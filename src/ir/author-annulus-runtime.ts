import type { AuthorIconId } from './author-catalog.generated.js';
import type { AuthorSourceGlyph, AuthorSymbolGlyphRequest } from './author-source.js';
import type { SourcePartProvenance } from './glyph-types.js';
import type { AuthorAnnulusVariationDomain, AuthorAnnulusVariationGlyph, AuthorAnnulusVariationGlyphRequest,
  AuthorAnnulusVariationReceipt } from './author-annulus-types.js';
import { createCompiledGlyph } from './symbol-runtime.js';
import { parseCompiledGlyphOptions } from './author-request-runtime.js';
import { GlyphModelError } from './request.js';
import { assembleGlyphFrame, assembleGlyphLayers } from './svg-assembly.js';
import { sha256Hex } from './sha256.js';
import { AuthoredAnnulusVariationError, annulusEmphasisParameter, representableAnnulusQuarters,
  materializeCompiledAnnulus } from './annulus-geometry-runtime.js';
export { AuthoredAnnulusVariationError } from './annulus-geometry-runtime.js';

type Point = readonly [number, number];
/** @internal Только build-проекция проверенного master, не произвольный path. */
export interface CompiledAuthorAnnulus {
  readonly version: 1;
  readonly law: 'annulus.counter-scale';
  readonly geometrySha256: string;
  readonly source: Readonly<{ masterSha256: string; pathFingerprintSha256: string }>;
  readonly partIds: readonly string[];
  readonly enclosure: Readonly<{ id: string; index: number; outerD: string; innerPoints: readonly Point[]; center: Point;
    outerRadius: number; referenceInnerRadius: number; referenceThickness: number }>;
  readonly domain: AuthorAnnulusVariationDomain;
}

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree); Object.freeze(value);
  }
  return value;
}

/** @internal Частичный admission сохраняет независимую Filled форму без закона. */
export function createCompiledAnnulusGlyph<TIcon extends AuthorIconId>(
  icon: TIcon,
  sources: Readonly<Record<'outline' | 'filled', AuthorSourceGlyph<TIcon>>>,
  input: CompiledAuthorAnnulus,
): (request?: AuthorSymbolGlyphRequest | AuthorAnnulusVariationGlyphRequest) => AuthorSourceGlyph<TIcon> | AuthorAnnulusVariationGlyph<TIcon> {
  const staticGlyph = createCompiledGlyph(icon, sources), geometry = freezeTree(input), source = sources.outline;
  const enclosure = geometry.enclosure, part = source.parts[enclosure.index];
  if (geometry.version !== 1 || geometry.law !== 'annulus.counter-scale' || source.icon !== icon || source.variant !== 'outline' ||
      geometry.source.masterSha256 !== source.provenance.author.masterSha256 ||
      geometry.source.pathFingerprintSha256 !== source.provenance.author.pathFingerprintSha256 ||
      source.composition.kind !== 'layers' || !source.provenance.anatomy ||
      geometry.partIds.length !== source.parts.length || source.parts.some((item, index) =>
        item.id !== geometry.partIds[index] || item.provenance.kind !== 'source' || item.provenance.identity !== 'declared' ||
        item.role !== (index === enclosure.index ? 'container' : 'content')) ||
      !part || part.id !== enclosure.id || typeof enclosure.outerD !== 'string' || !part.d.startsWith(enclosure.outerD) ||
      enclosure.innerPoints.length !== 12 || !representableAnnulusQuarters(enclosure.innerPoints)) {
    throw new AuthoredAnnulusVariationError('VARIATION_SOURCE_MISMATCH', 'Скомпилированное обрамление принадлежит другому master или набору частей.');
  }
  const [frameStart, frameEnd] = assembleGlyphFrame(source.viewBox);
  return function glyph(request?: AuthorSymbolGlyphRequest | AuthorAnnulusVariationGlyphRequest): AuthorSourceGlyph<TIcon> | AuthorAnnulusVariationGlyph<TIcon> {
    if (request === undefined) return source;
    if (!request || typeof request !== 'object' || Array.isArray(request)) return staticGlyph(request) as AuthorSourceGlyph<TIcon>;
    const variation = request.variation;
    const options = parseCompiledGlyphOptions(icon, request, true);
    const selected = sources[options.variant];
    if (variation === undefined) return selected;
    if (selected.variant !== 'outline') {
      throw new GlyphModelError('AUTHOR_VARIATION_UNSUPPORTED', 'Независимая Filled форма не поддерживает этот закон обрамления.');
    }
    const emphasis = annulusEmphasisParameter(variation);
    // Exact default возвращает общий source объект, без генерации и хеша.
    if (emphasis === 1) return selected;
    if (options.modelMode === 'source-only') throw new GlyphModelError('AUTHOR_PARITY_REQUIRED', 'source-only сохраняет точный master.');
    const { d, scale } = materializeCompiledAnnulus(geometry, emphasis);
    const receipt: AuthorAnnulusVariationReceipt = { version: 1, law: geometry.law,
      geometrySha256: geometry.geometrySha256, parameters: { enclosureEmphasis: emphasis }, scale };
    const parts = source.parts.map((item, index) => index === enclosure.index ? { ...item, d,
      provenance: { kind: 'authored-variation' as const, identity: 'declared' as const,
        source: item.provenance as SourcePartProvenance, variation: receipt, fingerprintBasis: 'literal-path' as const,
        artifactFingerprint: `sha256:${sha256Hex(`${item.fillRule}\0${d}`)}` as const } } : item);
    return freezeTree({ ...source, variant: 'outline', parts, d: parts.map(item => item.d).join(''),
      svg: frameStart + assembleGlyphLayers(parts) + frameEnd,
      provenance: { kind: 'authored-variation', file: source.provenance.file,
        author: source.provenance.author, anatomy: source.provenance.anatomy!, variation: receipt } });
  };
}
