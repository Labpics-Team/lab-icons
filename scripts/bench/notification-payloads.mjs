#!/usr/bin/env node
/** Две семьи: exact shipping bytes и отвергнутые build-only представления. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, version as esbuildVersion } from 'esbuild';
import { gzipSync } from 'fflate';
import { compactDataLiteral, jsonDataLiteral, literalKey } from '../lib/generated-module.js';
import { renderSymbolModules } from '../lib/symbol-modules.js';
import { authoredSymbolPayloads } from '../../test/helpers/authored-symbol-payload.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const baseline = '8fbb434fb3c56b22703088c9e69b4f618bc2685f';
const receiptSha256 = 'b63ab4be495f7a8b866035ae24b3c25ea33211c0c10be466163880e1413e4d91';
const sha256 = text => createHash('sha256').update(text).digest('hex');
const measure = text => {
  const bytes = Buffer.from(text);
  return { bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).length, sha256: sha256(bytes) };
};
const receiptBytes = readFileSync(process.argv[2] ?? join(root, '../annulus-consumer-evidence-20261102/schema6-8fbb434-report.json'));
assert.equal(sha256(receiptBytes), receiptSha256, 'Нужен точный authenticated remote report.');
const receipt = JSON.parse(receiptBytes);
assert.equal(receipt.sourceSha, baseline);
const ceilings = { notifications: [23951, 4165], 'notifications-unread': [30360, 5034] };
const baselineEmitter = execFileSync('git', ['show', `${baseline}:scripts/lib/symbol-modules.js`],
  { cwd: root, encoding: 'utf8', windowsHide: true });
const importedBaseline = baselineEmitter.replace(/from '(\.\/[^']+)'/g, (_, specifier) =>
  `from ${JSON.stringify(new URL(specifier, new URL('../lib/symbol-modules.js', import.meta.url)).href)}`);
const previous = await import(`data:text/javascript;base64,${Buffer.from(importedBaseline).toString('base64')}`);

/** Эксперимент сохраняет все JSON-ключи/порядок, включая extension __proto__. */
function experimentalModule(input, { paths = false, staticPaths = false, pure = true, primitives = false } = {}) {
  let encode = compactDataLiteral;
  const calls = [];
  const record = (value, references = new Map()) => `{${Object.entries(value).flatMap(([key, item]) => {
    const literal = references.get(key) ?? encode(item);
    return literal === undefined ? [] : [`${literalKey(key)}:${literal}`];
  }).join(',')}}`;
  const materialize = expression => pure ? `/* @__PURE__ */ (() => (${expression}))()` : expression;
  const layout = () => {
    const shared = [], sources = {}, capabilities = {}, strings = [], staticExports = [];
    for (const variant of ['outline', 'filled']) {
      const source = input.source[variant], capability = input.capabilities[variant], metadata = new Map();
      for (const field of ['author', 'anatomy']) {
        const left = source.provenance?.[field], right = capability?.[field];
        if (!left || typeof left !== 'object' || Array.isArray(left) ||
            !right || typeof right !== 'object' || Array.isArray(right) ||
            jsonDataLiteral(left) !== jsonDataLiteral(right)) continue;
        const name = `${variant}${field === 'author' ? 'Author' : 'Anatomy'}`;
        shared.push(`const ${name} = ${encode(left)};`);
        metadata.set(field, name);
      }
      const sourceReferences = new Map();
      if (metadata.size) sourceReferences.set('provenance', record(source.provenance, metadata));
      if (source.svg === input.staticSvg[variant]) sourceReferences.set('svg', variant);
      const pathReferences = paths ? source.parts.map((part, index) => [part.d, `${variant}Path${index}`]) : [];
      for (const [path, name] of pathReferences) strings.push(`const ${name} = ${jsonDataLiteral(path)};`);
      if (paths) {
        // Разбиение выполняется при сборке; consumer только соединяет exact строки.
        // Object records и независимость авторских вариантов не объединяются.
        sourceReferences.set('parts', `[${source.parts.map((part, index) => record(part,
          new Map([['d', `${variant}Path${index}`]]))).join(',')}]`);
        sourceReferences.set('d', stringExpression(source.d, pathReferences));
        sourceReferences.set('svg', stringExpression(source.svg, pathReferences));
      }
      const renderedSource = record(source, sourceReferences);
      sources[variant] = paths ? materialize(renderedSource) : renderedSource;
      capabilities[variant] = record(capability, metadata);
      staticExports.push(`export const ${variant} = ${staticPaths
        ? materialize(stringExpression(input.staticSvg[variant], pathReferences)) : jsonDataLiteral(input.staticSvg[variant])};`);
    }
    return [
      '/** GENERATED: проверенные текущие авторские masters одного символа. */',
      "import { createCompiledGlyph, createCompiledCapabilities } from '../ir/symbol-runtime.js';",
      ...strings, ...staticExports, ...shared,
      `const outlineSource = ${sources.outline};`, `const filledSource = ${sources.filled};`,
      `export const glyph = /* @__PURE__ */ createCompiledGlyph(${jsonDataLiteral(input.icon)}, { outline: outlineSource, filled: filledSource });`,
      `export const glyphCapabilities = /* @__PURE__ */ createCompiledCapabilities({outline:${capabilities.outline},filled:${capabilities.filled}});`, '',
    ].join('\n');
  };
  if (!primitives) return layout();
  encode = value => { calls.push(value); return compactDataLiteral(value); };
  layout();
  const counts = new Map();
  const count = value => {
    if (typeof value === 'string') counts.set(value, (counts.get(value) ?? 0) + 1);
    else if (value && typeof value === 'object') Object.values(value).forEach(count);
  };
  calls.forEach(count);
  // Exact scalar values можно разделить без изменения object identity.
  // Предварительный фильтр исключает неприбыльные по raw declarations.
  const references = new Map();
  for (const [value, occurrences] of counts) {
    const name = `s${references.size}`, literal = jsonDataLiteral(value);
    if (occurrences > 1 && (literal.length - name.length) * occurrences > `const ${name}=${literal};\n`.length) {
      references.set(value, name);
    }
  }
  const emit = value => typeof value === 'string' && references.has(value) ? references.get(value)
    : Array.isArray(value) ? `[${value.map(emit).join(',')}]`
    : value !== null && typeof value === 'object' ? `{${Object.entries(value)
      .map(([key, item]) => `${literalKey(key)}:${emit(item)}`).join(',')}}` : jsonDataLiteral(value);
  encode = value => {
    const json = JSON.stringify(value);
    return json === undefined ? undefined : emit(JSON.parse(json));
  };
  return [...references].map(([value, name]) => `const ${name}=${jsonDataLiteral(value)};`).join('\n') + '\n' + layout();
}

function stringExpression(value, references) {
  let fragments = [{ value }];
  for (const [path, reference] of references) {
    if (!path) continue;
    fragments = fragments.flatMap(fragment => fragment.reference ? [fragment]
      : fragment.value.split(path).flatMap((value, index) => index ? [{ reference }, { value }] : [{ value }]));
  }
  return fragments.filter(fragment => fragment.reference || fragment.value)
    .map(fragment => fragment.reference ?? jsonDataLiteral(fragment.value)).join('+') || '""';
}

async function runtime(entry, external = []) {
  const result = await build({ absWorkingDir: root, entryPoints: [join(root, entry)], outfile: join(root, '.notification-runtime.js'),
    bundle: true, charset: 'utf8', external, format: 'esm', legalComments: 'none', logLevel: 'silent',
    minify: false, minifyWhitespace: true, platform: 'browser', sourcemap: false, write: false, metafile: true,
    target: 'es2022', treeShaking: true });
  const modules = Object.entries(Object.values(result.metafile.outputs)[0].inputs)
    .filter(([, input]) => input.bytesInOutput > 0).map(([name]) => name).sort();
  return modules.map(name => `// ${name}\n`).join('') + result.outputFiles[0].text;
}
const common = {
  'dist/ir/request.js': await runtime('src/ir/request.ts'),
  'dist/ir/author-request-runtime.js': await runtime('src/ir/author-request-runtime.ts', ['./request.js']),
  'dist/ir/symbol-runtime.js': await runtime('src/ir/symbol-runtime.ts', ['./request.js', './author-request-runtime.js']),
};
for (const [file, contents] of Object.entries(common)) assert.equal(measure(contents).sha256, receipt.artifacts[file].sha256, file);

const nativeRoot = resolve(mkdtempSync(join(root, '.notification-payload-control-')));
assert.ok(nativeRoot.startsWith(resolve(root) + '\\') || nativeRoot.startsWith(resolve(root) + '/'));
async function native(files, icon, label, input) {
  const folder = join(nativeRoot, `${icon}-${label}`), pkg = join(folder, 'node_modules/@labpics/icons');
  for (const [file, contents] of Object.entries(files)) {
    const target = join(pkg, file); mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, contents);
  }
  writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', sideEffects: false,
    exports: { './symbols/*': './dist/symbols/*.js' } }));
  const consumer = await import(pathToFileURL(join(pkg, `dist/symbols/${icon}.js`)).href);
  assert.deepEqual(Object.keys(consumer).sort(), ['filled', 'glyph', 'glyphCapabilities', 'outline']);
  assert.equal(consumer.glyph.name, 'glyph'); assert.equal(consumer.glyphCapabilities.name, 'glyphCapabilities');
  const recursivelyFrozen = value => !value || typeof value !== 'object' ||
    Object.isFrozen(value) && Object.values(value).every(recursivelyFrozen);
  for (const variant of ['outline', 'filled']) {
    const glyph = consumer.glyph({ variant }), caps = consumer.glyphCapabilities(variant);
    assert.equal(JSON.stringify(glyph), JSON.stringify(input.source[variant]));
    assert.equal(JSON.stringify(caps), JSON.stringify(input.capabilities[variant]));
    assert.equal(consumer[variant], input.staticSvg[variant]);
    assert.ok(recursivelyFrozen(glyph)); assert.ok(recursivelyFrozen(caps));
    for (const field of ['author', 'anatomy']) {
      if (input.capabilities[variant][field] && jsonDataLiteral(input.source[variant].provenance[field]) === jsonDataLiteral(input.capabilities[variant][field])) {
        assert.equal(glyph.provenance[field], caps[field]);
      }
    }
  }
  assert.equal(consumer.glyph(), consumer.glyph());
  assert.notEqual(consumer.glyph(), consumer.glyph({ variant: 'filled' }));
  assert.notEqual(consumer.glyph().provenance.author, consumer.glyph({ variant: 'filled' }).provenance.author);
  const request = { get variant() { assert.equal(this, request); return 'outline'; } };
  assert.equal(consumer.glyph(request), consumer.glyph());
  for (const request of [{ axes: { weight: 1 } }, { modelMode: 'allow-candidate' }]) {
    assert.throws(() => consumer.glyph(request), error => error.code === 'AUTHOR_PARITY_REQUIRED');
  }
  assert.throws(() => consumer.glyph({ variation: {} }), error => error.code === 'AUTHOR_VARIATION_UNSUPPORTED');
  return { exactJsonAndKeyOrder: true, staticValues: true, frozenTrees: true, defaultAndVariantIdentity: true,
    metadataIdentity: true, functionNames: true, getterReceiver: true, refusals: true };
}
async function consume(files, icon, expression) {
  const source = `import { glyph,glyphCapabilities,outline,filled } from './dist/symbols/${icon}.js';export const result=${expression};`;
  const result = await build({ stdin: { contents: source, resolveDir: root }, bundle: true, write: false, minify: true,
    platform: 'browser', format: 'esm', target: 'es2022', treeShaking: true, logLevel: 'silent', metafile: true,
    plugins: [{ name: 'exact-notification-closure', setup(plugin) {
      plugin.onResolve({ filter: /^\.\.?\// }, args => {
        const file = (args.importer ? join(dirname(args.importer), args.path) : args.path.slice(2)).replaceAll('\\', '/');
        if (Object.hasOwn(files, file)) return { path: file, namespace: 'projection', sideEffects: false };
      });
      plugin.onLoad({ filter: /.*/, namespace: 'projection' }, args => ({ contents: files[args.path], loader: 'js' }));
    } }] });
  const text = result.outputFiles[0].text;
  const observed = (await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`)).result;
  return { ...measure(text), observed, retainedFiles: Object.entries(Object.values(result.metafile.outputs)[0].inputs)
    .filter(([, input]) => input.bytesInOutput > 0).map(([file]) => file.replace(/^projection:/, '')).sort() };
}

try {
  const inputs = await authoredSymbolPayloads(['notifications', 'notifications-unread']);
  const rows = [], cases = { glyph: 'glyph()', caps: 'glyphCapabilities()', both: '[glyph(),glyphCapabilities()]', outline: 'outline', filled: 'filled' };
  for (const [icon, input] of Object.entries(inputs)) {
    const original = JSON.stringify(input), module = previous.renderSymbolModules(input).symbol, expected = receipt.artifacts[`dist/symbols/${icon}.js`];
    assert.deepEqual(measure(module), { bytes: expected.bytes, gzipBytes: expected.gzipBytes, sha256: expected.sha256 });
    const baselineFiles = { ...common, [`dist/symbols/${icon}.js`]: module }, consumers = {};
    for (const [name, expression] of Object.entries(cases)) consumers[name] = await consume(baselineFiles, icon, expression);
    const alternatives = {};
    for (const [label, options] of Object.entries({ paths: { paths: true },
      staticPaths: { paths: true, staticPaths: true }, primitives: { primitives: true },
      pathsAndPrimitives: { paths: true, primitives: true }, withoutPure: { paths: true, pure: false } })) {
      const candidate = experimentalModule(input, options), files = { ...common, [`dist/symbols/${icon}.js`]: candidate };
      const controls = await native(files, icon, label, input), observed = {}, regressions = [];
      for (const [name, expression] of Object.entries(cases)) {
        const actual = await consume(files, icon, expression), old = consumers[name];
        assert.equal(JSON.stringify(actual.observed), JSON.stringify(old.observed), `${icon}/${label}/${name}`);
        const { observed: _observed, ...measurement } = actual;
        observed[name] = { ...measurement, resultEqual: true };
        if (actual.bytes > old.bytes || actual.gzipBytes > old.gzipBytes) regressions.push(name);
      }
      const shipping = measure(candidate), [rawCeiling, gzipCeiling] = ceilings[icon];
      const admitted = shipping.bytes <= rawCeiling && shipping.gzipBytes <= gzipCeiling && !regressions.length;
      alternatives[label] = { module: shipping, controls, consumers: observed, regressions, admitted,
        reason: label === 'withoutPure' ? 'Контрпример: побочные эффекты concatenation удерживают source в caps/static consumer.'
          : shipping.gzipBytes > gzipCeiling ? 'Не закрыт неизменённый shipping gzip ceiling.' : 'Нарушена consumer nonregression.' };
      assert.equal(admitted, false, `${icon}/${label}: требуется пересмотреть отрицательный вывод`);
    }
    assert.ok(alternatives.withoutPure.consumers.caps.bytes > consumers.caps.bytes * 2, 'PURE sabotage не обнаружен');
    const current = renderSymbolModules(input).symbol, currentFiles = { ...common, [`dist/symbols/${icon}.js`]: current }, currentConsumers = {};
    const controls = await native(currentFiles, icon, 'current', input);
    for (const [name, expression] of Object.entries(cases)) {
      const actual = await consume(currentFiles, icon, expression), old = consumers[name];
      assert.equal(JSON.stringify(actual.observed), JSON.stringify(old.observed), `${icon}/current/${name}`);
      assert.ok(actual.bytes <= old.bytes && actual.gzipBytes <= old.gzipBytes, `${icon}/current/${name}: consumer regression`);
      const { observed: _observed, ...measurement } = actual;
      currentConsumers[name] = { ...measurement, resultEqual: true };
    }
    const pathOccurrences = Object.fromEntries(['outline', 'filled'].map(variant => [variant,
      input.source[variant].parts.map(part => ({ id: part.id, baseline: module.split(part.d).length - 1,
        current: current.split(part.d).length - 1 }))]));
    assert.ok(Object.values(pathOccurrences).flat().every(part => part.baseline >= 3 && part.current <= 2), 'RED повторов не закрыт');
    const currentMeasurement = measure(current);
    assert.ok(currentMeasurement.bytes <= expected.bytes && currentMeasurement.gzipBytes <= expected.gzipBytes);
    assert.equal(JSON.stringify(input), original, 'Авторский compiler fixture изменён');
    rows.push({ icon, baseline: measure(module), exactRemoteReceipt: true, ceilings: { bytes: ceilings[icon][0], gzipBytes: ceilings[icon][1] },
      baselineConsumers: Object.fromEntries(Object.entries(consumers).map(([name, { observed: _observed, ...value }]) => [name, value])), alternatives,
      current: { module: currentMeasurement, controls, consumers: currentConsumers, pathOccurrences,
        remainingShippingGap: { bytes: Math.max(0, currentMeasurement.bytes - ceilings[icon][0]),
          gzipBytes: Math.max(0, currentMeasurement.gzipBytes - ceilings[icon][1]) } } });
  }
  const report = { baseline, sourceSha: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim(),
    capturedAt: new Date().toISOString(), receiptSha256, receiptCapturedAt: receipt.capturedAt,
    emitterSha256: sha256(readFileSync(join(root, 'scripts/lib/symbol-modules.js'))), baselineEmitterSha256: sha256(baselineEmitter),
    experimentSha256: sha256(readFileSync(fileURLToPath(import.meta.url))),
    runtimeReceipts: Object.fromEntries(Object.entries(common).map(([file, text]) => [file, measure(text)])),
    environment: { node: process.version, platform: process.platform, esbuild: esbuildVersion,
      fflate: JSON.parse(readFileSync(join(root, 'node_modules/fflate/package.json'))).version, gzip: { level: 9, mtime: 0 } },
    scope: 'Две семьи/четыре настоящих masters; точные три runtime модуля; native JSON/identity и selective esbuild consumers. Без full build/corpus/pack, timing, памяти, browser или shipping qualification.',
    decision: 'Product emitter устраняет повтор path strings, сохраняя пять consumer raw/gzip и все semantic controls. Старый module gzip ceiling остаётся RED; он не повышен. Другие представления не приняты.', rows };
  if (process.argv[3]) writeFileSync(process.argv[3], `${JSON.stringify(report, null, 2)}\n`);
  for (const row of rows) console.log(JSON.stringify({ icon: row.icon, baseline: row.baseline,
    current: { module: row.current.module, remainingShippingGap: row.current.remainingShippingGap },
    alternatives: Object.fromEntries(Object.entries(row.alternatives).map(([name, value]) => [name,
      { module: value.module, regressions: value.regressions, admitted: value.admitted }])) }));
} finally {
  // Только созданный этой проверкой каталог внутри проверенного root.
  assert.ok(nativeRoot.startsWith(resolve(root) + '\\') || nativeRoot.startsWith(resolve(root) + '/'));
  rmSync(nativeRoot, { recursive: true, force: true });
}
