import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { normalizeFigmaSvg } from './figma-import.js';
import { buildSourceVariantContractFromSvg } from './icon-catalog.js';
import { authorPathEntries } from '../../src/core/icon-geometry.js';

const NAME = /^[a-z][a-z0-9-]*$/;
const HASH = /^[a-f0-9]{64}$/;
const NODE = /^\d+:\d+$/;
const VARIANTS = ['outline', 'filled'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const stableJSON = value => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]]))
    : item);

export class AuthorBaselineError extends Error {
  constructor(code, message, options) {
    super(`author-baseline: ${message}`, options);
    this.name = 'AuthorBaselineError';
    this.code = code;
  }
}

function refuse(code, message) {
  throw new AuthorBaselineError(code, message);
}

function record(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

/** Проекция имён не разбирает geometry и никогда не подменяет master-проверку. */
export function authorIconNames(manifest) {
  if (!record(manifest) || manifest.schemaVersion !== 1 || !record(manifest.source) ||
      manifest.source.kind !== 'figma' || typeof manifest.source.fileKey !== 'string' ||
      !/^[A-Za-z0-9]+$/.test(manifest.source.fileKey) ||
      typeof manifest.source.version !== 'string' || !/^\d+$/.test(manifest.source.version) ||
      !record(manifest.icons)) {
    refuse('MANIFEST_INVALID', 'требуется versioned Figma manifest');
  }
  const names = Object.keys(manifest.icons).sort();
  if (!names.length || names.some(name => !NAME.test(name)) ||
      !record(manifest.counts) || manifest.counts.families !== names.length ||
      manifest.counts.variants !== names.length * VARIANTS.length) {
    refuse('MANIFEST_INVALID', 'имена и полный Outline/Filled census не совпадают с counts');
  }
  for (const name of names) {
    const variants = manifest.icons[name];
    if (!record(variants) || Object.keys(variants).sort().join(',') !== 'filled,outline') {
      refuse('MANIFEST_INVALID', `${name} обязан иметь ровно Outline и Filled`);
    }
    for (const variant of VARIANTS) {
      const item = variants[variant];
      if (!record(item) || !NODE.test(item.nodeId) || !HASH.test(item.nodeSha256) ||
          !HASH.test(item.sha256) || !Number.isSafeInteger(item.bytes) || item.bytes <= 0 ||
          !record(item.normalizedSource) || item.normalizedSource.status !== 'supported' ||
          !HASH.test(item.normalizedSource.sha256) || !HASH.test(item.normalizedSource.pathFingerprintSha256)) {
        refuse('MANIFEST_INVALID', `${name}/${variant} не имеет полного supported master receipt`);
      }
      const expected = `masters/figma/${manifest.source.version}/${variant === 'outline' ? 'Outline' : 'Filled'}/${name}.svg`;
      if (item.master !== expected) refuse('MASTER_PATH_INVALID', `${name}/${variant}: нужен canonical master ${expected}`);
    }
  }
  return names;
}

/** Общая граница build/Observatory: до выдачи любого источника проверяется весь снимок. */
export function loadAuthorBaseline(repoRoot, { manifest } = {}) {
  const input = manifest ?? JSON.parse(readFileSync(join(repoRoot, 'semantics', 'figma-baseline.json'), 'utf8'));
  const names = authorIconNames(input);
  const icons = {};
  for (const name of names) {
    const variants = {};
    for (const variant of VARIANTS) {
      const item = input.icons[name][variant];
      let bytes;
      try {
        bytes = readFileSync(join(repoRoot, item.master));
      } catch (cause) {
        throw new AuthorBaselineError('MASTER_UNREADABLE', `${name}/${variant}: master не прочитан`, { cause });
      }
      if (bytes.length !== item.bytes || sha256(bytes) !== item.sha256) {
        refuse('MASTER_HASH_MISMATCH', `${name}/${variant}: raw bytes/SHA256 не совпали с immutable receipt`);
      }
      const rawSvg = bytes.toString('utf8');
      let normalizedSvg;
      try {
        normalizedSvg = normalizeFigmaSvg(rawSvg, { source: item.master });
      } catch (cause) {
        throw new AuthorBaselineError('MASTER_UNSUPPORTED', `${name}/${variant}: SVG не проходит supported lowering`, { cause });
      }
      if (sha256(normalizedSvg) !== item.normalizedSource.sha256) {
        refuse('NORMALIZED_HASH_MISMATCH', `${name}/${variant}: normalized SHA256 не совпал с receipt`);
      }
      const fingerprint = sha256(stableJSON(authorPathEntries(normalizedSvg)));
      if (fingerprint !== item.normalizedSource.pathFingerprintSha256) {
        refuse('PATH_FINGERPRINT_MISMATCH', `${name}/${variant}: path order/fill-rule fingerprint не совпал`);
      }
      // Lowering уже проверил root paint. Единственная materialization здесь —
      // currentColor; авторские d, fill-rule и порядок не сериализуются заново.
      const artifactSvg = normalizedSvg.replace(/^<svg\b/, '<svg fill="currentColor"');
      const sourceContract = buildSourceVariantContractFromSvg({
        file: item.master, sourceSvg: normalizedSvg, artifactSvg,
      });
      const author = {
        kind: 'figma',
        fileKey: input.source.fileKey,
        version: input.source.version,
        nodeId: item.nodeId,
        nodeSha256: item.nodeSha256,
        masterSha256: item.sha256,
        normalizedSha256: item.normalizedSource.sha256,
        pathFingerprintSha256: item.normalizedSource.pathFingerprintSha256,
      };
      variants[variant] = { ...item, rawSvg, normalizedSvg, artifactSvg, sourceContract, author };
    }
    icons[name] = variants;
  }
  return freezeTree({ source: { ...input.source }, counts: { ...input.counts }, icons });
}

/** Source-only materialization использует тот же compiler, что записанный IR. */
export function authorSymbolPayload(icon, variantSources, compiler) {
  const source = {};
  const capabilities = {};
  const staticSvg = {};
  for (const variant of VARIANTS) {
    const item = variantSources[variant];
    const glyph = compiler.glyph({ icon, variant, modelMode: 'source-only' });
    const capability = compiler.glyphCapabilities(icon, variant);
    if (glyph.icon !== icon || glyph.variant !== variant || capability.icon !== icon || capability.variant !== variant ||
        glyph.provenance.kind !== 'source' || glyph.provenance.file !== item.master ||
        capability.modelState !== null || capability.supportedAxes.length ||
        capability.motion.state !== 'source-only' || capability.motion.partIds.length || capability.motion.tracks.length ||
        capability.motion.gestures.length) {
      refuse('SOURCE_CAPABILITY_DRIFT', `${icon}/${variant}: авторскому источнику приписана другая модель или admission`);
    }
    source[variant] = { ...glyph, provenance: { ...glyph.provenance, author: item.author } };
    capabilities[variant] = { ...capability, author: item.author };
    staticSvg[variant] = item.artifactSvg;
  }
  return freezeTree({ icon, source, capabilities, staticSvg });
}

/** Типы нового author corpus не меняют контракт записанного ./ir-каталога. */
export function renderAuthorTypeProjection(manifest) {
  const names = authorIconNames(manifest);
  return [
    '/** GENERATED: конечные имена semantics/figma-baseline.json; geometry сюда не попадает. */',
    'export type AuthorIconId =',
    ...names.map((name, index) => `  | '${name}'${index === names.length - 1 ? ';' : ''}`),
    '',
  ].join('\n');
}
