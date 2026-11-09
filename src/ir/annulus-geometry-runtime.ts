import type { AuthorAnnulusVariationDomain, AuthoredAnnulusVariation } from './author-annulus-types.js';

type Point = readonly [number, number];

/** @internal Проверенная сборкой геометрия; не входной SVG-язык. */
export interface CompiledAnnulusGeometry {
  readonly enclosure: Readonly<{
    outerD: string;
    innerPoints: readonly Point[];
    center: Point;
    outerRadius: number;
    referenceInnerRadius: number;
    referenceThickness: number;
  }>;
  readonly domain: AuthorAnnulusVariationDomain;
}

export class AuthoredAnnulusVariationError extends RangeError {
  readonly code: 'INVALID_VARIATION' | 'VARIATION_OUTSIDE_DOMAIN' | 'VARIATION_UNREPRESENTABLE' | 'VARIATION_SOURCE_MISMATCH';
  constructor(code: AuthoredAnnulusVariationError['code'], message: string) {
    super(message); this.name = 'AuthoredAnnulusVariationError'; this.code = code;
  }
}

/** @internal Одна граница параметра для glyph и общего state-обрамления. */
export function annulusEmphasisParameter(value: unknown): number {
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(key => key !== 'enclosureEmphasis')) {
    throw new AuthoredAnnulusVariationError('INVALID_VARIATION', 'Нужен только enclosureEmphasis.');
  }
  const requested = (value as AuthoredAnnulusVariation).enclosureEmphasis;
  const emphasis = requested === undefined ? 1 : requested;
  if (typeof emphasis !== 'number' || !Number.isFinite(emphasis) || emphasis <= 0) {
    throw new AuthoredAnnulusVariationError('INVALID_VARIATION', 'enclosureEmphasis обязан быть конечным положительным числом.');
  }
  return emphasis;
}

/** @internal Affine формула сохраняет монотонность; проверяется и округлённый результат. */
export function representableAnnulusQuarters(points: readonly Point[]): boolean {
  if (points.some(point => point.some(value => !Number.isFinite(value)))) return false;
  for (let quarter = 0; quarter < 4; quarter++) {
    const sequence = [0, 1, 2, 3].map(index => points[(quarter * 3 + index) % 12]!);
    for (const axis of [0, 1] as const) {
      const sign = Math.sign(sequence[3]![axis] - sequence[0]![axis]);
      if (!sign || sequence.slice(1).some((point, index) => sign * (point[axis] - sequence[index]![axis]) < 0)) return false;
    }
  }
  return true;
}

/** @internal Один материализатор countershape; proof, SVG и hashing остаются снаружи. */
export function materializeCompiledAnnulus(geometry: CompiledAnnulusGeometry, emphasis: number): Readonly<{ d: string; scale: number }> {
  const enclosure = geometry.enclosure;
  const scale = (enclosure.outerRadius - emphasis * enclosure.referenceThickness) / enclosure.referenceInnerRadius;
  if (!Number.isFinite(scale) || scale <= 0) {
    throw new AuthoredAnnulusVariationError('VARIATION_UNREPRESENTABLE', 'Контрформа обрамления схлопнулась.');
  }
  if (scale < geometry.domain.scale.minimum || scale >= geometry.domain.scale.maximum) {
    throw new AuthoredAnnulusVariationError('VARIATION_OUTSIDE_DOMAIN', 'Контрформа выходит за доказанный radial domain.');
  }
  const points = enclosure.innerPoints.map(point => point.map((value, axis) =>
    enclosure.center[axis]! + scale * (value - enclosure.center[axis]!)) as unknown as Point);
  if (!representableAnnulusQuarters(points)) {
    throw new AuthoredAnnulusVariationError('VARIATION_UNREPRESENTABLE', 'Материализованные controls разрушили cardinal topology.');
  }
  const at = (index: number) => points[index % 12]!;
  const innerD = `M${at(0).join(' ')}${[0, 1, 2, 3].map(index =>
    `C${[at(1 + index * 3), at(2 + index * 3), at(3 + index * 3)].flat().join(' ')}`).join('')}Z`;
  return { d: enclosure.outerD + innerD, scale };
}
