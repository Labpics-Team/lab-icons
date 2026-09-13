import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { execFileSync, spawnSync } from 'node:child_process';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';

import {
  BASELINE_FREEZE_VERSION,
  RETROSPECTIVE_HOLDOUT_SIZE,
  buildCorpusFreeAuthoringProjection,
  buildHoldoutLeakSignals,
  buildRetrospectivePartition,
  buildSealedCorpusManifest,
  canonicalDigest,
  validateMotionIntentCensus,
  validateMotionIntentEvidence,
  validateStaticConsumerBaseline,
} from './baseline-freeze.js';

const EXPECTED_FAMILIES = 238;
const EXPECTED_VARIANTS = 476;

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function jsonBytes(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256File(path) {
  return sha256(readFileSync(path));
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

function defaultPnpmRunner({ root, args, env }) {
  const options = {
    cwd: root,
    env,
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    windowsHide: true,
  };
  if (process.platform === 'win32') {
    const shell = process.env.ComSpec || 'cmd.exe';
    const command = ['pnpm', ...args].join(' ');
    return spawnSync(shell, ['/d', '/s', '/c', command], options);
  }
  return spawnSync('pnpm', args, options);
}

function isWithin(parent, child) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function canonicalProspectivePath(value) {
  const target = resolve(value);
  let cursor = target;
  const missing = [];
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return target;
    missing.unshift(basename(cursor));
    cursor = parent;
  }
  return resolve(realpathSync.native(cursor), ...missing);
}

function publicGitWorktrees(sourceRoot) {
  return git(sourceRoot, ['worktree', 'list', '--porcelain'])
    .split(/\r?\n/)
    .filter((line) => line.startsWith('worktree '))
    .map((line) => canonicalProspectivePath(line.slice('worktree '.length)));
}

export function assertPrivateEvidencePath({ inputPath, sourceRoot, label = 'private evidence' }) {
  const candidate = canonicalProspectivePath(inputPath);
  if (publicGitWorktrees(sourceRoot).some((worktree) => isWithin(worktree, candidate))) {
    throw new Error(`baseline-workflow: ${label} must stay outside every public Git worktree`);
  }
  return candidate;
}

/**
 * Возвращает source identity только для чистого checkout на exact origin/main.
 * Freeze evidence не имеет права наследовать локальный branch/dirty drift.
 */
export function inspectExactSourceFence(sourceRoot) {
  const root = resolve(sourceRoot);
  const headSha = git(root, ['rev-parse', 'HEAD']);
  const originMainSha = git(root, ['rev-parse', 'refs/remotes/origin/main']);
  const dirty = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (headSha !== originMainSha || dirty.length > 0) {
    throw new Error('baseline-workflow: source checkout must be clean exact origin/main');
  }
  const treeSha = git(root, ['rev-parse', 'HEAD^{tree}']);
  const packageBytes = readFileSync(resolve(root, 'package.json'));
  const packageJson = JSON.parse(packageBytes.toString('utf8'));
  if (typeof packageJson.name !== 'string' || typeof packageJson.version !== 'string') {
    throw new Error('baseline-workflow: package name/version are required');
  }
  return {
    headSha,
    treeSha,
    package: {
      name: packageJson.name,
      version: packageJson.version,
      contractSha256: sha256(packageBytes),
    },
  };
}

/**
 * Выполняет канонический consumer gate самостоятельно. Caller не передаёт
 * готовые booleans: baseline строится только из результата exact-main verify.
 */
export function captureStaticConsumerBaseline({ sourceRoot, sourceFence, runner = defaultPnpmRunner }) {
  const root = resolve(sourceRoot);
  const observedFence = inspectExactSourceFence(root);
  if (canonicalDigest(observedFence) !== canonicalDigest(sourceFence)) {
    throw new Error('baseline-workflow: static consumer source fence drifted before verify');
  }

  const pkgPath = resolve(root, 'package.json');
  const packageJson = JSON.parse(readFileSync(pkgPath, 'utf8'));
  const verifyScript = packageJson?.scripts?.verify;
  if (typeof verifyScript !== 'string'
      || !verifyScript.includes('node scripts/check-package-artifact.js')
      || !verifyScript.includes('vitest run')) {
    throw new Error('baseline-workflow: canonical verify no longer proves clean package + full test suite');
  }

  const env = { ...process.env, CI: 'true' };
  const install = runner({ root, args: ['install', '--frozen-lockfile'], env });
  if (install.error || install.status !== 0) {
    throw new Error(`baseline-workflow: CI install failed (${install.status ?? 'spawn-error'})`);
  }
  const verify = runner({ root, args: ['verify'], env });
  const verifyOutput = stripAnsi(`${verify.stdout ?? ''}\n${verify.stderr ?? ''}`);
  if (verify.error || verify.status !== 0) {
    const tail = verifyOutput.slice(-4000).trim();
    throw new Error(`baseline-workflow: CI verify failed (${verify.status ?? 'spawn-error'})${tail ? `\n${tail}` : ''}`);
  }
  if (!/check-package-artifact: OK\b/.test(verifyOutput)) {
    throw new Error('baseline-workflow: verify output lacks clean package artifact witness');
  }
  const testFiles = /Test Files\s+(\d+) passed/.exec(verifyOutput);
  const tests = /\bTests\s+(\d+) passed/.exec(verifyOutput);
  if (!testFiles || !tests) {
    throw new Error('baseline-workflow: verify output lacks complete Vitest pass counts');
  }

  const afterFence = inspectExactSourceFence(root);
  if (canonicalDigest(afterFence) !== canonicalDigest(sourceFence)) {
    throw new Error('baseline-workflow: source fence drifted during static consumer verify');
  }

  const nodeVersion = process.version;
  const pnpmVersionResult = runner({ root, args: ['--version'], env });
  if (pnpmVersionResult.error || pnpmVersionResult.status !== 0) {
    throw new Error('baseline-workflow: cannot read pnpm version');
  }
  const pnpmVersion = stripAnsi(pnpmVersionResult.stdout).trim();
  if (!pnpmVersion) throw new Error('baseline-workflow: empty pnpm version');

  return {
    schema: 'labpics.icons-static-consumer-baseline/1',
    sourceFenceDigest: canonicalDigest(sourceFence),
    command: 'CI=true pnpm verify',
    exitCode: 0,
    toolchain: { node: nodeVersion, pnpm: pnpmVersion },
    checks: {
      testFilesPassed: Number(testFiles[1]),
      testsPassed: Number(tests[1]),
      cleanSourcePackFreshInstall: true,
      candidateOptInFailClosed: true,
      unsupportedAxisRefusal: true,
      staticSvgAndAcceptedIr: true,
      motionAdaptersNotExported: true,
      sourceCleanAfter: true,
    },
    digests: {
      packageJsonSha256: sha256File(pkgPath),
      pnpmLockSha256: sha256File(resolve(root, 'pnpm-lock.yaml')),
      releaseContractSha256: sha256File(resolve(root, 'release/contract.json')),
    },
  };
}

/**
 * Собирает один связанный freeze bundle. Функция не пишет файлов и не делает
 * provider/network effects: это verifier-side компиляция уже зафиксированных входов.
 */
export function buildBaselineFreezeBundle({
  sourceRoot,
  sourceFence,
  partitionSeed,
  catalog,
  axisQuality,
  motionRows,
  motionEvidence,
  staticConsumerBaseline,
  contracts = [],
}) {
  const partition = buildRetrospectivePartition({ catalog, sourceFence, partitionSeed });
  const manifest = buildSealedCorpusManifest({ catalog, axisQuality, sourceFence, partition });
  const motion = validateMotionIntentCensus({ catalog, rows: motionRows });
  const motionEvidenceReceipt = validateMotionIntentEvidence({ motionCensus: motion, evidence: motionEvidence });
  const consumer = validateStaticConsumerBaseline({ sourceFence, baseline: staticConsumerBaseline });
  const signals = buildHoldoutLeakSignals({ root: sourceRoot, catalog, partition });
  const authoring = buildCorpusFreeAuthoringProjection({
    sealedManifest: manifest,
    signals,
    motionCensus: motion,
    contracts,
  });

  const receiptCore = {
    schema: 'labpics.icons-baseline-freeze-receipt/1',
    version: BASELINE_FREEZE_VERSION,
    sourceFenceDigest: manifest.sourceFenceDigest,
    partitionDigest: canonicalDigest(partition),
    partitionSeedCommitment: partition.seedCommitment,
    sealedManifestDigest: canonicalDigest(manifest),
    motionCensusDigest: motion.digest,
    motionEvidenceDigest: motionEvidenceReceipt.digest,
    staticConsumerBaselineDigest: consumer.digest,
    authoringProjectionDigest: authoring.projectionDigest,
    leakSignalsDigest: canonicalDigest(signals),
  };

  const publicSummary = {
    schema: 'labpics.icons-baseline-public-summary/1',
    version: BASELINE_FREEZE_VERSION,
    sourceFenceDigest: manifest.sourceFenceDigest,
    corpus: {
      families: EXPECTED_FAMILIES,
      variants: EXPECTED_VARIANTS,
      trainFamilies: EXPECTED_FAMILIES - RETROSPECTIVE_HOLDOUT_SIZE,
      sealedHoldoutFamilies: RETROSPECTIVE_HOLDOUT_SIZE,
    },
    partitionSeedCommitment: partition.seedCommitment,
  };

  const receipt = {
    ...receiptCore,
    bundleDigest: canonicalDigest({ receiptCore, publicSummary }),
  };

  return {
    version: BASELINE_FREEZE_VERSION,
    sealed: {
      partition,
      manifest,
      motion,
      motionEvidence: motionEvidenceReceipt,
      leakSignals: signals,
    },
    authoring,
    staticConsumer: consumer.baseline,
    publicSummary,
    receipt,
  };
}

function assertEmptyExternalOutput(outputRoot, sourceRoot) {
  const output = canonicalProspectivePath(outputRoot);
  const source = canonicalProspectivePath(sourceRoot);
  if (isWithin(source, output)) {
    throw new Error('baseline-workflow: private freeze output must stay outside public source checkout');
  }
  if (publicGitWorktrees(source).some((worktree) => isWithin(worktree, output))) {
    throw new Error('baseline-workflow: private freeze output must stay outside every public Git worktree');
  }
  if (existsSync(output) && readdirSync(output).length > 0) {
    throw new Error('baseline-workflow: private freeze output directory must be empty');
  }
  return output;
}

/** Материализует private staging bundle без перезаписи существующих evidence bytes. */
export function writeBaselineFreezeBundle({ bundle, outputRoot, sourceRoot }) {
  const output = assertEmptyExternalOutput(outputRoot, sourceRoot);
  mkdirSync(resolve(output, 'sealed'), { recursive: true });
  mkdirSync(resolve(output, 'authoring'), { recursive: true });

  const files = new Map([
    ['sealed/partition.json', bundle.sealed.partition],
    ['sealed/corpus-manifest.json', bundle.sealed.manifest],
    ['sealed/motion-intent.json', bundle.sealed.motion],
    ['sealed/motion-evidence.json', bundle.sealed.motionEvidence],
    ['sealed/leak-signals.json', bundle.sealed.leakSignals],
    ['authoring/projection.json', bundle.authoring],
    ['static-consumer-baseline.json', bundle.staticConsumer],
    ['public-summary.json', bundle.publicSummary],
    ['receipt.json', bundle.receipt],
  ]);
  for (const [path, value] of files) {
    writeFileSync(resolve(output, path), jsonBytes(value), { flag: 'wx' });
  }
  return {
    outputRoot: output,
    files: [...files.keys()],
    receipt: bundle.receipt,
  };
}
