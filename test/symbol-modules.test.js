import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { renderSymbolModule, symbolExportName, symbolModuleDeclaration, symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
import { expandReleaseExports, runtimeModuleSpecifiers, validateReleaseContract, validateReleaseRuntimeDependencyGraph } from '../scripts/lib/release-contract.js';
import { authorSymbolPayload, loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { createCompiledVariationGlyph } from '../src/ir/authored-variation.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';

const base = {
  packageName: '@labpics/icons', primary: { kind: 'npm', access: 'public', install: 'pnpm add @labpics/icons' },
  fallback: { kind: 'github-dist-tag', specifier: 'github:Labpics-Team/lab-icons#vX.Y.Z-dist', immutable: true },
  exports: Object.fromEntries([['.', 'index'], ['./ir', 'ir/index'], ['./ir/recipes', 'ir/recipes'], ['./ir/candidates', 'ir/candidates']].map(([key, file]) => [key, { types: `./dist/${file}.d.ts`, import: `./dist/${file}.js` }])),
};

async function consumeSymbol(contents, entry) {
  const output = await build({
    stdin: { contents: entry, loader: 'js' },
    bundle: true, write: false, minify: true, platform: 'browser', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'single-symbol-control', setup(plugin) {
      plugin.onResolve({ filter: /^test-symbol$/ }, () => ({ path: 'symbol', namespace: 'symbol', sideEffects: false }));
      plugin.onLoad({ filter: /.*/, namespace: 'symbol' }, () => ({ contents, loader: 'js' }));
      plugin.onResolve({ filter: /symbol-runtime\.js$/ }, () => ({ path: fileURLToPath(new URL('../src/ir/symbol-runtime.ts', import.meta.url)) }));
      plugin.onResolve({ filter: /variation-runtime\.js$/ }, () => ({ path: fileURLToPath(new URL('../src/ir/authored-variation.ts', import.meta.url)) }));
    } }],
  });
  return output.outputFiles[0].text;
}

function metadataControl() {
  const source = {}, capabilities = {};
  for (const variant of ['outline', 'filled']) {
    const author = { masterSha256: `${variant.toUpperCase()}_AUTHOR_RECEIPT` };
    const anatomy = { annotationSha256: `${variant.toUpperCase()}_ANATOMY_RECEIPT` };
    source[variant] = { icon: 'alert', variant, svg: 'AUTHOR_IR_SENTINEL', parts: [],
      provenance: { kind: 'source', author: { ...author }, anatomy: { ...anatomy } } };
    capabilities[variant] = { trace: 'AUTHOR_CAPS_SENTINEL', author, anatomy };
  }
  return { icon: 'alert', source, capabilities, staticSvg: { outline: 'SVG_STATIC_CONTROL', filled: 'FILLED_UNUSED' } };
}

async function importSymbol(contents) {
  const bundled = await consumeSymbol(contents, 'export { glyph, glyphCapabilities, outline, filled } from "test-symbol";');
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

function authoredControl(icon) {
  const root = fileURLToPath(new URL('..', import.meta.url));
  const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
  const captured = read('semantics/figma-baseline.json');
  const manifest = { ...captured, counts: { families: 1, variants: 2 }, icons: { [icon]: captured.icons[icon] } };
  const baseline = loadAuthorBaseline(root, { manifest });
  const annotations = read('semantics/author-anatomy.json');
  const contracts = compileAuthorAnatomy(baseline, { ...annotations,
    icons: annotations.icons[icon] ? { [icon]: annotations.icons[icon] } : {} });
  const sources = Object.fromEntries(['outline', 'filled'].map(variant => [variant, {
    ...baseline.icons[icon][variant], sourceContract: contracts[`${icon}/${variant}`] ?? baseline.icons[icon][variant].sourceContract,
  }]));
  const compiler = createGlyphCompiler({
    catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
      icons: { [icon]: { model: null, source: Object.fromEntries(['outline', 'filled'].map(variant => [variant, sources[variant].sourceContract])) } } },
    anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
    staticIcons: Object.fromEntries(['outline', 'filled'].map(variant =>
      [symbolExportName(icon, variant), sources[variant].artifactSvg])),
  });
  const payload = authorSymbolPayload(icon, sources, compiler);
  const variation = Object.fromEntries(['outline', 'filled'].map(variant => [variant, contracts[`${icon}/${variant}`]?.variation]));
  if (!variation.outline || !variation.filled) return payload;
  return { ...payload, variation, capabilities: Object.fromEntries(['outline', 'filled'].map(variant => [variant, {
    ...payload.capabilities[variant], variation: { version: 1, law: variation[variant].law,
      geometrySha256: variation[variant].geometrySha256, defaults: { dotScale: 1, spacingScale: 1 },
      domain: variation[variant].domain,
      targets: { svg: 'supported', webEffect: 'existing-part-gestures', lottie: 'not-exported', sfSymbols: 'not-exported' } },
  }])) };
}

describe('замкнутые symbol modules', () => {
  it('projection растёт от настоящего catalog и не требует фиксированного числа иконок', () => {
    const contract = symbolReleaseProjection(base, ['time', 'alert', 'new-symbol']);
    expect(validateReleaseContract(contract)).toEqual([]);
    const exports = expandReleaseExports(contract);
    expect(exports['./symbols/new-symbol']).toEqual({ types: './dist/symbols/new-symbol.d.ts', import: './dist/symbols/new-symbol.js' });
    expect(contract.files).toContain('dist/symbols/alert.js');
    expect(contract.files.some(file => file.includes('*'))).toBe(false);
    expect(() => symbolReleaseProjection(base, ['time', 'time'])).toThrow();
    expect(() => symbolReleaseProjection(base, ['../escape'])).toThrow();
  });

  it('source-only module не импортирует ни compiler, ни геометрию соседнего символа', () => {
    const shape = { icon: 'alert', svg: '<svg/>', parts: [] };
    const result = renderSymbolModule({ icon: 'alert', source: { outline: shape, filled: shape }, capabilities: {}, staticSvg: { outline: '<svg/>', filled: '<svg/>' } });
    expect(runtimeModuleSpecifiers(result).specifiers).toEqual(['../ir/symbol-runtime.js']);
    expect(result).not.toContain('createGlyphCompiler');
    expect(result).not.toContain('catalog.json');
    expect(result).toContain('createCompiledGlyph("alert", { outline: outlineSource, filled: filledSource })');
  });

  it('declaration связывает реальное добавленное имя с author corpus', () => {
    const declaration = symbolModuleDeclaration('align-bottom');
    expect(declaration).toContain("AuthorSourceGlyph<'align-bottom'>");
    expect(declaration).toContain("AuthorSourceCapabilities<'align-bottom'>");
    expect(declaration).not.toContain('CatalogIconId');
    expect(() => symbolModuleDeclaration('../escape')).toThrow();
  });

  it.each([
    ['glyph', 'AUTHOR_IR_SENTINEL', 'AUTHOR_CAPS_SENTINEL'],
    ['glyphCapabilities', 'AUTHOR_CAPS_SENTINEL', 'AUTHOR_IR_SENTINEL'],
  ])('%s consumer оставляет только свой независимый payload', async (name, retained, discarded) => {
    const shape = { icon: 'alert', svg: 'AUTHOR_IR_SENTINEL', parts: [] };
    const caps = { trace: 'AUTHOR_CAPS_SENTINEL' };
    const module = renderSymbolModule({ icon: 'alert', source: { outline: shape, filled: shape },
      capabilities: { outline: caps, filled: caps }, staticSvg: { outline: 'SVG_STATIC_CONTROL', filled: 'FILLED_UNUSED' } });
    const actual = await consumeSymbol(module, `import { ${name} } from "test-symbol"; console.log(${name}());`);
    expect(actual).toContain(retained);
    expect(actual).not.toContain(discarded);
    expect(actual).not.toContain('SVG_STATIC_CONTROL');
    expect(actual).not.toContain('FILLED_UNUSED');
  });

  it('общие receipts одного варианта материализуются один раз, без объединения Outline/Filled', async () => {
    const input = metadataControl();
    const before = structuredClone(input);
    const module = renderSymbolModule(input);
    for (const variant of ['OUTLINE', 'FILLED']) {
      for (const field of ['AUTHOR', 'ANATOMY']) expect(module.match(new RegExp(`${variant}_${field}_RECEIPT`, 'g'))).toHaveLength(1);
    }
    const consumer = await importSymbol(module);
    for (const variant of ['outline', 'filled']) {
      const glyph = consumer.glyph({ variant }), caps = consumer.glyphCapabilities(variant);
      expect(glyph).toEqual(input.source[variant]);
      expect(caps).toEqual(input.capabilities[variant]);
      expect(glyph.provenance.author).toBe(caps.author);
      expect(glyph.provenance.anatomy).toBe(caps.anatomy);
      expect(Object.isFrozen(caps.author)).toBe(true);
      expect(Object.isFrozen(caps.anatomy)).toBe(true);
    }
    expect(consumer.glyph().provenance.author).not.toBe(consumer.glyph({ variant: 'filled' }).provenance.author);
    expect(consumer.glyph().provenance.anatomy).not.toBe(consumer.glyph({ variant: 'filled' }).provenance.anatomy);
    expect(input).toEqual(before);
    expect(Object.isFrozen(input.source.outline.provenance.author)).toBe(false);
  });

  it.each([
    ['glyph', 'AUTHOR_IR_SENTINEL', 'AUTHOR_CAPS_SENTINEL'],
    ['glyphCapabilities', 'AUTHOR_CAPS_SENTINEL', 'AUTHOR_IR_SENTINEL'],
  ])('общие receipts не удерживают чужой payload для %s', async (name, retained, discarded) => {
    const actual = await consumeSymbol(renderSymbolModule(metadataControl()), `import { ${name} } from "test-symbol"; console.log(${name}());`);
    expect(actual).toContain(retained);
    expect(actual).not.toContain(discarded);
    expect(actual).not.toContain('SVG_STATIC_CONTROL');
    expect(actual).not.toContain('FILLED_UNUSED');
    expect(actual).toContain('OUTLINE_AUTHOR_RECEIPT');
    expect(actual).toContain('OUTLINE_ANATOMY_RECEIPT');
  });

  it('static import удаляет общие receipts и обе независимые фабрики', async () => {
    const actual = await consumeSymbol(renderSymbolModule(metadataControl()), 'import { outline } from "test-symbol"; console.log(outline);');
    expect(actual).toContain('SVG_STATIC_CONTROL');
    for (const discarded of ['RECEIPT', 'AUTHOR_IR_SENTINEL', 'AUTHOR_CAPS_SENTINEL', 'FILLED_UNUSED', 'AUTHOR_PARITY_REQUIRED']) {
      expect(actual).not.toContain(discarded);
    }
  });

  it.each(['time', 'reload'])('настоящий %s проходит compiler → module → consumer без изменения authored paths и admission', async icon => {
    const payload = authoredControl(icon);
    const consumer = await importSymbol(renderSymbolModule(payload));
    for (const variant of ['outline', 'filled']) {
      const glyph = consumer.glyph({ variant }), caps = consumer.glyphCapabilities(variant);
      expect(glyph).toEqual(payload.source[variant]);
      expect(caps).toEqual(payload.capabilities[variant]);
      expect(glyph.provenance.author).toBe(caps.author);
      expect(glyph.provenance.anatomy).toBe(caps.anatomy);
      expect(Object.isFrozen(glyph.provenance.author)).toBe(true);
      expect(consumer[variant]).toBe(payload.staticSvg[variant]);
    }
    expect(consumer.glyph()).toBe(consumer.glyph());
    expect(consumer.glyph()).not.toBe(consumer.glyph({ variant: 'filled' }));
    expect(() => consumer.glyph({ axes: { weight: 1 } })).toThrow(expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
    expect(() => consumer.glyph({ modelMode: 'allow-candidate' })).toThrow(expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
  });

  it.each(['ellipsis-horizontal', 'ellipsis-vertical'])('%s сохраняет реальную authored variation в generated consumer', async icon => {
    const input = authoredControl(icon), before = structuredClone(input);
    const module = renderSymbolModule(input);
    const consumer = await importSymbol(module);
    const expectedGlyph = createCompiledVariationGlyph(icon, structuredClone(input.source), structuredClone(input.variation));
    for (const variant of ['outline', 'filled']) {
      expect(consumer.glyph({ variant })).toEqual(input.source[variant]);
      expect(consumer.glyph({ variant, variation: { dotScale: 1.1, spacingScale: 0.9 } }))
        .toEqual(expectedGlyph({ variant, variation: { dotScale: 1.1, spacingScale: 0.9 } }));
      expect(consumer.glyphCapabilities(variant)).toEqual(JSON.parse(JSON.stringify(input.capabilities[variant])));
      expect(Object.isFrozen(consumer.glyphCapabilities(variant).variation.domain)).toBe(true);
      expect(() => consumer.glyph({ variant, variation: { dotScale: 100, spacingScale: 1 } }))
        .toThrow(expect.objectContaining({ code: 'VARIATION_OUTSIDE_DOMAIN' }));
    }
    expect(consumer.glyphCapabilities().variation.domain).not.toBe(consumer.glyphCapabilities('filled').variation.domain);
    expect(input).toEqual(before);
  });

  it.each([
    ['glyph', 'AUTHOR_IR_SENTINEL', 'AUTHOR_CAPS_SENTINEL'],
    ['glyphCapabilities', 'AUTHOR_CAPS_SENTINEL', 'AUTHOR_IR_SENTINEL'],
  ])('variation сохраняет независимый %s consumer', async (name, retained, discarded) => {
    const input = structuredClone(authoredControl('ellipsis-horizontal'));
    input.source.outline.consumerSentinel = 'AUTHOR_IR_SENTINEL';
    input.capabilities.outline.consumerSentinel = 'AUTHOR_CAPS_SENTINEL';
    const actual = await consumeSymbol(renderSymbolModule(input), `import { ${name} } from "test-symbol"; console.log(${name}());`);
    expect(actual).toContain(retained);
    expect(actual).not.toContain(discarded);
    expect(actual).toContain('convex-linear');
  });

  it('static variation consumer удаляет domain, runtime и геометрию', async () => {
    const input = structuredClone(authoredControl('ellipsis-horizontal'));
    input.staticSvg.outline = 'SVG_STATIC_CONTROL';
    const actual = await consumeSymbol(renderSymbolModule(input), 'import { outline } from "test-symbol"; console.log(outline);');
    expect(actual).toContain('SVG_STATIC_CONTROL');
    for (const discarded of ['convex-linear', 'dotScale', 'geometrySha256', 'VARIATION_OUTSIDE_DOMAIN', 'AUTHOR_PARITY_REQUIRED']) {
      expect(actual).not.toContain(discarded);
    }
  });

  it('разные и отсутствующие variation domains сохраняют исходные данные', async () => {
    const input = structuredClone(authoredControl('ellipsis-horizontal'));
    input.capabilities.outline.variation.domain.policy.gridSha256 = 'OTHER_CAPABILITY_DOMAIN';
    delete input.capabilities.filled.variation.domain;
    const before = structuredClone(input), module = renderSymbolModule(input);
    const consumer = await importSymbol(module);
    expect(consumer.glyphCapabilities()).toEqual(JSON.parse(JSON.stringify(input.capabilities.outline)));
    expect(consumer.glyphCapabilities('filled').variation).not.toHaveProperty('domain');
    expect(consumer.glyph({ variation: { dotScale: 1.1 } }).provenance.kind).toBe('authored-variation');
    expect(input).toEqual(before);
  });

  it('равные Outline/Filled domains остаются отдельными авторскими объектами', async () => {
    const input = structuredClone(authoredControl('ellipsis-horizontal'));
    input.variation.filled.domain = structuredClone(input.variation.outline.domain);
    input.capabilities.filled.variation.domain = structuredClone(input.variation.outline.domain);
    const consumer = await importSymbol(renderSymbolModule(input));
    expect(consumer.glyphCapabilities().variation.domain).toEqual(consumer.glyphCapabilities('filled').variation.domain);
    expect(consumer.glyphCapabilities().variation.domain).not.toBe(consumer.glyphCapabilities('filled').variation.domain);
  });

  it('расходящиеся или отсутствующие metadata не заменяются общей записью', async () => {
    const input = metadataControl();
    input.capabilities.outline.author.masterSha256 = 'OTHER_AUTHOR_RECEIPT';
    delete input.capabilities.filled.anatomy;
    const consumer = await importSymbol(renderSymbolModule(input));
    for (const variant of ['outline', 'filled']) {
      expect(consumer.glyph({ variant })).toEqual(input.source[variant]);
      expect(consumer.glyphCapabilities(variant)).toEqual(input.capabilities[variant]);
    }
    expect(consumer.glyph().provenance.author).not.toBe(consumer.glyphCapabilities().author);
    expect(consumer.glyphCapabilities('filled')).not.toHaveProperty('anatomy');
  });

  it('outline-only consumer удаляет настоящий runtime и весь IR payload; прежний member-read это нарушает', async () => {
    const shape = { icon: 'alert', svg: 'AUTHOR_IR_SENTINEL', parts: [] };
    const module = renderSymbolModule({ icon: 'alert', source: { outline: shape, filled: shape }, capabilities: { trace: 'AUTHOR_CAPS_SENTINEL' }, staticSvg: { outline: '<svg>SVG_STATIC_CONTROL</svg>', filled: '<svg>FILLED_UNUSED</svg>' } });
    const consume = contents => consumeSymbol(contents, 'import { outline } from "test-symbol"; console.log(outline);');
    const actual = await consume(module);
    expect(actual).toContain('SVG_STATIC_CONTROL');
    expect(actual).not.toContain('AUTHOR_IR_SENTINEL');
    expect(actual).not.toContain('AUTHOR_CAPS_SENTINEL');
    expect(actual).not.toContain('FILLED_UNUSED');
    expect(actual).not.toContain('AUTHOR_PARITY_REQUIRED');
    const stale = module
      .replace('export const glyph = /* @__PURE__ */', 'const symbolGlyph = /* @__PURE__ */')
      .replace('export const glyphCapabilities = /* @__PURE__ */', 'const symbolCapabilities = /* @__PURE__ */') +
      '\nconst symbol = { glyph: symbolGlyph, glyphCapabilities: symbolCapabilities };\n' +
      'export const glyph = symbol.glyph;\nexport const glyphCapabilities = symbol.glyphCapabilities;\n';
    expect(await consume(stale)).toContain('AUTHOR_IR_SENTINEL');
  });

  it('runtime parser различает настоящие imports, данные и template expressions', () => {
    const parsed = runtimeModuleSpecifiers('const text="import(fake)";export const x=`prefix${import("./one.js")}`;');
    expect(parsed).toEqual({ specifiers: ['./one.js'], errors: [] });
    expect(runtimeModuleSpecifiers('export const x=()=>import(name);').errors).toHaveLength(1);
    expect(runtimeModuleSpecifiers('export const x=()=>import("./"+name);').errors).toHaveLength(1);
    expect(runtimeModuleSpecifiers('export const object={import(value){return value;}};').errors).toEqual([]);
  });

  it('orphan или внешняя runtime dependency не становится разрешённой через manifest', () => {
    const contract = symbolReleaseProjection(base, ['alert']);
    const files = Object.fromEntries(contract.files.filter(file => file.endsWith('.js')).map(file => [file, 'export const value=1;']));
    files['dist/ir/index.js'] = 'import "./compiler.js";export const value=1;';
    files['dist/ir/compiler.js'] = 'import "./request.js";export const value=1;';
    files['dist/ir/symbol-runtime.js'] = 'import "./request.js";export const value=1;';
    files['dist/symbols/alert.js'] = 'import "../ir/symbol-runtime.js";export const value=1;';
    files['dist/lottie/alert.js'] = 'import "../ir/lottie-runtime.js";export const value=1;';
    files['dist/motion/index.js'] = 'import "../ir/contour-runtime.js";export const value=1;';
    const readText = file => files[file];
    expect(validateReleaseRuntimeDependencyGraph({ contract, readText })).toEqual([]);
    files['dist/ir/compiler.js'] = 'import "node:fs";export const value=1;';
    expect(validateReleaseRuntimeDependencyGraph({ contract, readText }).join('\n')).toContain('внешнюю runtime-зависимость node:fs');
    files['dist/ir/compiler.js'] = 'import "./request.js";export const value=1;';
    const orphan = 'dist/ir/unreachable.js';
    files[orphan] = 'export const value=1;';
    const mutated = { ...contract, files: [...contract.files, orphan].sort(), runtimeDependencies: [...contract.runtimeDependencies, orphan].sort() };
    expect(validateReleaseRuntimeDependencyGraph({ contract: mutated, readText }).join('\n')).toContain('не равен import closure');
  });
});
