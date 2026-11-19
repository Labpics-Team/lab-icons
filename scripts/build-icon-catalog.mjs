import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { nativeSymbolSource } from './lib/native-symbol.js';

const root = fileURLToPath(new URL('..', import.meta.url));

/** The site consumes the same public modules as an application. No geometry compiler in its browser. */
export async function buildIconCatalog({ repo = root, outDir = join(repo, 'preview/catalog') } = {}) {
  const source = JSON.parse(readFileSync(join(repo, 'symbols/source.json'), 'utf8'));
  const pkg = JSON.parse(readFileSync(join(repo, 'package.json'), 'utf8'));
  const ids = Object.keys(source.symbols).sort();
  const entries = [];
  const native = {};
  mkdirSync(outDir, { recursive: true });
  mkdirSync(join(outDir, 'icons'), { recursive: true });
  mkdirSync(join(outDir, 'kotlin'), { recursive: true });
  for (const id of ids) {
    const symbol = (await import(pathToFileURL(join(repo, 'dist/symbols', `${id}.js`)).href)).default;
    const families = Object.entries(source.stateFamilies).flatMap(([family, states]) =>
      Object.entries(states).filter(([, member]) => member === id).map(([state]) => ({ family, state })));
    entries.push({ id, families, animated: ['outline', 'filled'].some(variant =>
      Object.keys(symbol.semantics?.variants[variant].effects ?? {}).length > 0) });
    for (const variant of ['outline', 'filled']) writeFileSync(join(outDir, 'icons', `${id}-${variant}.svg`), symbol[variant]);
    const file = nativeSymbolSource(symbol, source.symbols[id]);
    writeFileSync(join(outDir, 'kotlin', file.file), file.source);
    native[id] = file.file;
  }
  for (const [id] of Object.entries(source.stateFamilies)) {
    const symbol = (await import(pathToFileURL(join(repo, 'dist/states', `${id}.js`)).href)).default;
    const file = nativeSymbolSource(symbol, source.symbols[symbol.id],
      { packageName: 'pics.lab.icons.states', exportId: `${id}-states` });
    writeFileSync(join(outDir, 'kotlin', file.file), file.source);
    native[`states/${id}`] = file.file;
  }
  const scratch = mkdtempSync(join(repo, '.catalog-build-'));
  try {
    const registry = join(scratch, 'registry.ts');
    writeFileSync(registry, `export const entries = ${JSON.stringify(entries)};\n` +
      `export const families = ${JSON.stringify(source.stateFamilies)};\nexport const nativeFiles = ${JSON.stringify(native)};\n` +
      `export const version = ${JSON.stringify(pkg.version)};\nexport const loaders = {\n` +
      [...ids.map(id => [id, `symbols/${id}`]), ...Object.keys(source.stateFamilies).map(id => [`states/${id}`, `states/${id}`])]
        .map(([key, entry]) => `${JSON.stringify(key)}: () => import(${JSON.stringify(`@labpics/icons/${entry}`)}).then(module => module.default)`).join(',\n') + '\n};\n');
    const result = buildSync({ absWorkingDir: repo, entryPoints: [join(repo, 'catalog/app.ts')],
      outdir: join(outDir, 'assets'), entryNames: 'catalog', chunkNames: '[name]-[hash]',
      alias: { '#catalog': registry }, bundle: true, splitting: true, format: 'esm', platform: 'browser',
      target: 'es2022', minify: true, metafile: true });
    const outputs = Object.fromEntries(Object.entries(result.metafile.outputs).map(([path, value]) =>
      [relative(outDir, resolve(repo, path)).replaceAll('\\', '/'), { bytes: value.bytes }]));
    const currentAssets = new Set(Object.keys(outputs).map(path => basename(path)));
    // Only generated, flat JavaScript assets belong to this compiler. Rebuilds
    // remove obsolete hash-named chunks without touching the embedding site.
    for (const file of readdirSync(join(outDir, 'assets'), { withFileTypes: true })) {
      if (file.isFile() && file.name.endsWith('.js') && !currentAssets.has(file.name)) unlinkSync(join(outDir, 'assets', file.name));
    }
    writeFileSync(join(outDir, 'build.json'), JSON.stringify({ version: pkg.version, symbols: ids.length,
      variants: ids.length * 2, outputs }, null, 2) + '\n');
  } finally { rmSync(scratch, { recursive: true, force: true }); }
  for (const file of ['index.html', 'style.css']) copyFileSync(join(repo, 'catalog', file), join(outDir, file));
  mkdirSync(join(outDir, 'fonts'), { recursive: true });
  for (const file of ['Geist-Variable.woff2', 'OFL.txt']) copyFileSync(join(repo, 'catalog/fonts', file), join(outDir, 'fonts', file));
  return { outDir, symbols: ids.length, variants: ids.length * 2 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  if (args.length && (args.length !== 2 || args[0] !== '--out-dir')) throw Error('Usage: build-icon-catalog.mjs [--out-dir path]');
  console.log(await buildIconCatalog(args.length ? { outDir: resolve(args[1]) } : {}));
}
