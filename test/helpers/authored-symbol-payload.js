import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { loadAuthorBaseline, authorSymbolPayload } from '../../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../../scripts/lib/author-anatomy.js';
import { compileLottieGeometry } from '../../scripts/lib/lottie-geometry.js';
import { symbolExportName } from '../../scripts/lib/symbol-modules.js';

/** Узкий настоящий compiler fixture; список выбирает проверку, не возможности продукта. */
export async function authoredSymbolPayloads(names) {
  const root = fileURLToPath(new URL('../..', import.meta.url));
  const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
  const captured = read('semantics/figma-baseline.json'), annotations = read('semantics/author-anatomy.json');
  const manifest = { ...captured, counts: { families: names.length, variants: names.length * 2 },
    icons: Object.fromEntries(names.map(icon => [icon, captured.icons[icon]])) };
  const author = loadAuthorBaseline(root, { manifest }), grid = read('semantics/grid.json');
  const contracts = compileAuthorAnatomy(author, { ...annotations,
    icons: Object.fromEntries(names.map(icon => [icon, annotations.icons[icon]])) }, grid);
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
  return Object.fromEntries(names.map(icon => {
    const payload = authorSymbolPayload(icon, sources[icon], compiler);
    const projected = Object.fromEntries(['outline', 'filled'].map(variant => [variant, sources[icon][variant].sourceContract.variation]));
    const variation = projected.outline || projected.filled ? projected : undefined;
    const capabilities = Object.fromEntries(['outline', 'filled'].map(variant => {
      const capability = payload.capabilities[variant], law = variation?.[variant], target = compileLottieGeometry(payload.source[variant]);
      return [variant, { ...capability, ...(law && { variation: { version: 1, law: law.law, geometrySha256: law.geometrySha256,
        defaults: { dotScale: 1, spacingScale: 1 }, domain: law.domain,
        targets: { svg: 'supported', webEffect: 'existing-part-gestures', lottie: 'not-exported', sfSymbols: 'not-exported' } } }),
        motion: { ...capability.motion, adapters: { ...capability.motion.adapters,
          lottie: target.ok && capability.motion.state === 'gesture-ready' ? 'lottie-web-svg-5.13' : 'not-exported' } } }];
    }));
    return [icon, { ...payload, capabilities, variation }];
  }));
}
