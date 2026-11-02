#!/usr/bin/env node
/** Узкое сравнение двух symbol modules; full build, pack и timing не запускаются. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { platform, arch } from 'node:os';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import { build, version as esbuildVersion } from 'esbuild';
import { gzipSync } from 'fflate';
import { authorSymbolPayload, loadAuthorBaseline } from '../lib/author-baseline.js';
import { compileAuthorAnatomy } from '../lib/author-anatomy.js';
import { compileLottieGeometry } from '../lib/lottie-geometry.js';
import { symbolExportName } from '../lib/symbol-modules.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const baseline = process.argv[2] ?? '633f963f5503e183f468c0d3763a24ec55c94afb';
if (!/^[a-f0-9]{40}$/.test(baseline)) throw new TypeError('Нужен полный baseline Git SHA.');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const measure = text => {
  const data = Buffer.from(text);
  return { bytes: data.length, gzipBytes: gzipSync(data, { level: 9, mtime: 0 }).length,
    brotliBytes: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    sha256: sha256(data) };
};
const read = path => JSON.parse(readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8'));
const names = ['ellipsis-horizontal', 'ellipsis-vertical'];
const captured = read('semantics/figma-baseline.json');
const manifest = { ...captured, counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map(icon => [icon, captured.icons[icon]])) };
const author = loadAuthorBaseline(root, { manifest });
const annotations = read('semantics/author-anatomy.json'), grid = read('semantics/grid.json');
const contracts = compileAuthorAnatomy(author, { ...annotations,
  icons: Object.fromEntries(names.map(icon => [icon, annotations.icons[icon]])) }, grid);
const sources = Object.fromEntries(names.map(icon => [icon, Object.fromEntries(['outline', 'filled'].map(variant =>
  [variant, { ...author.icons[icon][variant], sourceContract: contracts[`${icon}/${variant}`] }]))]));
const compilerBundle = await build({ stdin: { contents: 'export { createGlyphCompiler } from "./src/ir/compiler.ts";', resolveDir: root },
  bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent' });
const { createGlyphCompiler } = await import(`data:text/javascript;base64,${Buffer.from(compilerBundle.outputFiles[0].text).toString('base64')}`);
const compiler = createGlyphCompiler({ catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
  icons: Object.fromEntries(names.map(icon => [icon, { model: null,
    source: Object.fromEntries(['outline', 'filled'].map(variant => [variant, sources[icon][variant].sourceContract])) }])) },
  anatomy: { version: 1, glyphs: {} }, grid,
  staticIcons: Object.fromEntries(names.flatMap(icon => ['outline', 'filled'].map(variant =>
    [symbolExportName(icon, variant), sources[icon][variant].artifactSvg]))) });
const previousSource = execFileSync('git', ['show', `${baseline}:scripts/lib/symbol-modules.js`], { cwd: root, encoding: 'utf8', windowsHide: true });
const previousModule = previousSource.replace("'./generated-module.js'", JSON.stringify(new URL('../lib/generated-module.js', import.meta.url).href));
const { renderSymbolModule: previousRender } = await import(`data:text/javascript;base64,${Buffer.from(previousModule).toString('base64')}`);
const candidateEvidence = process.argv[4] && JSON.parse(readFileSync(process.argv[4], 'utf8'));
const candidateSource = candidateEvidence?.candidateEmitterSource ?? readFileSync(new URL('../lib/symbol-modules.js', import.meta.url), 'utf8');
if (candidateEvidence && sha256(candidateSource) !== candidateEvidence.candidateEmitterSha256) throw new Error('Неверный digest снимка experiment emitter.');
const candidateModule = candidateSource.replace("'./generated-module.js'", JSON.stringify(new URL('../lib/generated-module.js', import.meta.url).href));
const { renderSymbolModule: candidateRender } = await import(`data:text/javascript;base64,${Buffer.from(candidateModule).toString('base64')}`);
const entries = {
  glyph: 'import {glyph} from "test-symbol";export const result=glyph({variation:{dotScale:1.1,spacingScale:.9}});',
  capabilities: 'import {glyphCapabilities} from "test-symbol";export const result=glyphCapabilities();',
  both: 'import {glyph,glyphCapabilities} from "test-symbol";export const result=[glyph({variation:{dotScale:1.1,spacingScale:.9}}),glyphCapabilities()];',
  static: 'import {outline} from "test-symbol";export const result=outline;',
};
async function consume(contents, entry) {
  const output = await build({ stdin: { contents: entry, loader: 'js' }, bundle: true, write: false,
    minify: true, platform: 'browser', format: 'esm', target: 'es2022', metafile: true, logLevel: 'silent',
    plugins: [{ name: 'variation-domain-control', setup(plugin) {
      plugin.onResolve({ filter: /^test-symbol$/ }, () => ({ path: 'symbol', namespace: 'symbol', sideEffects: false }));
      plugin.onLoad({ filter: /.*/, namespace: 'symbol' }, () => ({ contents, loader: 'js' }));
      plugin.onResolve({ filter: /symbol-runtime\.js$/ }, () => ({ path: fileURLToPath(new URL('../../src/ir/symbol-runtime.ts', import.meta.url)) }));
      plugin.onResolve({ filter: /variation-runtime\.js$/ }, () => ({ path: fileURLToPath(new URL('../../src/ir/authored-variation.ts', import.meta.url)) }));
    } }],
  });
  const text = output.outputFiles[0].text;
  const { result } = await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
  return { ...measure(text), resultSha256: sha256(JSON.stringify(result)), inputs: Object.keys(output.metafile.inputs).sort() };
}
const rows = [];
for (const icon of names) {
  const payload = authorSymbolPayload(icon, sources[icon], compiler);
  const variation = Object.fromEntries(['outline', 'filled'].map(variant => [variant, sources[icon][variant].sourceContract.variation]));
  const capabilities = Object.fromEntries(['outline', 'filled'].map(variant => {
    const capability = payload.capabilities[variant], law = variation[variant], target = compileLottieGeometry(payload.source[variant]);
    return [variant, { ...capability, variation: { version: 1, law: law.law, geometrySha256: law.geometrySha256,
      defaults: { dotScale: 1, spacingScale: 1 }, domain: law.domain,
      targets: { svg: 'supported', webEffect: 'existing-part-gestures', lottie: 'not-exported', sfSymbols: 'not-exported' } },
      motion: { ...capability.motion, adapters: { ...capability.motion.adapters,
        lottie: target.ok && capability.motion.state === 'gesture-ready' ? 'lottie-web-svg-5.13' : 'not-exported' } } }];
  }));
  const input = { ...payload, capabilities, variation };
  const before = previousRender(input), after = candidateRender(input);
  const consumers = {};
  for (const [name, entry] of Object.entries(entries)) {
    consumers[name] = { baseline: await consume(before, entry), actual: await consume(after, entry) };
    if (consumers[name].baseline.resultSha256 !== consumers[name].actual.resultSha256) throw new Error(`${icon}/${name}: consumer output differs`);
  }
  const module = { baseline: measure(before), actual: measure(after) };
  if (module.actual.bytes > module.baseline.bytes || module.actual.gzipBytes > module.baseline.gzipBytes) throw new Error(`${icon}: generated module regressed`);
  rows.push({ icon, module, consumers, domainOccurrences: { baseline: (before.match(/\b["']?kind["']?:"convex-linear"/g) ?? []).length,
    actual: (after.match(/\b["']?kind["']?:"convex-linear"/g) ?? []).length },
    masters: Object.fromEntries(['outline', 'filled'].map(variant => [variant, {
      masterSha256: payload.source[variant].provenance.author.masterSha256, geometrySha256: variation[variant].geometrySha256 }])) });
}
const report = { baseline, head: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  candidateEmitterSha256: sha256(candidateSource), candidateEmitterSource: candidateSource, baselineEmitterSha256: sha256(previousSource),
  scope: 'two families/four masters; generated module and ordinary selective source bundles; no full build, pack, publication, browser or timing qualification',
  environment: { platform: platform(), arch: arch(), node: process.version, esbuild: esbuildVersion,
    fflate: JSON.parse(readFileSync(new URL('../../node_modules/fflate/package.json', import.meta.url), 'utf8')).version,
    brotli: process.versions.brotli, gzip: { level: 9, mtime: 0 }, brotliQuality: 11, target: 'es2022' }, rows };
const output = process.argv[3];
if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
for (const row of rows) console.log(JSON.stringify({ icon: row.icon, module: row.module,
  consumers: Object.fromEntries(Object.entries(row.consumers).map(([name, value]) => [name, {
    baseline: [value.baseline.bytes, value.baseline.gzipBytes, value.baseline.brotliBytes],
    actual: [value.actual.bytes, value.actual.gzipBytes, value.actual.brotliBytes], outputEqual: value.baseline.resultSha256 === value.actual.resultSha256,
  }])) }));
