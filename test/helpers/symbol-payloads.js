import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { authorSymbolPayload, loadAuthorBaseline } from '../../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../../scripts/lib/author-anatomy.js';
import { compileLottieGeometry } from '../../scripts/lib/lottie-geometry.js';
import { symbolExportName } from '../../scripts/lib/symbol-modules.js';
import { createGlyphCompiler } from '../../src/ir/compiler.js';

/** Только названные реальные masters; полный build/bench здесь не запускается. */
export function symbolPayloads(names) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const read = file => JSON.parse(readFileSync(new URL(`../../${file}`, import.meta.url), 'utf8'));
  const captured = read('semantics/figma-baseline.json');
  const baseline = loadAuthorBaseline(root, { manifest: { ...captured,
    counts: { families: names.length, variants: names.length * 2 },
    icons: Object.fromEntries(names.map(icon => [icon, captured.icons[icon]])) } });
  const all = read('semantics/author-anatomy.json');
  const annotations = compileAuthorAnatomy(baseline, { ...all,
    icons: Object.fromEntries(names.filter(icon => all.icons[icon]).map(icon => [icon, all.icons[icon]])) });
  const sources = Object.fromEntries(Object.entries(baseline.icons).map(([icon, variants]) => [icon,
    Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, { ...item,
      sourceContract: annotations[`${icon}/${variant}`] ?? item.sourceContract }]))]));
  const compiler = createGlyphCompiler({
    catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
      icons: Object.fromEntries(Object.entries(sources).map(([icon, variants]) => [icon, { model: null,
        source: Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, item.sourceContract])) }])) },
    anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
    staticIcons: Object.fromEntries(Object.entries(sources).flatMap(([icon, variants]) =>
      Object.entries(variants).map(([variant, item]) => [symbolExportName(icon, variant), item.artifactSvg]))) });
  return Object.fromEntries(names.map(icon => {
    const payload = authorSymbolPayload(icon, sources[icon], compiler);
    const targets = Object.fromEntries(['outline', 'filled'].map(variant => [variant, compileLottieGeometry(payload.source[variant])]));
    const capabilities = Object.fromEntries(['outline', 'filled'].map(variant => {
      const capability = payload.capabilities[variant];
      return [variant, { ...capability, motion: { ...capability.motion, adapters: { ...capability.motion.adapters,
        lottie: targets[variant].ok && capability.motion.state === 'gesture-ready' ? 'lottie-web-svg-5.13' : 'not-exported' } } }];
    }));
    return [icon, { ...payload, capabilities, targets }];
  }));
}
