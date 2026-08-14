/**
 * Полный каталог корпуса: источник, доказанность модели и стабильные части.
 *
 * SVG остаётся точным source fallback. Наличие файла не превращает его в
 * параметрическую модель: model появляется только для деклараций anatomy, а
 * accepted/candidate различает отгруженный закон и ещё не принятую реконструкцию.
 */
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { optimize } from 'svgo';
import { buildGlyph, buildGlyphParts, topologySignature } from './anatomy-gen.js';
import { authorPathEntries, sourcePathEntries } from './icon-geometry.js';
import { parsePathData } from './path-data.js';
import { axisDebtIds, proveVariantAxes, resolvePublicAxes } from './axis-quality.js';
import { quarantinedModelIds } from './model-quality.js';

export const CATALOG_VERSION = 1;
export const VARIANTS = ['outline', 'filled'];
export const MODEL_STATES = new Set(['accepted', 'candidate']);
export const PART_ROLES = new Set([
  'body',
  'content',
  'ink',
  'counter',
  'container',
  'control',
  'detail',
  'decorator',
  'unclassified',
]);

const round = (value) => Number(value.toFixed(6));
const require = createRequire(import.meta.url);
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const normalizedSegments = (d) => JSON.stringify(parsePathData(d));
const variantPath = (name, variant) => variant === 'outline'
  ? `svg/Outline/${name}.svg`
  : `svg/Filled/${name}_filled.svg`;

function iconNames(root) {
  const outline = readdirSync(join(root, 'svg', 'Outline'))
    .filter((file) => file.endsWith('.svg'))
    .map((file) => file.slice(0, -4))
    .sort();
  const filled = readdirSync(join(root, 'svg', 'Filled'))
    .filter((file) => file.endsWith('_filled.svg'))
    .map((file) => file.slice(0, -'_filled.svg'.length))
    .sort();
  if (JSON.stringify(outline) !== JSON.stringify(filled)) {
    throw new Error('icon-catalog: Outline/Filled name parity нарушен');
  }
  return outline;
}

export function buildSourceVariantContract(root, name, variant, svgoConfig) {
  const file = variantPath(name, variant);
  const svg = readFileSync(join(root, file), 'utf8');
  const optimized = optimize(svg, { ...svgoConfig, path: join(root, file) });
  if (optimized.error) throw new Error(`icon-catalog: SVGO не собрал ${file}: ${optimized.error}`);
  const sourceEntries = authorPathEntries(svg);
  const artifactEntries = sourcePathEntries(optimized.data);
  if (sourceEntries.length !== artifactEntries.length) {
    throw new Error(`icon-catalog: SVGO изменил path count ${file}`);
  }
  const occurrences = new Map();
  const parts = sourceEntries.map((entry, zIndex) => {
    const fingerprint = sha256(`${entry.fillRule}\0${normalizedSegments(entry.d)}`);
    const artifactEntry = artifactEntries[zIndex];
    const artifactFingerprint = sha256(
      `${artifactEntry.fillRule}\0${normalizedSegments(artifactEntry.d)}`,
    );
    const occurrence = (occurrences.get(fingerprint) ?? 0) + 1;
    occurrences.set(fingerprint, occurrence);
    return {
      // У source-only нет доказанной semantic identity. Hash переживает
      // перестановку path, но честно меняется при редактировании геометрии.
      id: `source-${fingerprint.slice(0, 12)}${occurrence > 1 ? `-${occurrence}` : ''}`,
      identity: 'geometry-derived',
      role: 'unclassified',
      zIndex,
      fillRule: entry.fillRule,
      topologySignature: topologySignature(entry.d),
      sourceFingerprint: `sha256:${fingerprint}`,
      artifactFingerprint: `sha256:${artifactFingerprint}`,
    };
  });
  if (parts.length === 0) throw new Error(`icon-catalog: ${file} не содержит path`);
  return { file, parts };
}

function supportedAxes(name, entry, variant, grid, lib, fillRule, disabledAxes, seenAxisDebt) {
  return resolvePublicAxes(
    `${name}/${variant}`,
    proveVariantAxes(entry, variant, grid, lib, fillRule),
    disabledAxes,
    seenAxisDebt,
  );
}

export function modelComposition(sourceVariant) {
  const rules = new Set(sourceVariant.parts.map((part) => part.fillRule));
  // buildGlyph возвращает один compound path. Если исторический source был
  // разбит на элементы с разными rules, генераторный закон по конструкции
  // nonzero-safe (внутренние counters реверсированы); default-паритет ниже
  // доказывается дифференциальным raster-тестом, а не верой в это правило.
  return {
    kind: 'compound',
    fillRule: rules.size === 1 ? [...rules][0] : 'nonzero',
  };
}

function modelFor(name, entry, grid, lib, source, quarantine, disabledAxes, seenAxisDebt) {
  const parts = buildGlyphParts(entry, grid, {}, lib);
  const variants = {};
  for (const variant of VARIANTS) {
    const status = entry.status?.[variant];
    if (!status || !parts[variant]) continue;
    if (status !== 'generated' && status !== 'hand') {
      throw new Error(`icon-catalog: ${name}/${variant} имеет неизвестный anatomy status ${String(status)}`);
    }
    const composition = modelComposition(source[variant]);
    variants[variant] = {
      state: status === 'generated' && !quarantine.has(`${name}/${variant}`)
        ? 'accepted'
        : 'candidate',
      supportedAxes: supportedAxes(
        name,
        entry,
        variant,
        grid,
        lib,
        composition.fillRule,
        disabledAxes,
        seenAxisDebt,
      ),
      composition,
      parts: parts[variant].map((part) => ({
        id: part.id,
        identity: 'declared',
        role: part.role,
        zIndex: part.zIndex,
        anchor: part.anchor.map(round),
        anchorSource: part.anchorSource,
        morphGroup: part.morphGroup,
        topologySignature: part.topologySignature,
      })),
    };
  }
  return {
    declaration: name,
    archetype: entry.archetype,
    variants,
  };
}

export function buildIconCatalog(root, anatomy, grid, modelQuality, axisQuality) {
  const svgoConfig = require(join(root, 'svgo.config.cjs'));
  const quarantine = quarantinedModelIds(modelQuality, anatomy);
  const disabledAxes = axisDebtIds(axisQuality, anatomy);
  const seenAxisDebt = new Set();
  const icons = {};
  for (const name of iconNames(root)) {
    const source = Object.fromEntries(VARIANTS.map((variant) => [
      variant,
      buildSourceVariantContract(root, name, variant, svgoConfig),
    ]));
    const entry = anatomy.glyphs[name];
    icons[name] = {
      source,
      model: entry ? modelFor(
        name,
        entry,
        grid,
        anatomy.glyphs,
        source,
        quarantine,
        disabledAxes,
        seenAxisDebt,
      ) : null,
    };
  }

  const orphanedAxisDebt = [...disabledAxes].filter((id) => !seenAxisDebt.has(id));
  if (orphanedAxisDebt.length > 0) {
    throw new Error(`icon-catalog: orphaned axis debt ${orphanedAxisDebt.join(', ')}`);
  }

  const catalog = {
    version: CATALOG_VERSION,
    canvas: {
      viewBox: [0, 0, grid.canvas.width, grid.canvas.height],
      declarationUnits: 'fraction-of-canvas',
    },
    variants: VARIANTS,
    axes: {
      weight: {
        // continuous описывает числовую интерполяцию генератора. Public
        // capability появляется отдельно, только после sampled optical proof.
        kind: 'continuous',
        min: grid.axes.weight.min,
        default: 1,
        max: grid.axes.weight.max,
        lifecycle: 'active-after-sampled-optical-proof',
      },
      corner: {
        kind: 'continuous',
        min: 0,
        default: 1,
        max: round(1 / grid.ratios.cornerSmoothing),
        lifecycle: 'active-after-sampled-optical-proof',
      },
      opsz: {
        kind: 'continuous',
        min: 16,
        default: 24,
        max: 48,
        lifecycle: 'active-in-recipe-kernels',
      },
    },
    icons,
  };
  validateIconCatalog(catalog);
  return catalog;
}

function assertExactKeys(value, allowed, where) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`icon-catalog: ${where} обязан быть объектом`);
  }
  const extra = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extra.length > 0) throw new Error(`icon-catalog: ${where} несёт неизвестные поля ${extra.join(', ')}`);
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  if (missing.length > 0) throw new Error(`icon-catalog: ${where} не имеет обязательных полей ${missing.join(', ')}`);
}

function validTopologySignature(value) {
  return typeof value === 'string' && /^(?:[MLHVCSQTAZ]+)(?:\|[MLHVCSQTAZ]+)*$/.test(value);
}

function validStableId(value) {
  return typeof value === 'string' && /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(value);
}

export function validateCatalogRatchet(ratchet) {
  assertExactKeys(ratchet, [
    'version',
    'comment',
    'minimumModeledNames',
    'minimumModeledVariants',
    'minimumGeneratedVariants',
    'minimumAcceptedVariants',
    'maximumQuarantinedGeneratedVariants',
    'maximumSourceOnlyVariants',
    'maximumUnclassifiedModelParts',
  ], 'catalog-ratchet');
  if (ratchet.version !== 1) throw new Error('icon-catalog: catalog-ratchet.version обязан быть 1');
  if (typeof ratchet.comment !== 'string' || ratchet.comment.trim().length < 24) {
    throw new Error('icon-catalog: catalog-ratchet.comment обязан объяснять provenance порога');
  }
  for (const name of [
    'minimumModeledNames',
    'minimumModeledVariants',
    'minimumGeneratedVariants',
    'minimumAcceptedVariants',
    'maximumQuarantinedGeneratedVariants',
    'maximumSourceOnlyVariants',
    'maximumUnclassifiedModelParts',
  ]) {
    if (!Number.isInteger(ratchet[name]) || ratchet[name] < 0) {
      throw new Error(`icon-catalog: catalog-ratchet.${name} обязан быть целым >= 0`);
    }
  }
  return ratchet;
}

export function validateIconCatalog(catalog) {
  if (!catalog || typeof catalog !== 'object' || Array.isArray(catalog)) {
    throw new Error('icon-catalog: корень обязан быть объектом');
  }
  assertExactKeys(catalog, ['version', 'canvas', 'variants', 'axes', 'icons'], 'root');
  if (catalog.version !== CATALOG_VERSION) {
    throw new Error(`icon-catalog: поддерживается version ${CATALOG_VERSION}`);
  }
  if (JSON.stringify(catalog.variants) !== JSON.stringify(VARIANTS)) {
    throw new Error('icon-catalog: варианты обязаны быть outline,filled в каноническом порядке');
  }
  assertExactKeys(catalog.canvas, ['viewBox', 'declarationUnits'], 'canvas');
  if (
    !Array.isArray(catalog.canvas.viewBox) ||
    catalog.canvas.viewBox.length !== 4 ||
    catalog.canvas.viewBox.some((value) => !Number.isFinite(value)) ||
    !(catalog.canvas.viewBox[2] > 0 && catalog.canvas.viewBox[3] > 0) ||
    catalog.canvas.declarationUnits !== 'fraction-of-canvas'
  ) {
    throw new Error('icon-catalog: canvas contract невалиден');
  }
  if (!catalog.axes || typeof catalog.axes !== 'object' || Array.isArray(catalog.axes)) {
    throw new Error('icon-catalog: axes обязан быть объектом');
  }
  for (const [name, axis] of Object.entries(catalog.axes)) {
    if (!/^[a-z][a-zA-Z0-9]*$/.test(name)) throw new Error(`icon-catalog: невалидное имя оси ${name}`);
    assertExactKeys(axis, ['kind', 'min', 'default', 'max', 'lifecycle'], `axes.${name}`);
    if (
      axis.kind !== 'continuous' ||
      ![axis.min, axis.default, axis.max].every(Number.isFinite) ||
      !(axis.min <= axis.default && axis.default <= axis.max) ||
      typeof axis.lifecycle !== 'string' ||
      axis.lifecycle.length === 0
    ) {
      throw new Error(`icon-catalog: ось ${name} имеет невалидный контракт`);
    }
  }
  if (!catalog.icons || typeof catalog.icons !== 'object' || Array.isArray(catalog.icons)) {
    throw new Error('icon-catalog: icons обязан быть объектом');
  }

  for (const [name, icon] of Object.entries(catalog.icons)) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) {
      throw new Error(`icon-catalog: невалидное имя ${name}`);
    }
    assertExactKeys(icon, ['source', 'model'], `icons.${name}`);
    for (const variant of VARIANTS) {
      const source = icon.source?.[variant];
      if (!source) throw new Error(`icon-catalog: ${name}/${variant} не имеет source`);
      assertExactKeys(source, ['file', 'parts'], `${name}/${variant}.source`);
      if (source.file !== variantPath(name, variant)) {
        throw new Error(`icon-catalog: ${name}/${variant} указывает неканонический файл`);
      }
      if (!Array.isArray(source.parts) || source.parts.length === 0) {
        throw new Error(`icon-catalog: ${name}/${variant}.source.parts обязан быть непустым массивом`);
      }
      const ids = new Set();
      for (const [partIndex, part] of source.parts.entries()) {
        assertExactKeys(
          part,
          [
            'id', 'identity', 'role', 'zIndex', 'fillRule', 'topologySignature',
            'sourceFingerprint', 'artifactFingerprint',
          ],
          `${name}/${variant}.source.part`,
        );
        if (!/^source-[0-9a-f]{12}(?:-[1-9][0-9]*)?$/.test(part.id)) {
          throw new Error(`icon-catalog: ${name}/${variant} имеет невалидный source part.id`);
        }
        if (ids.has(part.id)) throw new Error(`icon-catalog: ${name}/${variant} повторяет source part.id ${part.id}`);
        ids.add(part.id);
        if (part.identity !== 'geometry-derived' || part.role !== 'unclassified') {
          throw new Error(`icon-catalog: ${name}/${variant}/${part.id} притворяется семантически размеченным source`);
        }
        if (
          !/^sha256:[0-9a-f]{64}$/.test(part.sourceFingerprint) ||
          !/^sha256:[0-9a-f]{64}$/.test(part.artifactFingerprint)
        ) {
          throw new Error(`icon-catalog: ${name}/${variant}/${part.id} имеет невалидный fingerprint`);
        }
        if (
          part.zIndex !== partIndex ||
          !['nonzero', 'evenodd'].includes(part.fillRule) ||
          !validTopologySignature(part.topologySignature)
        ) {
          throw new Error(`icon-catalog: ${name}/${variant}/${part.id} имеет невалидную source geometry schema`);
        }
      }
      if (ids.size === 0) throw new Error(`icon-catalog: ${name}/${variant} source пуст`);
    }

    if (icon.model == null) continue;
    assertExactKeys(icon.model, ['declaration', 'archetype', 'variants'], `${name}.model`);
    if (icon.model.declaration !== name) throw new Error(`icon-catalog: ${name} ссылается на чужую модель`);
    if (typeof icon.model.archetype !== 'string' || icon.model.archetype.length === 0) {
      throw new Error(`icon-catalog: ${name} имеет невалидный archetype`);
    }
    if (!icon.model.variants || typeof icon.model.variants !== 'object' || Array.isArray(icon.model.variants)) {
      throw new Error(`icon-catalog: ${name}.model.variants обязан быть объектом`);
    }
    for (const [variant, model] of Object.entries(icon.model.variants)) {
      if (!VARIANTS.includes(variant)) throw new Error(`icon-catalog: ${name} имеет неизвестный model variant ${variant}`);
      assertExactKeys(model, ['state', 'supportedAxes', 'composition', 'parts'], `${name}/${variant}.model`);
      if (!MODEL_STATES.has(model.state)) throw new Error(`icon-catalog: ${name}/${variant} имеет неизвестный model state`);
      if (!Array.isArray(model.supportedAxes) ||
          new Set(model.supportedAxes).size !== model.supportedAxes.length ||
          model.supportedAxes.some((axis) => !Object.hasOwn(catalog.axes, axis))) {
        throw new Error(`icon-catalog: ${name}/${variant} имеет невалидный supportedAxes`);
      }
      assertExactKeys(model.composition, ['kind', 'fillRule'], `${name}/${variant}.model.composition`);
      if (
        model.composition.kind !== 'compound' ||
        !['nonzero', 'evenodd'].includes(model.composition.fillRule)
      ) {
        throw new Error(`icon-catalog: ${name}/${variant} имеет невалидную composition`);
      }
      if (!Array.isArray(model.parts) || model.parts.length === 0) {
        throw new Error(`icon-catalog: ${name}/${variant}.model.parts обязан быть непустым массивом`);
      }
      const ids = new Set();
      for (const [partIndex, part] of model.parts.entries()) {
        assertExactKeys(
          part,
          ['id', 'identity', 'role', 'zIndex', 'anchor', 'anchorSource', 'morphGroup', 'topologySignature'],
          `${name}/${variant}.model.part`,
        );
        if (!validStableId(part.id)) throw new Error(`icon-catalog: ${name}/${variant} имеет невалидный model part.id`);
        if (ids.has(part.id)) throw new Error(`icon-catalog: ${name}/${variant} повторяет model part.id ${part.id}`);
        ids.add(part.id);
        if (part.identity !== 'declared' || !PART_ROLES.has(part.role)) {
          throw new Error(`icon-catalog: ${name}/${variant}/${part.id} имеет невалидный semantic contract`);
        }
        if (!Array.isArray(part.anchor) || part.anchor.length !== 2 || part.anchor.some((n) => !Number.isFinite(n))) {
          throw new Error(`icon-catalog: ${name}/${variant}/${part.id} имеет невалидный anchor`);
        }
        if (
          part.zIndex !== partIndex ||
          part.anchor.some((n) => n < 0 || n > 1) ||
          !['declared', 'geometry-bbox-center'].includes(part.anchorSource) ||
          !(part.morphGroup === null || validStableId(part.morphGroup)) ||
          !validTopologySignature(part.topologySignature)
        ) {
          throw new Error(`icon-catalog: ${name}/${variant}/${part.id} имеет невалидную model geometry schema`);
        }
      }
      if (ids.size === 0) throw new Error(`icon-catalog: ${name}/${variant} model пуст`);
    }
  }
  return catalog;
}

export function serializeIconCatalog(catalog) {
  return `${JSON.stringify(validateIconCatalog(catalog), null, 1)}\n`;
}
