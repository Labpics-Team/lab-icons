#!/usr/bin/env node
/** Узкий source-пакет: никакой corpus/browser или cold benchmark. */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { gzipSync } from 'fflate';
import { build, version as esbuildVersion } from 'esbuild';
import { authoredSymbolPayloads } from '../../test/helpers/authored-symbol-payload.js';
import { compactDataLiteral, literalKey } from '../lib/generated-module.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const baselineSha = 'ebec9e952c795d63c7d6c8c8e72bd44cda099ba3';
const baselineText = execFileSync('git', ['show', `${baselineSha}:scripts/lib/symbol-modules.js`], { cwd: root, windowsHide: true, encoding: 'utf8' });
const previous = await import(`data:text/javascript;base64,${Buffer.from(baselineText
  .replaceAll("'./generated-module.js'", JSON.stringify(new URL('../lib/generated-module.js', import.meta.url).href))
  .replaceAll("'./author-variation.js'", JSON.stringify(new URL('../lib/author-variation.js', import.meta.url).href))).toString('base64')}`);
const inputs = await authoredSymbolPayloads(['notifications', 'notifications-unread']);
if (process.argv.includes('--inspect')) {
  for (const [icon, input] of Object.entries(inputs)) {
    console.log(JSON.stringify({ icon, source: Object.fromEntries(Object.entries(input.source).map(([variant, source]) =>
      [variant, { ...source, d: source.d.length, svg: source.svg.length,
        parts: source.parts.map(part => ({ ...part, d: part.d.length })) }])), capabilities: input.capabilities }, null, 2));
  }
}

const measure = value => ({ bytes: Buffer.byteLength(value), gzipBytes: gzipSync(Buffer.from(value), { level: 9, mtime: 0 }).length,
  sha256: createHash('sha256').update(value).digest('hex') });
const refTag = Symbol('build reference'), ref = value => ({ [refTag]: value });
const emit = value => value && typeof value === 'object' && Object.hasOwn(value, refTag) ? value[refTag]
  : Array.isArray(value) ? `[${value.map(emit).join(',')}]`
    : value !== null && typeof value === 'object' ? `{${Object.entries(value).map(([key, item]) => `${literalKey(key)}:${emit(item)}`).join(',')}}`
      : compactDataLiteral(value);

// Только закрытая схема проверенного build input. Размер helpers входит в consumer closure.
const sourceHelper = `
export function materializeSourceV1(icon,variant,file,parts,d,svg,author,anatomy){
  return {icon,variant,viewBox:[0,0,24,24],parts:parts.map(p=>({
    id:p[0],role:p[1],zIndex:p[2],d:p[3],fillRule:p[4],paint:{kind:"fill",fill:"currentColor"},
    anchor:p[5],anchorSource:p[6],topologySignature:p[7],morphGroup:null,
    provenance:{kind:"source",identity:p[8],file,sourceFingerprint:p[9],artifactFingerprint:p[9]}
  })),d,svg,composition:{kind:"layers"},provenance:{kind:"source",file,anatomy,author}};
}`;
const denseSourceHelper = `
export function materializeSourceV1(icon,variant,file,parts,d,svg,author,anatomy){
  return {icon,variant,viewBox:[0,0,24,24],parts:parts.map(([id,role,zIndex,d,fillRule,anchor,anchorSource,topologySignature,identity,fingerprint])=>({
    id,role,zIndex,d,fillRule,paint:{kind:"fill",fill:"currentColor"},anchor,anchorSource,topologySignature,morphGroup:null,
    provenance:{kind:"source",identity,file,sourceFingerprint:fingerprint,artifactFingerprint:fingerprint}
  })),d,svg,composition:{kind:"layers"},provenance:{kind:"source",file,anatomy,author}};
}`;
const receiptsHelper = `
export function materializeAuthorV1(fileKey,version,p){return {kind:"figma",fileKey,version,nodeId:p[0],nodeSha256:p[1],masterSha256:p[2],normalizedSha256:p[3],pathFingerprintSha256:p[4]};}
export function materializeAnatomyV1(annotationSha256,author){return {version:1,annotationSha256,masterSha256:author.masterSha256,pathFingerprintSha256:author.pathFingerprintSha256};}
`;
const motionHelper = `
export function materializeTranslationCycleV1(icon,partIds,partId,meaning,amplitude){return {
state:"gesture-ready",partIds,tracks:[{id:"translate.x."+partId,kind:"translate",partIds:[partId],axis:"x",unit:"viewBox"}],
gestures:[{id:icon+".ring",kind:"cycle",meaning,partIds:[partId],progress:"normalized-0-to-1",restProgress:0,tracks:[{
partId,kind:"translate",axis:"x",unit:"viewBox",interpolation:"linear",stops:[{at:0,value:0},{at:0.2,value:amplitude},{at:0.4,value:-amplitude},{at:0.6,value:amplitude/2},{at:0.8,value:-amplitude/2},{at:1,value:0}]
}]}],adapters:{lottie:"lottie-web-svg-5.13",sfSymbols:"not-exported"}};}
`;

function stringExpression(value, paths) {
  let fragments = [{ value }];
  for (const [path, name] of paths) fragments = fragments.flatMap(fragment => fragment.name ? [fragment]
    : fragment.value.split(path).flatMap((value, index) => index ? [{ name }, { value }] : [{ value }]));
  return fragments.filter(fragment => fragment.name || fragment.value).map(fragment => fragment.name ?? compactDataLiteral(fragment.value)).join('+') || '""';
}

function sourcePacketModule(input, options) {
  const variants = ['outline', 'filled'], declarations = [], paths = [], sources = [], caps = [];
  for (const variant of variants) {
    const source = input.source[variant], capability = JSON.parse(JSON.stringify(input.capabilities[variant]));
    assert.deepEqual(Object.keys(source), ['icon', 'variant', 'viewBox', 'parts', 'd', 'svg', 'composition', 'provenance']);
    assert.deepEqual(source.viewBox, [0, 0, 24, 24]); assert.deepEqual(source.composition, { kind: 'layers' });
    assert.deepEqual(Object.keys(source.provenance), ['kind', 'file', 'anatomy', 'author']);
    const author = source.provenance.author, anatomy = source.provenance.anatomy;
    assert.deepEqual(author, capability.author); assert.deepEqual(anatomy, capability.anatomy);
    const authorName = `${variant}Author`, anatomyName = `${variant}Anatomy`;
    declarations.push(options.receipts
      ? `const ${authorName}=/* @__PURE__ */ materializeAuthorV1(${emit(author.fileKey)},${emit(author.version)},${emit([author.nodeId, author.nodeSha256, author.masterSha256, author.normalizedSha256, author.pathFingerprintSha256])});`
      : `const ${authorName}=${emit(author)};`);
    declarations.push(options.receipts
      ? `const ${anatomyName}=/* @__PURE__ */ (()=>materializeAnatomyV1(${emit(anatomy.annotationSha256)},${authorName}))();`
      : `const ${anatomyName}=${emit(anatomy)};`);
    capability.author = ref(authorName); capability.anatomy = ref(anatomyName);
    const names = source.parts.map((part, index) => [part.d, `${variant}Path${index}`]);
    paths.push(...names.map(([path, name]) => `const ${name}=${emit(path)};`));
    const parts = source.parts.map((part, index) => {
      assert.deepEqual(Object.keys(part), ['id', 'role', 'zIndex', 'd', 'fillRule', 'paint', 'anchor', 'anchorSource', 'topologySignature', 'morphGroup', 'provenance']);
      assert.deepEqual(part.paint, { kind: 'fill', fill: 'currentColor' }); assert.equal(part.morphGroup, null);
      assert.deepEqual(Object.keys(part.provenance), ['kind', 'identity', 'file', 'sourceFingerprint', 'artifactFingerprint']);
      assert.equal(part.provenance.kind, 'source'); assert.equal(part.provenance.file, source.provenance.file);
      assert.equal(part.provenance.sourceFingerprint, part.provenance.artifactFingerprint);
      return [part.id, part.role, part.zIndex, ref(names[index][1]), part.fillRule, part.anchor, part.anchorSource,
        part.topologySignature, part.provenance.identity, part.provenance.sourceFingerprint];
    });
    sources.push(`const ${variant}Source=/* @__PURE__ */ (()=>materializeSourceV1(${emit(input.icon)},${emit(variant)},${emit(source.provenance.file)},${emit(parts)},${stringExpression(source.d,names)},${stringExpression(source.svg,names)},${authorName},${anatomyName}))();`);
    if (options.motion) {
      const motion = input.capabilities[variant].motion, gesture = motion.gestures[0], track = gesture.tracks[0];
      assert.equal(motion.gestures.length, 1); assert.equal(gesture.tracks.length, 1);
      const amplitude = track.stops[1].value;
      capability.motion = ref(`/* @__PURE__ */ materializeTranslationCycleV1(${emit(input.icon)},${emit(motion.partIds)},${emit(track.partId)},${emit(gesture.meaning)},${emit(amplitude)})`);
    }
    caps.push(emit(capability));
  }
  const imported = ['createCompiledGlyph', 'createCompiledCapabilities', 'materializeSourceV1',
    ...(options.receipts ? ['materializeAuthorV1', 'materializeAnatomyV1'] : []),
    ...(options.motion ? ['materializeTranslationCycleV1'] : [])];
  return [`import {${imported.join(',')}} from '../ir/symbol-runtime.js';`, ...paths,
    ...variants.map(variant => `export const ${variant}=${emit(input.staticSvg[variant])};`), ...declarations, ...sources,
    `export const glyph=/* @__PURE__ */ createCompiledGlyph(${emit(input.icon)},{outline:outlineSource,filled:filledSource});`,
    `export const glyphCapabilities=/* @__PURE__ */ createCompiledCapabilities({outline:${caps[0]},filled:${caps[1]}});`, ''].join('\n');
}

async function runtime(entry, external = []) {
  const result = await build({ absWorkingDir: root, entryPoints: [join(root, entry)], outfile: join(root, '.source-packet-runtime.js'),
    bundle: true, charset: 'utf8', external, format: 'esm', legalComments: 'none', logLevel: 'silent',
    minify: false, minifyWhitespace: true, platform: 'browser', sourcemap: false, write: false, metafile: true,
    target: 'es2022', treeShaking: true });
  const modules = Object.entries(Object.values(result.metafile.outputs)[0].inputs).filter(([, input]) => input.bytesInOutput > 0).map(([name]) => name).sort();
  return modules.map(name => `// ${name}\n`).join('') + result.outputFiles[0].text;
}

async function consume(files, icon, expression) {
  const result = await build({ stdin: { contents: `import {glyph,glyphCapabilities,outline,filled} from './dist/symbols/${icon}.js';export const result=${expression};`, resolveDir: root },
    bundle: true, write: false, minify: true, platform: 'browser', format: 'esm', target: 'es2022', treeShaking: true,
    logLevel: 'silent', metafile: true, plugins: [{ name: 'whole-source-packet', setup(plugin) {
      plugin.onResolve({ filter: /^\.\.?\// }, args => {
        const file = (args.importer ? join(dirname(args.importer), args.path) : args.path.slice(2)).replaceAll('\\', '/');
        if (Object.hasOwn(files, file)) return { path: file, namespace: 'packet', sideEffects: false };
      });
      plugin.onLoad({ filter: /.*/, namespace: 'packet' }, args => ({ contents: files[args.path], loader: 'js' }));
    } }] });
  const text = result.outputFiles[0].text, observed = (await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`)).result;
  return { ...measure(text), observed, graph: Object.fromEntries(Object.entries(Object.values(result.metafile.outputs)[0].inputs)
    .filter(([, value]) => value.bytesInOutput > 0).map(([file, value]) => [file.replace(/^packet:/, ''), value.bytesInOutput])) };
}

if (!process.argv.includes('--inspect')) {
  const common = { 'dist/ir/request.js': await runtime('src/ir/request.ts'),
    'dist/ir/author-request-runtime.js': await runtime('src/ir/author-request-runtime.ts', ['./request.js']),
    'dist/ir/symbol-runtime.js': await runtime('src/ir/symbol-runtime.ts', ['./request.js', './author-request-runtime.js']) };
  const report = { capturedAt: new Date().toISOString(), baselineSha, baselineEmitterSha256: measure(baselineText).sha256,
    environment: { node: process.version, esbuild: esbuildVersion, platform: process.platform, gzip: { level: 9, mtime: 0 } },
    experimentSha256: measure(readFileSync(fileURLToPath(import.meta.url))).sha256, rows: [] };
  for (const [icon, input] of Object.entries(inputs)) {
    const baseline = previous.renderSymbolModules(input).symbol, cases = { glyph: 'glyph()', caps: 'glyphCapabilities()', both: '[glyph(),glyphCapabilities()]', outline: 'outline', filled: 'filled' };
    const prior = {}, row = { icon, baseline: { module: measure(baseline), consumers: {} }, alternatives: {} };
    for (const [name, expression] of Object.entries(cases)) {
      const { observed, ...measurement } = await consume({ ...common, [`dist/symbols/${icon}.js`]: baseline }, icon, expression);
      prior[name] = observed; row.baseline.consumers[name] = measurement;
    }
    for (const [name, options] of Object.entries({ wholeSource: {}, wholeMetadata: { receipts: true }, wholeSemantic: { receipts: true, motion: true },
      sourceAndCycle: { motion: true }, denseSourceAndCycle: { motion: true, dense: true } })) {
      const module = sourcePacketModule(input, options), helpers = (options.dense ? denseSourceHelper : sourceHelper) + (options.receipts ? receiptsHelper : '') + (options.motion ? motionHelper : '');
      const files = { ...common, 'dist/ir/symbol-runtime.js': common['dist/ir/symbol-runtime.js'] + helpers, [`dist/symbols/${icon}.js`]: module };
      const entry = { module: measure(module), helperCost: measure(helpers), consumers: {}, regressions: [] };
      for (const [consumer, expression] of Object.entries(cases)) {
        const { observed, ...actual } = await consume(files, icon, expression);
        assert.equal(JSON.stringify(observed), JSON.stringify(prior[consumer]), `${icon}/${name}/${consumer}: exact JSON/key order`);
        const old = row.baseline.consumers[consumer]; entry.consumers[consumer] = actual;
        if (actual.bytes > old.bytes || actual.gzipBytes > old.gzipBytes) entry.regressions.push(consumer);
      }
      row.alternatives[name] = entry;
    }
    report.rows.push(row);
    console.log(JSON.stringify({ icon, baseline: row.baseline.module, alternatives: Object.fromEntries(Object.entries(row.alternatives)
      .map(([name, value]) => [name, { module: value.module, helperCost: value.helperCost, glyph: value.consumers.glyph, caps: value.consumers.caps, regressions: value.regressions }])) }));
  }
  if (process.argv[2]) writeFileSync(process.argv[2], `${JSON.stringify(report, null, 2)}\n`);
}
