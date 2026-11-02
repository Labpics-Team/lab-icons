import type { CompiledAnnulusGeometry } from './annulus-geometry-runtime.js';
import { materializeCompiledAnnulus, AuthoredAnnulusVariationError } from './annulus-geometry-runtime.js';
import type { AuthorContentVariationDomain, AuthoredContentVariation } from './author-content-types.js';
// @ts-expect-error — Общая чистая JS-операция имеет единственного build/runtime owner.
import { contentScaleParameters, admitJointContentScale, materializeProjectedContent } from '../core/annulus-content-geometry.js';

type Point = readonly [number, number];

/** @internal Программа подготовлена compiler; arbitrary d здесь не принимается. */
export interface CompiledContentGeometry {
  readonly enclosure: CompiledAnnulusGeometry['enclosure'];
  readonly content: Readonly<{ center: Point; parts: readonly Readonly<{
    id: string; index: number; commands: string; points: readonly Point[];
    coordinateOrder: readonly [readonly number[], readonly number[]]; winding: readonly number[];
    sourceLiteralSha256: string;
  }>[] }>;
  readonly domain: AuthorContentVariationDomain;
}

export class AuthoredContentVariationError extends RangeError {
  readonly code: 'INVALID_VARIATION' | 'VARIATION_OUTSIDE_DOMAIN' | 'VARIATION_UNREPRESENTABLE' | 'VARIATION_SOURCE_MISMATCH';
  constructor(code: AuthoredContentVariationError['code'], message: string) {
    super(message); this.name = 'AuthoredContentVariationError'; this.code = code;
  }
}
const refuse = (code: AuthoredContentVariationError['code'], message: string): never => {
  throw new AuthoredContentVariationError(code, message);
};

/** @internal Одна граница для публичного glyph и будущей state projection. */
export function authoredContentParameters(value: unknown): Required<AuthoredContentVariation> {
  return contentScaleParameters(value, refuse) as Required<AuthoredContentVariation>;
}

/** @internal Совместный допуск применяется к фактическому binary64 scale кольца. */
export function materializeCompiledContent(geometry: CompiledContentGeometry, parameters: Required<AuthoredContentVariation>):
  Readonly<{ scale: number; enclosureD?: string; parts: readonly Readonly<{ index: number; d: string }>[] }> {
  const { enclosureEmphasis, contentScale } = parameters, enclosure = geometry.enclosure;
  const scale = enclosureEmphasis === 1 ? 1
    : (enclosure.outerRadius - enclosureEmphasis * enclosure.referenceThickness) / enclosure.referenceInnerRadius;
  admitJointContentScale(geometry.domain, contentScale, scale, refuse);
  let enclosureD: string | undefined;
  if (enclosureEmphasis !== 1) {
    try {
      enclosureD = materializeCompiledAnnulus({ enclosure,
        domain: { kind: 'radial-bernstein', parameter: 'enclosureEmphasis', evaluated: 'actual-binary64-scale',
          scale: geometry.domain.enclosureScale } }, enclosureEmphasis).d;
    } catch (error) {
      if (!(error instanceof AuthoredAnnulusVariationError)) throw error;
      refuse(error.code, error.message);
    }
  }
  const parts = contentScale === 1 ? [] : materializeProjectedContent(geometry.content, contentScale, refuse) as
    readonly Readonly<{ index: number; d: string }>[];
  return { scale, ...(enclosureD === undefined ? {} : { enclosureD }), parts };
}
