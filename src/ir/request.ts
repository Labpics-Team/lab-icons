import type { AxisContract, AxisName, IconVariant, ModelMode } from './compiler.js';
import { AXIS_NAMES } from './catalog.generated.js';

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

export interface SymbolOptions {
  readonly variant: IconVariant;
  readonly modelMode: ModelMode;
  readonly axes: Readonly<Partial<Record<AxisName, number>>>;
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
): SymbolOptions {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('@labpics/icons/ir: запрос обязан быть объектом');
  }
  const input = value as Record<string, unknown>;
  const unknownKeys = Object.keys(input).filter(key => !['variant', 'modelMode', 'axes'].includes(key));
  if (unknownKeys.length) {
    throw new TypeError(`@labpics/icons/ir: неизвестные поля запроса: ${unknownKeys.join(', ')}`);
  }
  const mode = input.modelMode === undefined ? 'accepted-only' : input.modelMode;
  if (mode !== 'accepted-only' && mode !== 'allow-candidate' && mode !== 'source-only') {
    throw new TypeError(`@labpics/icons/ir: modelMode обязан быть accepted-only, allow-candidate или source-only, получено «${String(mode)}»`);
  }
  const axes: Partial<Record<AxisName, number>> = {};
  if (input.axes !== undefined) {
    if (input.axes === null || typeof input.axes !== 'object' || Array.isArray(input.axes)) {
      throw new TypeError('@labpics/icons/ir: axes обязан быть объектом');
    }
    for (const [name, value] of Object.entries(input.axes)) {
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
  return Object.freeze({
    variant: input.variant === undefined ? 'outline' : parseSymbolVariant(input.variant),
    modelMode: mode,
    axes: Object.freeze(axes),
  });
}
