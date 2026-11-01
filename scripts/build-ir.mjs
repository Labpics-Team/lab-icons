#!/usr/bin/env node
/**
 * Записанный IR, текущие авторские символы и motion используют один compiler.
 * Default/source parts, fingerprint, bounds и topology вычисляются при сборке;
 * браузер получает замкнутый символ и не восстанавливает анатомию из path.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateReleaseTypeDependencyGraph, validateReleaseRuntimeDependencyGraph } from './lib/release-contract.js';
import { recoverOwnedDirectory, replaceOwnedDirectory } from './lib/owned-directory.js';
import { renderSymbolModule, symbolExportName, symbolModuleDeclaration } from './lib/symbol-modules.js';
import { authorSymbolPayload, loadAuthorBaseline } from './lib/author-baseline.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = join(ROOT, 'dist');
const TARGETS = ['ir', 'symbols', 'motion'];
const REQUIRED_DECLARATIONS = ['author-catalog.generated.d.ts', 'author-source.d.ts', 'candidates.d.ts', 'catalog.generated.d.ts', 'compiler.d.ts', 'index.d.ts', 'recipes.d.ts', 'render.d.ts', 'request.d.ts'];
const read = file => JSON.parse(readFileSync(join(ROOT, file), 'utf8'));

function listFiles(root, directory = root) {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? listFiles(root, path) : [relative(root, path).replaceAll('\\', '/')];
  });
}

async function bundle(staging, entry, target, external = []) {
  await build({
    entryPoints: [join(ROOT, entry)], outfile: join(staging, target),
    bundle: true, charset: 'utf8', external, format: 'esm', legalComments: 'none',
    logLevel: 'info', minify: false, platform: 'browser', sourcemap: false,
    target: 'es2022', treeShaking: true,
  });
}

execFileSync(process.execPath, [join(ROOT, 'scripts/build-anatomy-projection.mjs')], { stdio: 'inherit' });
mkdirSync(DIST_DIR, { recursive: true });
for (const name of TARGETS) {
  recoverOwnedDirectory({ output: join(DIST_DIR, name), backup: join(DIST_DIR, `.${name}-previous`) });
}
const staging = mkdtempSync(join(DIST_DIR, '.ir-platform-build-'));
const declarations = mkdtempSync(join(tmpdir(), 'lab-icons-ir-dts-'));
try {
  for (const name of TARGETS) mkdirSync(join(staging, name));
  await Promise.all([
    bundle(staging, 'src/ir/index.ts', 'ir/index.js', ['@labpics/icons', './compiler.js']),
    bundle(staging, 'src/ir/compiler.ts', 'ir/compiler.js', ['./request.js']),
    bundle(staging, 'src/ir/request.ts', 'ir/request.js'),
    bundle(staging, 'src/ir/symbol-runtime.ts', 'ir/symbol-runtime.js', ['./request.js']),
    bundle(staging, 'src/ir/recipes.ts', 'ir/recipes.js'),
    bundle(staging, 'src/ir/render.ts', 'ir/render.js'),
    bundle(staging, 'src/ir/candidates.ts', 'ir/candidates.js', ['./index.js']),
    bundle(staging, 'src/motion/index.ts', 'motion/index.js'),
  ]);
  execFileSync(process.execPath, [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'tsconfig.build.json'), '--outDir', declarations], { cwd: ROOT, stdio: 'inherit' });
  for (const file of REQUIRED_DECLARATIONS) copyFileSync(join(declarations, 'ir', file), join(staging, 'ir', file));
  copyFileSync(join(declarations, 'motion/index.d.ts'), join(staging, 'motion/index.d.ts'));

  const catalog = read('semantics/catalog.json');
  const grid = read('semantics/grid.json');
  const author = loadAuthorBaseline(ROOT);
  const names = Object.keys(author.icons).sort();
  const sourceCatalog = {
    canvas: catalog.canvas,
    axes: catalog.axes,
    icons: Object.fromEntries(names.map(icon => [icon, {
      source: Object.fromEntries(['outline', 'filled'].map(variant => [variant, author.icons[icon][variant].sourceContract])),
      model: null,
    }])),
  };
  const staticIcons = Object.fromEntries(names.flatMap(icon =>
    ['outline', 'filled'].map(variant => [symbolExportName(icon, variant), author.icons[icon][variant].artifactSvg])));
  const { createGlyphCompiler } = await import(pathToFileURL(join(staging, 'ir/compiler.js')).href);
  const compiler = createGlyphCompiler({
    catalog: sourceCatalog, anatomy: { version: 1, glyphs: {} }, grid, staticIcons,
  });
  for (const icon of names) {
    const payload = authorSymbolPayload(icon, author.icons[icon], compiler);
    writeFileSync(join(staging, 'symbols', `${icon}.js`), renderSymbolModule(payload));
    writeFileSync(join(staging, 'symbols', `${icon}.d.ts`), symbolModuleDeclaration(icon));
  }

  const contract = read('release/contract.json');
  const actual = listFiles(staging).map(file => `dist/${file}`).sort();
  const expected = contract.files.filter(file => !['dist/index.js', 'dist/index.d.ts'].includes(file)).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`build-ir output surface drift: regenerate release projection from actual catalog; missing=${expected.filter(file => !actual.includes(file)).join(',')}; extra=${actual.filter(file => !expected.includes(file)).join(',')}`);
  }
  const readText = file => readFileSync(file.startsWith('dist/index.') ? join(ROOT, file) : join(staging, file.slice(5)), 'utf8');
  const errors = [
    ...validateReleaseTypeDependencyGraph({ contract, readText }),
    ...validateReleaseRuntimeDependencyGraph({ contract, readText }),
  ];
  if (errors.length) throw new Error(`build-ir dependency closure:\n${errors.join('\n')}`);
  // Проверка всех targets завершается до первой замены. Pack всегда начинает
  // с чистых исходников, поэтому незавершённая сборка не становится выпуском.
  for (const name of TARGETS) {
    replaceOwnedDirectory({ staging: join(staging, name), output: join(DIST_DIR, name), backup: join(DIST_DIR, `.${name}-previous`) });
  }
  console.log(`build-ir: ${names.length} current author symbol modules + recorded IR + isolated motion`);
} finally {
  rmSync(staging, { recursive: true, force: true });
  rmSync(declarations, { recursive: true, force: true });
}
