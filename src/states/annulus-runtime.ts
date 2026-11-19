import { annulusEmphasisParameter, materializeCompiledAnnulus, AuthoredAnnulusVariationError } from '../ir/annulus-geometry-runtime.js';
import type { CompiledAnnulusGeometry } from '../ir/annulus-geometry-runtime.js';
import type { EnclosureVariationCapabilities, EnclosureVariationRefusal, EnclosureVariationRequest,
  EnclosureVariationResult, SymbolGeometryPatch } from './annulus-types.js';

interface CompiledEnclosureVariation extends CompiledAnnulusGeometry {
  readonly group: string;
  readonly variant: 'outline';
  readonly partId: string;
  readonly defaultD: string;
}

function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree); Object.freeze(value);
  }
  return value;
}

function refuse(code: EnclosureVariationRefusal['reason']['code'], message: string): EnclosureVariationRefusal {
  return Object.freeze({ ok: false, reason: Object.freeze({ code, message }) });
}

/** @internal Сборка уже связала эту часть со всеми members и общим domain. */
export function createCompiledEnclosureVariation(input: CompiledEnclosureVariation) {
  const data = freezeTree(input);
  const patch = (d: string): Readonly<{ ok: true; patch: SymbolGeometryPatch }> => freezeTree({ ok: true, patch: {
    contract: 'labpics.symbol-geometry-patch/1', version: 1, group: data.group, variant: data.variant,
    partId: data.partId, attributes: { d },
  } });
  const defaultPatch = patch(data.defaultD);

  return function renderEnclosurePatch(request: EnclosureVariationRequest = {}): EnclosureVariationResult {
    if (!request || typeof request !== 'object' || Object.getPrototypeOf(request) !== Object.prototype ||
        Reflect.ownKeys(request).some(key => key !== 'variant' && key !== 'variation')) {
      return refuse('INVALID_REQUEST', 'Нужен объект с известными параметрами обрамления.');
    }
    const variant: unknown = request.variant === undefined ? data.variant : request.variant;
    if (variant !== 'outline') {
      return variant === 'filled'
        ? refuse('VARIANT_UNSUPPORTED', 'Независимая Filled форма не имеет общего annulus допуска.')
        : refuse('INVALID_REQUEST', 'Начертание: outline.');
    }
    try {
      const emphasis = annulusEmphasisParameter(request.variation === undefined ? {} : request.variation);
      // Возврат authored строки не проходит через арифметику или сериализацию.
      if (emphasis === 1) return defaultPatch;
      return patch(materializeCompiledAnnulus(data, emphasis).d);
    } catch (error) {
      if (!(error instanceof AuthoredAnnulusVariationError)) throw error;
      if (error.code === 'INVALID_VARIATION') return refuse('INVALID_REQUEST', error.message);
      if (error.code === 'VARIATION_OUTSIDE_DOMAIN') return refuse(error.code, error.message);
      return refuse('POSE_UNREPRESENTABLE', error.message);
    }
  };
}

/** @internal Metadata отделена от materializer и может быть удалена tree shaking. */
export function createCompiledEnclosureVariationCapabilities(input: EnclosureVariationCapabilities) {
  const capabilities = freezeTree(input);
  return function enclosureVariationCapabilities() { return capabilities; };
}
