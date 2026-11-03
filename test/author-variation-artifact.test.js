import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { authorPackageExpectations } from '../scripts/check-package-artifact.js';
import { authorVariationArtifactConsumerSource, authorVariationFamilyConsumerSource } from '../scripts/lib/author-variation-artifact-consumer.js';
import { loadAuthorBaseline, authorSymbolPayload } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { authorVariationCapability } from '../scripts/lib/author-variation.js';
import { renderSymbolModules, symbolExportName } from '../scripts/lib/symbol-modules.js';
import { renderLottieSymbolModule } from '../scripts/lib/lottie-geometry.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const names = ['plus-circle', 'checkmark-circle', 'ellipsis-horizontal', 'mic', 'mic-circle'];
const variants = ['outline', 'filled'];
const manifest = read('semantics/figma-baseline.json');
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest,
  counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map(icon => [icon, manifest.icons[icon]])) } });
const document = read('semantics/author-anatomy.json');
const annotations = { ...document, icons: Object.fromEntries(names.map(icon => [icon, document.icons[icon]])) };
const grid = read('semantics/grid.json');
const contracts = compileAuthorAnatomy(baseline, annotations, grid);
const sources = Object.fromEntries(names.map(icon => [icon, Object.fromEntries(variants.map(variant => [variant,
  { ...baseline.icons[icon][variant], sourceContract: contracts[`${icon}/${variant}`] ?? baseline.icons[icon][variant].sourceContract }]))]));
const expected = authorPackageExpectations(baseline, annotations);
const compiler = createGlyphCompiler({ catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
  icons: Object.fromEntries(names.map(icon => [icon, { model: null,
    source: Object.fromEntries(variants.map(variant => [variant, sources[icon][variant].sourceContract])) }])) },
  anatomy: { version: 1, glyphs: {} }, grid,
  staticIcons: Object.fromEntries(names.flatMap(icon => variants.map(variant =>
    [symbolExportName(icon, variant), sources[icon][variant].artifactSvg]))) });

let directory;
function runConsumer({ expectations = expected } = {}) {
  writeFileSync(join(directory, 'author-expected.json'), JSON.stringify(expectations));
  const source = `import { readFileSync } from 'node:fs';
import { compileSymbolEffect } from '@labpics/icons/motion';
import { observeAuthorGlyph } from ${JSON.stringify(pathToFileURL(join(root, 'scripts/bench/author-oracle.js')).href)};
${authorVariationArtifactConsumerSource()}
const expectedSymbols = JSON.parse(readFileSync(new URL('./author-expected.json', import.meta.url), 'utf8'));
for (const [icon, variants] of Object.entries(expectedSymbols)) {
  const symbol = await import('@labpics/icons/symbols/' + icon);
  ${authorVariationFamilyConsumerSource()}
  for (const [variant, expected] of Object.entries(variants)) {
    const current = symbol.glyph({ variant }), capabilities = symbol.glyphCapabilities(variant);
    verifyInstalledAuthorVariation({ icon, variant, expected, familyVariation, current, capabilities, symbol, variable, lottie: lottieVariation, compileSymbolEffect, observeAuthorGlyph });
  }
}
console.log('author variation installed consumer PASS');
`;
  writeFileSync(join(directory, 'consumer.mjs'), source);
  return spawnSync(process.execPath, [join(directory, 'consumer.mjs')], { cwd: directory, encoding: 'utf8', timeout: 30_000 });
}

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), 'lab-icons-author-variation-artifact-'));
  const pkg = join(directory, 'node_modules/@labpics/icons'), dist = join(pkg, 'dist');
  for (const path of ['ir/symbol-data', 'symbols', 'variations', 'lottie', 'motion']) mkdirSync(join(dist, path), { recursive: true });
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', exports: read('package.json').exports }));
  // Узкие runtime entrypoints; полный build/pack и каталог не запускаются.
  for (const [input, output] of [
    ['src/ir/symbol-runtime.ts', 'ir/symbol-runtime.js'],
    ['src/ir/author-annulus-runtime.ts', 'ir/annulus-runtime.js'],
    ['src/ir/author-capsule-runtime.ts', 'ir/capsule-runtime.js'],
    ['src/ir/authored-variation.ts', 'ir/variation-runtime.js'],
    ['src/motion/index.ts', 'motion/index.js'],
    ['src/lottie/runtime.ts', 'ir/lottie-runtime.js'],
  ]) await build({ entryPoints: [join(root, input)], outfile: join(dist, output), bundle: true,
    platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent' });
  for (const icon of names) {
    const payload = authorSymbolPayload(icon, sources[icon], compiler);
    const variation = Object.fromEntries(variants.flatMap(variant => {
      const packet = contracts[`${icon}/${variant}`]?.variation;
      return packet ? [[variant, packet]] : [];
    }));
    const capabilities = Object.fromEntries(variants.map(variant => [variant, { ...payload.capabilities[variant],
      ...(variation[variant] && { variation: authorVariationCapability(variation[variant]) }) }]));
    const modules = renderSymbolModules({ ...payload, capabilities, variation });
    for (const [path, code] of [[`symbols/${icon}.js`, modules.symbol], [`variations/${icon}.js`, modules.variation],
      [`ir/symbol-data/${icon}.js`, modules.data]]) writeFileSync(join(dist, path), code);
    // Variation отвергается настоящим target runtime до чтения default payload.
    const unavailable = { ok: false, reason: { code: 'PATH_INVALID', message: 'не используется для variation refusal' } };
    writeFileSync(join(dist, 'lottie', `${icon}.js`), renderLottieSymbolModule(icon, { outline: unavailable, filled: unavailable }));
  }
});
afterAll(() => { if (directory) rmSync(directory, { recursive: true, force: true }); });

describe('author variation: исполняемый installed smoke по объявленному закону', () => {
  it('контроль dots сохраняет identity, все изменённые части, жесты и точные отказы', () => {
    const result = runConsumer({ expectations: { 'ellipsis-horizontal': expected['ellipsis-horizontal'] } });
    expect(result.status, result.stdout + result.stderr).toBe(0);
  });
  it('все три закона проходят один generated smoke через public exports; Filled остаётся независимым', () => {
    const result = runConsumer();
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('author variation installed consumer PASS');
  });

  it('настоящая capsule сохраняет независимые layers и отрицательный Filled compound', () => {
    expect(expected['mic'].outline.composition).toEqual({ kind: 'layers' });
    expect(expected['mic-circle'].filled.composition).toEqual({ kind: 'compound', fillRule: 'evenodd' });
    expect(expected['mic-circle'].filled.parts.map(part => part.role)).toEqual(['container', 'counter', 'counter']);
    for (const icon of ['mic', 'mic-circle']) for (const variant of variants) {
      expect(expected[icon][variant].variation).toMatchObject({ law: 'capsule.width', bodyPartId: 'microphone-body' });
    }
    const result = runConsumer({ expectations: { mic: expected.mic, 'mic-circle': expected['mic-circle'] } });
    expect(result.status, result.stdout + result.stderr).toBe(0);
    expect(result.stdout).toContain('author variation installed consumer PASS');
  });

  it('source ожидания сохраняют law и ID enclosure, не объявляя Filled variation', () => {
    expect(expected['plus-circle'].outline.variation).toMatchObject({ law: 'annulus.counter-scale', enclosurePartId: annotations.icons['plus-circle'].outline.variation.enclosurePartId });
    expect(expected['checkmark-circle'].outline.variation).toMatchObject({ law: 'annulus.counter-scale' });
    expect(expected['plus-circle'].filled.variation).toBeNull();
    expect(expected['ellipsis-horizontal'].outline.variation).toMatchObject({ law: 'dots.affine' });
  });

  it('неизвестный закон даёт явный failure, не обход проверки', () => {
    const corrupt = structuredClone(expected);
    corrupt['plus-circle'].outline.variation.law = 'future.unverified';
    const result = runConsumer({ expectations: corrupt });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('unsupported authored variation law');
  });

  it('исполненный smoke отвергает подмену changed-part contract', () => {
    const corrupt = structuredClone(expected);
    corrupt['plus-circle'].outline.variation.enclosurePartId = expected['plus-circle'].outline.parts[0].id;
    const result = runConsumer({ expectations: corrupt });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('authored variation changed-part contract');
  });

  it.each([
    ['unsupported admission', 'glyph',
      "request => request?.variant === 'filled' && Object.hasOwn(request, 'variation') ? artifactOriginal({ variant: 'filled' }) : artifactOriginal(request)",
      'unsupported authored variation accepted'],
    ['wrong default', 'glyph',
      "request => request?.variant === 'filled' ? { ...artifactOriginal(request) } : artifactOriginal(request)",
      'unsupported authored variation default differs'],
    ['wrong capabilities', 'glyphCapabilities',
      "variant => variant === 'filled' ? { ...artifactOriginal(variant) } : artifactOriginal(variant)",
      'unsupported authored variation capabilities differ'],
  ])('Filled opt-in: reachable mutant %s обнаруживается после успешного syntax control', (_, exported, replacement, message) => {
    const path = join(directory, 'node_modules/@labpics/icons/dist/variations/plus-circle.js');
    const original = readFileSync(path, 'utf8');
    const declaration = `export const ${exported} =`;
    expect(original).toContain(declaration);
    try {
      writeFileSync(path, original.replace(declaration, 'const artifactOriginal =') + `\nexport const ${exported} = ${replacement};\n`);
      const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      expect(syntax.status, syntax.stdout + syntax.stderr).toBe(0);
      const result = runConsumer();
      expect(result.status, result.stdout + result.stderr).not.toBe(0);
      expect(result.stderr).toContain(message);
    } finally { writeFileSync(path, original); }
  });

  it.each([
    ['потеря semantic part', 'return { ...glyph, parts: glyph.parts.slice(0, -1) };', 'authored variation lost parts/SVG'],
    ['дублирование semantic part', 'return { ...glyph, parts: [...glyph.parts, glyph.parts[1]] };', 'authored variation lost parts/SVG'],
    ['перестановка semantic parts', 'return { ...glyph, parts: [glyph.parts[0], glyph.parts[2], glyph.parts[1]] };', 'authored variation lost parts/SVG'],
    ['подмена semantic role', "return { ...glyph, parts: glyph.parts.map((part, index) => index === 1 ? { ...part, role: 'content' } : part) };", 'authored variation lost parts/SVG'],
    ['потеря физического contour', 'return { ...glyph, svg: glyph.svg.replace(\'d="\' + glyph.d + \'"\', \'d="\' + glyph.parts.slice(0, -1).map(part => part.d).join(\'\') + \'"\') };', 'authored variation lost parts/SVG'],
    ['дублирование физического contour', 'return { ...glyph, svg: glyph.svg.replace(\'d="\' + glyph.d + \'"\', \'d="\' + glyph.d + glyph.parts[1].d + \'"\') };', 'authored variation lost parts/SVG'],
    ['подмена физической role', 'return { ...glyph, svg: glyph.svg.replace(\'data-roles="container counter counter"\', \'data-roles="container content counter"\') };', 'compound parent утратил ordered contour metadata'],
    ['подмена общего fill owner', 'return { ...glyph, svg: glyph.svg.replace(\'fill-rule="evenodd"\', \'fill-rule="nonzero"\') };', 'compound source требует один точный evenodd fill owner'],
  ])('Filled compound: %s обнаруживается в установленном consumer', (_, mutation, message) => {
    const path = join(directory, 'node_modules/@labpics/icons/dist/variations/mic-circle.js');
    const original = readFileSync(path, 'utf8'), declaration = 'export const glyph =';
    expect(original).toContain(declaration);
    try {
      writeFileSync(path, original.replace(declaration, 'const artifactOriginal =') + `
export const glyph = request => {
  const glyph = artifactOriginal(request);
  if (request?.variant === 'filled' && request.variation?.bodyWidth < 1) { ${mutation} }
  return glyph;
};
`);
      const syntax = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
      expect(syntax.status, syntax.stdout + syntax.stderr).toBe(0);
      const result = runConsumer({ expectations: { 'mic-circle': { filled: expected['mic-circle'].filled } } });
      expect(result.status, result.stdout + result.stderr).not.toBe(0);
      expect(result.stderr).toContain(message);
    } finally { writeFileSync(path, original); }
  });
});
