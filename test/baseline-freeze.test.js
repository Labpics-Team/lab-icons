import { execFileSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  captureVerifyReceipt,
  createPnpmRunner,
  freezeBaseline,
  inspectExactSourceFence,
  parseFreezeArgs,
  publishImmutableReceipt,
  verifyFrozenBaselineIdentity,
} from '../scripts/lib/baseline-freeze.js';
import { loadBaselineSourceEvidence } from '../scripts/lib/baseline-evidence.js';
import { runFreezeBaselineCli } from '../scripts/lib/baseline-cli.js';
import { canonicalDigest } from '../scripts/lib/baseline-snapshot.js';

const root = join(import.meta.dirname, '..');
const sourceFence = {
  headSha: '73835162207a790831a831fb962fee29270ec3e1',
  treeSha: '4'.repeat(40),
  package: {
    name: '@labpics/icons',
    version: '0.3.0',
    packageJsonSha256: 'a'.repeat(64),
    pnpmLockSha256: 'b'.repeat(64),
    releaseContractSha256: 'c'.repeat(64),
  },
};

const tempRoots = [];
afterEach(() => {
  for (const path of tempRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function successfulRunner(calls) {
  return ({ args, env }) => {
    calls.push({ args, ci: env.CI });
    if (args[0] === 'verify') {
      return {
        status: 0,
        stdout: [
          'check-package-artifact: OK',
          ' Test Files  79 passed (79)',
          '      Tests  909 passed (909)',
        ].join('\n'),
        stderr: '',
      };
    }
    if (args[0] === '--version') return { status: 0, stdout: '11.13.1\n', stderr: '' };
    return { status: 0, stdout: '', stderr: '' };
  };
}

function runGit(cwd, args) {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function exactSourceFixture() {
  const target = mkdtempSync(join(tmpdir(), 'lab-icons-exact-source-'));
  tempRoots.push(target);
  const remote = join(target, 'remote.git');
  const source = join(target, 'source');
  execFileSync('git', ['init', '--bare', remote], { stdio: 'ignore' });
  execFileSync('git', ['init', '-b', 'main', source], { stdio: 'ignore' });
  runGit(source, ['config', 'user.email', 'baseline-test@lab.pics']);
  runGit(source, ['config', 'user.name', 'Baseline Test']);
  mkdirSync(join(source, 'release'), { recursive: true });
  writeFileSync(join(source, 'package.json'), '{"name":"@labpics/icons","version":"0.0.0"}\n');
  writeFileSync(join(source, 'pnpm-lock.yaml'), 'lockfileVersion: 9.0\n');
  writeFileSync(join(source, 'release', 'contract.json'), '{}\n');
  runGit(source, ['add', '.']);
  runGit(source, ['commit', '-m', 'fixture']);
  runGit(source, ['remote', 'add', 'origin', remote]);
  runGit(source, ['push', '-u', 'origin', 'main']);
  return source;
}

describe('BASELINE-08: effect-граница freeze', () => {
  it('real source fence требует clean exact origin/main и различает оба класса drift', () => {
    const source = exactSourceFixture();
    const clean = inspectExactSourceFence(source);
    expect(clean.headSha).toBe(runGit(source, ['rev-parse', 'refs/remotes/origin/main']));

    writeFileSync(join(source, 'package.json'), '{"name":"@labpics/icons","version":"0.0.1"}\n');
    runGit(source, ['add', 'package.json']);
    runGit(source, ['commit', '-m', 'diverge head']);
    expect(() => inspectExactSourceFence(source)).toThrow(/clean exact origin\/main/);

    runGit(source, ['reset', '--hard', 'origin/main']);
    writeFileSync(join(source, 'package.json'), '{"name":"@labpics/icons","version":"dirty"}\n');
    expect(() => inspectExactSourceFence(source)).toThrow(/clean exact origin\/main/);

    runGit(source, ['checkout', '--', 'package.json']);
    writeFileSync(join(source, 'untracked.txt'), 'untracked\n');
    expect(() => inspectExactSourceFence(source)).toThrow(/clean exact origin\/main/);
  });

  it('default pnpm runner ограничивает каждый процесс timeout и SIGTERM', () => {
    const calls = [];
    const runner = createPnpmRunner({
      timeoutMs: 1234,
      spawn(command, args, options) {
        calls.push({ command, args, options });
        return { status: 0, stdout: '11.13.1\n', stderr: '' };
      },
    });

    runner({ root: '.', args: ['--version'], env: { CI: 'true' } });
    expect(calls).toHaveLength(1);
    expect(calls[0].options).toMatchObject({ timeout: 1234, killSignal: 'SIGTERM' });
  });

  it('receipt получается только после install, verify, toolchain readback и двух source-fence проверок', () => {
    const calls = [];
    const inspections = [];
    const receipt = captureVerifyReceipt({
      sourceRoot: '.',
      sourceFence,
      runner: successfulRunner(calls),
      inspectSourceFence(root) {
        inspections.push(root);
        return sourceFence;
      },
    });

    expect(calls).toEqual([
      { args: ['install', '--frozen-lockfile'], ci: 'true' },
      { args: ['verify'], ci: 'true' },
      { args: ['--version'], ci: 'true' },
    ]);
    expect(inspections).toHaveLength(2);
    expect(receipt).toMatchObject({
      schema: 'labpics.icons-baseline-verify/2',
      status: 'passed',
      sourceFenceDigest: canonicalDigest(sourceFence),
      toolchain: { pnpm: '11.13.1' },
      observations: {
        testFilesPassed: 79,
        testsPassed: 909,
        packageArtifactWitness: true,
      },
    });
  });

  it('не выдаёт receipt при failed install, слабом verify witness или source drift', () => {
    const installCalls = [];
    expect(() => captureVerifyReceipt({
      sourceRoot: '.',
      sourceFence,
      inspectSourceFence: () => sourceFence,
      runner({ args, env }) {
        installCalls.push({ args, ci: env.CI });
        return { status: 1, stdout: '', stderr: 'fail' };
      },
    })).toThrow(/pnpm install failed/);
    expect(installCalls).toEqual([{ args: ['install', '--frozen-lockfile'], ci: 'true' }]);

    const weakCalls = [];
    expect(() => captureVerifyReceipt({
      sourceRoot: '.',
      sourceFence,
      inspectSourceFence: () => sourceFence,
      runner({ args, env }) {
        weakCalls.push({ args, ci: env.CI });
        if (args[0] === 'verify') return { status: 0, stdout: 'all green', stderr: '' };
        return { status: 0, stdout: '', stderr: '' };
      },
    })).toThrow(/direct required witnesses/);
    expect(weakCalls.map(({ args }) => args)).toEqual([
      ['install', '--frozen-lockfile'],
      ['verify'],
    ]);

    expect(() => captureVerifyReceipt({
      sourceRoot: '.',
      sourceFence,
      inspectSourceFence: () => sourceFence,
      runner({ args }) {
        if (args[0] === 'install') return { status: 0, stdout: '', stderr: '' };
        return { status: null, signal: 'SIGTERM', stdout: '', stderr: '' };
      },
    })).toThrow(/pnpm verify failed \(signal SIGTERM\)/);

    let inspection = 0;
    expect(() => captureVerifyReceipt({
      sourceRoot: '.',
      sourceFence,
      runner: successfulRunner([]),
      inspectSourceFence() {
        inspection += 1;
        return inspection === 1 ? sourceFence : { ...sourceFence, treeSha: 'drifted-tree' };
      },
    })).toThrow(/source fence drifted during verify/);
  });

  it('публикует receipt атомарно и не перезаписывает существующий target', () => {
    const targetRoot = mkdtempSync(join(tmpdir(), 'lab-icons-receipt-'));
    tempRoots.push(targetRoot);
    const source = join(targetRoot, 'source');
    const outputDir = join(targetRoot, 'output');
    mkdirSync(source);
    mkdirSync(outputDir);
    const output = join(outputDir, 'baseline.json');

    publishImmutableReceipt({ output, sourceRoot: source, contents: '{"ok":true}\n', stageId: () => 'first' });
    expect(readFileSync(output, 'utf8')).toBe('{"ok":true}\n');
    expect(() => publishImmutableReceipt({
      output,
      sourceRoot: source,
      contents: '{"ok":false}\n',
      stageId: () => 'second',
    })).toThrow();
    expect(readFileSync(output, 'utf8')).toBe('{"ok":true}\n');
    expect(readdirSync(outputDir).filter((name) => name.endsWith('.tmp'))).toEqual([]);
  });

  it('не создаёт каталог внутри frozen source до проверки output fence', () => {
    const targetRoot = mkdtempSync(join(tmpdir(), 'lab-icons-receipt-fence-order-'));
    tempRoots.push(targetRoot);
    const source = join(targetRoot, 'source');
    mkdirSync(source);
    const nested = join(source, 'new', 'nested');

    expect(() => publishImmutableReceipt({
      output: join(nested, 'baseline.json'),
      sourceRoot: source,
      contents: '{}\n',
      stageId: () => 'inside-source',
    })).toThrow(/outside the frozen source/);
    expect(existsSync(nested)).toBe(false);
  });

  it('не делает частичный target видимым при ошибке commit-перехода', () => {
    const targetRoot = mkdtempSync(join(tmpdir(), 'lab-icons-receipt-fault-'));
    tempRoots.push(targetRoot);
    const source = join(targetRoot, 'source');
    const outputDir = join(targetRoot, 'output');
    mkdirSync(source);
    mkdirSync(outputDir);
    const output = join(outputDir, 'baseline.json');
    const faultingFs = {
      closeSync,
      fsyncSync,
      mkdirSync,
      openSync,
      readFileSync,
      rmSync,
      writeFileSync,
      linkSync() {
        throw new Error('injected commit failure');
      },
    };

    expect(() => publishImmutableReceipt({
      output,
      sourceRoot: source,
      contents: '{"complete":true}\n',
      fs: faultingFs,
      stageId: () => 'fault',
    })).toThrow(/injected commit failure/);
    expect(existsSync(output)).toBe(false);
    expect(readdirSync(outputDir)).toEqual([]);
  });

  it('канонизирует alias внутри самой publish-операции', () => {
    const targetRoot = mkdtempSync(join(tmpdir(), 'lab-icons-receipt-race-'));
    tempRoots.push(targetRoot);
    const source = join(targetRoot, 'source');
    const safe = join(targetRoot, 'safe');
    const alias = join(targetRoot, 'alias');
    mkdirSync(source);
    mkdirSync(safe);
    symlinkSync(safe, alias, process.platform === 'win32' ? 'junction' : 'dir');

    const target = publishImmutableReceipt({
      sourceRoot: source,
      output: join(alias, 'baseline.json'),
      contents: '{"safe":true}\n',
      stageId: () => 'alias',
    });

    expect(target).toBe(join(realpathSync(safe), 'baseline.json'));
    expect(readFileSync(join(safe, 'baseline.json'), 'utf8')).toBe('{"safe":true}\n');
    expect(existsSync(join(source, 'baseline.json'))).toBe(false);
  });

  it('не публикует receipt при замене канонического parent до staging или commit', () => {
    const targetRoot = mkdtempSync(join(tmpdir(), 'lab-icons-receipt-parent-race-'));
    tempRoots.push(targetRoot);
    const source = join(targetRoot, 'source');
    mkdirSync(source);
    const directoryKind = process.platform === 'win32' ? 'junction' : 'dir';

    for (const phase of ['open', 'close']) {
      const safe = join(targetRoot, `safe-${phase}`);
      mkdirSync(safe);
      let swapped = false;
      const racingFs = {
        closeSync(descriptor) {
          closeSync(descriptor);
          if (phase === 'close' && !swapped) {
            swapped = true;
            const staging = readdirSync(safe).find((name) => name.includes('parent-race'));
            if (staging) rmSync(join(safe, staging), { force: true });
            rmSync(safe, { recursive: true, force: true });
            symlinkSync(source, safe, directoryKind);
          }
        },
        fsyncSync,
        linkSync,
        mkdirSync,
        openSync(path, flags, mode) {
          if (phase === 'open' && !swapped) {
            swapped = true;
            rmSync(safe, { recursive: true, force: true });
            symlinkSync(source, safe, directoryKind);
          }
          return openSync(path, flags, mode);
        },
        readFileSync,
        rmSync,
        writeFileSync,
      };

      expect(() => publishImmutableReceipt({
        output: join(safe, 'baseline.json'),
        sourceRoot: source,
        contents: 'race-complete\n',
        fs: racingFs,
        stageId: () => `parent-race-${phase}`,
      })).toThrow('baseline-freeze: output must stay outside the frozen source checkout');
      expect(existsSync(join(source, 'baseline.json')), phase).toBe(false);
      expect(readdirSync(source).filter((name) => name.includes('parent-race')), phase).toEqual([]);
    }
  });

  it('freeze orchestration связывает source, verify, tool identity и атомарную публикацию', () => {
    const targetRoot = mkdtempSync(join(tmpdir(), 'lab-icons-freeze-integration-'));
    tempRoots.push(targetRoot);
    const calls = [];
    const inspections = [];
    const result = freezeBaseline({
      sourceRoot: root,
      output: join(targetRoot, 'baseline.json'),
      toolRoot: root,
      runner: successfulRunner(calls),
      inspectSourceFence(currentRoot) {
        inspections.push(currentRoot);
        return sourceFence;
      },
    });

    expect(inspections).toHaveLength(4);
    expect(calls.map(({ args }) => args)).toEqual([
      ['install', '--frozen-lockfile'],
      ['verify'],
      ['--version'],
    ]);
    expect(result.snapshot.corpus).toEqual({ families: 238, variants: 476 });
    expect(JSON.parse(readFileSync(result.output, 'utf8'))).toEqual(result.snapshot);
  });

  it('не публикует receipt при source или tool drift после verify', () => {
    const targetRoot = mkdtempSync(join(tmpdir(), 'lab-icons-freeze-final-drift-'));
    tempRoots.push(targetRoot);
    const sourceOutput = join(targetRoot, 'source-drift.json');
    let inspection = 0;
    expect(() => freezeBaseline({
      sourceRoot: root,
      output: sourceOutput,
      toolRoot: root,
      runner: successfulRunner([]),
      inspectSourceFence() {
        inspection += 1;
        return inspection < 4 ? sourceFence : { ...sourceFence, treeSha: '5'.repeat(40) };
      },
    })).toThrow(/source fence drifted before receipt publication/);
    expect(existsSync(sourceOutput)).toBe(false);

    const toolOutput = join(targetRoot, 'tool-drift.json');
    let toolRead = 0;
    const stableToolIdentity = {
      schema: 'labpics.icons-baseline-tool/2',
      entrySha256: '1'.repeat(64),
      cliAdapterSha256: '6'.repeat(64),
      snapshotLibrarySha256: '2'.repeat(64),
      evidenceAdapterSha256: '7'.repeat(64),
      freezeAdapterSha256: '3'.repeat(64),
      corpusContractSha256: '4'.repeat(64),
      packageJsonSha256: '5'.repeat(64),
    };
    expect(() => freezeBaseline({
      sourceRoot: root,
      output: toolOutput,
      toolRoot: root,
      runner: successfulRunner([]),
      inspectSourceFence: () => sourceFence,
      toolIdentityBuilder() {
        toolRead += 1;
        return toolRead === 1
          ? stableToolIdentity
          : { ...stableToolIdentity, freezeAdapterSha256: '0'.repeat(64) };
      },
    })).toThrow(/tool identity drifted before receipt publication/);
    expect(existsSync(toolOutput)).toBe(false);
  });

  it('identity verifier повторно читает source и tool evidence вместо доверия сохранённым digest', () => {
    const targetRoot = mkdtempSync(join(tmpdir(), 'lab-icons-freeze-verify-'));
    tempRoots.push(targetRoot);
    const result = freezeBaseline({
      sourceRoot: root,
      output: join(targetRoot, 'baseline.json'),
      toolRoot: root,
      runner: successfulRunner([]),
      inspectSourceFence: () => sourceFence,
    });

    expect(() => verifyFrozenBaselineIdentity({
      expected: result.snapshot,
      sourceRoot: root,
      toolRoot: root,
      inspectSourceFence: () => sourceFence,
    })).not.toThrow();

    expect(() => verifyFrozenBaselineIdentity({
      expected: result.snapshot,
      sourceRoot: root,
      toolRoot: root,
      inspectSourceFence: () => sourceFence,
      toolIdentityBuilder() {
        return { ...result.snapshot.toolIdentity, freezeAdapterSha256: '0'.repeat(64) };
      },
    })).toThrow(/snapshot drift/);

    const driftedEvidence = loadBaselineSourceEvidence(root);
    driftedEvidence.sourceFileDigests[result.snapshot.variants[0].sourceFile] = '0'.repeat(64);
    expect(() => verifyFrozenBaselineIdentity({
      expected: result.snapshot,
      sourceRoot: root,
      toolRoot: root,
      inspectSourceFence: () => sourceFence,
      sourceEvidenceLoader: () => driftedEvidence,
    })).toThrow(/snapshot drift/);
  });

  it('CLI parser отвергает missing, duplicate и неизвестные аргументы', () => {
    expect(() => parseFreezeArgs(['--source-root', '.'])).toThrow(/missing --output/);
    expect(() => parseFreezeArgs(['--source-root', '.', '--source-root', '..', '--output', 'x.json']))
      .toThrow(/duplicate argument --source-root/);
    expect(() => parseFreezeArgs(['--source-root', '.', '--wat', 'x', '--output', 'x.json']))
      .toThrow(/unsupported or duplicate argument --wat/);
    expect(parseFreezeArgs(['--source-root', '.', '--output', 'x.json'])).toEqual({
      sourceRoot: resolve('.'),
      output: resolve('x.json'),
    });
  });

  it('CLI печатает identity summary фактического freeze result', () => {
    const writes = [];
    const expectedOutput = resolve('canonical-baseline.json');
    const requestedOutput = resolve('requested-baseline.json');
    const expected = {
      output: expectedOutput,
      requestedOutput,
      sourceFence,
      snapshot: {
        corpus: { families: 238, variants: 476 },
        modelStates: { accepted: 53, candidate: 91, sourceOnly: 332 },
        debt: { quarantinedVariants: 10, disabledAxisEntries: 66 },
        receiptDigest: 'f'.repeat(64),
      },
    };
    const sourceRoot = resolve('source-root');
    const output = resolve('output.json');
    const summary = runFreezeBaselineCli({
      argv: ['--source-root', sourceRoot, '--output', output],
      toolRoot: root,
      stdout: { write: (value) => writes.push(value) },
      freeze(args) {
        expect(args).toEqual({ sourceRoot, output, toolRoot: root });
        return expected;
      },
    });

    expect(JSON.parse(writes.join(''))).toEqual(summary);
    expect(summary).toEqual({
      output: expectedOutput,
      requestedOutput,
      sourceHeadSha: sourceFence.headSha,
      corpus: expected.snapshot.corpus,
      modelStates: expected.snapshot.modelStates,
      debt: expected.snapshot.debt,
      receiptDigest: expected.snapshot.receiptDigest,
    });
  });
});
