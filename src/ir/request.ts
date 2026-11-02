import type { AxisContract, AxisName, IconVariant, SymbolOptions } from './glyph-types.js';
import { AXIS_NAMES } from './catalog.generated.js';

export type { SymbolOptions };

export type GlyphModelErrorCode = 'CANDIDATES_REQUIRED' | 'AUTHOR_PARITY_REQUIRED' | 'AUTHOR_VARIATION_UNSUPPORTED';

/** Потребитель проверяет code; сообщение не является машинным контрактом. */
export class GlyphModelError extends Error {
  readonly code: GlyphModelErrorCode;
  constructor(code: GlyphModelErrorCode, message: string) {
    super(message);
    this.name = 'GlyphModelError';
    this.code = code;
  }
}

export function parseSymbolVariant(value: unknown): IconVariant {
  if (value !== 'outline' && value !== 'filled') {
    throw new TypeError(`@labpics/icons/ir: variant обязан быть outline или filled, получено «${String(value)}»`);
  }
  return value;
}

/** Общая граница запроса для полного каталога и предварительно собранного символа. */
export function parseSymbolOptions(
  value: unknown,
  contracts?: Readonly<Record<AxisName, AxisContract>>,
  authorVariation = false,
): SymbolOptions {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('@labpics/icons/ir: запрос обязан быть объектом');
  }
  const input = value as Record<string, unknown>;
  const unknownKeys = Object.keys(input).filter(key =>
    !(authorVariation && key === 'variation') && !['variant', 'modelMode', 'axes'].includes(key));
  if (unknownKeys.length) {
    throw new TypeError(`@labpics/icons/ir: неизвестные поля запроса: ${unknownKeys.join(', ')}`);
  }
  const requestedMode = input.modelMode;
  const mode = requestedMode === undefined ? 'accepted-only' : requestedMode;
  if (mode !== 'accepted-only' && mode !== 'allow-candidate' && mode !== 'source-only') {
    throw new TypeError(`@labpics/icons/ir: modelMode обязан быть accepted-only, allow-candidate или source-only, получено «${String(mode)}»`);
  }
  const axes: Partial<Record<AxisName, number>> = {};
  const requestedAxes = input.axes;
  if (requestedAxes !== undefined) {
    if (requestedAxes === null || typeof requestedAxes !== 'object' || Array.isArray(requestedAxes)) {
      throw new TypeError('@labpics/icons/ir: axes обязан быть объектом');
    }
    for (const [name, value] of Object.entries(requestedAxes)) {
      if (contracts ? !Object.hasOwn(contracts, name) : !AXIS_NAMES.includes(name as AxisName)) {
        throw new TypeError(`@labpics/icons/ir: неизвестная ось «${name}»`);
      }
      const axis = contracts?.[name as AxisName];
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new TypeError(`@labpics/icons/ir: ось ${name} обязана быть конечным числом`);
      }
      if (axis && (value < axis.min || value > axis.max)) {
        throw new RangeError(`@labpics/icons/ir: ось ${name}=${value} вне диапазона [${axis.min}, ${axis.max}]`);
      }
      axes[name as AxisName] = value;
    }
  }
  const variant = input.variant;
  return Object.freeze({
    variant: variant === undefined ? 'outline' : parseSymbolVariant(variant),
    modelMode: mode,
    axes: Object.freeze(axes),
  });
}
