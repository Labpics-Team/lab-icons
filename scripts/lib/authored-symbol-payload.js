import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadAuthorBaseline, authorSymbolPayload } from './author-baseline.js';
import { compileAuthorAnatomy } from './author-anatomy.js';
import { authorVariationCapability } from './author-variation.js';
import { compileLottieGeometry } from './lottie-geometry.js';
import { symbolExportName } from './symbol-modules.js';

/** Один владелец target capabilities для build и release projection. */
export function compiledAuthorSymbolPayload(icon, sources, compiler) {
  const payload = authorSymbolPayload(icon, sources, compiler);
  const projected = Object.fromEntries(['outline', 'filled'].map(variant => [variant, sources[variant].sourceContract.variation]));
  const variation = projected.outline || projected.filled ? projected : undefined;
  const content = sources.outline.sourceContract.contentVariation;
  const contentVariation = content ? { outline: content } : undefined;
  const targets = Object.fromEntries(['outline', 'filled'].map(variant => [variant, compileLottieGeometry(payload.source[variant])]));
  const capabilities = Object.fromEntries(['outline', 'filled'].map(variant => {
    const capability = payload.capabilities[variant], law = variation?.[variant];
    return [variant, { ...capability, ...(law && { variation: authorVariationCapability(law) }),
      motion: { ...capability.motion, adapters: { ...capability.motion.adapters,
        lottie: targets[variant].ok && capability.motion.state === 'gesture-ready' ? 'lottie-web-svg-5.13' : 'not-exported' } } }];
  }));
  return { ...payload, capabilities, variation, targets, ...(contentVariation && { contentVariation }) };
}

/** Production projection выбирает имена; никакой ручной census возможностей. */
export async function authoredSymbolPayloads(names, options = { scope: 'source' }) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
  const captured = read('semantics/figma-baseline.json'), annotations = read('semantics/author-anatomy.json');
  const manifest = { ...captured, counts: { families: names.length, variants: names.length * 2 },
    icons: Object.fromEntries(names.map(icon => [icon, captured.icons[icon]])) };
  const author = loadAuthorBaseline(root, { manifest }), grid = read('semantics/grid.json');
  const contracts = compileAuthorAnatomy(author, { ...annotations,
      icons: Object.fromEntries(names.filter(icon => Object.hasOwn(annotations.icons, icon)).map(icon => [icon, annotations.icons[icon]])) }, grid, options);
  const sources = Object.fromEntries(names.map(icon => [icon, Object.fromEntries(['outline', 'filled'].map(variant =>
    [variant, { ...author.icons[icon][variant], sourceContract: contracts[`${icon}/${variant}`] ?? author.icons[icon][variant].sourceContract }]))]));
  const bundle = await build({ stdin: { contents: 'export { createGlyphCompiler } from "./src/ir/compiler.ts";', resolveDir: root },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent' });
  const { createGlyphCompiler } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const compiler = createGlyphCompiler({ catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
    icons: Object.fromEntries(names.map(icon => [icon, { model: null,
      source: Object.fromEntries(['outline', 'filled'].map(variant => [variant, sources[icon][variant].sourceContract])) }])) },
    anatomy: { version: 1, glyphs: {} }, grid,
    staticIcons: Object.fromEntries(names.flatMap(icon => ['outline', 'filled'].map(variant =>
      [symbolExportName(icon, variant), sources[icon][variant].artifactSvg]))) });
  return Object.fromEntries(names.map(icon => [icon, compiledAuthorSymbolPayload(icon, sources[icon], compiler)]));
}
