/**
 * Fail-closed proof boundary for axes advertised by the public Glyph IR.
 *
 * A different `d` string only proves that a parameter changes geometry.  It
 * does not prove that the resulting glyph remains readable.  This module
 * therefore admits an axis only after declared samples across its normalized
 * range, public optical rasters and a 4x analysis raster preserve phase-stable
 * ink topology.  This is an executable sampled proof, not a claim of analytic
 * topology for every real number between samples.
 * Failing axes stay modeled, but are named in an explicit reviewed debt
 * registry instead of being silently filtered from the catalog.
 */
import { buildGlyph, topologySignature } from './anatomy-gen.js';
import { DEFAULT_RASTER_PHASES, topologyAcrossPhases } from './ink-raster.js';

export const AXIS_QUALITY_VERSION = 1;
export const AXIS_QUALITY_TARGET_RASTERS = Object.freeze([16, 24, 48]);
export const AXIS_QUALITY_ANALYSIS_SUPERSAMPLE = 4;
// 128 интервалов — измеренный minimum, поймавший межмастерный topology event
// swap-horizontal/outline при weight=0.63242203125, который сетка 16 пропускала.
// Это ratchet от hostile bite, а не эстетически выбранная плотность.
export const AXIS_QUALITY_NORMALIZED_SUBDIVISIONS = 128;

export const AXIS_QUALITY_POLICY = Object.freeze({
  targetRasterSizes: AXIS_QUALITY_TARGET_RASTERS,
  analysisSupersample: AXIS_QUALITY_ANALYSIS_SUPERSAMPLE,
  normalizedSubdivisions: AXIS_QUALITY_NORMALIZED_SUBDIVISIONS,
  phases: DEFAULT_RASTER_PHASES,
  comparison: 'phase-stable components:holes against the default master',
});

const AXIS_NAMES = Object.freeze(['weight', 'corner']);
const VARIANTS = new Set(['outline', 'filled']);

function exactKeys(value, allowed, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`axis-quality: ${label} обязан быть объектом`);
  }
  const actual = Object.keys(value);
  const unknown = actual.filter((key) => !allowed.includes(key));
  const missing = allowed.filter((key) => !Object.hasOwn(value, key));
  if (unknown.length > 0) {
    throw new TypeError(`axis-quality: ${label} несёт неизвестные поля ${unknown.join(', ')}`);
  }
  if (missing.length > 0) {
    throw new TypeError(`axis-quality: ${label} не имеет обязательных полей ${missing.join(', ')}`);
  }
}

function parseDebtId(id) {
  const match = /^([a-z0-9]+(?:-[a-z0-9]+)*)\/(outline|filled)\/(weight|corner)$/.exec(id);
  return match ? { name: match[1], variant: match[2], axis: match[3] } : null;
}

export function validateAxisQuality(quality, anatomy = null) {
  exactKeys(quality, ['version', 'comment', 'policy', 'disabled'], 'root');
  if (quality.version !== AXIS_QUALITY_VERSION) {
    throw new RangeError(`axis-quality: поддерживается version ${AXIS_QUALITY_VERSION}`);
  }
  if (typeof quality.comment !== 'string' || quality.comment.trim().length < 32) {
    throw new TypeError('axis-quality: comment обязан объяснять provenance политики');
  }
  if (JSON.stringify(quality.policy) !== JSON.stringify(AXIS_QUALITY_POLICY)) {
    throw new Error('axis-quality: policy дрейфует от исполняемого proof oracle');
  }
  if (!quality.disabled || typeof quality.disabled !== 'object' || Array.isArray(quality.disabled)) {
    throw new TypeError('axis-quality: disabled обязан быть объектом');
  }

  const ids = Object.keys(quality.disabled);
  if (JSON.stringify(ids) !== JSON.stringify([...ids].sort())) {
    throw new Error('axis-quality: disabled обязан быть отсортирован ASCII для стабильного review');
  }
  for (const id of ids) {
    const parsed = parseDebtId(id);
    if (!parsed) throw new TypeError(`axis-quality: невалидный debt id ${id}`);
    const record = quality.disabled[id];
    exactKeys(record, ['reason', 'exitCriteria'], `disabled.${id}`);
    for (const field of ['reason', 'exitCriteria']) {
      if (typeof record[field] !== 'string' || record[field].trim().length < 32) {
        throw new TypeError(`axis-quality: ${id}.${field} обязан быть содержательным`);
      }
    }
    if (anatomy) {
      const status = anatomy.glyphs?.[parsed.name]?.status?.[parsed.variant];
      if (status !== 'generated' && status !== 'hand') {
        throw new Error(`axis-quality: ${id} обязан ссылаться на существующий model master`);
      }
    }
  }
  return quality;
}

function axisContracts(grid) {
  return {
    weight: {
      min: grid.axes.weight.min,
      default: 1,
      max: grid.axes.weight.max,
    },
    corner: {
      min: 0,
      default: 1,
      max: 1 / grid.ratios.cornerSmoothing,
    },
  };
}

function axisSamples(contract) {
  const values = Array.from(
    { length: AXIS_QUALITY_NORMALIZED_SUBDIVISIONS + 1 },
    (_, index) => (
      contract.min +
      ((contract.max - contract.min) * index) / AXIS_QUALITY_NORMALIZED_SUBDIVISIONS
    ),
  );
  values.push(contract.default);
  return [...new Set(values)].sort((a, b) => a - b);
}

function rasterSizes() {
  const largest = AXIS_QUALITY_TARGET_RASTERS.at(-1);
  return [...AXIS_QUALITY_TARGET_RASTERS, largest * AXIS_QUALITY_ANALYSIS_SUPERSAMPLE];
}

function topologySample(d, fillRule, grid, rasterSize) {
  return topologyAcrossPhases(
    [{ d, fillRule }],
    {
      width: grid.canvas.width,
      height: grid.canvas.height,
      step: grid.canvas.width / rasterSize,
      stepsPerSeg: 24,
      minFeatureArea: 0,
      phases: DEFAULT_RASTER_PHASES,
    },
  );
}

function firstAxisFinding(entry, variant, axis, contract, grid, lib, fillRule, baseline) {
  const baselineCommandTopology = topologySignature(baseline);
  const baselineRaster = new Map();
  for (const rasterSize of rasterSizes()) {
    const sample = topologySample(baseline, fillRule, grid, rasterSize);
    if (!sample.stable) {
      return {
        kind: 'default-phase-unstable',
        axis,
        value: contract.default,
        rasterSize,
        signatures: sample.signatures,
      };
    }
    baselineRaster.set(rasterSize, sample.signatures[0]);
  }

  for (const value of axisSamples(contract)) {
    const d = buildGlyph(entry, grid, { [axis]: value }, lib)[variant];
    if (topologySignature(d) !== baselineCommandTopology) {
      return {
        kind: 'command-topology-drift',
        axis,
        value,
        rasterSize: null,
        signatures: [baselineCommandTopology, topologySignature(d)],
      };
    }
    for (const rasterSize of rasterSizes()) {
      const sample = topologySample(d, fillRule, grid, rasterSize);
      const baselineSignature = baselineRaster.get(rasterSize);
      if (!sample.stable || sample.signatures.some((signature) => signature !== baselineSignature)) {
        return {
          kind: sample.stable ? 'axis-topology-drift' : 'axis-phase-unstable',
          axis,
          value,
          rasterSize,
          signatures: [baselineSignature, ...sample.signatures],
        };
      }
    }
  }
  return null;
}

/**
 * Returns every geometry-active axis together with its first deterministic
 * proof finding. `finding:null` is the only state eligible for public support.
 */
export function proveVariantAxes(entry, variant, grid, lib, fillRule) {
  if (!VARIANTS.has(variant)) throw new TypeError(`axis-quality: неизвестный variant ${variant}`);
  if (!['nonzero', 'evenodd'].includes(fillRule)) {
    throw new TypeError(`axis-quality: неизвестный fillRule ${fillRule}`);
  }
  const baseline = buildGlyph(entry, grid, {}, lib)[variant];
  if (!baseline) return [];
  const contracts = axisContracts(grid);
  const results = [];
  for (const axis of AXIS_NAMES) {
    const contract = contracts[axis];
    const samples = axisSamples(contract);
    const active = samples.some((value) => (
      buildGlyph(entry, grid, { [axis]: value }, lib)[variant] !== baseline
    ));
    if (!active) continue;
    results.push({
      axis,
      finding: firstAxisFinding(
        entry,
        variant,
        axis,
        contract,
        grid,
        lib,
        fillRule,
        baseline,
      ),
    });
  }
  return results;
}

/**
 * Reconciles computed proof with reviewed debt.  Neither a new failure nor a
 * fixed axis can change the public capability surface without an explicit
 * registry edit in the same review.
 */
export function resolvePublicAxes(variantId, proofs, disabledAxes, seenAxisDebt = new Set()) {
  if (typeof variantId !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*\/(?:outline|filled)$/.test(variantId)) {
    throw new TypeError(`axis-quality: невалидный variant id ${String(variantId)}`);
  }
  if (!Array.isArray(proofs) || !(disabledAxes instanceof Set) || !(seenAxisDebt instanceof Set)) {
    throw new TypeError('axis-quality: proofs и debt sets имеют невалидный тип');
  }
  return proofs.flatMap(({ axis, finding }) => {
    const id = `${variantId}/${axis}`;
    const disabled = disabledAxes.has(id);
    if (finding && !disabled) {
      throw new Error(
        `axis-quality: ${id} провалил proof без reviewed debt: ` +
        `${finding.kind} value=${finding.value} raster=${finding.rasterSize} ` +
        `${finding.signatures.join(' → ')}`,
      );
    }
    if (!finding && disabled) {
      throw new Error(`axis-quality: ${id} debt устарел: proof уже проходит`);
    }
    if (disabled) {
      seenAxisDebt.add(id);
      return [];
    }
    return [axis];
  });
}

export function axisDebtIds(quality, anatomy = null) {
  return new Set(Object.keys(validateAxisQuality(quality, anatomy).disabled));
}
