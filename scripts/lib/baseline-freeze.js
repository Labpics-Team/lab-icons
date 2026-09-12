import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { authorPathEntries } from '../../src/core/icon-geometry.js';
import { parsePathData } from '../../src/core/path-data.js';
import {
  EXPECTED_ICON_NAMES,
  EXPECTED_SOURCE_VARIANTS,
  EXPECTED_VARIANTS_PER_ICON,
} from './corpus-contract.js';

export const BASELINE_FREEZE_VERSION = 1;
export const RETROSPECTIVE_HOLDOUT_SIZE = 32;
export const DEFAULT_MANDATORY_TRAIN = Object.freeze([
  'calendar-number',
  'cloud-off',
  'earth',
  'fire',
  'reload',
  'sun',
  'sun-low',
  'time',
]);

const VARIANTS = Object.freeze(['outline', 'filled']);
const SHA40 = /^[a-f0-9]{40}$/;
const SHA64 = /^[a-f0-9]{64}$/;
const SOURCE_STATES = new Set(['accepted', 'candidate', 'source-only']);
const PART_CLASSES = Object.freeze(['single', 'pair', 'multi']);

const asciiCompare = (left, right) => left < right ? -1 : left > right ? 1 : 0;
const sha256 = (value) => createHash('sha256').update(value).digest('hex');

function assertObject(value, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`baseline-freeze: ${where} должен быть объектом`);
  }
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.keys(value).sort(asciiCompare).map((key) => [key, canonicalize(value[key])]),
  );
}

export function canonicalDigest(value) {
  return sha256(JSON.stringify(canonicalize(value)));
}

export function validateSourceFence(sourceFence) {
  assertObject(sourceFence, 'sourceFence');
  assertObject(sourceFence.package, 'sourceFence.package');
  if (!SHA40.test(sourceFence.headSha ?? '')) throw new Error('baseline-freeze: sourceFence.headSha невалиден');
  if (!SHA40.test(sourceFence.treeSha ?? '')) throw new Error('baseline-freeze: sourceFence.treeSha невалиден');
  if (typeof sourceFence.package.name !== 'string' || sourceFence.package.name.length === 0) {
    throw new Error('baseline-freeze: package.name обязателен');
  }
  if (typeof sourceFence.package.version !== 'string' || sourceFence.package.version.length === 0) {
    throw new Error('baseline-freeze: package.version обязателен');
  }
  if (!SHA64.test(sourceFence.package.contractSha256 ?? '')) {
    throw new Error('baseline-freeze: package.contractSha256 невалиден');
  }
  return sourceFence;
}

function sourceVariant(catalog, name, variant) {
  const source = catalog.icons?.[name]?.source?.[variant];
  if (!source || !Array.isArray(source.parts) || source.parts.length === 0) {
    throw new Error(`baseline-freeze: ${name}/${variant} не имеет source contract`);
  }
  return source;
}

function topologyCommandCount(signature) {
  if (typeof signature !== 'string' || !/^[A-Z]+(?:\|[A-Z]+)*$/.test(signature)) {
    throw new Error(`baseline-freeze: невалидная topologySignature ${String(signature)}`);
  }
  return signature.replaceAll('|', '').length;
}

function topologyContourCount(signature) {
  topologyCommandCount(signature);
  return signature.split('|').length;
}

function partClass(partCount) {
  if (partCount === 1) return 'single';
  if (partCount === 2) return 'pair';
  return 'multi';
}

function modelState(catalog, name, variant) {
  const state = catalog.icons[name].model?.variants?.[variant]?.state ?? 'source-only';
  if (!SOURCE_STATES.has(state)) throw new Error(`baseline-freeze: ${name}/${variant} имеет state=${String(state)}`);
  return state;
}

function familyReferenceDigest(catalog, name) {
  const material = [];
  for (const variant of VARIANTS) {
    const source = sourceVariant(catalog, name, variant);
    material.push(variant, source.file);
    for (const part of source.parts) {
      material.push(part.sourceFingerprint, part.artifactFingerprint, part.topologySignature);
    }
  }
  return sha256(material.join('\0'));
}

export function structuralRows(catalog) {
  assertObject(catalog, 'catalog');
  assertObject(catalog.icons, 'catalog.icons');
  const names = Object.keys(catalog.icons).sort(asciiCompare);
  if (names.length !== EXPECTED_ICON_NAMES) {
    throw new Error(`baseline-freeze: ожидалось ${EXPECTED_ICON_NAMES} семейств, получено ${names.length}`);
  }

  const rows = names.map((name) => {
    const sources = VARIANTS.map((variant) => sourceVariant(catalog, name, variant));
    const maxSourceParts = Math.max(...sources.map((source) => source.parts.length));
    const maxContours = Math.max(...sources.flatMap((source) =>
      source.parts.map((part) => topologyContourCount(part.topologySignature))));
    const commandCount = sources.flatMap((source) => source.parts)
      .reduce((total, part) => total + topologyCommandCount(part.topologySignature), 0);
    return {
      name,
      partClass: partClass(maxSourceParts),
      maxSourceParts,
      maxContours,
      commandCount,
      referenceDigest: familyReferenceDigest(catalog, name),
    };
  });

  for (const cls of PART_CLASSES) {
    const members = rows
      .filter((row) => row.partClass === cls)
      .sort((left, right) => left.commandCount - right.commandCount || asciiCompare(left.name, right.name));
    members.forEach((row, index) => {
      const quartile = Math.min(4, Math.floor((index * 4) / members.length) + 1);
      row.structuralStratum = `${cls}-q${quartile}`;
    });
  }
  return rows;
}

function proportionalQuotas(counts, totalQuota) {
  const entries = [...counts.entries()].sort(([left], [right]) => asciiCompare(left, right));
  const population = entries.reduce((sum, [, count]) => sum + count, 0);
  if (!Number.isInteger(totalQuota) || totalQuota <= 0 || totalQuota > population) {
    throw new RangeError('baseline-freeze: holdout quota вне population');
  }
  if (entries.some(([, count]) => !Number.isInteger(count) || count <= 0)) {
    throw new Error('baseline-freeze: пустой structural stratum недопустим');
  }

  const requireCoverage = totalQuota >= entries.length;
  const rows = entries.map(([stratum, count]) => {
    const ideal = count * totalQuota / population;
    const floor = Math.floor(ideal);
    return {
      stratum,
      count,
      ideal,
      quota: requireCoverage ? Math.max(1, floor) : floor,
    };
  });

  let assigned = rows.reduce((sum, row) => sum + row.quota, 0);
  while (assigned < totalQuota) {
    const candidate = rows
      .filter((row) => row.quota < row.count)
      .sort((left, right) =>
        (right.ideal - right.quota) - (left.ideal - left.quota)
        || asciiCompare(left.stratum, right.stratum))[0];
    if (!candidate) throw new Error('baseline-freeze: не удалось распределить holdout quota');
    candidate.quota += 1;
    assigned += 1;
  }
  while (assigned > totalQuota) {
    const candidate = rows
      .filter((row) => row.quota > (requireCoverage ? 1 : 0))
      .sort((left, right) =>
        (left.ideal - left.quota) - (right.ideal - right.quota)
        || asciiCompare(right.stratum, left.stratum))[0];
    if (!candidate) throw new Error('baseline-freeze: невозможно уменьшить holdout quota без потери покрытия');
    candidate.quota -= 1;
    assigned -= 1;
  }
  return Object.fromEntries(rows.map(({ stratum, quota }) => [stratum, quota]));
}

export function buildRetrospectivePartition({
  catalog,
  sourceFence,
  holdoutSize = RETROSPECTIVE_HOLDOUT_SIZE,
  mandatoryTrain = DEFAULT_MANDATORY_TRAIN,
}) {
  validateSourceFence(sourceFence);
  const rows = structuralRows(catalog);
  const byName = new Map(rows.map((row) => [row.name, row]));
  const mandatory = [...new Set(mandatoryTrain)].sort(asciiCompare);
  if (mandatory.length !== mandatoryTrain.length) throw new Error('baseline-freeze: mandatory train содержит дубликаты');
  for (const name of mandatory) {
    if (!byName.has(name)) throw new Error(`baseline-freeze: mandatory train ${name} отсутствует в corpus`);
  }

  const mandatorySet = new Set(mandatory);
  const eligible = rows.filter((row) => !mandatorySet.has(row.name));
  const counts = new Map();
  for (const row of eligible) counts.set(row.structuralStratum, (counts.get(row.structuralStratum) ?? 0) + 1);
  const quotas = proportionalQuotas(counts, holdoutSize);
  const selected = [];

  for (const stratum of Object.keys(quotas).sort(asciiCompare)) {
    const candidates = eligible
      .filter((row) => row.structuralStratum === stratum)
      .map((row) => ({
        ...row,
        selectionKey: sha256([
          `baseline-freeze-v${BASELINE_FREEZE_VERSION}`,
          stratum,
          row.name,
        ].join('\0')),
      }))
      .sort((left, right) => asciiCompare(left.selectionKey, right.selectionKey) || asciiCompare(left.name, right.name));
    selected.push(...candidates.slice(0, quotas[stratum]).map((row) => row.name));
  }

  const holdout = selected.sort(asciiCompare);
  const holdoutSet = new Set(holdout);
  const train = rows.map((row) => row.name).filter((name) => !holdoutSet.has(name));
  if (holdout.length !== holdoutSize || train.length + holdout.length !== EXPECTED_ICON_NAMES) {
    throw new Error('baseline-freeze: partition не замыкает corpus');
  }
  if (mandatory.some((name) => holdoutSet.has(name))) {
    throw new Error('baseline-freeze: обязательный train пример попал в holdout');
  }

  return {
    version: BASELINE_FREEZE_VERSION,
    method: 'source-structure-stratified-sha256-v1',
    sourceFenceDigest: canonicalDigest(sourceFence),
    holdoutSize,
    trainSize: train.length,
    mandatoryTrain: mandatory,
    quotas,
    holdout,
    train,
  };
}

function variantManifest(catalog, axisQuality, name, variant) {
  const source = sourceVariant(catalog, name, variant);
  const state = modelState(catalog, name, variant);
  const supportedAxes = catalog.icons[name].model?.variants?.[variant]?.supportedAxes ?? [];
  const debtPrefix = `${name}/${variant}/`;
  const axisDebt = Object.entries(axisQuality.disabled ?? {})
    .filter(([id]) => id.startsWith(debtPrefix))
    .map(([id, debt]) => ({ axis: id.slice(debtPrefix.length), ...debt }))
    .sort((left, right) => asciiCompare(left.axis, right.axis));
  return {
    state,
    supportedAxes: [...supportedAxes].sort(asciiCompare),
    axisDebt,
    source: {
      file: source.file,
      parts: source.parts.map((part) => ({
        sourceFingerprint: part.sourceFingerprint,
        artifactFingerprint: part.artifactFingerprint,
        topologySignature: part.topologySignature,
      })),
    },
  };
}

export function buildSealedCorpusManifest({ catalog, axisQuality, sourceFence, partition }) {
  validateSourceFence(sourceFence);
  assertObject(axisQuality, 'axisQuality');
  if (partition.sourceFenceDigest !== canonicalDigest(sourceFence)) {
    throw new Error('baseline-freeze: partition относится к другому source fence');
  }
  const rows = structuralRows(catalog);
  const holdout = new Set(partition.holdout);
  const train = new Set(partition.train);
  const families = rows.map((row) => ({
    id: row.name,
    allocation: holdout.has(row.name) ? 'holdout' : train.has(row.name) ? 'train' : 'invalid',
    structuralStratum: row.structuralStratum,
    structuralMetrics: {
      maxSourceParts: row.maxSourceParts,
      maxContours: row.maxContours,
      commandCount: row.commandCount,
    },
    referenceDigest: row.referenceDigest,
    variants: Object.fromEntries(VARIANTS.map((variant) => [
      variant,
      variantManifest(catalog, axisQuality, row.name, variant),
    ])),
  }));
  if (families.some((family) => family.allocation === 'invalid')) {
    throw new Error('baseline-freeze: partition не классифицирует каждое семейство');
  }
  const variantCount = families.reduce((sum, family) => sum + Object.keys(family.variants).length, 0);
  if (variantCount !== EXPECTED_SOURCE_VARIANTS) {
    throw new Error(`baseline-freeze: manifest содержит ${variantCount}, ожидалось ${EXPECTED_SOURCE_VARIANTS} variants`);
  }
  return {
    version: BASELINE_FREEZE_VERSION,
    sourceFence,
    sourceFenceDigest: canonicalDigest(sourceFence),
    partition: {
      method: partition.method,
      holdoutSize: partition.holdoutSize,
      trainSize: partition.trainSize,
      mandatoryTrain: partition.mandatoryTrain,
      quotas: partition.quotas,
    },
    families,
  };
}

export function buildTrainManifestProjection(sealedManifest) {
  assertObject(sealedManifest, 'sealedManifest');
  const trainFamilies = sealedManifest.families
    .filter((family) => family.allocation === 'train')
    .map(({ allocation: _allocation, referenceDigest: _referenceDigest, ...family }) => family);
  if (trainFamilies.length !== EXPECTED_ICON_NAMES - RETROSPECTIVE_HOLDOUT_SIZE) {
    throw new Error('baseline-freeze: train projection имеет неверный размер');
  }
  const stratumAggregates = Object.values(trainFamilies.reduce((acc, family) => {
    const key = family.structuralStratum;
    acc[key] ??= { structuralStratum: key, trainFamilies: 0 };
    acc[key].trainFamilies += 1;
    return acc;
  }, {})).sort((left, right) => asciiCompare(left.structuralStratum, right.structuralStratum));
  return {
    version: BASELINE_FREEZE_VERSION,
    sourceFenceDigest: sealedManifest.sourceFenceDigest,
    corpus: {
      trainFamilies: trainFamilies.length,
      trainVariants: trainFamilies.length * EXPECTED_VARIANTS_PER_ICON,
      sealedHoldoutFamilies: RETROSPECTIVE_HOLDOUT_SIZE,
    },
    strata: stratumAggregates,
    families: trainFamilies,
  };
}

function normalizedGeometryDigest(pathData) {
  return sha256(JSON.stringify(parsePathData(pathData)));
}

function referenceSignalsForFamilies({ root, catalog, names }) {
  const signals = {
    names: [],
    filenames: [],
    exportIds: [],
    fingerprints: [],
    sourceFileDigests: [],
    rawPaths: [],
    geometryDigests: [],
  };
  for (const name of names) {
    signals.names.push(name);
    for (const variant of VARIANTS) {
      const source = sourceVariant(catalog, name, variant);
      const bytes = readFileSync(join(root, source.file));
      const text = bytes.toString('utf8');
      signals.filenames.push(source.file, source.file.split('/').at(-1));
      const basename = source.file.split('/').at(-1).replace(/\.svg$/i, '');
      const camel = basename
        .replace(/[-_](.)/g, (_, char) => char.toUpperCase())
        .replace(/^(.)/, (_, char) => char.toLowerCase());
      signals.exportIds.push(variant === 'filled' ? camel : `${camel}Outline`);
      signals.sourceFileDigests.push(sha256(bytes));
      for (const part of source.parts) {
        signals.fingerprints.push(part.sourceFingerprint, part.artifactFingerprint);
      }
      for (const entry of authorPathEntries(text)) {
        signals.rawPaths.push(entry.d);
        signals.geometryDigests.push(normalizedGeometryDigest(entry.d));
      }
    }
  }
  return Object.fromEntries(Object.entries(signals).map(([key, values]) => [
    key,
    [...new Set(values)].sort(asciiCompare),
  ]));
}

function difference(values, allowed) {
  const allowedSet = new Set(allowed);
  return values.filter((value) => !allowedSet.has(value));
}

function intersection(values, allowed) {
  const allowedSet = new Set(allowed);
  return values.filter((value) => allowedSet.has(value));
}

export function buildHoldoutLeakSignals({ root, catalog, partition }) {
  const holdout = referenceSignalsForFamilies({ root, catalog, names: partition.holdout });
  const train = referenceSignalsForFamilies({ root, catalog, names: partition.train });
  const identifying = {
    // Family identity itself is sealed even if a lexical fragment happens to be
    // common elsewhere; scanner uses token boundaries rather than substrings.
    names: holdout.names,
    filenames: holdout.filenames,
    exportIds: difference(holdout.exportIds, train.exportIds),
    fingerprints: difference(holdout.fingerprints, train.fingerprints),
    sourceFileDigests: difference(holdout.sourceFileDigests, train.sourceFileDigests),
    rawPaths: difference(holdout.rawPaths, train.rawPaths),
    geometryDigests: difference(holdout.geometryDigests, train.geometryDigests),
  };
  const sharedWithTrain = {
    fingerprints: intersection(holdout.fingerprints, train.fingerprints),
    sourceFileDigests: intersection(holdout.sourceFileDigests, train.sourceFileDigests),
    rawPaths: intersection(holdout.rawPaths, train.rawPaths),
    geometryDigests: intersection(holdout.geometryDigests, train.geometryDigests),
  };
  return { identifying, sharedWithTrain };
}

function escapedRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

const IDENTITY_FIELD = /^(?:id|icon|iconId|icon-id|icon_id|name|family|familyId|family-id|family_id|brief|briefId|brief-id|brief_id|target)$/i;
const REGISTRY_FIELD = /^(?:icons|iconIds|icon-ids|icon_ids|families|registry|catalog|exports|briefs|targets)$/i;

function jsonContainsIdentity(value, name, parentKey = null) {
  if (typeof value === 'string') {
    return IDENTITY_FIELD.test(parentKey ?? '') && value.toLowerCase() === name.toLowerCase();
  }
  if (Array.isArray(value)) {
    if (REGISTRY_FIELD.test(parentKey ?? '') && value.some((item) =>
      typeof item === 'string' && item.toLowerCase() === name.toLowerCase())) return true;
    return value.some((item) => jsonContainsIdentity(item, name, parentKey));
  }
  if (!value || typeof value !== 'object') return false;
  for (const [key, item] of Object.entries(value)) {
    if (REGISTRY_FIELD.test(parentKey ?? '') && key.toLowerCase() === name.toLowerCase()) return true;
    if (jsonContainsIdentity(item, name, key)) return true;
  }
  return false;
}

function containsIdentityName(text, name) {
  try {
    if (jsonContainsIdentity(JSON.parse(text), name)) return true;
  } catch {
    // Prompts/tool output are often plain text; use an explicit semantic cue below.
  }
  const token = escapedRegExp(name);
  const cue = '(?:icon|glyph|family|brief|target)(?:\\s+(?:id|name))?';
  return new RegExp(`(?:${cue}\\s*[:=]?\\s*["']?${token}(?:["']|\\b)|\\b${token}\\b\\s+(?:icon|glyph|family|brief)\\b)`, 'i').test(text);
}

function containsExportId(text, exportId) {
  const token = escapedRegExp(exportId);
  return new RegExp(`(^|[^A-Za-z0-9_$])${token}([^A-Za-z0-9_$]|$)`).test(text);
}

function containsFilename(text, filename) {
  if (filename.includes('/')) return text.includes(filename);
  const token = escapedRegExp(filename);
  return new RegExp(`(^|[^A-Za-z0-9_-])${token}([^A-Za-z0-9_-]|$)`).test(text);
}

function jsonStrings(value, output = []) {
  if (typeof value === 'string') output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => jsonStrings(item, output));
  else if (value && typeof value === 'object') Object.entries(value).forEach(([key, item]) => {
    output.push(key);
    jsonStrings(item, output);
  });
  return output;
}

function candidateGeometryDigests(text) {
  const digests = new Set();
  if (/<svg\b/i.test(text)) {
    try {
      for (const entry of authorPathEntries(text)) digests.add(normalizedGeometryDigest(entry.d));
    } catch {
      // Невалидный SVG будет отвергнут своим contract gate; leak scanner не
      // должен превращаться во второй SVG parser.
    }
  }
  try {
    for (const value of jsonStrings(JSON.parse(text))) {
      if (!/^\s*[Mm]/.test(value)) continue;
      try { digests.add(normalizedGeometryDigest(value)); } catch { /* не path */ }
    }
  } catch {
    // Tool output/prompt не обязан быть JSON.
  }
  return digests;
}

export function scanHoldoutLeakage({ artifacts, signals }) {
  const identifying = signals.identifying ?? signals;
  const holdoutGeometry = new Set(identifying.geometryDigests);
  const findings = [];
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact.id !== 'string') throw new TypeError('baseline-freeze: artifact.id обязателен');
    const bytes = Buffer.isBuffer(artifact.content) ? artifact.content : Buffer.from(String(artifact.content));
    const text = bytes.toString('utf8');
    const push = (kind, signal) => findings.push({ artifact: artifact.id, kind, signal });
    for (const name of identifying.names) if (containsIdentityName(text, name)) push('holdout-name', name);
    for (const filename of identifying.filenames) if (containsFilename(text, filename)) push('holdout-filename', filename);
    for (const exportId of identifying.exportIds ?? []) if (containsExportId(text, exportId)) push('holdout-export-id', exportId);
    for (const fingerprint of identifying.fingerprints) if (text.includes(fingerprint)) push('holdout-fingerprint', fingerprint);
    for (const path of identifying.rawPaths) if (path.length >= 12 && text.includes(path)) push('holdout-raw-path', sha256(path));
    const bytesDigest = sha256(bytes);
    if (identifying.sourceFileDigests.includes(bytesDigest)) push('holdout-source-bytes', bytesDigest);
    for (const digest of candidateGeometryDigests(text)) {
      if (holdoutGeometry.has(digest)) push('holdout-geometry', digest);
    }
  }
  return findings.sort((left, right) =>
    asciiCompare(left.artifact, right.artifact)
    || asciiCompare(left.kind, right.kind)
    || asciiCompare(left.signal, right.signal));
}
