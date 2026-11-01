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
import { compileLottieGeometry, renderLottieSymbolModule, lottieSymbolDeclaration } from './lib/lottie-geometry.js';
import { compileAuthorStateGroups, renderStateGroupModule, stateGroupDeclaration } from './lib/author-state-groups.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TARGETS = ['ir', 'symbols', 'motion', 'lottie', 'authoring', 'states'];
const REQUIRED_DECLARATIONS = ['author-catalog.generated.d.ts', 'author-provenance.d.ts', 'author-source.d.ts', 'authored-variation.d.ts', 'candidates.d.ts', 'catalog.generated.d.ts', 'compiler.d.ts', 'index.d.ts', 'recipes.d.ts', 'render.d.ts', 'request.d.ts'];
const read = (root, file) => JSON.parse(readFileSync(join(root, file), 'utf8'));

/** Только локальный checkout и его OS namespace: неизвестный или живой PID сохраняется. */
function recoverAbandonedStaging(root) {
  for (const name of readdirSync(root)) {
    const owner = /^\.dist-ir-build-([1-9]\d*)-[A-Za-z0-9]{6}$/.exec(name);
    if (!owner) continue;
    const pid = Number(owner[1]);
    if (!Number.isSafeInteger(pid)) continue;
    const path = join(root, name);
    try {
      if (!lstatSync(path).isDirectory()) continue;
    } catch (error) {
      if (error.code === 'ENOENT') continue;
      throw error;
    }
    try {
      process.kill(pid, 0);
      continue;
    } catch (error) {
      // ESRCH подтверждает отсутствие процесса. EPERM и reuse PID не разрешают GC.
      if (error.code !== 'ESRCH') continue;
    }
    rmSync(path, { recursive: true, force: true });
  }
}

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
      bundle(root, staging, 'src/ir/authored-variation.ts', 'ir/variation-runtime.js', ['./request.js', './symbol-runtime.js']),
      bundle(root, staging, 'src/ir/recipes.ts', 'ir/recipes.js'),
      bundle(root, staging, 'src/ir/render.ts', 'ir/render.js'),
      bundle(root, staging, 'src/authoring/index.ts', 'authoring/index.js'),
      bundle(root, staging, 'src/ir/candidates.ts', 'ir/candidates.js', ['./index.js']),
      bundle(root, staging, 'src/motion/index.ts', 'motion/index.js'),
      bundle(root, staging, 'src/lottie/runtime.ts', 'ir/lottie-runtime.js', ['../motion/index.js']),
      bundle(root, staging, 'src/states/runtime.ts', 'ir/state-runtime.js'),
      // Serializer остаётся build-only: runtime групп потребляет проверенные строки.
      bundle(root, declarations, 'src/ir/svg-assembly.ts', 'svg-assembly.mjs'),
    ]);
    // Все операции записи завершаются до удаления staging при ошибке одной
    // сборки: поздняя запись иначе заново создаст уже убранный каталог.
    const failedBundle = bundles.find(result => result.status === 'rejected');
    if (failedBundle) throw failedBundle.reason;
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.build.json'), '--outDir', declarations], { cwd: root, stdio: 'inherit' });
    for (const file of REQUIRED_DECLARATIONS) copyFileSync(join(declarations, 'ir', file), join(staging, 'ir', file));
    copyFileSync(join(declarations, 'motion/index.d.ts'), join(staging, 'motion/index.d.ts'));
    copyFileSync(join(declarations, 'lottie/types.d.ts'), join(staging, 'ir/lottie-types.d.ts'));
    copyFileSync(join(declarations, 'authoring/index.d.ts'), join(staging, 'authoring/index.d.ts'));
    copyFileSync(join(declarations, 'authoring/design-spec.d.ts'), join(staging, 'authoring/design-spec.d.ts'));
    copyFileSync(join(declarations, 'states/types.d.ts'), join(staging, 'ir/state-types.d.ts'));

    const catalog = read(root, 'semantics/catalog.json');
    const grid = read(root, 'semantics/grid.json');
    const author = loadAuthorBaseline(root);
    const annotatedSources = compileAuthorAnatomy(author, read(root, 'semantics/author-anatomy.json'), grid);
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
      const projected = Object.fromEntries(['outline', 'filled'].map(variant => [variant, authorSources[icon][variant].sourceContract.variation]));
      const variation = projected.outline || projected.filled ? projected : undefined;
      if (variation && (!variation.outline || !variation.filled)) throw new Error(`build-ir: ${icon}: обе authored variation формы обязательны`);
      const targets = Object.fromEntries(['outline', 'filled'].map(variant => [variant, compileLottieGeometry(payload.source[variant])]));
      const capabilities = Object.fromEntries(['outline', 'filled'].map(variant => {
        const capability = payload.capabilities[variant];
        const law = variation?.[variant];
        return [variant, { ...capability, ...(law && { variation: { version: 1, law: law.law, geometrySha256: law.geometrySha256,
          defaults: { dotScale: 1, spacingScale: 1 }, domain: law.domain,
          targets: { svg: 'supported', webEffect: 'existing-part-gestures', lottie: 'not-exported', sfSymbols: 'not-exported' } } }),
          motion: { ...capability.motion, adapters: { ...capability.motion.adapters,
          lottie: targets[variant].ok && capability.motion.state === 'gesture-ready' ? 'lottie-web-svg-5.13' : 'not-exported' } } }];
      }));
      writeFileSync(join(staging, 'symbols', `${icon}.js`), renderSymbolModule({ ...payload, capabilities, variation }));
      writeFileSync(join(staging, 'symbols', `${icon}.d.ts`), symbolModuleDeclaration(icon, !!variation));
      writeFileSync(join(staging, 'lottie', `${icon}.js`), renderLottieSymbolModule(icon, targets));
      writeFileSync(join(staging, 'lottie', `${icon}.d.ts`), lottieSymbolDeclaration());
    }
    const stateSpec = read(root, 'semantics/author-state-groups.json');
    const assembly = await import(pathToFileURL(join(declarations, 'svg-assembly.mjs')).href);
    const stateGroups = compileAuthorStateGroups(author, stateSpec, { compiler, ...assembly });
    for (const [name, payload] of Object.entries(stateGroups)) {
      writeFileSync(join(staging, 'states', `${name}.js`), renderStateGroupModule(payload));
      writeFileSync(join(staging, 'states', `${name}.d.ts`), stateGroupDeclaration(stateSpec, name));
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
  recoverAbandonedStaging(root);
  recoverOwnedDirectory({ output, backup, fs: transactionFs });
  // PID входит в атомарно созданное имя: crash до записи marker не оставляет unknown owner.
  const staging = mkdtempSync(join(root, `.dist-ir-build-${process.pid}-`));
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
