#!/usr/bin/env node
/** Два annulus и один независимый dots control: байты/loader graph без fullbuild или timing. */
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
const baseline = process.argv[2];
if (!/^[a-f0-9]{40}$/.test(baseline ?? '')) throw new TypeError('Нужен полный baseline SHA.');
const hash = data => createHash('sha256').update(data).digest('hex');
const measure = text => { const data = Buffer.from(text); return { bytes: data.length,
  gzipBytes: gzipSync(data, { level: 9, mtime: 0 }).length,
  brotliBytes: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length, sha256: hash(data) }; };
const previousSource = execFileSync('git', ['show', `${baseline}:scripts/lib/symbol-modules.js`], { cwd: root, encoding: 'utf8', windowsHide: true });
const previousModule = previousSource.replace("'./generated-module.js'", JSON.stringify(new URL('../lib/generated-module.js', import.meta.url).href));
const { renderSymbolModule: previousRender } = await import(`data:text/javascript;base64,${Buffer.from(previousModule).toString('base64')}`);
async function runtime(entry, external = []) {
  const result = await build({ entryPoints: [join(root, entry)], bundle: true, write: false, platform: 'browser',
    format: 'esm', target: 'es2022', external, charset: 'utf8', logLevel: 'silent' });
  return result.outputFiles[0].text;
}
const common = { 'dist/ir/request.js': await runtime('src/ir/request.ts'),
  'dist/ir/symbol-runtime.js': await runtime('src/ir/symbol-runtime.ts', ['./request.js']) };
const actualFiles = { ...common, 'dist/ir/annulus-runtime.js': await runtime('src/ir/author-annulus-runtime.ts', ['./request.js', './symbol-runtime.js']),
  'dist/ir/variation-runtime.js': await runtime('src/ir/authored-variation.ts', ['./request.js', './symbol-runtime.js']) };
const inputs = await authoredSymbolPayloads(['plus-circle', 'minus-circle', 'ellipsis-horizontal']);
const baselineFiles = { ...common };
for (const [icon, input] of Object.entries(inputs)) {
  const projection = renderSymbolModules(input), law = input.variation.outline.law;
  baselineFiles[`dist/symbols/${icon}.js`] = previousRender(input);
  for (const [file, contents] of [[`dist/symbols/${icon}.js`, projection.symbol], [`dist/variations/${icon}.js`, projection.variation],
    [`dist/ir/symbol-data/${icon}.js`, projection.data], [`dist/symbols/${icon}.d.ts`, symbolModuleDeclaration(icon)],
    [`dist/variations/${icon}.d.ts`, variationModuleDeclaration(icon, law)]]) actualFiles[file] = contents;
}
async function consume(files, icon, directory, expression) {
  const output = await build({ stdin: { contents: `import {glyph,glyphCapabilities,outline} from './dist/${directory}/${icon}.js';export const result=${expression};`, resolveDir: root },
    bundle: true, write: false, minify: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent', metafile: true,
    plugins: [{ name: 'exact-emitted-packet', setup(plugin) {
      plugin.onResolve({ filter: /^\.\.?\// }, args => {
        const file = args.importer ? join(dirname(args.importer), args.path).replaceAll('\\', '/') : args.path.slice(2);
        if (Object.hasOwn(files, file)) return { path: file, namespace: 'packet', sideEffects: false };
      });
      plugin.onLoad({ filter: /.*/, namespace: 'packet' }, args => ({ contents: files[args.path], loader: 'js' }));
    } }] });
  const code = output.outputFiles[0].text, module = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
  return { ...measure(code), result: module.result,
    retainedFiles: Object.keys(Object.values(output.metafile.outputs)[0].inputs).sort() };
}
const temporary = mkdtempSync(join(tmpdir(), 'lab-icons-annulus-native-'));
const retained = process.argv[4];
function writePacket(folder, files) {
  for (const [file, contents] of Object.entries(files)) { const target = join(folder, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, contents); }
  writeFileSync(join(folder, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', exports: {
    './symbols/*': './dist/symbols/*.js', './variations/*': './dist/variations/*.js' } }));
}
function native(icon, directory) {
  const pkg = join(temporary, 'node_modules/@labpics/icons');
  const prefix = pathToFileURL(`${pkg}/`).href;
  const probe = join(temporary, 'probe.mjs');
  writeFileSync(probe, `import {registerHooks} from 'node:module';
    const loaded=[];const hook=registerHooks({load(url,context,nextLoad){const result=nextLoad(url,context);if(url.includes('/node_modules/@labpics/icons/'))loaded.push(url);return result;}});
    const target=await import('@labpics/icons/${directory}/${icon}');const initialLoaded=[...loaded];const glyph=target.glyph();
    const source=await import('@labpics/icons/symbols/${icon}');const identity=glyph===source.glyph()&&target.glyph({variant:'filled'})===source.glyph({variant:'filled'});
    let privateRefused=false;try{await import('@labpics/icons/ir/symbol-data/${icon}');}catch(error){privateRefused=error.code==='ERR_PACKAGE_PATH_NOT_EXPORTED';}
    hook.deregister();console.log(JSON.stringify({initialLoaded:initialLoaded.map(url=>url.slice(${JSON.stringify(prefix)}.length)),identity,privateRefused}));`);
  const result = JSON.parse(execFileSync(process.execPath, [probe], { cwd: temporary, encoding: 'utf8', windowsHide: true }));
  return { ...result, aggregate: result.initialLoaded.map(file => measure(actualFiles[file])).reduce((a, b) => ({
    bytes: a.bytes + b.bytes, gzipBytes: a.gzipBytes + b.gzipBytes, brotliBytes: a.brotliBytes + b.brotliBytes }), { bytes: 0, gzipBytes: 0, brotliBytes: 0 }) };
}
try {
  writePacket(join(temporary, 'node_modules/@labpics/icons'), actualFiles);
  const rows = [];
  for (const icon of ['plus-circle', 'minus-circle']) {
    const consumers = {};
    for (const [name, expression] of Object.entries({ sourceGlyph: 'glyph()', sourceCapabilities: 'glyphCapabilities()', sourceStatic: 'outline' })) {
      const before = await consume(baselineFiles, icon, 'symbols', expression), actual = await consume(actualFiles, icon, 'symbols', expression);
      if (JSON.stringify(before.result) !== JSON.stringify(actual.result)) throw new Error(`${icon}/${name}: source outcome changed`);
      const strip = ({ result: _result, ...value }) => value;
      consumers[name] = { baseline: strip(before), actual: strip(actual), resultEqual: true };
    }
    const variable = await consume(actualFiles, icon, 'variations', 'glyph({variation:{enclosureEmphasis:1.1}})');
    const expected = inputs[icon].source.outline;
    if (variable.result.parts[0].d !== expected.parts[0].d || !variable.result.parts[1].d.startsWith(inputs[icon].variation.outline.enclosure.outerD)) throw new Error(`${icon}: changed outer/content`);
    const { result: _result, ...variableMeasurement } = variable; consumers.variableGlyph = variableMeasurement;
    const source = native(icon, 'symbols'), variation = native(icon, 'variations');
    if (source.initialLoaded.some(file => /(?:annulus|variation)-runtime/.test(file)) || !variation.identity || !variation.privateRefused ||
        variation.initialLoaded.includes('dist/ir/variation-runtime.js')) throw new Error(`${icon}: native law/import boundary failed`);
    rows.push({ icon, consumers, native: { source, variation }, masterSha256: expected.provenance.author.masterSha256,
      geometrySha256: inputs[icon].variation.outline.geometrySha256 });
  }
  const dots = native('ellipsis-horizontal', 'variations');
  if (dots.initialLoaded.includes('dist/ir/annulus-runtime.js') || !dots.identity) throw new Error('dots imports annulus runtime');
  if (retained) { mkdirSync(retained); writePacket(retained, actualFiles); }
  const report = { baseline, producerHead: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
    emitterSha256: hash(readFileSync(join(root, 'scripts/lib/symbol-modules.js'))), capturedAt: new Date().toISOString(),
    scope: 'two annulus families/four masters and one dots control; exact emitted packets/browser bundles/cold native graphs; no package build/install, browser renders, timing, memory or optical acceptance',
    environment: { node: process.version, esbuild: esbuildVersion, platform: process.platform, arch: process.arch,
      fflate: JSON.parse(readFileSync(join(root, 'node_modules/fflate/package.json'))).version, brotli: process.versions.brotli, gzipLevel: 9, brotliQuality: 11 },
    artifacts: Object.fromEntries(Object.entries(actualFiles).map(([file, code]) => [file, measure(code)])), rows, dotsControl: dots, retained };
  if (process.argv[3]) writeFileSync(process.argv[3], `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report));
} finally { rmSync(temporary, { recursive: true, force: true }); }
