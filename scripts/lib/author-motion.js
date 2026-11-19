import { compileAuthorAnatomy } from './author-anatomy.js';
import { authorPathFingerprint, authorSymbolPayload } from './author-baseline.js';
import { authorPathEntries } from '../../src/core/icon-geometry.js';
import { compactDataLiteral, jsonDataLiteral } from './generated-module.js';
import { symbolExportName } from './symbol-modules.js';

const NAME = /^[a-z][a-z0-9-]*$/;
const VARIANTS = ['outline', 'filled'];

/** Только уже объявленный вращательный закон имеет этот target. */
export function authorMotionSymbolNames(document) {
  return Object.keys(document.icons).filter(icon => Object.values(document.icons[icon])
    .some(declaration => declaration.gesture?.law === 'cycle.clockwise')).sort();
}

/** Полный compiler проверяет identity и anchors до удаления его runtime-знания. */
export function projectAuthorMotionSymbol(payload, compileSymbolEffect) {
  if (!NAME.test(payload?.icon)) throw new TypeError('author motion: невалидный символ');
  const variants = {};
  for (const variant of VARIANTS) {
    const glyph = payload.source[variant], capabilities = payload.capabilities[variant];
    const gestures = capabilities.motion.gestures.filter(gesture => gesture.tracks.length &&
      gesture.tracks.every(track => track.kind === 'rotate'));
    if (!gestures.length) continue;
    if (glyph.provenance.kind !== 'source' || !glyph.provenance.author || glyph.composition.kind !== 'layers') {
      throw new TypeError('author motion: нужны самостоятельные текущие авторские layers');
    }
    // Source parser не принимает IR metadata. Удаляются только нейтральные
    // labels после отдельной проверки их точного соответствия объявленным parts.
    const unaddressed = glyph.svg.replace(/ data-(?:part|role)="[a-z][a-z0-9-]*"/g, '');
    const entries = authorPathEntries(unaddressed);
    const ids = [...glyph.svg.matchAll(/<path\b[^>]*\sdata-part="([^"]+)"[^>]*>/g)].map(match => match[1]);
    const roles = [...glyph.svg.matchAll(/<path\b[^>]*\sdata-role="([^"]+)"[^>]*>/g)].map(match => match[1]);
    if (authorPathFingerprint(unaddressed) !== glyph.provenance.author.pathFingerprintSha256 ||
        JSON.stringify(entries) !== JSON.stringify(glyph.parts.map((part, index) => ({ index, d: part.d, fillRule: part.fillRule }))) ||
        JSON.stringify(ids) !== JSON.stringify(glyph.parts.map(part => part.id)) ||
        JSON.stringify(roles) !== JSON.stringify(glyph.parts.map(part => part.role))) {
      throw new TypeError('author motion: SVG, parts и author fingerprint обязаны описывать одну геометрию');
    }
    const effects = gestures.map(gesture => {
      const admitted = compileSymbolEffect(glyph, capabilities, gesture.id, { duration: 0 });
      if (!admitted.ok || admitted.effect.version !== 1) {
        throw new TypeError(`author motion: ${payload.icon}/${variant}/${gesture.id}: ${admitted.reason?.code ?? 'TARGET_UNSUPPORTED'}`);
      }
      return { id: gesture.id, targets: gesture.tracks.map(track => ({ partId: track.partId,
        anchor: [...track.anchor], from: track.from, to: track.to })),
        unchangedPartIds: [...admitted.effect.unchangedPartIds] };
    });
    variants[variant] = { svg: glyph.svg, effects, capabilities: {
      icon: glyph.icon, variant, gestures: gestures.map(({ id, kind, meaning }) => ({ id, kind, meaning })),
      formats: ['svg', 'web-effect'], author: glyph.provenance.author, anatomy: glyph.provenance.anatomy,
    } };
  }
  if (!Object.keys(variants).length) throw new TypeError('author motion: нет допущенного вращательного target');
  return { icon: payload.icon, variants };
}

/** Отдельная производная проекция того же author spec; default sources не меняются. */
export function compileAuthorMotionSymbols(author, document, { grid, catalog, createGlyphCompiler, compileSymbolEffect }) {
  const names = authorMotionSymbolNames(document);
  if (!names.length) return {};
  const annotations = compileAuthorAnatomy(author, { ...document,
    icons: Object.fromEntries(names.map(icon => [icon, document.icons[icon]])) }, grid, { scope: 'motion' });
  const sources = Object.fromEntries(names.map(icon => [icon, Object.fromEntries(VARIANTS.map(variant =>
    [variant, { ...author.icons[icon][variant],
      sourceContract: annotations[`${icon}/${variant}`] ?? author.icons[icon][variant].sourceContract }]))]));
  const compiler = createGlyphCompiler({ catalog: { canvas: catalog.canvas, axes: catalog.axes,
    icons: Object.fromEntries(names.map(icon => [icon, { model: null,
      source: Object.fromEntries(VARIANTS.map(variant => [variant, sources[icon][variant].sourceContract])) }])) },
    anatomy: { version: 1, glyphs: {} }, grid,
    staticIcons: Object.fromEntries(names.flatMap(icon => VARIANTS.map(variant =>
      [symbolExportName(icon, variant),
        author.icons[icon][variant].artifactSvg]))) });
  return Object.fromEntries(names.map(icon => [icon,
    projectAuthorMotionSymbol(authorSymbolPayload(icon, sources[icon], compiler), compileSymbolEffect)]));
}

/** SVG, effects и receipts имеют независимые PURE roots для настоящих consumers. */
export function renderAuthorMotionModule(payload) {
  if (!NAME.test(payload?.icon) || !payload.variants || !Object.keys(payload.variants).length ||
      Object.keys(payload.variants).some(variant => !VARIANTS.includes(variant))) {
    throw new TypeError('author motion module: нужен допущенный target');
  }
  const select = field => Object.fromEntries(Object.entries(payload.variants).map(([variant, value]) => [variant, value[field]]));
  return [
    '/** GENERATED: авторская геометрия и готовые вращательные operands одного символа. */',
    "import { createCompiledMotionRenderer, createCompiledMotionEffects, createCompiledMotionCapabilities } from '../ir/gesture-runtime.js';",
    `export const renderMotionSvg = /* @__PURE__ */ createCompiledMotionRenderer(${compactDataLiteral(select('svg'))});`,
    `export const compileMotionEffect = /* @__PURE__ */ createCompiledMotionEffects(${jsonDataLiteral(payload.icon)},${compactDataLiteral(select('effects'))});`,
    `export const motionCapabilities = /* @__PURE__ */ createCompiledMotionCapabilities(${compactDataLiteral(select('capabilities'))});`,
    '',
  ].join('\n');
}

export function authorMotionModuleDeclaration(payload) {
  const variants = Object.keys(payload.variants).sort();
  const gestures = [...new Set(Object.values(payload.variants).flatMap(value => value.effects.map(effect => effect.id)))].sort();
  return [
    "import type { MotionCapabilitiesResult, MotionEffectRequest, MotionEffectResult, MotionSvgResult } from '../ir/gesture-types.js';",
    `export type MotionVariant = ${variants.map(jsonDataLiteral).join(' | ')};`,
    `export type Gesture = ${gestures.map(jsonDataLiteral).join(' | ')};`,
    'export declare function renderMotionSvg(variant?: MotionVariant): MotionSvgResult;',
    'export declare function compileMotionEffect(gesture: Gesture, request: Omit<MotionEffectRequest, "variant"> & { readonly variant?: MotionVariant }): MotionEffectResult;',
    'export declare function motionCapabilities(variant?: MotionVariant): MotionCapabilitiesResult;',
    '',
  ].join('\n');
}
