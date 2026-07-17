#!/usr/bin/env node
/**
 * Сборка browser ESM и деклараций Glyph IR без мета-бандлера.
 *
 * JS строит закреплённый esbuild. Декларации выпускает тот же TypeScript,
 * которым typecheck-ится проект: это убирает скрытую вторую версию компилятора
 * и делает несовместимость toolchain немедленной ошибкой build.
 */

import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateReleaseTypeDependencyGraph } from './lib/release-contract.js';
import {
  recoverOwnedDirectory,
  replaceOwnedDirectory,
} from './lib/owned-directory.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIST_DIR = join(ROOT, 'dist');
const OUT_DIR = join(ROOT, 'dist/ir');
const BACKUP_DIR = join(ROOT, 'dist/.ir-previous');
const DTS_CONFIG = join(ROOT, 'tsconfig.build.json');
const REQUIRED_DECLARATIONS = Object.freeze([
  'catalog.generated.d.ts',
  'index.d.ts',
  'recipes.d.ts',
]);
const EXPECTED_OUTPUTS = Object.freeze([
  'catalog.generated.d.ts',
  'index.d.ts',
  'index.js',
  'recipes.d.ts',
  'recipes.js',
]);

function emitDeclarations(outDir) {
  // TypeScript 7 поставляет нативный tsc и намеренно не обещает старый JS API.
  // CLI — поддерживаемая граница; process.execPath одинаково работает с
  // POSIX shim и Windows без shell/string interpolation.
  execFileSync(
    process.execPath,
    [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', DTS_CONFIG, '--outDir', outDir],
    { cwd: ROOT, stdio: 'inherit' },
  );
}

async function bundle(outDir, entry, outfile, external = []) {
  await build({
    entryPoints: [join(ROOT, entry)],
    outfile: join(outDir, outfile),
    bundle: true,
    charset: 'utf8',
    external,
    format: 'esm',
    legalComments: 'none',
    logLevel: 'info',
    minify: false,
    platform: 'browser',
    sourcemap: false,
    target: 'es2022',
    treeShaking: true,
  });
}

mkdirSync(DIST_DIR, { recursive: true });
recoverOwnedDirectory({ output: OUT_DIR, backup: BACKUP_DIR });
const staging = mkdtempSync(join(DIST_DIR, '.ir-build-'));
const declarations = mkdtempSync(join(tmpdir(), 'lab-icons-ir-dts-'));
try {
  await Promise.all([
    bundle(staging, 'src/ir/index.ts', 'index.js', ['@labpics/icons']),
    bundle(staging, 'src/ir/recipes.ts', 'recipes.js'),
  ]);
  emitDeclarations(declarations);
  for (const file of REQUIRED_DECLARATIONS) {
    // readFileSync делает отсутствие output явной build-ошибкой до копирования.
    readFileSync(join(declarations, file));
    copyFileSync(join(declarations, file), join(staging, file));
  }
  const actual = readdirSync(staging).sort();
  if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_OUTPUTS)) {
    throw new Error(
      `build-ir staging surface drift: expected [${EXPECTED_OUTPUTS.join(', ')}], ` +
        `actual [${actual.join(', ')}]`,
    );
  }
  const releaseContract = JSON.parse(
    readFileSync(join(ROOT, 'release/contract.json'), 'utf8'),
  );
  const irContract = {
    files: releaseContract.files.filter((file) => file.startsWith('dist/ir/')),
    typeDependencies: releaseContract.typeDependencies.filter((file) =>
      file.startsWith('dist/ir/')),
    exports: Object.fromEntries(
      Object.entries(releaseContract.exports).filter(([subpath]) => subpath.startsWith('./ir')),
    ),
  };
  const typeErrors = validateReleaseTypeDependencyGraph({
    contract: irContract,
    readText(file) {
      return readFileSync(join(staging, file.slice('dist/ir/'.length)), 'utf8');
    },
  });
  if (typeErrors.length > 0) {
    throw new Error(`build-ir type closure:\n${typeErrors.map((error) => `  - ${error}`).join('\n')}`);
  }
  // Staging находится на том же volume. Ошибка swap немедленно возвращает
  // прежний output, а crash между rename восстанавливается следующим build.
  replaceOwnedDirectory({ staging, output: OUT_DIR, backup: BACKUP_DIR });
} finally {
  rmSync(staging, { recursive: true, force: true });
  rmSync(declarations, { recursive: true, force: true });
}

console.log(
  `build-ir: ESM 2 + declarations ${REQUIRED_DECLARATIONS.length}; ` +
    'esbuild и TypeScript используют один pinned dependency graph',
);
