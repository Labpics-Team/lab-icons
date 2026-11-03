import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { gzipSync } from 'fflate';
import { renderSymbolModules } from '../scripts/lib/symbol-modules.js';
import { authoredSymbolPayloads } from './helpers/authored-symbol-payload.js';

const payloads = await authoredSymbolPayloads(['notifications', 'notifications-unread']);
const root = fileURLToPath(new URL('..', import.meta.url));
async function shippingRuntime(entry, external = []) {
  const result = await build({ absWorkingDir: root, entryPoints: [join(root, entry)], outfile: join(root, '.notification-runtime.js'),
    bundle: true, charset: 'utf8', external, format: 'esm', legalComments: 'none', minify: false, minifyWhitespace: true,
    platform: 'browser', write: false, metafile: true, target: 'es2022', treeShaking: true, logLevel: 'silent' });
  const modules = Object.entries(Object.values(result.metafile.outputs)[0].inputs)
    .filter(([, input]) => input.bytesInOutput > 0).map(([name]) => name).sort();
  return modules.map(name => `// ${name}\n`).join('') + result.outputFiles[0].text;
}
const shipping = {
  'dist/ir/request.js': await shippingRuntime('src/ir/request.ts'),
  'dist/ir/author-request-runtime.js': await shippingRuntime('src/ir/author-request-runtime.ts', ['./request.js']),
  'dist/ir/symbol-runtime.js': await shippingRuntime('src/ir/symbol-runtime.ts', ['./request.js', './author-request-runtime.js']),
  'dist/ir/source-packet-runtime.js': await shippingRuntime('src/ir/source-packet-runtime.ts'),
};
async function consume(module, expression) {
  const result = await build({ stdin: { contents: `import {glyph,glyphCapabilities,outline} from 'test-symbol';export const value=${expression};` },
    bundle: true, write: false, minify: true, treeShaking: true, platform: 'browser', format: 'esm', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'notification-source-control', setup(plugin) {
      plugin.onResolve({ filter: /^test-symbol$/ }, () => ({ path: 'symbol', namespace: 'symbol', sideEffects: false }));
      plugin.onLoad({ filter: /.*/, namespace: 'symbol' }, () => ({ contents: module, loader: 'js' }));
      plugin.onResolve({ filter: /symbol-runtime\.js$/ }, () => ({ path: fileURLToPath(new URL('../src/ir/symbol-runtime.ts', import.meta.url)) }));
      plugin.onResolve({ filter: /source-packet-runtime\.js$/ }, () => ({ path: fileURLToPath(new URL('../src/ir/source-packet-runtime.ts', import.meta.url)) }));
    } }] });
  const text = result.outputFiles[0].text;
  const { value } = await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`);
  return { text, value };
}

describe('exact notification path representation', () => {
  it.each(Object.keys(payloads))('%s caps raw/gzip не растут на настоящем shipping runtime closure', async icon => {
    const files = { ...shipping, [`dist/symbols/${icon}.js`]: renderSymbolModules(payloads[icon]).symbol };
    const result = await build({ stdin: { contents: `import { glyph,glyphCapabilities,outline,filled } from './dist/symbols/${icon}.js';export const result=glyphCapabilities();`, resolveDir: root },
      bundle: true, write: false, minify: true, platform: 'browser', format: 'esm', target: 'es2022', treeShaking: true, logLevel: 'silent',
      plugins: [{ name: 'notification-shipping-caps', setup(plugin) {
        plugin.onResolve({ filter: /^\.\.?\// }, args => {
          const file = (args.importer ? join(dirname(args.importer), args.path) : args.path.slice(2)).replaceAll('\\', '/');
          if (Object.hasOwn(files, file)) return { path: file, namespace: 'projection', sideEffects: false };
        });
        plugin.onLoad({ filter: /.*/, namespace: 'projection' }, args => ({ contents: files[args.path], loader: 'js' }));
      } }] });
    // Baseline 8fbb434: authenticated report и frozen comparison в bench.
    const [raw, gzip] = icon === 'notifications' ? [4531, 1511] : [4668, 1529];
    const bytes = result.outputFiles[0].contents;
    expect(bytes.length).toBeLessThanOrEqual(raw);
    expect(gzipSync(bytes, { level: 9, mtime: 0 }).length).toBeLessThanOrEqual(gzip);
  });

  it.each(Object.keys(payloads))('%s хранит path один раз для source и один раз для независимого static', async icon => {
    const input = payloads[icon], original = JSON.stringify(input), module = renderSymbolModules(input).symbol;
    const { value: consumer } = await consume(module, '[glyph(),glyph({variant:"filled"}),glyphCapabilities(),glyphCapabilities("filled"),outline]');
    for (const [index, variant] of ['outline', 'filled'].entries()) {
      expect(JSON.stringify(consumer[index])).toBe(JSON.stringify(input.source[variant]));
      expect(JSON.stringify(consumer[index + 2])).toBe(JSON.stringify(input.capabilities[variant]));
      for (const part of input.source[variant].parts) expect(module.split(part.d).length - 1).toBeLessThanOrEqual(2);
    }
    expect(consumer[4]).toBe(input.staticSvg.outline);
    expect(JSON.stringify(input)).toBe(original);
  });

  it.each(Object.keys(payloads))('%s lazy source construction исключает геометрию; eager initialization её удерживает', async icon => {
    const input = payloads[icon], module = renderSymbolModules(input).symbol;
    const geometry = input.source.outline.parts[0].d.slice(0, 120);
    const { text: caps } = await consume(module, 'glyphCapabilities()');
    expect(caps).not.toContain(geometry);
    const sabotage = module + '\nglyph();\n';
    expect(sabotage).not.toBe(module);
    const { text: retained } = await consume(sabotage, 'glyphCapabilities()');
    expect(retained).toContain(geometry);
    const { text: staticOnly } = await consume(module, 'outline');
    expect(staticOnly).not.toContain('masterSha256');
    expect(staticOnly).not.toContain('AUTHOR_PARITY_REQUIRED');
  });

  it('Unicode, специальные JSON-ключи и частичные совпадения остаются exact данными', async () => {
    const input = structuredClone(payloads.notifications);
    const path = `🔔${input.source.outline.parts[0].d}\\\"\u2028${'${literal}'}`;
    input.source.outline.parts[0].d = path;
    input.source.outline.d = `${path} ${input.source.outline.parts[1].d}`;
    input.source.outline.svg = `prefix${path}${path}suffix`;
    input.source.outline.parts[0].extension = JSON.parse('{"__proto__":{"meaning":"own data"}}');
    const { value } = await consume(renderSymbolModules(input).symbol, 'glyph()');
    expect(JSON.stringify(value)).toBe(JSON.stringify(input.source.outline));
    expect(Object.hasOwn(value.parts[0].extension, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(value.parts[0].extension)).toBe(Object.prototype);
  });
});
