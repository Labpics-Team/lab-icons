import { createHash } from 'node:crypto';

import {
  BASELINE_INPUT_PATHS,
  EXPECTED_ICON_NAMES,
  EXPECTED_SOURCE_VARIANTS,
} from './corpus-contract.js';

const VARIANTS = Object.freeze(['outline', 'filled']);
const SHA256 = /^[a-f0-9]{64}$/;
const GIT_OBJECT_ID = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const FINGERPRINT = /^sha256:[a-f0-9]{64}$/;

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

function assertObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`baseline-snapshot: ${label} must be an object`);
  }
}

function assertDigestMap(value, label) {
  assertObject(value, label);
  const entries = Object.entries(value);
  if (entries.length === 0) {
    throw new Error(`baseline-snapshot: ${label} must not be empty`);
  }
  for (const [key, digest] of entries) {
    if (key.length === 0 || !SHA256.test(digest ?? '')) {
      throw new Error(`baseline-snapshot: ${label} contains invalid digest for ${key}`);
    }
  }
}

function assertExactKeySet(value, expected, label) {
  const actualKeys = Object.keys(value).sort(asciiCompare);
  const expectedKeys = [...expected].sort(asciiCompare);
  if (
    actualKeys.length !== expectedKeys.length
    || actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(`baseline-snapshot: ${label} must match baseline inputs exactly`);
  }
}

function variantKey(familyId, variant) {
  return `${familyId}/${variant}`;
}

function validateSourceParts(parts, key) {
  if (!Array.isArray(parts) || parts.length === 0) {
    throw new Error(`baseline-snapshot: ${key} lacks source parts`);
  }
  const ids = new Set();
  for (const [index, part] of parts.entries()) {
    assertObject(part, `${key}.source.parts[${index}]`);
    if (typeof part.id !== 'string' || part.id.length === 0 || ids.has(part.id)
        || typeof part.role !== 'string' || part.role.length === 0
        || !Number.isInteger(part.zIndex)
        || !['evenodd', 'nonzero'].includes(part.fillRule)
        || typeof part.topologySignature !== 'string' || part.topologySignature.length === 0
        || !FINGERPRINT.test(part.sourceFingerprint ?? '')
        || !FINGERPRINT.test(part.artifactFingerprint ?? '')) {
      throw new Error(`baseline-snapshot: invalid source part evidence for ${key}`);
    }
    ids.add(part.id);
  }
}

function parseDebtKey(key, knownVariants, label, expectedSegments) {
  const parts = key.split('/');
  if (parts.length !== expectedSegments) {
    throw new Error(`baseline-snapshot: malformed ${label} key ${key}`);
  }
  const base = parts.slice(0, 2).join('/');
  if (!knownVariants.has(base)) throw new Error(`baseline-snapshot: ${label} references unknown variant ${base}`);
  return parts;
}

function validateToolIdentity(toolIdentity) {
  assertObject(toolIdentity, 'toolIdentity');
  if (toolIdentity.schema !== 'labpics.icons-baseline-tool/2'
      || !SHA256.test(toolIdentity.entrySha256 ?? '')
      || !SHA256.test(toolIdentity.cliAdapterSha256 ?? '')
      || !SHA256.test(toolIdentity.snapshotLibrarySha256 ?? '')
      || !SHA256.test(toolIdentity.evidenceAdapterSha256 ?? '')
      || !SHA256.test(toolIdentity.freezeAdapterSha256 ?? '')
      || !SHA256.test(toolIdentity.corpusContractSha256 ?? '')
      || !SHA256.test(toolIdentity.packageJsonSha256 ?? '')) {
    throw new Error('baseline-snapshot: invalid tool identity');
  }
}

function validateSourceFence(sourceFence) {
  assertObject(sourceFence, 'sourceFence');
  assertObject(sourceFence.package, 'sourceFence.package');
  if (!GIT_OBJECT_ID.test(sourceFence.headSha ?? '')
      || !GIT_OBJECT_ID.test(sourceFence.treeSha ?? '')
      || typeof sourceFence.package.name !== 'string'
      || sourceFence.package.name.length === 0
      || typeof sourceFence.package.version !== 'string'
      || sourceFence.package.version.length === 0
      || !SHA256.test(sourceFence.package.packageJsonSha256 ?? '')
      || !SHA256.test(sourceFence.package.pnpmLockSha256 ?? '')
      || !SHA256.test(sourceFence.package.releaseContractSha256 ?? '')) {
    throw new Error('baseline-snapshot: invalid source fence');
  }
}

function validateVerifyReceipt(verifyReceipt) {
  assertObject(verifyReceipt, 'verifyReceipt');
  if (verifyReceipt.schema !== 'labpics.icons-baseline-verify/2'
      || verifyReceipt.status !== 'passed'
      || !SHA256.test(verifyReceipt.sourceFenceDigest ?? '')) {
    throw new Error('baseline-snapshot: invalid verify receipt');
  }
  assertObject(verifyReceipt.observations, 'verifyReceipt.observations');
  assertObject(verifyReceipt.toolchain, 'verifyReceipt.toolchain');
  if (!Number.isInteger(verifyReceipt.observations.testFilesPassed)
      || verifyReceipt.observations.testFilesPassed <= 0
      || !Number.isInteger(verifyReceipt.observations.testsPassed)
      || verifyReceipt.observations.testsPassed <= 0
      || verifyReceipt.observations.packageArtifactWitness !== true
      || !SHA256.test(verifyReceipt.observations.outputSha256 ?? '')
      || typeof verifyReceipt.toolchain.node !== 'string'
      || verifyReceipt.toolchain.node.length === 0
      || typeof verifyReceipt.toolchain.pnpm !== 'string'
      || verifyReceipt.toolchain.pnpm.length === 0) {
    throw new Error('baseline-snapshot: verify receipt lacks direct observations');
  }
}

function validateSourceEvidence(sourceEvidence) {
  assertObject(sourceEvidence, 'sourceEvidence');
  assertObject(sourceEvidence.catalog, 'sourceEvidence.catalog');
  assertObject(sourceEvidence.candidateVariants, 'sourceEvidence.candidateVariants');
  assertObject(sourceEvidence.modelQuality, 'sourceEvidence.modelQuality');
  assertObject(sourceEvidence.axisQuality, 'sourceEvidence.axisQuality');
  assertDigestMap(sourceEvidence.inputDigests, 'sourceEvidence.inputDigests');
  assertExactKeySet(sourceEvidence.inputDigests, BASELINE_INPUT_PATHS, 'sourceEvidence.inputDigests');
  assertObject(sourceEvidence.sourceFileDigests, 'sourceEvidence.sourceFileDigests');
}

/**
 * Собирает публичный снимок состояния до преобразований. Retrospective train/holdout
 * здесь намеренно отсутствует: весь публичный корпус является входным evidence.
 */
export function buildBaselineSnapshot({
  sourceEvidence,
  sourceFence,
  toolIdentity,
  verifyReceipt,
}) {
  validateSourceFence(sourceFence);
  validateToolIdentity(toolIdentity);
  validateVerifyReceipt(verifyReceipt);
  validateSourceEvidence(sourceEvidence);
  if (verifyReceipt.sourceFenceDigest !== canonicalDigest(sourceFence)) {
    throw new Error('baseline-snapshot: verify receipt is not bound to the source fence');
  }

  const {
    catalog,
    candidateVariants,
    modelQuality,
    axisQuality,
    inputDigests,
    sourceFileDigests,
  } = sourceEvidence;
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
      if (!SHA256.test(sourceFileDigests[source.file] ?? '')) {
        throw new Error(`baseline-snapshot: ${key} lacks source file digest`);
      }
      validateSourceParts(source.parts, key);
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
        sourceFileSha256: sourceFileDigests[source.file],
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
  for (const key of candidateSet) parseDebtKey(key, knownVariants, 'candidate', 2);
  for (const key of Object.keys(quarantined)) parseDebtKey(key, knownVariants, 'quarantine', 2);
  for (const key of Object.keys(disabledAxes)) {
    const parts = parseDebtKey(key, knownVariants, 'axis debt', 3);
    if (!Object.hasOwn(catalog.axes ?? {}, parts[2])) {
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
    inputDigests: canonicalize(inputDigests),
    quarantine: canonicalize(quarantined),
    axisDebt: canonicalize(disabledAxes),
    variants: rows,
  };
  return { ...core, receiptDigest: canonicalDigest(core) };
}

export function compareBaselineSnapshot({ expected, ...inputs }) {
  const actual = buildBaselineSnapshot(inputs);
  if (canonicalDigest(actual) !== canonicalDigest(expected)) {
    throw new Error('baseline-snapshot: snapshot drift');
  }
  return actual;
}
