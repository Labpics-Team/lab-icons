import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  EXPECTED_ICON_NAMES,
  EXPECTED_SOURCE_VARIANTS,
} from './corpus-contract.js';

const VARIANTS = Object.freeze(['outline', 'filled']);
const SHA256 = /^[a-f0-9]{64}$/;
const BASELINE_INPUTS = Object.freeze([
  'semantics/catalog.json',
  'semantics/anatomy.json',
  'semantics/anatomy.runtime.json',
  'semantics/anatomy.candidates.json',
  'semantics/candidate-variants.json',
  'semantics/model-quality.json',
  'semantics/axis-quality.json',
  'semantics/grid.json',
]);

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function asciiCompare(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value)
      .sort(asciiCompare)
      .filter((key) => value[key] !== undefined)
      .map((key) => [key, canonicalize(value[key])]));
  }
  return value;
}

export function canonicalDigest(value) {
  return sha256(Buffer.from(JSON.stringify(canonicalize(value))));
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF+/, ''));
}

function fileDigest(root, relativePath) {
  return sha256(readFileSync(resolve(root, relativePath)));
}

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`baseline-snapshot: ${label} must be an object`);
  }
}

function variantKey(familyId, variant) {
  return `${familyId}/${variant}`;
}

function parseDebtKey(key, knownVariants, label) {
  const parts = key.split('/');
  if (parts.length < 2) throw new Error(`baseline-snapshot: malformed ${label} key ${key}`);
  const base = parts.slice(0, 2).join('/');
  if (!knownVariants.has(base)) throw new Error(`baseline-snapshot: ${label} references unknown variant ${base}`);
  return parts;
}

function validateToolIdentity(toolIdentity) {
  assertObject(toolIdentity, 'toolIdentity');
  if (toolIdentity.schema !== 'labpics.icons-baseline-tool/1'
      || !SHA256.test(toolIdentity.entrySha256 ?? '')
      || !SHA256.test(toolIdentity.librarySha256 ?? '')
      || !SHA256.test(toolIdentity.corpusContractSha256 ?? '')
      || !SHA256.test(toolIdentity.packageJsonSha256 ?? '')) {
    throw new Error('baseline-snapshot: invalid tool identity');
  }
}

function validateVerifyReceipt(verifyReceipt) {
  assertObject(verifyReceipt, 'verifyReceipt');
  if (verifyReceipt.schema !== 'labpics.icons-baseline-verify/1'
      || verifyReceipt.command !== 'CI=true pnpm verify'
      || verifyReceipt.exitCode !== 0
      || !SHA256.test(verifyReceipt.sourceFenceDigest ?? '')) {
    throw new Error('baseline-snapshot: invalid verify receipt');
  }
  assertObject(verifyReceipt.observations, 'verifyReceipt.observations');
  if (!Number.isInteger(verifyReceipt.observations.testFilesPassed)
      || verifyReceipt.observations.testFilesPassed <= 0
      || !Number.isInteger(verifyReceipt.observations.testsPassed)
      || verifyReceipt.observations.testsPassed <= 0
      || verifyReceipt.observations.packageArtifactWitness !== true
      || !SHA256.test(verifyReceipt.observations.outputSha256 ?? '')) {
    throw new Error('baseline-snapshot: verify receipt lacks direct observations');
  }
}

/**
 * Builds a public pre-change snapshot. There is deliberately no train/holdout
 * allocation here: the current corpus is public and all 238 families are input
 * evidence for geometric systematization.
 */
export function buildBaselineSnapshot({
  sourceRoot,
  sourceFence,
  toolIdentity,
  verifyReceipt,
}) {
  const root = resolve(sourceRoot);
  assertObject(sourceFence, 'sourceFence');
  validateToolIdentity(toolIdentity);
  validateVerifyReceipt(verifyReceipt);
  if (verifyReceipt.sourceFenceDigest !== canonicalDigest(sourceFence)) {
    throw new Error('baseline-snapshot: verify receipt is not bound to the source fence');
  }

  const catalog = readJson(resolve(root, 'semantics/catalog.json'));
  const candidateVariants = readJson(resolve(root, 'semantics/candidate-variants.json'));
  const modelQuality = readJson(resolve(root, 'semantics/model-quality.json'));
  const axisQuality = readJson(resolve(root, 'semantics/axis-quality.json'));
  assertObject(catalog.icons, 'catalog.icons');
  if (Object.keys(catalog.icons).length !== EXPECTED_ICON_NAMES) {
    throw new Error(`baseline-snapshot: expected ${EXPECTED_ICON_NAMES} families`);
  }
  if (!Array.isArray(candidateVariants.variants)) {
    throw new Error('baseline-snapshot: candidate-variants.variants must be an array');
  }

  const candidateSet = new Set(candidateVariants.variants);
  if (candidateSet.size !== candidateVariants.variants.length) {
    throw new Error('baseline-snapshot: duplicate candidate variant');
  }
  const quarantined = modelQuality.quarantined ?? {};
  const disabledAxes = axisQuality.disabled ?? {};
  assertObject(quarantined, 'model-quality.quarantined');
  assertObject(disabledAxes, 'axis-quality.disabled');

  const rows = [];
  const states = { accepted: 0, candidate: 0, sourceOnly: 0 };
  for (const familyId of Object.keys(catalog.icons).sort(asciiCompare)) {
    const family = catalog.icons[familyId];
    assertObject(family.source, `${familyId}.source`);
    for (const variant of VARIANTS) {
      const key = variantKey(familyId, variant);
      const source = family.source[variant];
      assertObject(source, `${key}.source`);
      if (typeof source.file !== 'string' || source.file.length === 0) {
        throw new Error(`baseline-snapshot: ${key} lacks source file`);
      }
      if (!Array.isArray(source.parts) || source.parts.length === 0) {
        throw new Error(`baseline-snapshot: ${key} lacks source parts`);
      }
      const model = family.model?.variants?.[variant];
      let modelState;
      if (candidateSet.has(key)) {
        if (model?.state !== 'candidate') {
          throw new Error(`baseline-snapshot: candidate registry disagrees with catalog for ${key}`);
        }
        modelState = 'candidate';
        states.candidate += 1;
      } else if (model?.state === 'accepted') {
        modelState = 'accepted';
        states.accepted += 1;
      } else if (model == null) {
        modelState = 'source-only';
        states.sourceOnly += 1;
      } else {
        throw new Error(`baseline-snapshot: unsupported model state for ${key}`);
      }
      rows.push({
        familyId,
        variant,
        sourceFile: source.file,
        sourceFileSha256: fileDigest(root, source.file),
        sourceParts: source.parts.map((part) => ({
          id: part.id,
          role: part.role,
          zIndex: part.zIndex,
          fillRule: part.fillRule,
          topologySignature: part.topologySignature,
          sourceFingerprint: part.sourceFingerprint,
          artifactFingerprint: part.artifactFingerprint,
        })),
        modelState,
        supportedAxes: [...(model?.supportedAxes ?? [])].sort(asciiCompare),
        quarantined: Object.hasOwn(quarantined, key),
        disabledAxes: Object.keys(disabledAxes)
          .filter((debtKey) => debtKey.startsWith(`${key}/`))
          .map((debtKey) => debtKey.slice(key.length + 1))
          .sort(asciiCompare),
      });
    }
  }
  if (rows.length !== EXPECTED_SOURCE_VARIANTS) {
    throw new Error(`baseline-snapshot: expected ${EXPECTED_SOURCE_VARIANTS} variants`);
  }
  const knownVariants = new Set(rows.map((row) => variantKey(row.familyId, row.variant)));
  for (const key of candidateSet) parseDebtKey(key, knownVariants, 'candidate');
  for (const key of Object.keys(quarantined)) parseDebtKey(key, knownVariants, 'quarantine');
  for (const key of Object.keys(disabledAxes)) {
    const parts = parseDebtKey(key, knownVariants, 'axis debt');
    if (parts.length !== 3 || !Object.hasOwn(catalog.axes ?? {}, parts[2])) {
      throw new Error(`baseline-snapshot: invalid axis debt ${key}`);
    }
  }

  const core = {
    schema: 'labpics.icons-baseline-snapshot/1',
    sourceFence: canonicalize(sourceFence),
    toolIdentity: canonicalize(toolIdentity),
    verify: canonicalize(verifyReceipt),
    corpus: { families: EXPECTED_ICON_NAMES, variants: EXPECTED_SOURCE_VARIANTS },
    modelStates: states,
    debt: {
      quarantinedVariants: Object.keys(quarantined).length,
      disabledAxisEntries: Object.keys(disabledAxes).length,
    },
    axes: canonicalize(catalog.axes ?? {}),
    axisPolicy: canonicalize(axisQuality.policy ?? {}),
    inputDigests: Object.fromEntries(BASELINE_INPUTS.map((path) => [path, fileDigest(root, path)])),
    quarantine: canonicalize(quarantined),
    axisDebt: canonicalize(disabledAxes),
    variants: rows,
  };
  return { ...core, receiptDigest: canonicalDigest(core) };
}

export function verifyBaselineSnapshot({ expected, ...inputs }) {
  const actual = buildBaselineSnapshot(inputs);
  if (canonicalDigest(actual) !== canonicalDigest(expected)) {
    throw new Error('baseline-snapshot: snapshot drift');
  }
  return actual;
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
    librarySha256: fileDigest(root, 'scripts/lib/baseline-snapshot.js'),
    corpusContractSha256: fileDigest(root, 'scripts/lib/corpus-contract.js'),
    packageJsonSha256: fileDigest(root, 'package.json'),
  };
}

export function assertOutputOutsideSource({ output, sourceRoot }) {
  const source = resolve(sourceRoot);
  const target = resolve(output);
  const pathFromSource = relative(source, target);
  const insideSource = pathFromSource === ''
    || (!pathFromSource.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`)
      && pathFromSource !== '..'
      && !isAbsolute(pathFromSource));
  if (insideSource) {
    throw new Error('baseline-freeze: output must stay outside the frozen source checkout');
  }
}

function stripAnsi(value) {
  return String(value ?? '').replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '');
}

export function parseVerifyObservations(rawOutput) {
  const output = stripAnsi(rawOutput);
  const testFiles = /Test Files\s+(\d+) passed/.exec(output);
  const tests = /\bTests\s+(\d+) passed/.exec(output);
  const packageArtifactWitness = /check-package-artifact: OK\b/.test(output);
  if (!testFiles || !tests || !packageArtifactWitness) {
    throw new Error('baseline-snapshot: verify output lacks direct required witnesses');
  }
  return {
    testFilesPassed: Number(testFiles[1]),
    testsPassed: Number(tests[1]),
    packageArtifactWitness,
    outputSha256: sha256(Buffer.from(output)),
  };
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

export function captureVerifyReceipt({ sourceRoot, sourceFence, runner = defaultPnpmRunner }) {
  const root = resolve(sourceRoot);
  const before = inspectExactSourceFence(root);
  if (canonicalDigest(before) !== canonicalDigest(sourceFence)) {
    throw new Error('baseline-snapshot: source fence drifted before verify');
  }
  const env = { ...process.env, CI: 'true' };
  const install = runner({ root, args: ['install', '--frozen-lockfile'], env });
  if (install.error || install.status !== 0) {
    throw new Error(`baseline-snapshot: pnpm install failed (${install.status ?? 'spawn-error'})`);
  }
  const verify = runner({ root, args: ['verify'], env });
  const output = stripAnsi(`${verify.stdout ?? ''}\n${verify.stderr ?? ''}`);
  if (verify.error || verify.status !== 0) {
    throw new Error(`baseline-snapshot: pnpm verify failed (${verify.status ?? 'spawn-error'})`);
  }
  const observations = parseVerifyObservations(output);
  const pnpm = runner({ root, args: ['--version'], env });
  if (pnpm.error || pnpm.status !== 0 || !String(pnpm.stdout ?? '').trim()) {
    throw new Error('baseline-snapshot: cannot identify pnpm toolchain');
  }
  const after = inspectExactSourceFence(root);
  if (canonicalDigest(after) !== canonicalDigest(sourceFence)) {
    throw new Error('baseline-snapshot: source fence drifted during verify');
  }
  return {
    schema: 'labpics.icons-baseline-verify/1',
    command: 'CI=true pnpm verify',
    exitCode: 0,
    sourceFenceDigest: canonicalDigest(sourceFence),
    toolchain: { node: process.version, pnpm: stripAnsi(pnpm.stdout).trim() },
    observations,
  };
}
