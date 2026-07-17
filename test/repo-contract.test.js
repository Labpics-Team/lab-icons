import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  checkoutBlocks,
  hasCanonicalVerify,
  pushTokenLinesFromRunSteps,
  releaseWorkflowErrors,
  validateRepoContract,
  workflowJobBlocks,
} from '../scripts/check-repo-contract.js';

const PACKAGE_MANAGER = 'pnpm@10.30.3';
const ACTION_SHA = 'a7487c7e89a18df4991f7f222e4898a00d66ddda';
const RELEASE_CONTRACT = JSON.parse(
  readFileSync(new URL('../release/contract.json', import.meta.url), 'utf8'),
);

function verifyStep(mode) {
  if (mode === 'logged-windows') {
    return `      - name: Verify
        shell: pwsh
        run: |
          pnpm verify 2>&1 | Tee-Object -FilePath verify-windows.log
          $verifyExit = $LASTEXITCODE
          if ($verifyExit -ne 0) { exit $verifyExit }
`;
  }
  if (mode === 'logged-linux') {
    return `      - name: Verify
        shell: bash
        run: |
          set -o pipefail
          pnpm verify 2>&1 | tee verify-linux.log
`;
  }
  return `      - name: Verify
        run: ${mode === 'direct' ? 'pnpm verify' : 'pnpm build'}
`;
}

function job({
  id = 'verify',
  version = '10.30.3',
  actionRef = ACTION_SHA,
  install = true,
  verify = 'direct',
  runner = 'ubuntu-latest',
  tail = '',
} = {}) {
  return `  ${id}:
    runs-on: ${runner}
    steps:
      - name: Checkout
        uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
        with:
          fetch-depth: 0
      - name: Setup pnpm
        uses: pnpm/action-setup@${actionRef}
        with:
          version: ${version}
      - name: Install
        run: ${install ? 'pnpm install --frozen-lockfile' : 'pnpm install'}
${verifyStep(verify)}${tail}`;
}

function workflow({ jobs = [job()] } = {}) {
  return `
name: Verify
jobs:
${jobs.join('\n')}
`;
}

function releaseWorkflow() {
  const provenance = `      - name: Validate source
        env:
          RELEASE_TAG: \${{ inputs.tag || github.ref_name }}
        run: node scripts/check-release-ref.js source "$RELEASE_TAG"
      - name: Publish
        env:
          RELEASE_TAG: \${{ inputs.tag || github.ref_name }}
        run: |
          git fetch --no-tags origin "refs/tags/\${DIST_TAG}:refs/tags/\${DIST_TAG}"
          node scripts/check-release-ref.js dist "$TAG"
          node scripts/stage-release-dist.js
          node scripts/check-release-ref.js dist "$TAG"
          git push origin "refs/tags/\${DIST_TAG}"
`;
  return `on:
  workflow_dispatch:
    inputs:
      tag:
        description: 'Существующий source tag; branch/SHA запрещены'
${workflow({ jobs: [job({ id: 'release-dist', tail: provenance })] })}`.replace(
    '          fetch-depth: 0',
    `          fetch-depth: 0
          ref: \${{ github.event_name == 'workflow_dispatch' && format('refs/tags/{0}', inputs.tag) || github.ref }}`,
  );
}

function fixture({ packagePatch = {}, filesPatch = {}, existingPatch = {} } = {}) {
  const pkg = {
    name: RELEASE_CONTRACT.packageName,
    version: '0.2.0',
    private: false,
    main: RELEASE_CONTRACT.exports['.'].import,
    module: RELEASE_CONTRACT.exports['.'].import,
    types: RELEASE_CONTRACT.exports['.'].types,
    publishConfig: { access: RELEASE_CONTRACT.primary.access },
    files: RELEASE_CONTRACT.files,
    exports: RELEASE_CONTRACT.exports,
    packageManager: PACKAGE_MANAGER,
    engines: { node: '>=20', pnpm: '>=9' },
    scripts: {
      build: 'pnpm build:static && pnpm build:catalog && pnpm build:runtime',
      'build:static': 'node scripts/build.js && node scripts/build-anatomy.js',
      'build:catalog': 'node scripts/build-catalog.mjs',
      'build:runtime': 'node scripts/clean-runtime-dist.js && tsup && node scripts/build-animate-cjs-types.js',
      'check:repo-contract': 'node scripts/check-repo-contract.js',
      prepack: 'pnpm build',
      verify: 'node scripts/check-repo-contract.js && node scripts/check-catalog.js && pnpm build',
    },
    ...packagePatch,
  };
  const files = {
    'package.json': JSON.stringify(pkg),
    'release/contract.json': JSON.stringify(RELEASE_CONTRACT),
    '.github/workflows/ci.yml': workflow(),
    '.github/workflows/release-dist.yml': releaseWorkflow(),
    ...filesPatch,
  };
  const existing = {
    'pnpm-lock.yaml': true,
    ...existingPatch,
  };

  return validateRepoContract({
    root: '/virtual',
    readText(relativePath) {
      if (!(relativePath in files)) throw new Error('ENOENT');
      return files[relativePath];
    },
    fileExists(relativePath) {
      return existing[relativePath] === true;
    },
  });
}

describe('check-repo-contract', () => {
  it('принимает один pnpm, один lockfile и единый verify-вход', () => {
    expect(fixture()).toEqual([]);
  });

  it('кусается, если npm projection расходится с release SSOT', () => {
    expect(fixture({ packagePatch: { files: ['dist/index.js'] } })).toContain(
      'package.json#files дрейфует от release contract',
    );
  });

  it('принимает независимые Linux и Windows job с полным контрактом в каждом', () => {
    const ci = workflow({
      jobs: [
        job({ id: 'linux', runner: 'ubuntu-latest', verify: 'logged-linux' }),
        job({ id: 'windows', runner: 'windows-latest', verify: 'logged-windows' }),
      ],
    });
    expect(fixture({ filesPatch: { '.github/workflows/ci.yml': ci } })).toEqual([]);
  });

  it('не путает nested keys с отдельными job', () => {
    const text = `
name: Verify
jobs:
  matrix:
    strategy:
      matrix:
        os: [ubuntu-latest, windows-latest]
    runs-on: \${{ matrix.os }}
    steps:
      - uses: pnpm/action-setup@${ACTION_SHA}
        with:
          version: 10.30.3
      - run: pnpm install --frozen-lockfile
      - run: pnpm verify
`;
    expect(workflowJobBlocks(text).map((entry) => entry.id)).toEqual(['matrix']);
  });

  it('принимает только Windows wrapper с обязательным пробросом exit code', () => {
    const valid = verifyStep('logged-windows');
    const masked = valid.replace(
      'if ($verifyExit -ne 0) { exit $verifyExit }',
      'if ($verifyExit -ne 0) { Write-Host masked }',
    );
    expect(hasCanonicalVerify(valid)).toBe(true);
    expect(hasCanonicalVerify(masked)).toBe(false);
    expect(hasCanonicalVerify('run: pnpm verify || true')).toBe(false);
  });

  it('принимает Linux wrapper только с pipefail', () => {
    const valid = verifyStep('logged-linux');
    const masked = valid.replace('set -o pipefail\n', '');
    expect(hasCanonicalVerify(valid)).toBe(true);
    expect(hasCanonicalVerify(masked)).toBe(false);
  });

  it('кусается, если второй runner не выполняет собственный verify', () => {
    const ci = workflow({
      jobs: [
        job({ id: 'linux' }),
        job({ id: 'windows', runner: 'windows-latest', verify: 'bypass' }),
      ],
    });
    const errors = fixture({ filesPatch: { '.github/workflows/ci.yml': ci } });
    expect(errors.some((error) => error.includes('job windows') && error.includes('pnpm verify'))).toBe(true);
    expect(errors.some((error) => error.includes('job windows') && error.includes('второй список истины'))).toBe(true);
  });

  it('кусается на pnpm verify без setup в том же job', () => {
    const orphan = `  orphan:
    runs-on: windows-latest
    steps:
      - run: pnpm verify
`;
    const ci = workflow({ jobs: [job({ id: 'linux' }), orphan] });
    const errors = fixture({ filesPatch: { '.github/workflows/ci.yml': ci } });
    expect(
      errors.some(
        (error) => error.includes('job orphan') && error.includes('pnpm/action-setup находится не в этом job'),
      ),
    ).toBe(true);
  });

  it('считает packageManager единственным SSOT версии pnpm', () => {
    const errors = fixture({ packagePatch: { packageManager: 'pnpm@10.31.0' } });
    expect(errors.filter((error) => error.includes('pnpm action обязан использовать 10.31.0'))).toHaveLength(2);
  });

  it('запрещает плавающий packageManager', () => {
    expect(fixture({ packagePatch: { packageManager: 'pnpm@latest' } })).toContain(
      'package.json: packageManager обязан быть точной версией вида pnpm@X.Y.Z; найдено pnpm@latest',
    );
  });

  it('кусается на втором lockfile', () => {
    expect(fixture({ existingPatch: { 'package-lock.json': true } })).toContain(
      'package-lock.json: второй lockfile запрещён; SSOT зависимостей — pnpm-lock.yaml',
    );
  });

  it('кусается на дрейфе версии pnpm в CI', () => {
    const errors = fixture({
      filesPatch: {
        '.github/workflows/ci.yml': workflow({ jobs: [job({ version: '9.15.0' })] }),
      },
    });
    expect(errors.some((error) => error.includes('pnpm action обязан использовать 10.30.3'))).toBe(true);
  });

  it('игнорирует version inputs чужих actions', () => {
    const tail = `      - name: Unrelated action
        uses: example/action@0123456789012345678901234567890123456789
        with:
          version: 7
`;
    const ci = workflow({ jobs: [job({ tail })] });
    expect(fixture({ filesPatch: { '.github/workflows/ci.yml': ci } })).toEqual([]);
  });

  it('требует полный SHA у pnpm/action-setup', () => {
    const errors = fixture({
      filesPatch: {
        '.github/workflows/ci.yml': workflow({ jobs: [job({ actionRef: 'v4' })] }),
      },
    });
    expect(errors.some((error) => error.includes('40-символьным SHA'))).toBe(true);
  });

  it('требует frozen install в каждом pnpm job', () => {
    const errors = fixture({
      filesPatch: {
        '.github/workflows/ci.yml': workflow({ jobs: [job({ install: false })] }),
      },
    });
    expect(errors.some((error) => error.includes('pnpm install --frozen-lockfile'))).toBe(true);
  });

  it('требует полную history в каждом verify job', () => {
    expect(checkoutBlocks(job())).toEqual([{
      ref: '11bd71901bbe5b1630ceea73d27597364c9af683',
      fetchDepth: '0',
    }]);
    const shallow = workflow({ jobs: [job().replace('fetch-depth: 0', 'fetch-depth: 1')] });
    const errors = fixture({ filesPatch: { '.github/workflows/ci.yml': shallow } });
    expect(errors.some((error) => error.includes('fetch-depth: 0'))).toBe(true);
  });

  it('кусается на manual branch/SHA и blind exit существующего -dist', () => {
    const bad = releaseWorkflow()
      .replace("format('refs/tags/{0}', inputs.tag)", 'inputs.tag')
      .replace('branch/SHA запрещены', 'разрешён любой ref')
      .replace('git fetch --no-tags origin "refs/tags/${DIST_TAG}:refs/tags/${DIST_TAG}"', 'echo skip-fetch')
      .replace('node scripts/check-release-ref.js dist "$TAG"', 'echo blind-exit')
      .replace('run: node scripts/check-release-ref.js source "$RELEASE_TAG"', 'run: node scripts/check-release-ref.js source "${{ inputs.tag }}"');
    const errors = releaseWorkflowErrors(bad);
    expect(errors.some((error) => error.includes('refs/tags'))).toBe(true);
    expect(errors.some((error) => error.includes('branch/SHA'))).toBe(true);
    expect(errors.some((error) => error.includes('existing sibling'))).toBe(true);
    expect(errors.some((error) => error.includes('existing и new tag'))).toBe(true);
    expect(errors.some((error) => error.includes('прямо в shell'))).toBe(true);
  });

  it('кусается на rogue second job под workflow-level contents:write', () => {
    const rogue = `${releaseWorkflow()}  retag-anything:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683
      - run: git tag hostile && git push origin hostile
`;
    const errors = fixture({ filesPatch: { '.github/workflows/release-dist.yml': rogue } });
    expect(errors.some((error) => error.includes('ровно одному job release-dist'))).toBe(true);
  });

  it('кусается на второй либо force/branch push внутри owner job', () => {
    const rogue = releaseWorkflow().replace(
      'git push origin "refs/tags/${DIST_TAG}"',
      'git push origin "refs/tags/${DIST_TAG}"\n          git push --force origin HEAD:refs/heads/master',
    );
    const errors = fixture({ filesPatch: { '.github/workflows/release-dist.yml': rogue } });
    expect(errors.some((error) => error.includes('remote mutation surface'))).toBe(true);
  });

  it.each([
    'command git push --force origin HEAD:refs/heads/master',
    'env git push --force origin HEAD:refs/heads/master',
    'git -c push.default=current push --force origin HEAD:refs/heads/master',
  ])('кусается на prefixed/global-option remote mutation: %s', (roguePush) => {
    const rogue = releaseWorkflow().replace(
      'git push origin "refs/tags/${DIST_TAG}"',
      `git push origin "refs/tags/\${DIST_TAG}"\n          ${roguePush}`,
    );
    expect(pushTokenLinesFromRunSteps(rogue)).toContain(roguePush);
    const errors = fixture({ filesPatch: { '.github/workflows/release-dist.yml': rogue } });
    expect(errors.some((error) => error.includes('remote mutation surface'))).toBe(true);
  });

  it('кусается, если workflow обходит pnpm verify', () => {
    const errors = fixture({
      filesPatch: {
        '.github/workflows/ci.yml': workflow({ jobs: [job({ verify: 'bypass' })] }),
      },
    });
    expect(errors.some((error) => error.includes('канонической командой «pnpm verify»'))).toBe(true);
    expect(errors.some((error) => error.includes('второй список истины'))).toBe(true);
  });

  it('кусается, если сам гейт исключён из начала verify', () => {
    const errors = fixture({
      packagePatch: {
        scripts: {
          build: 'pnpm build:static && pnpm build:catalog && pnpm build:runtime',
          'build:static': 'node scripts/build.js && node scripts/build-anatomy.js',
          'build:catalog': 'node scripts/build-catalog.mjs',
          'build:runtime': 'node scripts/clean-runtime-dist.js && tsup && node scripts/build-animate-cjs-types.js',
          'check:repo-contract': 'node scripts/check-repo-contract.js',
          prepack: 'pnpm build',
          verify: 'node scripts/build.js',
        },
      },
    });
    expect(errors).toContain(
      'package.json: verify обязан начинаться с check-repo-contract, чтобы дрейф кусался до сборки',
    );
  });

  it('кусается, если build или prepack не строит весь release surface', () => {
    const errors = fixture({
      packagePatch: {
        scripts: {
          build: 'node scripts/build.js',
          'build:static': 'node scripts/build.js && node scripts/build-anatomy.js',
          'build:catalog': 'node scripts/build-catalog.mjs',
          'build:runtime': 'node scripts/clean-runtime-dist.js && tsup && node scripts/build-animate-cjs-types.js',
          'check:repo-contract': 'node scripts/check-repo-contract.js',
          prepack: 'node scripts/build.js',
          verify: 'node scripts/check-repo-contract.js && node scripts/build.js',
        },
      },
    });
    expect(errors.some((error) => error.includes('build обязан'))).toBe(true);
    expect(errors.some((error) => error.includes('prepack обязан'))).toBe(true);
    expect(errors).toContain('package.json: verify обязан ровно один раз вызывать канонический pnpm build');
    expect(errors).toContain('package.json: verify обходит канонический build через «node scripts/build.js»');
  });

  it('кусается, если build успевает перезаписать stale catalog до drift-check', () => {
    const errors = fixture({
      packagePatch: {
        scripts: {
          build: 'pnpm build:static && pnpm build:catalog && pnpm build:runtime',
          'build:static': 'node scripts/build.js && node scripts/build-anatomy.js',
          'build:catalog': 'node -e "process.exit(0)"',
          'build:runtime': 'node scripts/clean-runtime-dist.js && tsup && node scripts/build-animate-cjs-types.js',
          'check:repo-contract': 'node scripts/check-repo-contract.js',
          prepack: 'pnpm build',
          verify: 'node scripts/check-repo-contract.js && pnpm build && node scripts/check-catalog.js',
        },
      },
    });
    expect(errors).toContain(
      'package.json: verify обязан проверять catalog drift до typecheck/build, иначе build скроет stale projection',
    );
    expect(errors.some((error) => error.includes('build:catalog обязан'))).toBe(true);
  });
});
