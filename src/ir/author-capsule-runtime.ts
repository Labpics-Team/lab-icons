import type { AuthorIconId } from './author-catalog.generated.js';
import type { AuthorSourceGlyph, AuthorSymbolGlyphRequest } from './author-source.js';
import type { SourcePartProvenance } from './glyph-types.js';
import type { AuthorCapsuleVariationDomain, AuthorCapsuleVariationGlyph, AuthorCapsuleVariationGlyphRequest,
  AuthorCapsuleVariationReceipt } from './author-capsule-types.js';
import { createCompiledGlyph } from './symbol-runtime.js';
import { parseCompiledGlyphOptions } from './author-request-runtime.js';
import { GlyphModelError } from './request.js';
import { assembleGlyphFrame, assembleGlyphLayers } from './svg-assembly.js';
import { sha256Hex } from './sha256.js';
import { projectedContourAreas } from '../core/annulus-content-geometry.js';

type Point = readonly [number, number];
/** @internal Команды и width coefficients допускаются только build compiler. */
export interface CompiledAuthorCapsule {
  readonly version: 1;
  readonly law: 'capsule.width';
  readonly geometrySha256: string;
  readonly packetSha256: string;
  readonly source: Readonly<{ masterSha256: string; pathFingerprintSha256: string }>;
  readonly partIds: readonly string[];
  readonly body: Readonly<{ id: string; index: number; sourceLiteralSha256: string;
    contours: readonly Readonly<{ commands: string; points: readonly Point[]; rates: readonly number[];
      minimumSpan: number; winding: number; xOrder: readonly number[] }>[] }>;
  readonly domain: AuthorCapsuleVariationDomain;
}
export class AuthoredCapsuleVariationError extends Error {
  constructor(readonly code: 'INVALID_VARIATION' | 'VARIATION_OUTSIDE_DOMAIN' | 'VARIATION_UNREPRESENTABLE' | 'VARIATION_SOURCE_MISMATCH', message: string) {
    super(message); this.name = 'AuthoredCapsuleVariationError';
  }
}
function refuse(code: AuthoredCapsuleVariationError['code'], message: string): never { throw new AuthoredCapsuleVariationError(code, message); }
function freezeTree<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freezeTree); Object.freeze(value);
  }
  return value;
}
const stableJSON = (value: unknown): string => JSON.stringify(value, (_, item: unknown) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, (item as Record<string, unknown>)[key]])) : item);
const COUNTS: Readonly<Record<string, number>> = { M: 1, L: 1, C: 3, Q: 2, Z: 0 };

/** @internal Опт-in не добавляет geometry compiler в ordinary symbol import. */
export function createCompiledCapsuleGlyph<TIcon extends AuthorIconId>(icon: TIcon,
  sources: Readonly<Record<'outline' | 'filled', AuthorSourceGlyph<TIcon>>>,
  input: Readonly<Partial<Record<'outline' | 'filled', CompiledAuthorCapsule>>>):
  (request?: AuthorSymbolGlyphRequest | AuthorCapsuleVariationGlyphRequest) => AuthorSourceGlyph<TIcon> | AuthorCapsuleVariationGlyph<TIcon> {
  const staticGlyph = createCompiledGlyph(icon, sources), compiled = freezeTree(input);
  for (const variant of ['outline', 'filled'] as const) {
    const geometry = compiled[variant];
    if (!geometry) continue;
    const { packetSha256, ...packet } = geometry, { geometrySha256, ...program } = packet;
    const source = sources[variant], body = source.parts[geometry.body.index];
    if (packetSha256 !== sha256Hex(stableJSON(packet)) || geometrySha256 !== sha256Hex(stableJSON(program)) ||
        geometry.version !== 1 || geometry.law !== 'capsule.width' ||
        source.icon !== icon || source.variant !== variant || source.composition.kind !== 'layers' || !source.provenance.anatomy ||
        geometry.source.masterSha256 !== source.provenance.author.masterSha256 ||
        geometry.source.pathFingerprintSha256 !== source.provenance.author.pathFingerprintSha256 ||
        geometry.source.pathFingerprintSha256 !== sha256Hex(stableJSON(source.parts.map((part, index) => ({ index, d: part.d, fillRule: part.fillRule })))) ||
        geometry.partIds.length !== source.parts.length || source.parts.some((part, index) => part.id !== geometry.partIds[index] ||
          part.zIndex !== index || part.provenance.kind !== 'source' || part.provenance.identity !== 'declared') ||
        !body || body.id !== geometry.body.id || body.role !== 'content' ||
        geometry.body.sourceLiteralSha256 !== sha256Hex(`${body.fillRule}\0${body.d}`) ||
        geometry.body.contours.length < 1 || geometry.body.contours.length > 2 || geometry.body.contours.some(contour =>
          !/^M[LCQ]+Z$/.test(contour.commands) || [...contour.commands].reduce((count, command) => count + COUNTS[command]!, 0) !== contour.points.length ||
          contour.points.length !== contour.rates.length || contour.points.some(point => point.length !== 2 || point.some(value => !Number.isFinite(value))) ||
          contour.rates.some(value => !Number.isFinite(value)) || !(contour.minimumSpan > 0) || ![-1, 1].includes(contour.winding))) {
      refuse('VARIATION_SOURCE_MISMATCH', 'Body width packet не принадлежит этому полному declared master.');
    }
  }
  return function glyph(request?: AuthorSymbolGlyphRequest | AuthorCapsuleVariationGlyphRequest): AuthorSourceGlyph<TIcon> | AuthorCapsuleVariationGlyph<TIcon> {
    if (request === undefined) return sources.outline;
    if (!request || typeof request !== 'object' || Array.isArray(request)) return staticGlyph(request) as AuthorSourceGlyph<TIcon>;
    const options = parseCompiledGlyphOptions(icon, request, true), source = sources[options.variant];
    if (request.variation === undefined) return source;
    const geometry = compiled[options.variant];
    if (!geometry) throw new GlyphModelError('AUTHOR_VARIATION_UNSUPPORTED', 'У исходного контракта нет независимо адресуемого body или negative body с допуском этого закона.');
    const variation = request.variation;
    if (!variation || Object.getPrototypeOf(variation) !== Object.prototype || Reflect.ownKeys(variation).some(key => key !== 'bodyWidth')) {
      refuse('INVALID_VARIATION', 'Нужен только bodyWidth, без coordinates или path.');
    }
    const width = variation.bodyWidth === undefined ? 1 : variation.bodyWidth;
    if (typeof width !== 'number' || !Number.isFinite(width) || width <= 0) refuse('INVALID_VARIATION', 'Body width обязан быть конечным положительным числом.');
    if (width === 1) return source;
    if (options.modelMode === 'source-only') throw new GlyphModelError('AUTHOR_PARITY_REQUIRED', 'source-only сохраняет точный master.');
    if (width < geometry.domain.minimum || width > geometry.domain.maximum) refuse('VARIATION_OUTSIDE_DOMAIN', 'Body width выходит за пересечение геометрического допуска и оптического диапазона авторского стиля.');
    const d = geometry.body.contours.map(contour => {
      const points = contour.points.map((point, index) => [point[0] + (width - 1) * contour.rates[index]!, point[1]] as const);
      const xs = points.map(point => point[0]);
      if (points.some(point => point.some(value => !Number.isFinite(value))) || Math.max(...xs) - Math.min(...xs) < contour.minimumSpan ||
          contour.xOrder.slice(1).some((index, position) => points[index]![0] <= points[contour.xOrder[position]!]![0]) ||
          Math.sign(projectedContourAreas(contour.commands, points, [0, 0])[0]!) !== contour.winding) {
        refuse('VARIATION_UNREPRESENTABLE', 'Body width схлопнул controls, span или winding.');
      }
      let index = 0;
      return [...contour.commands].map(command => {
        const count = COUNTS[command]!; const operands = points.slice(index, index + count); index += count;
        return command + operands.flat().join(' ');
      }).join('');
    }).join('');
    const receipt: AuthorCapsuleVariationReceipt = { version: 1, law: geometry.law, geometrySha256: geometry.geometrySha256, parameters: { bodyWidth: width } };
    const parts = source.parts.map((part, index) => index === geometry.body.index ? { ...part, d,
      provenance: { kind: 'authored-variation' as const, identity: 'declared' as const, source: part.provenance as SourcePartProvenance,
        variation: receipt, fingerprintBasis: 'literal-path' as const, artifactFingerprint: `sha256:${sha256Hex(`${part.fillRule}\0${d}`)}` as const } } : part);
    const [start, end] = assembleGlyphFrame(source.viewBox);
    return freezeTree({ ...source, parts, d: parts.map(part => part.d).join(''), svg: start + assembleGlyphLayers(parts) + end,
      provenance: { kind: 'authored-variation', file: source.provenance.file, author: source.provenance.author,
        anatomy: source.provenance.anatomy!, variation: receipt } });
  };
}
