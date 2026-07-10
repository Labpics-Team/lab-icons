import { describe, expect, it } from 'vitest';
import { validateRepoContract } from '../scripts/check-repo-contract.js';

const PACKAGE_MANAGER = 'pnpm@10.30.3';

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
  const workflow = (version = '10.30.3') => `
name: Verify
jobs:
  verify:
    steps:
      - uses: pnpm/action-setup@sha
        with:
          version: ${version}
      - run: pnpm verify
`;
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

  it('кусается на втором lockfile', () => {
    expect(fixture({ existingPatch: { 'package-lock.json': true } })).toContain(
      'package-lock.json: второй lockfile запрещён; SSOT зависимостей — pnpm-lock.yaml',
    );
  });

  it('кусается на дрейфе версии pnpm в CI', () => {
    const errors = fixture({
      filesPatch: {
        '.github/workflows/ci.yml': `
name: Verify
jobs:
  verify:
    steps:
      - uses: pnpm/action-setup@sha
        with:
          version: 9
      - run: pnpm verify
`,
      },
    });
    expect(errors.some((error) => error.includes('pnpm action обязан использовать 10.30.3'))).toBe(true);
  });

  it('кусается, если workflow обходит pnpm verify', () => {
    const errors = fixture({
      filesPatch: {
        '.github/workflows/ci.yml': `
name: Verify
jobs:
  verify:
    steps:
      - uses: pnpm/action-setup@sha
        with:
          version: 10.30.3
      - run: pnpm build
`,
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
