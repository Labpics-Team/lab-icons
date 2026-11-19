#!/usr/bin/env node
/** Две семьи: реальные selective bundles и cold native import graph, без timing/full pack. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import { build, version as esbuildVersion } from 'esbuild';
import { gzipSync } from 'fflate';
import { renderSymbolModules, symbolModuleDeclaration, variationModuleDeclaration } from '../lib/symbol-modules.js';
import { authoredSymbolPayloads } from '../../test/helpers/authored-symbol-payload.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const baseline = process.argv[2] ?? '1b9412237a8d1b2db6e929be746dd79274390292';
if (!/^[a-f0-9]{40}$/.test(baseline)) throw new TypeError('Нужен полный baseline SHA.');
const sha256 = value => createHash('sha256').update(value).digest('hex');
const measure = text => { const data = Buffer.from(text); return { bytes: data.length,
  gzipBytes: gzipSync(data, { level: 9, mtime: 0 }).length,
  brotliBytes: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length, sha256: sha256(data) }; };
const previousSource = execFileSync('git', ['show', `${baseline}:scripts/lib/symbol-modules.js`], { cwd: root, encoding: 'utf8', windowsHide: true });
const previousModule = previousSource.replace("'./generated-module.js'", JSON.stringify(new URL('../lib/generated-module.js', import.meta.url).href));
const { renderSymbolModule: previousRender } = await import(`data:text/javascript;base64,${Buffer.from(previousModule).toString('base64')}`);
async function runtime(source, external = []) {
  const output = await build({ stdin: { contents: source, resolveDir: join(root, 'src/ir'), loader: 'ts' },
    bundle: true, write: false, platform: 'browser', format: 'esm', target: 'es2022', treeShaking: true,
    minify: false, charset: 'utf8', legalComments: 'none', external, logLevel: 'silent' });
  return output.outputFiles[0].text;
}
const common = { 'dist/ir/request.js': await runtime(readFileSync(join(root, 'src/ir/request.ts'), 'utf8')),
  'dist/ir/symbol-runtime.js': await runtime(readFileSync(join(root, 'src/ir/symbol-runtime.ts'), 'utf8'), ['./request.js']) };
const previousRuntime = await runtime(execFileSync('git', ['show', `${baseline}:src/ir/authored-variation.ts`], { cwd: root, encoding: 'utf8', windowsHide: true }), ['./request.js', './symbol-runtime.js']);
const actualRuntime = await runtime(readFileSync(join(root, 'src/ir/authored-variation.ts'), 'utf8'), ['./request.js', './symbol-runtime.js']);
const inputs = await authoredSymbolPayloads(['ellipsis-horizontal', 'ellipsis-vertical']);
const cases = { sourceGlyph: ['symbols', 'glyph()'], sourceCaps: ['symbols', 'glyphCapabilities()'],
  sourceBoth: ['symbols', '[glyph(),glyphCapabilities()]'], static: ['symbols', 'outline'],
  variableGlyph: ['variations', 'glyph({variation:{dotScale:1.1,spacingScale:.9}})'],
  variableCaps: ['variations', 'glyphCapabilities()'],
  variableBoth: ['variations', '[glyph({variation:{dotScale:1.1,spacingScale:.9}}),glyphCapabilities()]'] };
async function consume(files, icon, directory, expression) {
  const entry = `import { glyph,glyphCapabilities,outline } from "./dist/${directory}/${icon}.js";export const result=${expression};`;
  const output = await build({ stdin: { contents: entry, resolveDir: root }, bundle: true, write: false,
    minify: true, platform: 'browser', format: 'esm', target: 'es2022', metafile: true, logLevel: 'silent',
    plugins: [{ name: 'actual-entry-closure', setup(plugin) {
      plugin.onResolve({ filter: /^\.\.?\// }, args => {
        const file = args.importer ? join(dirname(args.importer), args.path).replaceAll('\\', '/') : args.path.slice(2);
        if (Object.hasOwn(files, file)) return { path: file, namespace: 'projection', sideEffects: false };
      });
      plugin.onLoad({ filter: /.*/, namespace: 'projection' }, args => ({ contents: files[args.path], loader: 'js' }));
    } }],
  });
  const text = output.outputFiles[0].text;
  const { result } = await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
  return { ...measure(text), result, retainedFiles: Object.entries(output.metafile.outputs)[0][1].inputs,
    resolvedFiles: Object.keys(output.metafile.inputs).sort() };
}
function native(files, icon, directory) {
  const folder = mkdtempSync(join(tmpdir(), 'lab-icons-variation-native-'));
  try {
    const pkg = join(folder, 'node_modules/@labpics/icons');
    for (const [file, contents] of Object.entries(files)) {
      const target = join(pkg, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, contents);
    }
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', exports: {
      './symbols/*': './dist/symbols/*.js', './variations/*': './dist/variations/*.js' } }));
    const probe = join(folder, 'probe.mjs');
    const prefix = pathToFileURL(`${pkg}/`).href;
    writeFileSync(probe, `import {registerHooks} from 'node:module';
      const loaded=[];const hook=registerHooks({load(url,context,nextLoad){const value=nextLoad(url,context);if(url.includes('/node_modules/@labpics/icons/'))loaded.push(url);return value;}});
      const current=await import('@labpics/icons/${directory}/${icon}');
      const initialLoaded=[...loaded],defaultGlyph=current.glyph();let identity=null,privateRefused=false;
      if('${directory}'==='variations'){const source=await import('@labpics/icons/symbols/${icon}');identity=current.glyph()===source.glyph()&&current.glyph({variant:'filled'})===source.glyph({variant:'filled'});}
      try{await import('@labpics/icons/ir/symbol-data/${icon}');}catch(error){privateRefused=error.code==='ERR_PACKAGE_PATH_NOT_EXPORTED';}
      hook.deregister();console.log(JSON.stringify({loaded:loaded.map(url=>url.slice(${JSON.stringify(prefix)}.length)),initialLoaded:initialLoaded.map(url=>url.slice(${JSON.stringify(prefix)}.length)),identity,privateRefused,defaultSvg:defaultGlyph.svg,capabilityVariation:!!current.glyphCapabilities().variation}));`);
    const observed = JSON.parse(execFileSync(process.execPath, [probe], { cwd: folder, encoding: 'utf8', windowsHide: true }));
    const loaded = observed.loaded.map(path => path.replace(/^\//, ''));
    const aggregate = paths => paths.map(file => measure(files[file])).reduce((sum, value) => ({
      bytes: sum.bytes + value.bytes, gzipBytes: sum.gzipBytes + value.gzipBytes, brotliBytes: sum.brotliBytes + value.brotliBytes }),
    { bytes: 0, gzipBytes: 0, brotliBytes: 0 });
    return { ...observed, loaded, totals: aggregate(loaded), initialTotals: aggregate(observed.initialLoaded),
      files: Object.fromEntries(loaded.map(file => [file, measure(files[file])])) };
  } finally { rmSync(folder, { recursive: true, force: true }); }
}
const rows = [];
for (const [icon, input] of Object.entries(inputs)) {
  const projected = renderSymbolModules(input);
  const before = { ...common, 'dist/ir/variation-runtime.js': previousRuntime, [`dist/symbols/${icon}.js`]: previousRender(input) };
  const after = { ...common, 'dist/ir/variation-runtime.js': actualRuntime,
    [`dist/symbols/${icon}.js`]: projected.symbol, [`dist/variations/${icon}.js`]: projected.variation, [`dist/ir/symbol-data/${icon}.js`]: projected.data };
  const consumers = {};
  for (const [name, [directory, expression]] of Object.entries(cases)) {
    const old = await consume(before, icon, 'symbols', expression), actual = await consume(after, icon, directory, expression);
    const normalize = value => name === 'sourceCaps' ? Object.fromEntries(Object.entries(value).filter(([key]) => key !== 'variation')) : name === 'sourceBoth'
      ? [value[0], Object.fromEntries(Object.entries(value[1]).filter(([key]) => key !== 'variation'))] : value;
    if (JSON.stringify(normalize(old.result)) !== JSON.stringify(actual.result)) throw new Error(`${icon}/${name}: behavior differs`);
    const withoutResult = ({ result: _result, ...measurement }) => measurement;
    consumers[name] = { baseline: withoutResult(old), actual: withoutResult(actual), resultEqual: true,
      ...(name.startsWith('source') && name !== 'sourceGlyph' ? { intentionalContractDelta: 'source capabilities omit opt-in variation' } : {}) };
  }
  const baselineNative = native(before, icon, 'symbols'), sourceNative = native(after, icon, 'symbols');
  const variableNative = native(after, icon, 'variations');
  if (!variableNative.identity || !variableNative.privateRefused || sourceNative.capabilityVariation || sourceNative.loaded.includes('dist/ir/variation-runtime.js')) throw new Error(`${icon}: native opt-in boundary failed`);
  rows.push({ icon, files: { baseline: Object.fromEntries(Object.entries(before).map(([file, source]) => [file, measure(source)])),
    actual: Object.fromEntries(Object.entries(after).map(([file, source]) => [file, measure(source)])) }, consumers,
    native: { baselineUnified: baselineNative, source: sourceNative, variableAndSource: variableNative },
    declarations: { baselineUnified: measure((await import(`data:text/javascript;base64,${Buffer.from(previousModule).toString('base64')}`)).symbolModuleDeclaration(icon, true)),
      source: measure(symbolModuleDeclaration(icon)), variable: measure(variationModuleDeclaration(icon)) },
    masters: Object.fromEntries(['outline','filled'].map(variant => [variant, { masterSha256: input.source[variant].provenance.author.masterSha256, geometrySha256: input.variation[variant].geometrySha256 }])) });
}
const report = { baseline, candidateEmitterSha256: sha256(readFileSync(join(root, 'scripts/lib/symbol-modules.js'))),
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  scope: 'two families/four masters; selective source bundles and real cold native loader graph; no full build/pack, published install, browser, timing or memory qualification',
  environment: { node: process.version, esbuild: esbuildVersion, fflate: JSON.parse(readFileSync(join(root, 'node_modules/fflate/package.json'), 'utf8')).version,
    brotli: process.versions.brotli, platform: process.platform, arch: process.arch, gzip: { level: 9, mtime: 0 }, brotliQuality: 11 }, rows };
if (process.argv[3]) writeFileSync(process.argv[3], `${JSON.stringify(report,null,2)}\n`);
for (const row of rows) console.log(JSON.stringify({ icon: row.icon,
  consumers: Object.fromEntries(Object.entries(row.consumers).map(([name, pair]) => [name, { baseline: [pair.baseline.bytes,pair.baseline.gzipBytes,pair.baseline.brotliBytes], actual: [pair.actual.bytes,pair.actual.gzipBytes,pair.actual.brotliBytes] }])),
  native: Object.fromEntries(Object.entries(row.native).map(([name, value]) => [name, { loaded:value.loaded, totals:value.totals, identity:value.identity }])) }));
