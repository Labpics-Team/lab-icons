import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadAuthorBaseline, authorSymbolPayload } from '../../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../../scripts/lib/author-anatomy.js';
import { compileLottieGeometry } from '../../scripts/lib/lottie-geometry.js';
import { symbolExportName } from '../../scripts/lib/symbol-modules.js';
import { createGlyphCompiler } from '../../src/ir/compiler.js';
import { createCompiledGlyph, createCompiledCapabilities } from '../../src/ir/symbol-runtime.js';
import { createLottieSymbol } from '../../src/lottie/runtime.js';

export const nudgeNames = ['chevron-back', 'chevron-forward', 'chevron-up', 'chevron-down',
  'arrow-back', 'arrow-forward', 'arrow-up', 'arrow-down'];
export const names = ['reload', 'refresh', 'ellipsis-horizontal', 'chatbubble-ellipses', 'volume-high', 'volume-middle', ...nudgeNames];
export function lottieSymbols() {
  const fixtureNames = [...names, 'mic-circle'];
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const read = path => JSON.parse(readFileSync(new URL(path, new URL('../..', import.meta.url)), 'utf8'));
  const manifest = read('semantics/figma-baseline.json');
  const baseline = loadAuthorBaseline(root, { manifest: { ...manifest, counts: { families: fixtureNames.length, variants: fixtureNames.length * 2 },
    icons: Object.fromEntries(fixtureNames.map(name => [name, manifest.icons[name]])) } });
  const all = read('semantics/author-anatomy.json');
  const annotations = compileAuthorAnatomy(baseline, { ...all, icons: Object.fromEntries(fixtureNames.map(name => [name, all.icons[name]])) });
  const sources = Object.fromEntries(Object.entries(baseline.icons).map(([icon, variants]) => [icon,
    Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, { ...item,
      sourceContract: annotations[`${icon}/${variant}`] ?? item.sourceContract }]))]));
  const compiler = createGlyphCompiler({ catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
    icons: Object.fromEntries(Object.entries(sources).map(([icon, variants]) => [icon, { model: null,
      source: Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, item.sourceContract])) }])) },
    anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
    staticIcons: Object.fromEntries(Object.entries(sources).flatMap(([icon, variants]) => Object.entries(variants).map(([variant, item]) =>
      [symbolExportName(icon, variant), item.artifactSvg]))) });
  return Object.fromEntries(fixtureNames.map(icon => {
    const payload = authorSymbolPayload(icon, sources[icon], compiler);
    const symbol = { glyph: createCompiledGlyph(payload.icon, payload.source),
      glyphCapabilities: createCompiledCapabilities(payload.capabilities) };
    const targets = Object.fromEntries(['outline', 'filled'].map(variant => [variant, compileLottieGeometry(payload.source[variant])]));
    return [icon, { symbol, payload, targets, lottie: createLottieSymbol(symbol, targets), masters: baseline.icons[icon] }];
  }));
}
