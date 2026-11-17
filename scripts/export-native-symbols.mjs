import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, resolve } from 'node:path';
import { compileOpticalCorpus } from './lib/optical-corpus.js';
import { loadSymbolSource } from './lib/symbol-source.js';
import { nativeSymbolSource, nativeSymbolTests } from './lib/native-symbol.js';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('..', import.meta.url));
const options = { preview: false }, args = process.argv.slice(2);
for (let index = 0; index < args.length; index++) {
  if (args[index] === '--preview') options.preview = true;
  else if (['--output', '--fixtures', '--symbol', '--package'].includes(args[index]) && args[index + 1] && !args[index + 1].startsWith('--')) {
    options[args[index].slice(2)] = args[++index];
  } else throw new Error('Usage: export-native-symbols.mjs [--preview] [--output directory] [--fixtures directory] [--symbol id] [--package kotlin.package]');
}
const { preview } = options;
const output = options.output ? resolve(options.output) : join(root, 'native/compose/build/generated/symbols');
const corpus = compileOpticalCorpus(root, { preview }), document = loadSymbolSource(root);
if (options.symbol && !Object.hasOwn(corpus.symbols, options.symbol)) throw new RangeError(`Unknown symbol: ${options.symbol}`);
const selected = options.symbol ? [corpus.symbols[options.symbol]] : Object.values(corpus.symbols);
const files = selected.map(symbol => ({ id: symbol.id, ...nativeSymbolSource(symbol, document.symbols[symbol.id], { packageName: options.package }) }));
mkdirSync(output, { recursive: true });
for (const file of files) writeFileSync(join(output, file.file), file.source);
writeFileSync(join(output, 'symbols.json'), JSON.stringify({ version: 1, reviewed: !preview, axes: corpus.axes,
  symbols: files.map(({ source, ...receipt }) => receipt) }, null, 2) + '\n');
if (options.fixtures) {
  const runtime = await build({ entryPoints: [join(root, 'src/render/optical-grid.ts')], bundle: true, write: false, format: 'esm' });
  const sampler = await import(`data:text/javascript;base64,${Buffer.from(runtime.outputFiles[0].text).toString('base64')}`);
  const fixtures = resolve(options.fixtures); mkdirSync(fixtures, { recursive: true });
  writeFileSync(join(fixtures, 'NativeCorpusTest.kt'), nativeSymbolTests(corpus, sampler));
}
console.log(`Kotlin SymbolData: ${files.length} families, ${files.reduce((total, file) => total + file.bytes, 0)} numeric bytes; reviewed=${!preview}`);
