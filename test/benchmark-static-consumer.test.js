import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { bundleMeasurements, inspectStaticRuntime, staticAdapterSource } from '../scripts/bench/static-consumer.js';

const svg = '<svg viewBox="0 0 24 24"><path d="M1 1L23 23"/></svg>';

async function adapter(variant, literal) {
  const result = await build({ stdin: { contents: staticAdapterSource(variant, literal), sourcefile: 'consumer.js' },
    bundle: true, write: false, format: 'esm', platform: 'browser', target: 'es2022', minify: true, metafile: true,
    plugins: [{ name: 'static-public-surface', setup(plugin) {
      plugin.onResolve({ filter: /^@labpics\/icons\/symbols\/accessibility$/ }, () => ({ path: 'symbol', namespace: 'fixture' }));
      plugin.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const outline=${JSON.stringify(svg)}; export const filled=${JSON.stringify(svg)};`, loader: 'js' }));
    } }], logLevel: 'silent' });
  return { module: await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`),
    bytes: result.outputFiles[0].contents, metafile: result.metafile };
}

describe('matched static SVG consumer', () => {
  it.each(['outline', 'filled'])('named %s и literal сохраняют те же SVG bytes, без измерительного harness', async variant => {
    const imported = await adapter(variant), literal = await adapter(variant, svg);
    expect(imported.module.svg).toBe(svg);
    expect(literal.module.svg).toBe(imported.module.svg);
    expect(Object.keys(imported.module)).toEqual(['svg']);
    expect(Buffer.from(imported.bytes).toString()).not.toContain('measureScene');
    const actual = bundleMeasurements(imported.bytes, imported.metafile), control = bundleMeasurements(literal.bytes, literal.metafile);
    expect(actual.compressors).toEqual(control.compressors);
    expect(actual.rawBytes).toBe(imported.bytes.length);
    expect(control.rawBytes).toBe(literal.bytes.length);
    expect(actual.gzipBytes).toBeGreaterThan(0);
    expect(actual.brotliBytes).toBeGreaterThan(0);
  });

  it('literal сериализует actual SVG, не исполняя его содержимое', async () => {
    const payload = '<svg><!-- `${globalThis.injection=1}` \\ --></svg>';
    const literal = await adapter('outline', payload);
    expect(literal.module.svg).toBe(payload);
    expect(globalThis.injection).toBeUndefined();
    expect(() => staticAdapterSource('bold', svg)).toThrow('variant');
    expect(() => staticAdapterSource('outline', '')).toThrow('actual SVG');
  });

  it('retained graph исключает прочитанные, но полностью удалённые bundler inputs', () => {
    const bytes = Buffer.from('export const svg="x";');
    const result = bundleMeasurements(bytes, { inputs: { 'symbol.js': { bytes: 80 }, 'catalog.json': { bytes: 800_000 } },
      outputs: { 'consumer.js': { inputs: { 'symbol.js': { bytesInOutput: 20 }, 'catalog.json': { bytesInOutput: 0 } } } } });
    expect(result.inputs).toHaveLength(2);
    expect(result.retainedInputs).toEqual([{ file: 'symbol.js', bytesInOutput: 20 }]);
  });
  it('один graph predicate отказывает IR, authoring, motion и catalog на обеих ОС', () => {
    for (const file of ['/installed/dist/ir/index.js', '/installed/dist/authoring/index.js',
      '/installed/dist/motion/index.js', '/installed/catalog.json', '/installed/anatomy.json', 'E:\\installed\\dist\\ir\\index.js']) {
      expect(inspectStaticRuntime([{ file, bytesInOutput: 1 }]).verdict).toBe('FAIL');
    }
    expect(inspectStaticRuntime([{ file: '/installed/dist/symbols/accessibility.js', bytesInOutput: 1 }]).verdict).toBe('PASS');
    expect(inspectStaticRuntime(undefined).verdict).toBe('INCOMPLETE');
    expect(inspectStaticRuntime([{}]).verdict).toBe('INCOMPLETE');
    expect(inspectStaticRuntime(Array(2)).verdict).toBe('INCOMPLETE');
  });
});
