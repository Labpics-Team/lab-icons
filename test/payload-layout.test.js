import { describe, expect, it } from 'vitest';
import { build, transformSync } from 'esbuild';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { gzipSync, strToU8 } from 'fflate';
import { brotliCompressSync, constants } from 'node:zlib';
import { compactDataLiteral, compactGeneratedModule } from '../scripts/lib/generated-module.js';
import { renderSymbolModule } from '../scripts/lib/symbol-modules.js';
import { renderLottieSymbolModule } from '../scripts/lib/lottie-geometry.js';
import { symbolPayloads } from './helpers/symbol-payloads.js';

const names = ['component', 'notifications', 'notifications-unread', 'time'];
const payloads = symbolPayloads(names);

/** Неизменяемый emitter 75c67fc: положительный baseline, не другой production path. */
function baselineModule({ icon, source, capabilities, staticSvg }) {
  const json = JSON.stringify, declarations = [], sources = {}, refs = {};
  const record = (value, replace) => `{${Object.entries(value).map(([key, item]) => `${json(key)}:${replace[key] ?? json(item)}`).join(',')}}`;
  for (const variant of ['outline', 'filled']) {
    const metadata = {};
    for (const field of ['author', 'anatomy']) if (source[variant].provenance[field] && json(source[variant].provenance[field]) === json(capabilities[variant][field])) {
      const name = `${variant}${field === 'author' ? 'Author' : 'Anatomy'}`;
      declarations.push(`const ${name} = ${json(capabilities[variant][field])};`);
      metadata[field] = name;
    }
    sources[variant] = record(source[variant], { provenance: record(source[variant].provenance, metadata) });
    refs[variant] = record(capabilities[variant], metadata);
  }
  return [
    '/** GENERATED: проверенные текущие авторские masters одного символа. */',
    "import { createCompiledGlyph, createCompiledCapabilities } from '../ir/symbol-runtime.js';",
    `export const outline = ${json(staticSvg.outline)};`, `export const filled = ${json(staticSvg.filled)};`,
    ...declarations, `const outlineSource = ${sources.outline};`, `const filledSource = ${sources.filled};`,
    `export const glyph = /* @__PURE__ */ createCompiledGlyph(${json(icon)}, { outline: outlineSource, filled: filledSource });`,
    `export const glyphCapabilities = /* @__PURE__ */ createCompiledCapabilities(${record(capabilities, refs)});`, '',
  ].join('\n');
}

async function consume(contents, entry) {
  const output = await build({ stdin: { contents: entry, loader: 'js' }, bundle: true, write: false,
    minify: true, treeShaking: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'actual-symbol-control', setup(plugin) {
      plugin.onResolve({ filter: /^test-symbol$/ }, () => ({ path: 'symbol', namespace: 'symbol', sideEffects: false }));
      plugin.onLoad({ filter: /.*/, namespace: 'symbol' }, () => ({ contents, loader: 'js' }));
      plugin.onResolve({ filter: /symbol-runtime\.js$/ }, () => ({ path: fileURLToPath(new URL('../src/ir/symbol-runtime.ts', import.meta.url)) }));
      plugin.onResolve({ filter: /source-packet-runtime\.js$/ }, () => ({ path: fileURLToPath(new URL('../src/ir/source-packet-runtime.ts', import.meta.url)) }));
    } }],
  });
  return output.outputFiles[0].text;
}

const measure = contents => {
  const bytes = strToU8(contents);
  return { bytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).length,
    brotliBytes: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    sha256: createHash('sha256').update(bytes).digest('hex') };
};

describe('build-only проекция без повторов авторских строк', () => {
  it('JSON extension keys остаются собственными данными при любом выбранном layout', async () => {
    const payload = structuredClone(payloads.time);
    payload.source.outline.auxiliary = Array.from({ length: 400 }, () => JSON.parse('{"__proto__":true}'));
    payload.capabilities.outline.auxiliary = JSON.parse('{"__proto__":{"meaning":"retained"}}');
    const packed = await consume(renderSymbolModule(payload),
      'export { glyph, glyphCapabilities } from "test-symbol";');
    const consumer = await import(`data:text/javascript;base64,${Buffer.from(packed).toString('base64')}`);
    const glyph = consumer.glyph(), caps = consumer.glyphCapabilities();
    expect(Object.hasOwn(glyph.auxiliary[0], '__proto__')).toBe(true);
    expect(Object.hasOwn(caps.auxiliary, '__proto__')).toBe(true);
    expect(JSON.stringify(glyph)).toBe(JSON.stringify(payload.source.outline));
    expect(JSON.stringify(caps)).toBe(JSON.stringify(payload.capabilities.outline));
    expect(Object.getPrototypeOf(caps.auxiliary)).toBe(Object.prototype);
  });

  it.each(names)('%s сохраняет exact glyph/caps/record order и уменьшает прежние module bytes', async icon => {
    const payload = payloads[icon], oldModule = baselineModule(payload), module = renderSymbolModule(payload);
    const baseline = measure(oldModule), actual = measure(module);
    expect(actual.bytes).toBeLessThanOrEqual(baseline.bytes);
    expect(actual.gzipBytes).toBeLessThanOrEqual(baseline.gzipBytes);
    if (icon === 'component') {
      expect(actual.bytes).toBeLessThanOrEqual(59341);
      expect(actual.gzipBytes).toBeLessThanOrEqual(9351);
    }
    const packed = await consume(module, 'export { glyph, glyphCapabilities, outline, filled } from "test-symbol";');
    const consumer = await import(`data:text/javascript;base64,${Buffer.from(packed).toString('base64')}`);
    for (const variant of ['outline', 'filled']) {
      const glyph = consumer.glyph({ variant }), caps = consumer.glyphCapabilities(variant);
      expect(JSON.stringify(glyph)).toBe(JSON.stringify(payload.source[variant]));
      expect(JSON.stringify(caps)).toBe(JSON.stringify(payload.capabilities[variant]));
      expect(consumer[variant]).toBe(payload.staticSvg[variant]);
      expect(Object.isFrozen(glyph.parts)).toBe(true);
      expect(Object.isFrozen(caps.motion.gestures)).toBe(true);
    }
    expect(consumer.glyph()).toBe(consumer.glyph());
    expect(consumer.glyph()).not.toBe(consumer.glyph({ variant: 'filled' }));
    const glyphEntry = 'import { glyph } from "test-symbol"; console.log(glyph());';
    const oldConsumer = await consume(oldModule, glyphEntry), actualConsumer = await consume(module, glyphEntry);
    const capsEntry = 'import { glyphCapabilities } from "test-symbol"; console.log(glyphCapabilities());';
    const oldCaps = await consume(oldModule, capsEntry), actualCaps = await consume(module, capsEntry);
    const staticEntryForReport = 'import { outline } from "test-symbol"; console.log(outline);';
    const oldStatic = await consume(oldModule, staticEntryForReport), actualStatic = await consume(module, staticEntryForReport);
    // Изменение представления сохраняет exact данные, проверенные выше;
    // consumer SHA вправе измениться при устранении повторов source strings.
    // Source-only namespace меняет private minifier names после удаления path
    // literals. Caps gzip проверяется на настоящем shipping runtime closure
    // в notification-payload.test.js, без этого несоответствия consumer graph.
    expect(measure(actualCaps).bytes).toBeLessThanOrEqual(measure(oldCaps).bytes);
    for (const [current, previous] of [[actualConsumer, oldConsumer], [actualStatic, oldStatic]]) {
      expect(measure(current).bytes).toBeLessThanOrEqual(measure(previous).bytes);
      expect(measure(current).gzipBytes).toBeLessThanOrEqual(measure(previous).gzipBytes);
    }
    expect(module).not.toContain('.slice(');
    expect(measure(actualConsumer).bytes).toBeLessThanOrEqual(measure(oldConsumer).bytes);
    const staticEntry = 'import { outline } from "test-symbol"; console.log(outline);';
    const staticConsumer = await consume(module, staticEntry);
    expect(measure(staticConsumer).bytes).toBe(measure(await consume(oldModule, staticEntry)).bytes);
    expect(staticConsumer).not.toContain('AUTHOR_PARITY_REQUIRED');
    expect(staticConsumer).not.toContain('masterSha256');
  });

  it('сохраняет UTF-16 offsets с Unicode prefix и точными разделёнными paths', async () => {
    const parts = [{ id: 'first', d: 'M0 0L1 1Z' }, { id: 'second', d: 'M2 2L3 3Z' }];
    const staticSvg = '<svg><title>😀λ</title><path d="M0 0L1 1Z M2 2L3 3Z"/></svg>';
    const source = { icon: 'alert', parts, d: parts.map(part => part.d).join(''),
      svg: `<svg>${parts.map(part => `<path d="${part.d}"/>`).join('')}</svg>`, provenance: { kind: 'source' } };
    const payload = { icon: 'alert', source: { outline: source, filled: { ...source, d: 'independent-d' } },
      capabilities: { outline: {}, filled: {} }, staticSvg: { outline: staticSvg, filled: 'independent static SVG' } };
    const module = renderSymbolModule(payload);
    const packed = await consume(module, 'export { glyph } from "test-symbol";');
    const consumer = await import(`data:text/javascript;base64,${Buffer.from(packed).toString('base64')}`);
    expect(JSON.stringify(consumer.glyph())).toBe(JSON.stringify(source));
    expect(JSON.stringify(consumer.glyph({ variant: 'filled' }))).toBe(JSON.stringify(payload.source.filled));
    expect(module).not.toContain('.indexOf(');
    expect(module).not.toContain('parsePathData');
  });

  it('literal serializer сохраняет JSON values, ключи и отсутствие undefined', () => {
    const value = { 'not-an-identifier': '😀 quote" /* @__PURE__ */', default: null, nested: { x: 1, absent: undefined }, values: [undefined, Infinity] };
    Object.defineProperty(value, '__proto__', { value: { own: true }, enumerable: true });
    expect(JSON.stringify(Function(`return (${compactDataLiteral(value)})`)())).toBe(JSON.stringify(value));
  });

  it('выбор отбрасывает layout с меньшим raw, но большим gzip', () => {
    const compressible = `export const a=${JSON.stringify('aaaaaaaa'.repeat(100))};`;
    const noisy = `export const a=${JSON.stringify(Array.from({ length: 300 }, (_, index) => String.fromCharCode(33 + index % 90)).join(''))};`;
    expect(strToU8(noisy).length).toBeLessThan(strToU8(compressible).length);
    expect(measure(noisy).gzipBytes).toBeGreaterThan(measure(compressible).gzipBytes);
    expect(compactGeneratedModule([compressible, noisy])).toBe(compressible);
  });

  it('whitespace-minification не переносится на library PURE declarations', async () => {
    const module = renderSymbolModule(payloads.time);
    const entry = 'import { outline } from "test-symbol"; console.log(outline);';
    const healthy = await consume(module, entry);
    const stripped = transformSync(module, { minifyWhitespace: true, format: 'esm' }).code;
    expect(await consume(stripped, entry)).toContain('AUTHOR_PARITY_REQUIRED');
    expect(healthy).not.toContain('AUTHOR_PARITY_REQUIRED');
  });

  it('Lottie не теряет PURE и сокращает actual unread module без изменения lowering', () => {
    const payload = payloads['notifications-unread'];
    const module = renderLottieSymbolModule(payload.icon, payload.targets);
    const size = measure(module);
    expect(size.bytes).toBeLessThanOrEqual(13309);
    expect(size.gzipBytes).toBeLessThanOrEqual(4701);
    expect(module).toContain('/* @__PURE__ */ createLottieSymbol');
    expect(module).not.toContain('parsePathData');
  });
});
