import type { AuthorIconId } from './author-catalog.generated.js';
import type { AuthorSourceGlyph, AuthorSymbolGlyphRequest } from './author-source.js';
import type { SourcePartProvenance } from './glyph-types.js';
import type { AuthorContentVariationGlyph, AuthorContentVariationGlyphRequest, AuthorContentVariationReceipt } from './author-content-types.js';
import type { CompiledContentGeometry } from './content-geometry-runtime.js';
import { authoredContentParameters, materializeCompiledContent, AuthoredContentVariationError } from './content-geometry-runtime.js';
import { createCompiledGlyph } from './symbol-runtime.js';
import { parseCompiledGlyphOptions } from './author-request-runtime.js';
import { GlyphModelError } from './request.js';
import { assembleGlyphFrame, assembleGlyphLayers } from './svg-assembly.js';
import { sha256Hex } from './sha256.js';
export { AuthoredContentVariationError } from './content-geometry-runtime.js';

/** @internal Source-bound пакет; consumer не выбирает части, controls или pivot. */
export interface CompiledAuthorContentVariation extends CompiledContentGeometry {
  readonly version: 1;
  readonly law: 'annulus.content-counter-scale';
  readonly geometrySha256: string;
  readonly packetSha256: string;
  readonly annulusGeometrySha256: string;
  readonly source: Readonly<{ masterSha256: string; pathFingerprintSha256: string }>;
  readonly partIds: readonly string[];
  readonly enclosure: CompiledContentGeometry['enclosure'] & Readonly<{ id: string; index: number }>;
}

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree); Object.freeze(value);
  }
  return value;
}

function stableJSON(value: unknown): string {
  return JSON.stringify(value, (_key, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, (item as Record<string, unknown>)[key]])) : item);
}

/** @internal Новый opt-in не меняет source-only и прежний annulus runtime. */
export function createCompiledContentGlyph<TIcon extends AuthorIconId>(icon: TIcon,
  sources: Readonly<Record<'outline' | 'filled', AuthorSourceGlyph<TIcon>>>, input: CompiledAuthorContentVariation):
  (request?: AuthorSymbolGlyphRequest | AuthorContentVariationGlyphRequest) => AuthorSourceGlyph<TIcon> | AuthorContentVariationGlyph<TIcon> {
  const { packetSha256, ...packet } = input;
  const serialized = stableJSON(packet);
  if (sha256Hex(serialized) !== packetSha256) {
    throw new AuthoredContentVariationError('VARIATION_SOURCE_MISMATCH', 'Content packet изменился после build admission.');
  }
  const staticGlyph = createCompiledGlyph(icon, sources), geometry = freezeTree(input), source = sources.outline;
  const enclosure = geometry.enclosure, ring = source.parts[enclosure.index];
  if (geometry.version !== 1 || geometry.law !== 'annulus.content-counter-scale' || source.icon !== icon ||
      source.variant !== 'outline' || source.composition.kind !== 'layers' || !source.provenance.anatomy ||
      geometry.source.masterSha256 !== source.provenance.author.masterSha256 ||
      geometry.source.pathFingerprintSha256 !== source.provenance.author.pathFingerprintSha256 ||
      geometry.source.pathFingerprintSha256 !== sha256Hex(stableJSON(source.parts.map((part, index) =>
        ({ index, d: part.d, fillRule: part.fillRule })))) ||
      !ring || ring.id !== enclosure.id || ring.role !== 'container' || !ring.d.startsWith(enclosure.outerD) ||
      geometry.content.center.some((value, axis) => value !== enclosure.center[axis]) ||
      geometry.partIds.length !== source.parts.length || geometry.content.parts.length !== source.parts.length - 1 ||
      source.parts.some((part, index) => part.id !== geometry.partIds[index] || part.zIndex !== index ||
        part.provenance.kind !== 'source' || part.provenance.identity !== 'declared' ||
        part.role !== (index === enclosure.index ? 'container' : 'content')) ||
      geometry.content.parts.some((part, index) => {
        const original = source.parts[part.index];
        return part.index !== index || !original || original.role !== 'content' || part.id !== original.id ||
          part.sourceLiteralSha256 !== sha256Hex(`${original.fillRule}\0${original.d}`) ||
          !part.commands || /[^MLCQZ]/.test(part.commands) || part.commands[0] !== 'M' || !part.commands.endsWith('Z') ||
          part.points.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value)));
      })) {
    throw new AuthoredContentVariationError('VARIATION_SOURCE_MISMATCH', 'Content projection не принадлежит этому declared layered master.');
  }
  const [frameStart, frameEnd] = assembleGlyphFrame(source.viewBox);
  return function glyph(request?: AuthorSymbolGlyphRequest | AuthorContentVariationGlyphRequest): AuthorSourceGlyph<TIcon> | AuthorContentVariationGlyph<TIcon> {
    if (request === undefined) return source;
    if (!request || typeof request !== 'object' || Array.isArray(request)) return staticGlyph(request) as AuthorSourceGlyph<TIcon>;
    const options = parseCompiledGlyphOptions(icon, request, true), selected = sources[options.variant];
    if (request.variation === undefined) return selected;
    if (selected.variant !== 'outline') {
      throw new GlyphModelError('AUTHOR_VARIATION_UNSUPPORTED', 'Независимая Filled форма не поддерживает совместный content/annulus закон.');
    }
    const parameters = authoredContentParameters(request.variation);
    if (parameters.contentScale === 1 && parameters.enclosureEmphasis === 1) return selected;
    if (options.modelMode === 'source-only') throw new GlyphModelError('AUTHOR_PARITY_REQUIRED', 'source-only сохраняет точный master.');
    const materialized = materializeCompiledContent(geometry, parameters);
    const receipt: AuthorContentVariationReceipt = { version: 1, law: geometry.law, geometrySha256: geometry.geometrySha256,
      parameters, scale: materialized.scale };
    const changes = new Map(materialized.parts.map(part => [part.index, part.d]));
    if (materialized.enclosureD !== undefined) changes.set(enclosure.index, materialized.enclosureD);
    const center = enclosure.center.map((value, axis) => (value - source.viewBox[axis]!) / source.viewBox[axis + 2]!);
    const parts = source.parts.map((part, index) => {
      const d = changes.get(index);
      if (d === undefined) return part;
      const anchor = index === enclosure.index ? part.anchor : part.anchor.map((value, axis) =>
        center[axis]! + parameters.contentScale * (value - center[axis]!)) as unknown as readonly [number, number];
      return { ...part, d, anchor, provenance: { kind: 'authored-variation' as const, identity: 'declared' as const,
        source: part.provenance as SourcePartProvenance, variation: receipt, fingerprintBasis: 'literal-path' as const,
        artifactFingerprint: `sha256:${sha256Hex(`${part.fillRule}\0${d}`)}` as const } };
    });
    return freezeTree({ ...source, variant: 'outline', parts, d: parts.map(part => part.d).join(''),
      svg: frameStart + assembleGlyphLayers(parts) + frameEnd,
      provenance: { kind: 'authored-variation', file: source.provenance.file,
        author: source.provenance.author, anatomy: source.provenance.anatomy!, variation: receipt } });
  };
}
