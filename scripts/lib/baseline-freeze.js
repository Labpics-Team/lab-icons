import { createHash, randomUUID } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import {
  closeSync,
  existsSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

import {
  BASELINE_INPUTS,
  buildBaselineSnapshot,
  canonicalDigest,
  compareBaselineSnapshot,
  parseVerifyObservations,
  stripBaselineAnsi,
} from './baseline-snapshot.js';

const DEFAULT_RECEIPT_FS = Object.freeze({
  closeSync,
  fsyncSync,
  linkSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
});

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF+/, ''));
}

function fileDigest(root, relativePath) {
  return sha256(readFileSync(resolve(root, relativePath)));
}

export function loadBaselineSourceEvidence(sourceRoot) {
  const root = resolve(sourceRoot);
  const catalog = readJson(resolve(root, 'semantics/catalog.json'));
  const candidateVariants = readJson(resolve(root, 'semantics/candidate-variants.json'));
  const modelQuality = readJson(resolve(root, 'semantics/model-quality.json'));
  const axisQuality = readJson(resolve(root, 'semantics/axis-quality.json'));
  const sourceFiles = new Set();
  for (const family of Object.values(catalog.icons ?? {})) {
    for (const variant of ['outline', 'filled']) {
      const sourceFile = family?.source?.[variant]?.file;
      if (typeof sourceFile === 'string' && sourceFile.length > 0) sourceFiles.add(sourceFile);
    }
  }
  return {
    catalog,
    candidateVariants,
    modelQuality,
    axisQuality,
    inputDigests: Object.fromEntries(BASELINE_INPUTS.map((path) => [path, fileDigest(root, path)])),
    sourceFileDigests: Object.fromEntries([...sourceFiles].map((path) => [path, fileDigest(root, path)])),
  };
}

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

export function inspectExactSourceFence(sourceRoot) {
  const root = resolve(sourceRoot);
  const headSha = git(root, ['rev-parse', 'HEAD']);
  const originMainSha = git(root, ['rev-parse', 'refs/remotes/origin/main']);
  const dirty = git(root, ['status', '--porcelain=v1', '--untracked-files=all']);
  if (headSha !== originMainSha || dirty.length > 0) {
    throw new Error('baseline-snapshot: source must be clean exact origin/main');
  }
  const packageJson = readJson(resolve(root, 'package.json'));
  return {
    headSha,
    treeSha: git(root, ['rev-parse', 'HEAD^{tree}']),
    package: {
      name: packageJson.name,
      version: packageJson.version,
      packageJsonSha256: fileDigest(root, 'package.json'),
      pnpmLockSha256: fileDigest(root, 'pnpm-lock.yaml'),
      releaseContractSha256: fileDigest(root, 'release/contract.json'),
    },
  };
}

export function buildToolIdentity(toolRoot) {
  const root = resolve(toolRoot);
  return {
    schema: 'labpics.icons-baseline-tool/1',
    entrySha256: fileDigest(root, 'scripts/freeze-baseline.mjs'),
    snapshotLibrarySha256: fileDigest(root, 'scripts/lib/baseline-snapshot.js'),
    freezeAdapterSha256: fileDigest(root, 'scripts/lib/baseline-freeze.js'),
    corpusContractSha256: fileDigest(root, 'scripts/lib/corpus-contract.js'),
    packageJsonSha256: fileDigest(root, 'package.json'),
  };
}

function isPathInside(base, candidate) {
  const pathFromBase = relative(base, candidate);
  return pathFromBase === ''
    || (!pathFromBase.startsWith(`..${sep}`)
      && pathFromBase !== '..'
      && !isAbsolute(pathFromBase));
}

function nearestExistingAncestor(path) {
  let current = resolve(path);
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) {
      throw new Error(`baseline-freeze: cannot resolve output parent ${path}`);
    }
    current = parent;
  }
  return current;
}

export function assertOutputOutsideSource({ output, sourceRoot }) {
  const source = realpathSync(resolve(sourceRoot));
  const target = resolve(output);
  const existingParent = nearestExistingAncestor(dirname(target));
  const resolvedParent = realpathSync(existingParent);
  const resolvedTarget = existsSync(target) ? realpathSync(target) : null;
  if (isPathInside(source, resolvedParent)
      || (resolvedTarget != null && isPathInside(source, resolvedTarget))) {
    throw new Error('baseline-freeze: output must stay outside the frozen source checkout');
  }
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
    return spawnSync(shell, ['/d', '/s', '/c', ['pnpm', ...args].join(' ')], options);
  }
  return spawnSync('pnpm', args, options);
}

export function captureVerifyReceipt({
  sourceRoot,
  sourceFence,
  runner = defaultPnpmRunner,
  inspectSourceFence = inspectExactSourceFence,
}) {
  const root = resolve(sourceRoot);
  const before = inspectSourceFence(root);
  if (canonicalDigest(before) !== canonicalDigest(sourceFence)) {
    throw new Error('baseline-snapshot: source fence drifted before verify');
  }
  const env = { ...process.env, CI: 'true' };
  const install = runner({ root, args: ['install', '--frozen-lockfile'], env });
  if (install.error || install.status !== 0) {
    throw new Error(`baseline-snapshot: pnpm install failed (${install.status ?? 'spawn-error'})`);
  }
  const verify = runner({ root, args: ['verify'], env });
  const output = stripBaselineAnsi(`${verify.stdout ?? ''}\n${verify.stderr ?? ''}`);
  if (verify.error || verify.status !== 0) {
    throw new Error(`baseline-snapshot: pnpm verify failed (${verify.status ?? 'spawn-error'})`);
  }
  const observations = parseVerifyObservations(output);
  const pnpm = runner({ root, args: ['--version'], env });
  if (pnpm.error || pnpm.status !== 0 || !String(pnpm.stdout ?? '').trim()) {
    throw new Error('baseline-snapshot: cannot identify pnpm toolchain');
  }
  const after = inspectSourceFence(root);
  if (canonicalDigest(after) !== canonicalDigest(sourceFence)) {
    throw new Error('baseline-snapshot: source fence drifted during verify');
  }
  return {
    schema: 'labpics.icons-baseline-verify/1',
    command: 'CI=true pnpm verify',
    exitCode: 0,
    sourceFenceDigest: canonicalDigest(sourceFence),
    toolchain: { node: process.version, pnpm: stripBaselineAnsi(pnpm.stdout).trim() },
    observations,
  };
}

export function verifyFrozenBaselineIdentity({
  expected,
  sourceRoot,
  toolRoot,
  inspectSourceFence = inspectExactSourceFence,
  toolIdentityBuilder = buildToolIdentity,
  sourceEvidenceLoader = loadBaselineSourceEvidence,
}) {
  return compareBaselineSnapshot({
    expected,
    sourceEvidence: sourceEvidenceLoader(sourceRoot),
    sourceFence: inspectSourceFence(sourceRoot),
    toolIdentity: toolIdentityBuilder(toolRoot),
    verifyReceipt: expected.verify,
  });
}

export function freezeBaseline({
  sourceRoot,
  output,
  toolRoot,
  runner = defaultPnpmRunner,
  inspectSourceFence = inspectExactSourceFence,
  toolIdentityBuilder = buildToolIdentity,
}) {
  assertOutputOutsideSource({ output, sourceRoot });
  const sourceFence = inspectSourceFence(sourceRoot);
  const toolIdentity = toolIdentityBuilder(toolRoot);
  const verifyReceipt = captureVerifyReceipt({
    sourceRoot,
    sourceFence,
    runner,
    inspectSourceFence,
  });
  const sourceEvidence = loadBaselineSourceEvidence(sourceRoot);
  const snapshot = buildBaselineSnapshot({ sourceEvidence, sourceFence, toolIdentity, verifyReceipt });
  const finalSourceFence = inspectSourceFence(sourceRoot);
  if (canonicalDigest(finalSourceFence) !== canonicalDigest(sourceFence)) {
    throw new Error('baseline-freeze: source fence drifted before receipt publication');
  }
  const finalToolIdentity = toolIdentityBuilder(toolRoot);
  if (canonicalDigest(finalToolIdentity) !== canonicalDigest(toolIdentity)) {
    throw new Error('baseline-freeze: tool identity drifted before receipt publication');
  }
  const publishedOutput = publishImmutableReceipt({
    output,
    sourceRoot,
    contents: `${JSON.stringify(snapshot, null, 2)}\n`,
  });
  return {
    sourceFence,
    snapshot,
    output: publishedOutput,
    requestedOutput: resolve(output),
  };
}

/**
 * Публикует полностью записанный receipt одним no-overwrite переходом имени.
 * Сбой до link оставляет целевой путь отсутствующим; после link целевой файл уже полный.
 */
export function publishImmutableReceipt({
  output,
  sourceRoot,
  contents,
  fs = DEFAULT_RECEIPT_FS,
  stageId = randomUUID,
}) {
  const requested = resolve(output);
  fs.mkdirSync(dirname(requested), { recursive: true });
  const source = realpathSync(resolve(sourceRoot));
  const parent = realpathSync(dirname(requested));
  const target = join(parent, basename(requested));
  const resolvedTarget = existsSync(target) ? realpathSync(target) : null;
  if (isPathInside(source, parent)
      || (resolvedTarget != null && isPathInside(source, resolvedTarget))) {
    throw new Error('baseline-freeze: output must stay outside the frozen source checkout');
  }
  const staging = join(parent, `.${basename(target)}.${process.pid}.${stageId()}.tmp`);
  let descriptor;
  try {
    descriptor = fs.openSync(staging, 'wx', 0o600);
    const actualStaging = realpathSync(staging);
    if (dirname(actualStaging) !== parent || isPathInside(source, actualStaging)) {
      throw new Error('baseline-freeze: output must stay outside the frozen source checkout');
    }
    fs.writeFileSync(descriptor, contents, { encoding: 'utf8' });
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    const actualParent = realpathSync(dirname(staging));
    if (actualParent !== parent || isPathInside(source, actualParent)) {
      throw new Error('baseline-freeze: output must stay outside the frozen source checkout');
    }
    fs.linkSync(staging, target);
    if (fs.readFileSync(target, 'utf8') !== contents) {
      throw new Error('baseline-freeze: receipt readback mismatch');
    }
  } finally {
    if (descriptor !== undefined) {
      try {
        fs.closeSync(descriptor);
      } catch {
        // Первичная ошибка важнее ошибки закрытия уже неиспользуемого staging fd.
      }
    }
    fs.rmSync(staging, { force: true });
  }
  return target;
}

export function parseFreezeArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value == null || value.startsWith('--')) {
      throw new Error('usage: pnpm baseline:freeze --source-root <clean-origin-main> --output <snapshot.json>');
    }
    if (!['--source-root', '--output'].includes(flag) || values.has(flag)) {
      throw new Error(`baseline-freeze: unsupported or duplicate argument ${flag}`);
    }
    values.set(flag, value);
  }
  for (const flag of ['--source-root', '--output']) {
    if (!values.has(flag)) throw new Error(`baseline-freeze: missing ${flag}`);
  }
  return { sourceRoot: resolve(values.get('--source-root')), output: resolve(values.get('--output')) };
}
