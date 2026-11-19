#!/usr/bin/env node
/** Две production семьи: bytes/native contracts, без browser/timing/full build. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { brotliCompressSync, constants } from 'node:zlib';
import { build, version as esbuildVersion } from 'esbuild';
import { gzipSync } from 'fflate';
import { authoredSymbolPayloads } from '../lib/authored-symbol-payload.js';
import { renderSymbolModules } from '../lib/symbol-modules.js';
import { measureArtifact } from '../check-package-size.js';

const root = fileURLToPath(new URL('../..', import.meta.url)), baselineSha = 'ebec9e952c795d63c7d6c8c8e72bd44cda099ba3';
const measure = value => ({ bytes: Buffer.byteLength(value), gzipBytes: gzipSync(Buffer.from(value), { level: 9, mtime: 0 }).length,
  brotliBytes: brotliCompressSync(Buffer.from(value), { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).byteLength,
  sha256: createHash('sha256').update(value).digest('hex') });
const temporary = mkdtempSync(join(root, '.source-packet-qualification-'));
const previousText = execFileSync('git', ['show', `${baselineSha}:scripts/lib/symbol-modules.js`], { cwd: root, windowsHide: true, encoding: 'utf8' });
const previousPath = join(temporary, 'baseline-emitter.mjs');
writeFileSync(previousPath, previousText.replaceAll("'./generated-module.js'", JSON.stringify(pathToFileURL(join(root, 'scripts/lib/generated-module.js')).href))
  .replaceAll("'./author-variation.js'", JSON.stringify(pathToFileURL(join(root, 'scripts/lib/author-variation.js')).href)));
const previous = await import(pathToFileURL(previousPath).href);

async function runtime(entry, external = []) {
  const result = await build({ absWorkingDir: root, entryPoints: [join(root, entry)], outfile: join(temporary, 'runtime.js'),
    bundle: true, charset: 'utf8', external, format: 'esm', legalComments: 'none', logLevel: 'silent', minify: false,
    minifyWhitespace: true, platform: 'browser', write: false, metafile: true, target: 'es2022', treeShaking: true });
  const modules = Object.entries(Object.values(result.metafile.outputs)[0].inputs).filter(([, data]) => data.bytesInOutput > 0).map(([file]) => file).sort();
  return modules.map(file => `// ${file}\n`).join('') + result.outputFiles[0].text;
}

const frozen = value => {
  if (value !== null && typeof value === 'object') { assert.ok(Object.isFrozen(value)); for (const child of Object.values(value)) frozen(child); }
};
async function native(files, input, label) {
  const target = join(temporary, label, input.icon);
  for (const [file, text] of Object.entries(files)) { const path = join(target, file); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, text); }
  const actual = await import(pathToFileURL(join(target, `dist/symbols/${input.icon}.js`)).href);
  for (const variant of ['outline', 'filled']) {
    const glyph = actual.glyph({ variant }), caps = actual.glyphCapabilities(variant);
    assert.equal(JSON.stringify(glyph), JSON.stringify(input.source[variant]));
    assert.equal(JSON.stringify(caps), JSON.stringify(input.capabilities[variant]));
    assert.equal(actual[variant], input.staticSvg[variant]);
    assert.equal(glyph.provenance.author, caps.author); assert.equal(glyph.provenance.anatomy, caps.anatomy);
    frozen(glyph); frozen(caps);
  }
  assert.equal(actual.glyph.name, 'glyph'); assert.equal(actual.glyphCapabilities.name, 'glyphCapabilities');
  assert.equal(actual.glyph(), actual.glyph()); assert.notEqual(actual.glyph(), actual.glyph({ variant: 'filled' }));
  assert.notEqual(actual.glyph().provenance.author, actual.glyph({ variant: 'filled' }).provenance.author);
  const request = { get variant() { assert.equal(this, request); return 'outline'; } };
  assert.equal(actual.glyph(request), actual.glyph());
  for (const request of [{ axes: { weight: 1 } }, { modelMode: 'allow-candidate' }]) {
    assert.throws(() => actual.glyph(request), error => error.code === 'AUTHOR_PARITY_REQUIRED');
  }
  assert.throws(() => actual.glyph({ variation: {} }), error => error.code === 'AUTHOR_VARIATION_UNSUPPORTED');
  return { exactJsonAndKeyOrder: true, frozenTrees: true, authorAnatomyAlias: true, independentVariants: true,
    defaultIdentity: true, nativeFunctionNames: true, getterReceiver: true, authorAndVariationRefusals: true };
}

async function consume(files, icon, expression) {
  const result = await build({ stdin: { contents: `import {glyph,glyphCapabilities,outline,filled} from './dist/symbols/${icon}.js';export const result=${expression};`, resolveDir: root },
    bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022', treeShaking: true,
    logLevel: 'silent', metafile: true, plugins: [{ name: 'exact-source-packet-closure', setup(plugin) {
      plugin.onResolve({ filter: /^\.\.?\// }, args => {
        const file = (args.importer ? join(dirname(args.importer), args.path) : args.path.slice(2)).replaceAll('\\', '/');
        if (Object.hasOwn(files, file)) return { path: file, namespace: 'qualified', sideEffects: false };
      });
      plugin.onLoad({ filter: /.*/, namespace: 'qualified' }, args => ({ contents: files[args.path], loader: 'js' }));
    } }] });
  const text = result.outputFiles[0].text, observed = (await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`)).result;
  return { ...measure(text), observed, graph: Object.fromEntries(Object.entries(Object.values(result.metafile.outputs)[0].inputs)
    .filter(([, data]) => data.bytesInOutput > 0).map(([file, data]) => [file.replace(/^qualified:/, ''), data.bytesInOutput])) };
}

try {
  const common = { 'dist/ir/request.js': await runtime('src/ir/request.ts'),
    'dist/ir/author-request-runtime.js': await runtime('src/ir/author-request-runtime.ts', ['./request.js']),
    'dist/ir/symbol-runtime.js': await runtime('src/ir/symbol-runtime.ts', ['./request.js', './author-request-runtime.js']) };
  const helper = await runtime('src/ir/source-packet-runtime.ts');
  const helperFile = 'dist/ir/source-packet-runtime.js', inputs = await authoredSymbolPayloads(['notifications', 'notifications-unread']);
  const report = { capturedAt: new Date().toISOString(), baselineSha, sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, windowsHide: true, encoding: 'utf8' }).trim(),
    emitterSha256: measure(readFileSync(join(root, 'scripts/lib/symbol-modules.js'))).sha256,
    packetCompilerSha256: measure(readFileSync(join(root, 'scripts/lib/source-packet.js'))).sha256,
    packetRuntimeSha256: measure(readFileSync(join(root, 'src/ir/source-packet-runtime.ts'))).sha256,
    experimentSha256: measure(readFileSync(fileURLToPath(import.meta.url))).sha256,
    scope: 'Две семьи/четыре masters, actual runtime emit/native ESM/selective bundles. Без full corpus/build/pack/browser, timing/allocations/памяти и shipping qualification.',
    environment: { node: process.version, platform: process.platform, arch: process.arch, esbuild: esbuildVersion,
      fflate: JSON.parse(readFileSync(join(root, 'node_modules/fflate/package.json'))).version, gzip: { level: 9, mtime: 0 }, brotliQuality: 11 },
    common: Object.fromEntries(Object.entries(common).map(([file, text]) => [file, measure(text)])),
    helper: { file: helperFile, ...measure(helper), ...measureArtifact(Buffer.from(helper)) }, rows: [] };
  const cases = { glyph: 'glyph()', caps: 'glyphCapabilities()', both: '[glyph(),glyphCapabilities()]', outline: 'outline', filled: 'filled' };
  const policy = JSON.parse(readFileSync(join(root, 'release/package-size-ratchet.json')));
  for (const [icon, input] of Object.entries(inputs)) {
    const oldModule = previous.renderSymbolModules(input).symbol, module = renderSymbolModules(input).symbol;
    const before = { ...common, [`dist/symbols/${icon}.js`]: oldModule }, after = { ...common, [helperFile]: helper, [`dist/symbols/${icon}.js`]: module };
    const row = { icon, baseline: measure(oldModule), candidate: measure(module), ceilings: policy.artifacts[`dist/symbols/${icon}.js`],
      baselineNative: await native(before, input, 'baseline'), candidateNative: await native(after, input, 'candidate'), consumers: {} };
    assert.ok(row.candidate.bytes <= row.ceilings.maxBytes && row.candidate.gzipBytes <= row.ceilings.maxGzipBytes);
    for (const [name, expression] of Object.entries(cases)) {
      const old = await consume(before, icon, expression), current = await consume(after, icon, expression);
      assert.equal(JSON.stringify(current.observed), JSON.stringify(old.observed));
      if (name === 'outline' || name === 'filled') {
        assert.equal(current.bytes, old.bytes);
        assert.deepEqual(current.graph, old.graph, 'static consumer не удерживает helper или IR');
      }
      const { observed: _before, ...baseline } = old, { observed: _after, ...candidate } = current;
      row.consumers[name] = { baseline, candidate, exactResult: true,
        rawDelta: candidate.bytes - baseline.bytes, gzipDelta: candidate.gzipBytes - baseline.gzipBytes, brotliDelta: candidate.brotliBytes - baseline.brotliBytes };
    }
    report.rows.push(row);
  }
  if (process.argv.includes('--freeze-helper-budget')) {
    assert.ok(!Object.hasOwn(policy.artifacts, helperFile), 'Новый budget фиксируется один раз до remote result');
    policy.artifacts[helperFile] = { baselineBytes: report.helper.bytes, baselineGzipBytes: report.helper.gzipBytes,
      maxBytes: report.helper.bytes, maxGzipBytes: report.helper.gzipBytes, allowedModules: report.helper.modules,
      forbiddenNeedles: ['sourceMappingURL', 'semantics/catalog.json', 'anatomy.runtime.json'] };
    policy.artifacts = Object.fromEntries(Object.entries(policy.artifacts).filter(([file]) => file !== helperFile)
      .flatMap(entry => entry[0] === 'dist/ir/symbol-runtime.js' ? [[helperFile, policy.artifacts[helperFile]], entry] : [entry]));
    writeFileSync(join(root, 'release/package-size-ratchet.json'), `${JSON.stringify(policy, null, 1)}\n`);
  }
  if (process.argv[2] && !process.argv[2].startsWith('--')) writeFileSync(resolve(process.argv[2]), `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ helper: report.helper, rows: report.rows.map(row => ({ icon: row.icon, baseline: row.baseline, candidate: row.candidate,
    consumers: Object.fromEntries(Object.entries(row.consumers).map(([name, value]) => [name, { rawDelta: value.rawDelta, gzipDelta: value.gzipDelta, brotliDelta: value.brotliDelta }])) })) }));
} finally {
  assert.ok(resolve(temporary).replaceAll('\\', '/').startsWith(resolve(root).replaceAll('\\', '/') + '/'));
  rmSync(temporary, { recursive: true, force: true });
}
