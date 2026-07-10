import { describe, expect, it } from 'vitest';
import {
  validateRepoContract,
  workflowJobBlocks,
} from '../scripts/check-repo-contract.js';

const PACKAGE_MANAGER = 'pnpm@10.30.3';
const ACTION_SHA = 'a7487c7e89a18df4991f7f222e4898a00d66ddda';

function job({
  id = 'verify',
  version = '10.30.3',
  actionRef = ACTION_SHA,
  install = true,
  verify = true,
  runner = 'ubuntu-latest',
  tail = '',
} = {}) {
  return `  ${id}:
    runs-on: ${runner}
    steps:
      - name: Setup pnpm
        uses: pnpm/action-setup@${actionRef}
        with:
          version: ${version}
      - name: Install
        run: ${install ? 'pnpm install --frozen-lockfile' : 'pnpm install'}
      - name: Verify
        run: ${verify ? 'pnpm verify' : 'pnpm build'}
${tail}`;
}

function workflow({ jobs = [job()] } = {}) {
  return `
name: Verify
jobs:
${jobs.join('\n')}
`;
}

function fixture({ packagePatch = {}, filesPatch = {}, existingPatch = {} } = {}) {
  const pkg = {
    packageManager: PACKAGE_MANAGER,
    engines: { node: '>=20', pnpm: '>=9' },
    scripts: {
      'check:repo-contract': 'node scripts/check-repo-contract.js',
      verify: 'node scripts/check-repo-contract.js && node scripts/build.js',
    },
    ...packagePatch,
  };
  const files = {
    'package.json': JSON.stringify(pkg),
    '.github/workflows/ci.yml': workflow(),
    '.github/workflows/release-dist.yml': workflow(),
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

  it('принимает независимые Linux и Windows job с полным контрактом в каждом', () => {
    const ci = workflow({
      jobs: [
        job({ id: 'linux', runner: 'ubuntu-latest' }),
        job({ id: 'windows', runner: 'windows-latest' }),
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

  it('кусается, если второй runner не выполняет собственный verify', () => {
    const ci = workflow({
      jobs: [
        job({ id: 'linux' }),
        job({ id: 'windows', runner: 'windows-latest', verify: false }),
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

  it('кусается, если workflow обходит pnpm verify', () => {
    const errors = fixture({
      filesPatch: {
        '.github/workflows/ci.yml': workflow({ jobs: [job({ verify: false })] }),
      },
    });
    expect(errors.some((error) => error.includes('одной командой «pnpm verify»'))).toBe(true);
    expect(errors.some((error) => error.includes('второй список истины'))).toBe(true);
  });

  it('кусается, если сам гейт исключён из начала verify', () => {
    const errors = fixture({
      packagePatch: {
        scripts: {
          'check:repo-contract': 'node scripts/check-repo-contract.js',
          verify: 'node scripts/build.js',
        },
      },
    });
    expect(errors).toContain(
      'package.json: verify обязан начинаться с check-repo-contract, чтобы дрейф кусался до сборки',
    );
  });
});
