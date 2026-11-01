#!/usr/bin/env node
/**
 * Записанный IR, текущие авторские символы и motion используют один compiler.
 * Default/source parts, fingerprint, bounds и topology вычисляются при сборке;
 * браузер получает замкнутый символ и не восстанавливает анатомию из path.
 */
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateReleaseTypeDependencyGraph, validateReleaseRuntimeDependencyGraph } from './lib/release-contract.js';
import { recoverOwnedDirectory, replaceOwnedDirectory } from './lib/owned-directory.js';
import { renderSymbolModule, symbolExportName, symbolModuleDeclaration } from './lib/symbol-modules.js';
import { authorSymbolPayload, loadAuthorBaseline } from './lib/author-baseline.js';
import { compileAuthorAnatomy } from './lib/author-anatomy.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['ir', 'symbols', 'motion'];
const REQUIRED_DECLARATIONS = ['author-catalog.generated.d.ts', 'author-source.d.ts', 'candidates.d.ts', 'catalog.generated.d.ts', 'compiler.d.ts', 'index.d.ts', 'recipes.d.ts', 'render.d.ts', 'request.d.ts'];
const read = (root, file) => JSON.parse(readFileSync(join(root, file), 'utf8'));

function entryKind(path) {
  const entry = lstatSync(path);
  if (entry.isDirectory()) return 'directory';
  if (entry.isFile()) return 'file';
  throw new Error(`build-ir: symbolic link или специальный файл запрещён: ${path}`);
}

function listFiles(root, directory = root) {
  return readdirSync(directory).sort().flatMap(name => {
    const path = join(directory, name);
    return entryKind(path) === 'directory' ? listFiles(root, path) : [relative(root, path).replaceAll('\\', '/')];
  });
}

function copyStaticEntry(source, target) {
  if (entryKind(source) === 'file') {
    copyFileSync(source, target);
    return;
  }
  mkdirSync(target);
  for (const name of readdirSync(source).sort()) copyStaticEntry(join(source, name), join(target, name));
}

function retainStaticArtifacts(output, staging) {
  if (entryKind(output) !== 'directory') throw new Error('build-ir: dist обязан быть каталогом статической сборки');
  for (const name of readdirSync(output).sort()) {
    // IR, символы и motion пересобираются; скрытые каталоги прежних транзакций не являются
    // статическими артефактами и не переходят в новую опубликованную эпоху.
    if (!TARGETS.includes(name) && !name.startsWith('.')) copyStaticEntry(join(output, name), join(staging, name));
  }
}

async function bundle(root, staging, entry, target, external = []) {
  await build({
    entryPoints: [join(root, entry)], outfile: join(staging, target),
    bundle: true, charset: 'utf8', external, format: 'esm', legalComments: 'none',
    logLevel: 'info', minify: false, platform: 'browser', sourcemap: false,
    target: 'es2022', treeShaking: true,
  });
}

async function compileIrTargets({ root, staging }) {
  execFileSync(process.execPath, [join(root, 'scripts/build-anatomy-projection.mjs')], { cwd: root, stdio: 'inherit' });
  const declarations = mkdtempSync(join(tmpdir(), 'lab-icons-ir-dts-'));
  try {
    for (const name of TARGETS) mkdirSync(join(staging, name));
    const bundles = await Promise.allSettled([
      bundle(root, staging, 'src/ir/index.ts', 'ir/index.js', ['@labpics/icons', './compiler.js']),
      bundle(root, staging, 'src/ir/compiler.ts', 'ir/compiler.js', ['./request.js']),
      bundle(root, staging, 'src/ir/request.ts', 'ir/request.js'),
      bundle(root, staging, 'src/ir/symbol-runtime.ts', 'ir/symbol-runtime.js', ['./request.js']),
      bundle(root, staging, 'src/ir/recipes.ts', 'ir/recipes.js'),
      bundle(root, staging, 'src/ir/render.ts', 'ir/render.js'),
      bundle(root, staging, 'src/ir/candidates.ts', 'ir/candidates.js', ['./index.js']),
      bundle(root, staging, 'src/motion/index.ts', 'motion/index.js'),
    ]);
    // Все операции записи завершаются до удаления staging при ошибке одной
    // сборки: поздняя запись иначе заново создаст уже убранный каталог.
    const failedBundle = bundles.find(result => result.status === 'rejected');
    if (failedBundle) throw failedBundle.reason;
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.build.json'), '--outDir', declarations], { cwd: root, stdio: 'inherit' });
    for (const file of REQUIRED_DECLARATIONS) copyFileSync(join(declarations, 'ir', file), join(staging, 'ir', file));
    copyFileSync(join(declarations, 'motion/index.d.ts'), join(staging, 'motion/index.d.ts'));

    const catalog = read(root, 'semantics/catalog.json');
    const grid = read(root, 'semantics/grid.json');
    const author = loadAuthorBaseline(root);
    const annotatedSources = compileAuthorAnatomy(author, read(root, 'semantics/author-anatomy.json'));
    const authorSources = Object.fromEntries(Object.entries(author.icons).map(([icon, variants]) => [icon,
      Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, {
        ...item, sourceContract: annotatedSources[`${icon}/${variant}`] ?? item.sourceContract,
      }])),
    ]));
    const names = Object.keys(author.icons).sort();
    const sourceCatalog = {
      canvas: catalog.canvas,
      axes: catalog.axes,
      icons: Object.fromEntries(names.map(icon => [icon, {
        source: Object.fromEntries(['outline', 'filled'].map(variant => [variant, authorSources[icon][variant].sourceContract])),
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
      const payload = authorSymbolPayload(icon, authorSources[icon], compiler);
      writeFileSync(join(staging, 'symbols', `${icon}.js`), renderSymbolModule(payload));
      writeFileSync(join(staging, 'symbols', `${icon}.d.ts`), symbolModuleDeclaration(icon));
    }
    return names.length;
  } finally {
    rmSync(declarations, { recursive: true, force: true });
  }
}

function validateStagedSurface(staging, contract) {
  const actual = listFiles(staging).map(file => `dist/${file}`).sort();
  const isTarget = file => TARGETS.includes(file.split('/')[1]);
  const generated = actual.filter(isTarget);
  const expected = contract.files.filter(isTarget).sort();
  const missing = contract.files.filter(file => !actual.includes(file));
  const extra = generated.filter(file => !expected.includes(file));
  if (missing.length || extra.length) {
    throw new Error(`build-ir output surface drift: regenerate release projection from actual catalog; missing=${missing.join(',')}; extra=${extra.join(',')}`);
  }
  const readText = file => readFileSync(join(staging, file.slice(5)), 'utf8');
  const errors = [
    ...validateReleaseTypeDependencyGraph({ contract, readText }),
    ...validateReleaseRuntimeDependencyGraph({ contract, readText }),
  ];
  if (errors.length) throw new Error(`build-ir dependency closure:\n${errors.join('\n')}`);
}

/** Команда сборки и проверки отказов проходят одну границу публикации всей эпохи. */
export async function buildIr({ root = ROOT, compileTargets = compileIrTargets, transactionFs } = {}) {
  const output = join(root, 'dist');
  const backup = join(root, '.dist-ir-previous');
  recoverOwnedDirectory({ output, backup, fs: transactionFs });
  const staging = mkdtempSync(join(root, '.dist-ir-build-'));
  try {
    retainStaticArtifacts(output, staging);
    const symbolCount = await compileTargets({ root, staging });
    validateStagedSurface(staging, read(root, 'release/contract.json'));
    // Соседний staging остаётся на той же файловой системе. Две rename могут дать
    // временно отсутствующий dist, но не смешанный набор IR/symbols/motion.
    replaceOwnedDirectory({ staging, output, backup, fs: transactionFs });
    return symbolCount;
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const symbolCount = await buildIr();
  console.log(`build-ir: ${symbolCount} current author symbol modules + recorded IR + isolated motion`);
}
