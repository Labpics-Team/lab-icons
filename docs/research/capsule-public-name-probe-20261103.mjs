import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';
import { gzipSync } from 'fflate';
import { authoredSymbolPayloads } from '../../scripts/lib/authored-symbol-payload.js';
import { renderSymbolModules } from '../../scripts/lib/symbol-modules.js';
import { projectAuthorCapsuleMotion, renderAuthorCapsuleMotionModule } from '../../scripts/lib/author-capsule-motion.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '../..');
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const hash = value => createHash('sha256').update(value).digest('hex');
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const rehash = packet => { const { packetSha256, ...program } = packet; packet.packetSha256 = hash(stableJSON(program)); };
const beforeSha = '0364b85';
const names = ['mic', 'mic-circle'];
const payloads = await authoredSymbolPayloads(names);
async function nativeSource(entry) {
  const result = await build({ entryPoints: [join(root, entry)], bundle: true, write: false,
    format: 'esm', platform: 'node', target: 'es2022', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}
const { createCompiledBodyWidthPreparation } = await nativeSource('src/ir/author-capsule-motion-runtime.ts');
const external = ['./request.js', './symbol-runtime.js', './author-request-runtime.js', './annulus-geometry-runtime.js'];
const original = execFileSync('git', ['show', `${beforeSha}:src/ir/author-capsule-runtime.ts`], { cwd: root, encoding: 'utf8' });
const originalPath = execFileSync('git', ['show', `${beforeSha}:src/ir/capsule-path.ts`], { cwd: root, encoding: 'utf8' });
const current = readFileSync(join(root, 'src/ir/author-capsule-runtime.ts'), 'utf8');
const records = [];
const completeClosures = [];
const common = {};
for (const [file, entry, external] of [
  ['dist/ir/request.js', 'src/ir/request.ts', []],
  ['dist/ir/symbol-runtime.js', 'src/ir/symbol-runtime.ts', ['./request.js', './author-request-runtime.js']],
  ['dist/ir/author-request-runtime.js', 'src/ir/author-request-runtime.ts', ['./request.js']],
]) {
  const result = await build({ entryPoints: [join(root, entry)], bundle: true, charset: 'utf8', legalComments: 'none',
    format: 'esm', platform: 'browser', target: 'es2022', write: false, minify: false, minifyWhitespace: true, external, logLevel: 'silent' });
  common[file] = result.outputFiles[0].text;
}
let reference;
const referenceFamilies = {};
for (const [label, source, keepNames] of [['before-global-keep', original, true], ['before-private-minify', original, false], ['candidate', current, false]]) {
  const produced = await build({ stdin: { contents: source, resolveDir: join(root, 'src/ir'), loader: 'ts' },
    bundle: true, charset: 'utf8', legalComments: 'none', format: 'esm', platform: 'browser', target: 'es2022', write: false, minify: true, keepNames, external, logLevel: 'silent',
    plugins: label === 'candidate' ? [] : [{ name: 'immutable-before-helper', setup(builder) {
      builder.onResolve({ filter: /^\.\/capsule-path\.js$/ }, () => ({ path: 'capsule-path', namespace: 'before' }));
      builder.onLoad({ filter: /.*/, namespace: 'before' }, () => ({ contents: originalPath, loader: 'ts' }));
    } }] });
  const text = produced.outputFiles[0].text;
  const result = await build({ stdin: { contents: "export { createCompiledCapsuleGlyph as factory } from 'compiled-capsule';", resolveDir: root },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, minify: true, metafile: true, logLevel: 'silent',
    external, plugins: [{ name: 'actual-compiled-capsule', setup(builder) {
      builder.onResolve({ filter: /^compiled-capsule$/ }, () => ({ path: 'capsule', namespace: 'compiled' }));
      builder.onLoad({ filter: /.*/, namespace: 'compiled' }, () => ({ contents: text, resolveDir: join(root, 'src/ir') }));
    } }] });
  const native = await build({ stdin: { contents: result.outputFiles[0].text, resolveDir: join(root, 'src/ir') },
    bundle: true, write: false, format: 'esm', platform: 'node', target: 'es2022', logLevel: 'silent' });
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(native.outputFiles[0].text).toString('base64')}`);
  const payload = structuredClone(payloads.mic);
  Object.freeze(payload.source);
  const glyph = runtime.factory('mic', payload.source, payload.variation);
  const values = [];
  for (const variant of ['outline', 'filled']) for (const width of [.8, .9, 1]) {
    values.push(glyph({ variant, variation: { bodyWidth: width } }));
  }
  reference ??= values;
  assert.deepEqual(values, reference);
  const descriptor = Object.getOwnPropertyDescriptor(glyph, 'name');
  assert.equal(glyph.length, 1); assert.equal(Object.hasOwn(glyph, 'prototype'), true);
  assert.equal(glyph.prototype.constructor, glyph);
  assert.equal(Reflect.construct(glyph, []), payload.source.outline);
  assert.equal(glyph.call(null), payload.source.outline); assert.equal(glyph.apply(null, []), payload.source.outline);
  const frozen = value => { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } };
  frozen(payload.source);
  assert.deepEqual(descriptor, { value: label === 'before-private-minify' ? '' : 'glyph', writable: false, enumerable: false, configurable: true });
  assert.throws(() => glyph({ axes: { weight: 1.1 } }), error => error.code === 'AUTHOR_PARITY_REQUIRED');
  assert.throws(() => glyph({ variation: { bodyWidth: .7 } }), error => error.code === 'VARIATION_OUTSIDE_DOMAIN' && error.name === 'AuthoredCapsuleVariationError');
  const bytes = result.outputFiles[0].contents;
  records.push({ label, sourceSha256: hash(source), pathSourceSha256: hash(label === 'candidate' ? readFileSync(join(root, 'src/ir/capsule-path.ts')) : originalPath), producedBytes: produced.outputFiles[0].contents.length,
    consumerBytes: bytes.length, consumerGzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).length,
    consumerSha256: hash(bytes), publicName: glyph.name, descriptor,
    namedPrivateLiterals: ['freezeTree', 'stableJSON', 'refuse', 'prepareCapsulePath', 'sha256Hex', 'assembleGlyphFrame', 'assembleGlyphLayers', 'assembleGlyphCompound', 'projectedContourAreas']
      .filter(name => result.outputFiles[0].text.includes(JSON.stringify(name))),
    retained: Object.entries(Object.values(result.metafile.outputs)[0].inputs).filter(([, value]) => value.bytesInOutput > 0).map(([name]) => name) });
  for (const icon of names) {
  const fresh = structuredClone(payloads[icon]), actual = runtime.factory(icon, fresh.source, fresh.variation);
  const familyValues = [];
  for (const variant of ['outline', 'filled']) for (const bodyWidth of [.8, .8000000000000002, .875, .9, .92, .9999999999999999, 1]) {
    const value = actual({ variant, variation: { bodyWidth } });
    familyValues.push(value);
    if (bodyWidth === 1) assert.equal(value, fresh.source[variant]);
  }
  referenceFamilies[icon] ??= familyValues;
  assert.deepEqual(familyValues, referenceFamilies[icon]);
  const invalidArray = []; invalidArray.variation = {};
  assert.throws(() => actual(invalidArray), error => error.name === 'GlyphModelError' && error.code === 'AUTHOR_VARIATION_UNSUPPORTED');
  for (const request of [null, [], false, 1, 'outline']) assert.throws(() => actual(request), TypeError);
  const modules = renderSymbolModules(payloads[icon]);
  const fullEntry = read('release/consumer-size-ratchet.json').scenarios[icon === 'mic' ? 'varied-microphone' : 'varied-microphone-circle'].entry;
  const files = { ...common, 'dist/ir/capsule-runtime.js': text,
    [`dist/ir/symbol-data/${icon}.js`]: modules.data, [`dist/variations/${icon}.js`]: modules.variation };
  const complete = await build({ stdin: { contents: fullEntry, resolveDir: root },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', write: false, minify: true, treeShaking: true, metafile: true,
    logLevel: 'silent', plugins: [{ name: 'one-real-family-production-closure', setup(builder) {
      builder.onResolve({ filter: /^@labpics\/icons\/variations\/(?:mic|mic-circle)$/ }, () => ({ path: `dist/variations/${icon}.js`, namespace: 'closure', sideEffects: false }));
      builder.onResolve({ filter: /^\.\.?\//, namespace: 'closure' }, args => {
        const file = join(dirname(args.importer), args.path).replaceAll('\\', '/');
        if (Object.hasOwn(files, file)) return { path: file, namespace: 'closure', sideEffects: false };
      });
      builder.onLoad({ filter: /.*/, namespace: 'closure' }, args => ({ contents: files[args.path] }));
    } }] });
  const completeBytes = complete.outputFiles[0].contents;
  completeClosures.push({ label, icon, entry: fullEntry, bytes: completeBytes.length, gzipBytes: gzipSync(completeBytes, { level: 9, mtime: 0 }).length,
    sha256: hash(completeBytes), graph: Object.fromEntries(Object.entries(Object.values(complete.metafile.outputs)[0].inputs)
      .filter(([, value]) => value.bytesInOutput > 0).map(([name, value]) => [name, value.bytesInOutput])) });
  }
}
const admissionControls = [];
const { createCompiledCapsuleGlyph } = await nativeSource('src/ir/author-capsule-runtime.ts');
const preparedArtifacts = [];
const emittedMotion = await build({ entryPoints: [join(root, 'src/ir/author-capsule-motion-runtime.ts')], bundle: true,
  charset: 'utf8', legalComments: 'none', write: false, minify: false, minifyWhitespace: true,
  format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
for (const icon of names) for (const exported of ['prepareBodyWidth', 'motionCapabilities']) {
  const packet = renderAuthorCapsuleMotionModule(projectAuthorCapsuleMotion(payloads[icon]));
  const output = await build({ stdin: { contents: `export { ${exported} } from 'prepared-packet';` },
    bundle: true, write: false, minify: true, treeShaking: true, metafile: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'production-prepared-packet', setup(builder) {
      builder.onResolve({ filter: /^prepared-packet$/ }, () => ({ path: 'packet', namespace: 'prepared', sideEffects: false }));
      builder.onResolve({ filter: /^\.\.\/ir\/capsule-motion-runtime\.js$/ }, () => ({ path: 'runtime', namespace: 'prepared', sideEffects: false }));
      builder.onLoad({ filter: /.*/, namespace: 'prepared' }, args => ({ contents: args.path === 'packet' ? packet : emittedMotion.outputFiles[0].text }));
    } }] });
  const text = output.outputFiles[0].text;
  assert.doesNotMatch(text, /createCompiledCapsuleGlyph|AuthoredCapsuleVariationError|createGlyphCompiler|glyphCapabilities/);
  const native = await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
  if (exported === 'prepareBodyWidth') {
    assert.ok(!text.includes(payloads[icon].variation.outline.geometrySha256));
    for (const variant of ['outline', 'filled']) {
      const value = createCompiledCapsuleGlyph(icon, payloads[icon].source, payloads[icon].variation)({ variant, variation: { bodyWidth: .9 } });
      assert.deepEqual(native.prepareBodyWidth(variant).prepared.sample(.9), { ok: true, bodyWidth: .9,
        d: value.composition.kind === 'compound' ? value.d : value.parts[payloads[icon].variation[variant].body.index].d });
    }
  } else {
    assert.ok(!text.includes(payloads[icon].source.outline.parts[1].d));
    assert.deepEqual(native.motionCapabilities().capabilities.formats, ['svg', 'prepared-width']);
  }
  const bytes = output.outputFiles[0].contents;
  preparedArtifacts.push({ icon, exported, bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).length,
    sha256: hash(bytes), isolatedRepresentation: true });
}
const mutations = [
  ['unsupported grammar', contour => { contour.commands = contour.commands.replace('C', 'A'); }],
  ['missing command', contour => { contour.commands = contour.commands.replace('C', ''); }],
  ['missing point', contour => { contour.points.pop(); contour.rates.pop(); }],
  ['extra point', contour => { contour.points.push(contour.points[0]); contour.rates.push(contour.rates[0]); }],
  ['missing rate', contour => { contour.rates.pop(); }],
  ['nonfinite rate', contour => { contour.rates[0] = Infinity; }],
  ['nonfinite coordinate', contour => { contour.points[0][0] = NaN; }],
  ['incomplete point', contour => { contour.points[0].pop(); }],
];
for (const [label, mutate] of mutations) {
  const input = structuredClone(payloads.mic), geometry = input.variation.outline;
  mutate(geometry.body.contours[0]);
  const { geometrySha256, packetSha256, ...program } = geometry;
  geometry.geometrySha256 = hash(stableJSON(program)); rehash(geometry);
  assert.throws(() => createCompiledCapsuleGlyph('mic', input.source, input.variation), error => error.name === 'AuthoredCapsuleVariationError' && error.code === 'VARIATION_SOURCE_MISMATCH');
  const motion = structuredClone(projectAuthorCapsuleMotion(payloads.mic).variants.outline.motion);
  mutate(motion.contours[0]); rehash(motion);
  assert.throws(() => createCompiledBodyWidthPreparation({ outline: motion }), TypeError);
  admissionControls.push(label);
}
for (const icon of names) {
  const input = structuredClone(payloads[icon]), glyph = createCompiledCapsuleGlyph(icon, input.source, input.variation);
  const packets = projectAuthorCapsuleMotion(payloads[icon]);
  const prepare = createCompiledBodyWidthPreparation(Object.fromEntries(Object.entries(packets.variants).map(([variant, value]) => [variant, value.motion])));
  for (const variant of ['outline', 'filled']) for (const bodyWidth of [.8, .8000000000000002, .9, .9999999999999999, 1]) {
    const value = glyph({ variant, variation: { bodyWidth } });
    assert.deepEqual(prepare(variant).prepared.sample(bodyWidth), { ok: true, bodyWidth,
      d: value.composition.kind === 'compound' ? value.d : value.parts[input.variation[variant].body.index].d });
  }
}
const report = { timestamp: new Date().toISOString(), node: process.version, esbuild: esbuildVersion,
  beforeSource: execFileSync('git', ['rev-parse', beforeSha], { cwd: root, encoding: 'utf8' }).trim(),
  scope: 'two actual author families/four masters; source-produced opt-in bundles/native controls; not packed package, browser or full release qualification',
  geometryControls: '28 real author poses deep-equal; fresh and partially frozen source trees frozen; call/apply/construct/prototype/length/default/axes/refusal controls passed',
  admissionControls, preparedControls: '20 finite optical neighbors match actual physical static path; defaults preserve identity', records, completeClosures, preparedArtifacts };
writeFileSync(join(root, 'docs/research/capsule-public-name-probe-20261103.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report));
