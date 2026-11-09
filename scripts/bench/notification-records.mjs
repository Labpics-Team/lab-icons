#!/usr/bin/env node
/** Четыре masters: конечные controls records и printers, без product mutation. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { build, transformSync, version as esbuildVersion } from 'esbuild';
import { gzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import { compactDataLiteral, jsonDataLiteral, literalKey } from '../lib/generated-module.js';
import { renderSymbolModules } from '../lib/symbol-modules.js';
import { authoredSymbolPayloads } from '../../test/helpers/authored-symbol-payload.js';

const root = fileURLToPath(new URL('../..', import.meta.url)), refTag = Symbol('build reference');
const ref = value => ({ [refTag]: value });
const isRef = value => value !== null && typeof value === 'object' && Object.hasOwn(value, refTag);
const emit = value => isRef(value) ? value[refTag] : Array.isArray(value) ? `[${value.map(emit).join(',')}]`
  : value !== null && typeof value === 'object' ? `{${Object.entries(value).map(([key, item]) => `${literalKey(key)}:${emit(item)}`).join(',')}}`
    : compactDataLiteral(value);
const signature = value => isRef(value) ? `ref:${value[refTag]}` : Array.isArray(value) ? `array:${JSON.stringify(value.map(signature))}`
  : value !== null && typeof value === 'object' ? `object:${JSON.stringify(Object.entries(value).map(([key, item]) => [key, signature(item)]))}`
    : `scalar:${jsonDataLiteral(value)}`;

/** Постоянный body создаёт свежие records; параметры передают exact значения. */
function constructor(name, values, declarations) {
  const slots = [], scalarSlots = new Map();
  const template = group => {
    if (group.every(value => signature(value) === signature(group[0]))) return emit(group[0]);
    if (group.every(Array.isArray) && group.every(value => value.length === group[0].length)) {
      return `[${group[0].map((_, index) => template(group.map(value => value[index]))).join(',')}]`;
    }
    const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && !isRef(value);
    if (group.every(record) && group.every(value => JSON.stringify(Object.keys(value)) === JSON.stringify(Object.keys(group[0])))) {
      return `{${Object.keys(group[0]).map(key => `${literalKey(key)}:${template(group.map(value => value[key]))}`).join(',')}}`;
    }
    const scalar = group.every(value => value === null || typeof value !== 'object');
    const key = JSON.stringify(group.map(signature));
    if (scalar && scalarSlots.has(key)) return scalarSlots.get(key);
    const parameter = `p${slots.length}`;
    slots.push({ parameter, values: group });
    if (scalar) scalarSlots.set(key, parameter);
    return parameter;
  };
  const body = template(values);
  declarations.push(`const ${name}=(${slots.map(slot => slot.parameter).join(',')})=>(${body});`);
  return values.map((_, index) => ref(`/* @__PURE__ */ ${name}(${slots.map(slot => emit(slot.values[index])).join(',')})`));
}

function pathExpression(value, paths) {
  let fragments = [{ value }];
  for (const [path, name] of paths) fragments = fragments.flatMap(fragment => fragment.name ? [fragment]
    : fragment.value.split(path).flatMap((value, index) => index ? [{ name }, { value }] : [{ value }]));
  return fragments.filter(fragment => fragment.name || fragment.value).map(fragment => fragment.name ?? jsonDataLiteral(fragment.value)).join('+') || '""';
}

function project(input, options) {
  const data = JSON.parse(JSON.stringify(input)), declarations = [], metadata = [], strings = [];
  const variants = ['outline', 'filled'];
  for (const field of ['author', 'anatomy']) {
    const values = variants.map(variant => data.source[variant].provenance[field]);
    const constructions = options.receipts ? constructor(field === 'author' ? 'A' : 'N', values, declarations) : values;
    for (const [index, variant] of variants.entries()) {
      assert.equal(JSON.stringify(values[index]), JSON.stringify(data.capabilities[variant][field]));
      const name = `${variant}${field === 'author' ? 'Author' : 'Anatomy'}`;
      metadata.push(`const ${name}=${emit(constructions[index])};`);
      data.source[variant].provenance[field] = ref(name); data.capabilities[variant][field] = ref(name);
    }
  }
  for (const variant of variants) {
    const source = data.source[variant], paths = source.parts.map((part, index) => [part.d, `${variant}Path${index}`]);
    if (options.partProvenance) {
      const file = source.provenance.file, reference = `${variant}File`;
      strings.push(`const ${reference}=${jsonDataLiteral(file)};`);
      source.provenance.file = ref(reference);
      const keys = ['kind', 'identity', 'file', 'sourceFingerprint', 'artifactFingerprint'];
      for (const part of source.parts) {
        const provenance = part.provenance;
        if (JSON.stringify(Object.keys(provenance)) !== JSON.stringify(keys) || provenance.kind !== 'source' ||
          provenance.identity !== 'declared' || provenance.file !== file ||
          provenance.sourceFingerprint !== provenance.artifactFingerprint ||
          typeof provenance.sourceFingerprint !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(provenance.sourceFingerprint)) continue;
        const value = options.prefix ? provenance.sourceFingerprint.slice(7) : provenance.sourceFingerprint;
        part.provenance = ref(`/* @__PURE__ */ V(${reference},${jsonDataLiteral(value)})`);
      }
    }
    for (const [value, name] of paths) {
      const start = input.staticSvg[variant].indexOf(value);
      strings.push(`const ${name}=${options.slices && start >= 0
        ? `/* @__PURE__ */ (()=>${variant}.slice(${start},${start + value.length}))()` : jsonDataLiteral(value)};`);
    }
    source.parts.forEach((part, index) => { part.d = ref(`${variant}Path${index}`); });
    source.d = ref(pathExpression(source.d, paths)); source.svg = ref(pathExpression(source.svg, paths));
  }
  if (options.partProvenance) declarations.push(options.prefix
    ? 'const V=(file,hash)=>{const fingerprint="sha256:"+hash;return {kind:"source",identity:"declared",file,sourceFingerprint:fingerprint,artifactFingerprint:fingerprint};};'
    : 'const V=(file,fingerprint)=>({kind:"source",identity:"declared",file,sourceFingerprint:fingerprint,artifactFingerprint:fingerprint});');
  if (options.omitPartProvenance) for (const variant of variants) for (const part of data.source[variant].parts) delete part.provenance;
  if (options.parts) {
    const parts = variants.flatMap(variant => data.source[variant].parts), calls = constructor('P', parts, declarations);
    let index = 0;
    for (const variant of variants) data.source[variant].parts = data.source[variant].parts.map(() => calls[index++]);
  }
  const source = options.source ? constructor('S', variants.map(variant => data.source[variant]), declarations) : variants.map(variant => data.source[variant]);
  const caps = options.caps ? constructor('C', variants.map(variant => data.capabilities[variant]), declarations) : variants.map(variant => data.capabilities[variant]);
  const sourceLines = variants.flatMap((variant, index) => options.named
    ? [`const ${variant}Materialize=()=>(${emit(source[index])});`, `const ${variant}Source=/* @__PURE__ */ ${variant}Materialize();`]
    : [`const ${variant}Source=/* @__PURE__ */ (()=>(${emit(source[index])}))();`]);
  return [
    "import {createCompiledGlyph,createCompiledCapabilities} from '../ir/symbol-runtime.js';",
    ...(options.slices ? [] : strings), ...variants.map(variant => `export const ${variant}=${jsonDataLiteral(input.staticSvg[variant])};`),
    ...(options.slices ? strings : []),
    ...declarations, ...metadata,
    ...sourceLines,
    `export const glyph=/* @__PURE__ */ createCompiledGlyph(${jsonDataLiteral(input.icon)},{outline:outlineSource,filled:filledSource});`,
    `export const glyphCapabilities=/* @__PURE__ */ createCompiledCapabilities({outline:${emit(caps[0])},filled:${emit(caps[1])}});`, '',
  ].join('\n');
}

const measure = text => ({ bytes: Buffer.byteLength(text), gzipBytes: gzipSync(Buffer.from(text), { level: 9, mtime: 0 }).length,
  sha256: createHash('sha256').update(text).digest('hex') });
const receiptFlag = process.argv.indexOf('--receipt');
if (receiptFlag >= 0) assert.ok(process.argv[receiptFlag + 1], 'Нужен path после --receipt.');
const receiptBytes = readFileSync(receiptFlag >= 0 ? resolve(process.argv[receiptFlag + 1])
  : join(root, '../annulus-consumer-evidence-20261102/schema6-8fbb434-report.json'));
const receiptSha256 = 'b63ab4be495f7a8b866035ae24b3c25ea33211c0c10be466163880e1413e4d91';
assert.equal(measure(receiptBytes).sha256, receiptSha256);
const receipt = JSON.parse(receiptBytes);
const report = (rows, scope, extra = {}) => ({
  capturedAt: new Date().toISOString(),
  sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
  emitterSha256: measure(readFileSync(join(root, 'scripts/lib/symbol-modules.js'))).sha256,
  experimentSha256: measure(readFileSync(fileURLToPath(import.meta.url))).sha256,
  receiptSha256, environment: { node: process.version, esbuild: esbuildVersion,
    fflate: JSON.parse(readFileSync(join(root, 'node_modules/fflate/package.json'))).version, gzip: { level: 9, mtime: 0 } },
  scope, ...extra, rows,
});
if (process.argv.includes('--terser-module-only')) {
  const entryFlag = process.argv.indexOf('--terser-entry');
  assert.ok(entryFlag >= 0 && process.argv[entryFlag + 1], 'Нужен --terser-entry вне product dependencies.');
  const entry = resolve(process.argv[entryFlag + 1]), terserPackage = JSON.parse(readFileSync(join(dirname(entry), 'package.json')));
  assert.equal(terserPackage.version, '5.51.2');
  const { minify } = await import(pathToFileURL(entry).href);
  const inputs = await authoredSymbolPayloads(['notifications', 'notifications-unread']), rows = [];
  for (const [icon, input] of Object.entries(inputs)) {
    const alternatives = {};
    for (const [name, options] of Object.entries({ current: null, parts: { parts: true }, sourceAndParts: { parts: true, source: true },
      slices: { slices: true }, slicesParts: { slices: true, parts: true }, slicesSourceParts: { slices: true, parts: true, source: true },
      all: { parts: true, source: true, receipts: true, caps: true }, slicesAll: { slices: true, parts: true, source: true, receipts: true, caps: true },
      partProvenance: { partProvenance: true }, partProvenancePrefix: { partProvenance: true, prefix: true },
      partProvenanceParts: { partProvenance: true, parts: true }, partProvenancePrefixParts: { partProvenance: true, prefix: true, parts: true } })) {
      const source = options ? project(input, options) : renderSymbolModules(input).symbol;
      for (const ascii_only of [false, true]) for (const passes of name === 'current' ? [0, 1, 3] : [0]) {
        const { code } = await minify(source, { module: true, compress: passes ? { passes } : false, mangle: true,
          format: { preserve_annotations: true, comments: false, ascii_only, inline_script: false } });
        const label = `${name}${ascii_only ? 'Ascii' : ''}${passes ? `Compress${passes}` : ''}`,
          item = { ...measure(code), pure: (code.match(/__PURE__/g) ?? []).length };
        alternatives[label] = item;
        console.log(JSON.stringify({ icon, name: label, ...item }));
      }
    }
    const source = renderSymbolModules(input).symbol, groups = { prefix: [], paths: [], static: [], metadata: [], sources: [], glyph: [], caps: [] };
    for (const line of source.split('\n').filter(Boolean)) {
      const key = /^const (outline|filled)Path/.test(line) ? 'paths' : /^export const (outline|filled) =/.test(line) ? 'static'
        : /^const (outline|filled)(Author|Anatomy) =/.test(line) ? 'metadata' : /^const (outline|filled)Source =/.test(line) ? 'sources'
          : /^export const glyph =/.test(line) ? 'glyph' : /^export const glyphCapabilities =/.test(line) ? 'caps' : 'prefix';
      groups[key].push(line);
    }
    const ordering = [];
    for (const order of [['paths', 'static', 'metadata'], ['paths', 'metadata', 'static'], ['static', 'paths', 'metadata'],
      ['static', 'metadata', 'paths'], ['metadata', 'static', 'paths'], ['metadata', 'paths', 'static']]) for (const earlyCaps of [false, true]) {
      const declarations = order.flatMap(key => [...groups[key], ...(earlyCaps && key === 'metadata' ? groups.caps : [])]);
      const text = [...groups.prefix, ...declarations, ...groups.sources, ...groups.glyph, ...(earlyCaps ? [] : groups.caps), ''].join('\n');
      if (order.join(',') === 'paths,static,metadata' && !earlyCaps) assert.equal(text, source);
      const { code } = await minify(text, { module: true, compress: false, mangle: true,
        format: { preserve_annotations: true, comments: false, ascii_only: true, inline_script: false } });
      ordering.push({ order, earlyCaps, original: measure(text), terser: measure(code) });
    }
    const omitted = project(input, { omitPartProvenance: true }), printedOmission = (await minify(omitted,
      { module: true, compress: false, mangle: true,
        format: { preserve_annotations: true, comments: false, ascii_only: true, inline_script: false } })).code;
    rows.push({ icon, baseline: measure(source), ceilings:
      (icon === 'notifications' ? { bytes: 23951, gzipBytes: 4165 } : { bytes: 30360, gzipBytes: 5034 }), alternatives, ordering,
      deliberateContractViolation: { missingRequiredField: 'GlyphPart.provenance', candidate: false,
        original: measure(omitted), terser: measure(printedOmission) } });
  }
  if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(report(rows,
    'Только module sizes; Terser preserve_annotations, без consumer/native/cold qualification.',
    { minifier: { name: terserPackage.name, version: terserPackage.version, passes: [0, 1, 3], mangle: true,
      format: { preserve_annotations: true, comments: false, ascii_only: [false, true], inline_script: false } } }), null, 2)}\n`);
  process.exit(0);
}
async function runtime(entry, external = []) {
  const result = await build({ absWorkingDir: root, entryPoints: [join(root, entry)], outfile: join(root, '.notification-runtime.js'),
    bundle: true, charset: 'utf8', external, format: 'esm', legalComments: 'none', minify: false, minifyWhitespace: true,
    platform: 'browser', write: false, metafile: true, target: 'es2022', treeShaking: true, logLevel: 'silent' });
  const modules = Object.entries(Object.values(result.metafile.outputs)[0].inputs).filter(([, item]) => item.bytesInOutput > 0).map(([file]) => file).sort();
  return modules.map(file => `// ${file}\n`).join('') + result.outputFiles[0].text;
}
const common = { 'dist/ir/request.js': await runtime('src/ir/request.ts'),
  'dist/ir/author-request-runtime.js': await runtime('src/ir/author-request-runtime.ts', ['./request.js']),
  'dist/ir/symbol-runtime.js': await runtime('src/ir/symbol-runtime.ts', ['./request.js', './author-request-runtime.js']) };
for (const [file, text] of Object.entries(common)) assert.equal(measure(text).sha256, receipt.artifacts[file].sha256);
async function consume(module, icon, expression) {
  const files = { ...common, [`dist/symbols/${icon}.js`]: module };
  const output = await build({ stdin: { contents: `import {glyph,glyphCapabilities,outline,filled} from './dist/symbols/${icon}.js';export const result=${expression};`, resolveDir: root },
    bundle: true, write: false, minify: true, treeShaking: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'notification-record-control', setup(plugin) {
      plugin.onResolve({ filter: /^\.\.?\// }, args => {
        const path = (args.importer ? join(dirname(args.importer), args.path) : args.path.slice(2)).replaceAll('\\', '/');
        if (Object.hasOwn(files, path)) return { path, namespace: 'projection', sideEffects: false };
      });
      plugin.onLoad({ filter: /.*/, namespace: 'projection' }, args => ({ contents: files[args.path], loader: 'js' }));
    } }] });
  const text = output.outputFiles[0].text, observed = (await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`)).result;
  return { ...measure(text), observed };
}
const inputs = await authoredSymbolPayloads(['notifications', 'notifications-unread']), rows = [];
const cases = { glyph: 'glyph()', caps: 'glyphCapabilities()', both: '[glyph(),glyphCapabilities()]', outline: 'outline', filled: 'filled' };
const printer = process.argv.includes('--printer');
for (const [icon, input] of Object.entries(inputs)) {
  const before = renderSymbolModules(input).symbol, baseline = {};
  for (const [name, expression] of Object.entries(cases)) baseline[name] = await consume(before, icon, expression);
  const alternatives = {};
  for (const [name, options] of Object.entries(printer ? { named: { named: true }, namedParts: { named: true, parts: true },
    namedSlices: { named: true, slices: true }, namedSlicesParts: { named: true, slices: true, parts: true } }
    : { caps: { caps: true }, receipts: { receipts: true }, parts: { parts: true },
    sourceAndParts: { source: true, parts: true }, all: { source: true, parts: true, caps: true, receipts: true },
    slices: { slices: true }, slicesParts: { slices: true, parts: true }, slicesAll: { slices: true, parts: true, source: true, caps: true, receipts: true },
    partProvenance: { partProvenance: true }, partProvenancePrefix: { partProvenance: true, prefix: true },
    partProvenanceParts: { partProvenance: true, parts: true }, partProvenancePrefixParts: { partProvenance: true, prefix: true, parts: true },
    omittedPartProvenance: { omitPartProvenance: true } })) {
    const constructed = project(input, options);
    for (const minify of [false, true]) {
      const text = minify ? transformSync(constructed, { minifyIdentifiers: true, minifyWhitespace: false, minifySyntax: printer,
        charset: 'utf8', legalComments: 'none', format: 'esm', target: 'es2022' }).code : constructed;
      const consumers = {}, regressions = [], semanticMismatches = [];
      for (const [consumer, expression] of Object.entries(cases)) {
        const actual = await consume(text, icon, expression), previous = baseline[consumer];
        const actualJson = JSON.stringify(actual.observed), previousJson = JSON.stringify(previous.observed);
        if (options.omitPartProvenance && ['glyph', 'both'].includes(consumer)) {
          assert.notEqual(actualJson, previousJson, `${icon}/${name}/${consumer}: omission falsifier не обнаружен`);
          semanticMismatches.push(consumer);
        } else assert.equal(actualJson, previousJson, `${icon}/${name}/${consumer}`);
        if (actual.bytes > previous.bytes || actual.gzipBytes > previous.gzipBytes) regressions.push(consumer);
        const { observed: _observed, ...measurement } = actual; consumers[consumer] = measurement;
      }
      alternatives[`${name}${minify ? 'Identifiers' : ''}`] = { module: measure(text), consumers, regressions,
        ...(options.omitPartProvenance && { candidate: false, semanticMismatches }) };
      console.log(JSON.stringify({ icon, name, minify, module: measure(text), regressions,
        consumers: Object.fromEntries(Object.entries(consumers).map(([name, value]) => [name, [value.bytes, value.gzipBytes]])) }));
    }
  }
  rows.push({ icon, baseline: measure(before), baselineConsumers: Object.fromEntries(Object.entries(baseline)
    .map(([name, { observed: _observed, ...measurement }]) => [name, measurement])), alternatives });
}
if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(report(rows,
  'Две семьи; exact JSON/key-order и пять selective consumers на pinned runtime. Без native/cold/fullbuild.',
  { mode: printer ? 'named-materializer-syntax-printer' : 'fresh-record-constructors',
    runtimeReceipts: Object.fromEntries(Object.entries(common).map(([file, code]) => [file, measure(code)])) }), null, 2)}\n`);
