import type { GlyphIR, IconVariant, SourcePartProvenance } from './glyph-types.js';
import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from './author-source.js';
import type { AuthorSourceProvenance, AuthorAnatomyReceipt } from './author-provenance.js';
import type { AuthorIconId } from './author-catalog.generated.js';
import { createCompiledGlyph } from './symbol-runtime.js';
import { parseCompiledGlyphOptions } from './author-request-runtime.js';
import { assembleGlyphFrame, assembleGlyphLayers } from './svg-assembly.js';
import { sha256Hex } from './sha256.js';
import { GlyphModelError } from './request.js';

export interface AuthoredDotVariation {
  readonly dotScale?: number;
  readonly spacingScale?: number;
}

export type AuthorVariationGlyphRequest = Omit<AuthorSymbolGlyphRequest, 'variation'> & Readonly<{ variation?: AuthoredDotVariation }>;

export interface AuthorVariationReceipt {
  readonly version: 1;
  readonly law: 'dots.affine';
  readonly geometrySha256: string;
  readonly parameters: Readonly<{ dotScale: number; spacingScale: number }>;
}

export interface AuthorVariationProvenance {
  readonly kind: 'authored-variation';
  readonly file: string;
  readonly author: AuthorSourceProvenance;
  readonly anatomy: AuthorAnatomyReceipt;
  readonly variation: AuthorVariationReceipt;
}

export interface AuthorVariationPartProvenance {
  readonly kind: 'authored-variation';
  readonly identity: 'declared';
  readonly source: SourcePartProvenance;
  readonly variation: AuthorVariationReceipt;
  readonly artifactFingerprint: `sha256:${string}`;
}

export interface AuthoredVariationDomain {
  readonly kind: 'convex-linear';
  readonly bound: 'control-hull';
  readonly positive: readonly ['dotScale', 'spacingScale'];
  /** a*dotScale + b*spacingScale >= minimum; положительность проверяется отдельно. */
  readonly constraints: readonly Readonly<{ kind: 'margin' | 'gap'; dotScale: number; spacingScale: number; minimum: number }>[];
  readonly policy: Readonly<{ gridVersion: number; gridSha256: string; marginRatio: number; minimumGapRatio: number }>;
}

export interface AuthorVariationCapability {
  readonly version: 1;
  readonly law: 'dots.affine';
  readonly geometrySha256: string;
  readonly defaults: Readonly<{ dotScale: 1; spacingScale: 1 }>;
  readonly domain: AuthoredVariationDomain;
  readonly targets: Readonly<{ svg: 'supported'; webEffect: 'existing-part-gestures'; lottie: 'not-exported'; sfSymbols: 'not-exported' }>;
}

export interface AuthorVariationGlyph<TIcon extends AuthorIconId = AuthorIconId> extends GlyphIR<TIcon> {
  readonly provenance: AuthorSourceGlyph<TIcon>['provenance'] | AuthorVariationProvenance;
}

export interface AuthorVariationCapabilities<TIcon extends AuthorIconId = AuthorIconId> extends AuthorSourceCapabilities<TIcon> {
  readonly variation: AuthorVariationCapability;
}

type Point = readonly [number, number];
/** @internal Только проверенная build-проекция; arbitrary d здесь не принимается. */
export interface CompiledAuthorVariation {
  readonly version: 1;
  readonly law: 'dots.affine';
  readonly axis: 0 | 1;
  readonly viewBox: GlyphIR['viewBox'];
  readonly geometrySha256: string;
  readonly domain: AuthoredVariationDomain;
  readonly source: Readonly<{ masterSha256: string; pathFingerprintSha256: string }>;
  readonly parts: readonly Readonly<{ id: string; points: readonly Point[]; pivot: Point; offset: number }>[];
}

/** Машинный код не зависит от текста ошибки. */
export class AuthoredVariationError extends RangeError {
  readonly code: 'INVALID_VARIATION' | 'VARIATION_OUTSIDE_DOMAIN' | 'VARIATION_UNREPRESENTABLE' | 'VARIATION_SOURCE_MISMATCH';
  constructor(code: AuthoredVariationError['code'], message: string) {
    super(message);
    this.name = 'AuthoredVariationError';
    this.code = code;
  }
}

function parameters(value: unknown): Readonly<{ dotScale: number; spacingScale: number }> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(key => !['dotScale', 'spacingScale'].includes(key))) {
    throw new AuthoredVariationError('INVALID_VARIATION', 'Нужны только dotScale и spacingScale.');
  }
  const input = value as AuthoredDotVariation;
  const dotScale = input.dotScale === undefined ? 1 : input.dotScale;
  const spacingScale = input.spacingScale === undefined ? 1 : input.spacingScale;
  if (![dotScale, spacingScale].every(item => typeof item === 'number' && Number.isFinite(item) && item > 0)) {
    throw new AuthoredVariationError('INVALID_VARIATION', 'Dot и spacing scale обязаны быть конечными положительными числами.');
  }
  return { dotScale, spacingScale };
}

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

/** @internal Обычный static glyph остаётся самостоятельным runtime. */
export function createCompiledVariationGlyph<TIcon extends AuthorIconId>(
  icon: TIcon,
  sources: Readonly<Record<IconVariant, AuthorSourceGlyph<TIcon>>>,
  variants: Readonly<Record<IconVariant, CompiledAuthorVariation>>,
): (request?: AuthorVariationGlyphRequest) => AuthorVariationGlyph<TIcon> {
  const staticGlyph = createCompiledGlyph(icon, sources);
  const compiled = freezeTree(variants);
  for (const variant of ['outline', 'filled'] as const) {
    const source = sources[variant], data = compiled[variant];
    if (data.version !== 1 || data.law !== 'dots.affine' || source.icon !== icon || source.variant !== variant ||
        data.source.masterSha256 !== source.provenance.author.masterSha256 ||
        data.source.pathFingerprintSha256 !== source.provenance.author.pathFingerprintSha256 ||
        !source.provenance.anatomy || source.composition.kind !== 'layers' || data.parts.length !== 3 || source.parts.length !== 3 ||
        data.viewBox.some((value, index) => value !== source.viewBox[index]) ||
        source.parts.some((part, index) => part.id !== data.parts[index]?.id || part.role !== 'content' ||
          part.provenance.kind !== 'source' || part.provenance.identity !== 'declared')) {
      throw new AuthoredVariationError('VARIATION_SOURCE_MISMATCH', 'Скомпилированная variation принадлежит другому master или набору частей.');
    }
  }
  return function glyph(request?: AuthorVariationGlyphRequest): AuthorVariationGlyph<TIcon> {
    if (request === undefined) return sources.outline;
    if (!request || typeof request !== 'object' || Array.isArray(request)) return staticGlyph(request) as AuthorSourceGlyph<TIcon>;
    const variation = request.variation;
    const selected = parseCompiledGlyphOptions(icon, request, true);
    const source = sources[selected.variant];
    if (variation === undefined) return source;
    const effective = parameters(variation);
    const { dotScale: s, spacingScale: g } = effective;
    // Точный default не пересериализуется и возвращает тот же frozen объект.
    if (s === 1 && g === 1) return source;
    if (selected.modelMode === 'source-only') throw new GlyphModelError('AUTHOR_PARITY_REQUIRED', 'source-only сохраняет точный master.');
    const geometry = compiled[source.variant];
    if (geometry.domain.constraints.some(c => c.dotScale * s + c.spacingScale * g < c.minimum)) {
      throw new AuthoredVariationError('VARIATION_OUTSIDE_DOMAIN', 'Вариация нарушает авторский порядок, grid margin или minimum gap.');
    }
    const receipt: AuthorVariationReceipt = { version: 1, law: 'dots.affine', geometrySha256: geometry.geometrySha256, parameters: effective };
    let previousHigh: number | undefined;
    const parts = source.parts.map((part, index) => {
      const data = geometry.parts[index]!;
      const transform = (point: Point): Point => [0, 1].map(a => point[a]! + (s - 1) * (point[a]! - data.pivot[a]!) +
        (a === geometry.axis ? (g - 1) * data.offset : 0)) as unknown as Point;
      const points = data.points.map(transform);
      const low = [0, 1].map(a => Math.min(...points.map(point => point[a]!)));
      const high = [0, 1].map(a => Math.max(...points.map(point => point[a]!)));
      if (points.some(point => point.some(value => !Number.isFinite(value))) || low.some((value, a) => value >= high[a]!)) {
        throw new AuthoredVariationError('VARIATION_UNREPRESENTABLE', 'Number-представление схлопывает авторскую dot геометрию.');
      }
      // Проверяется именно материализуемый Number: cancellation/округление не
      // разрешает нарушить те же margins/gaps на границе линейной области.
      if (low.some((value, a) => value < source.viewBox[a]! + source.viewBox[a + 2]! * geometry.domain.policy.marginRatio) ||
          high.some((value, a) => value > source.viewBox[a]! + source.viewBox[a + 2]! * (1 - geometry.domain.policy.marginRatio)) ||
          previousHigh !== undefined && low[geometry.axis]! - previousHigh <
            Math.min(source.viewBox[2], source.viewBox[3]) * geometry.domain.policy.minimumGapRatio) {
        throw new AuthoredVariationError('VARIATION_OUTSIDE_DOMAIN', 'Материализованные controls нарушают grid margin или minimum gap.');
      }
      previousHigh = high[geometry.axis];
      const segments = [{ cmd: 'M', x: points[0]![0], y: points[0]![1] },
        ...[0, 1, 2, 3].map(i => { const a = points[1 + i * 3]!, b = points[2 + i * 3]!, end = points[3 + i * 3]!;
          return { cmd: 'C', x1: a[0], y1: a[1], x2: b[0], y2: b[1], x: end[0], y: end[1] }; }), { cmd: 'Z' }];
      const d = `M${points[0]!.join(' ')}${[0, 1, 2, 3].map(i => `C${points.slice(1 + i * 3, 4 + i * 3).flat().join(' ')}`).join('')}Z`;
      const anchor = data.pivot.map((value, a) => (value + (a === geometry.axis ? (g - 1) * data.offset : 0) - source.viewBox[a]!) / source.viewBox[a + 2]!) as [number, number];
      return { ...part, d, anchor, provenance: { kind: 'authored-variation' as const, identity: 'declared' as const,
        source: part.provenance as SourcePartProvenance, variation: receipt,
        artifactFingerprint: `sha256:${sha256Hex(`${part.fillRule}\0${JSON.stringify(segments)}`)}` as const } };
    });
    const [start, end] = assembleGlyphFrame(source.viewBox);
    return freezeTree({ ...source, parts, d: parts.map(part => part.d).join(''),
      svg: start + assembleGlyphLayers(parts) + end,
      provenance: { kind: 'authored-variation', file: source.provenance.file,
        author: source.provenance.author, anatomy: source.provenance.anatomy!, variation: receipt } });
  };
}
