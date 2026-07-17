#!/usr/bin/env node
/**
 * Материализует отдельную CommonJS declaration boundary для ./animate.
 *
 * Одинаковое API не означает одинаковый module kind: рядом с package
 * `type: module` файл `.d.ts` считается ESM и вызывает TS1479 у Node16 CJS
 * consumer. Расширение `.d.cts` является частью публичной семантики, поэтому
 * файл создаётся после tsup и публикуется отдельным exact artifact.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function buildAnimateCjsTypes(root = ROOT) {
  const esmDeclaration = join(root, 'dist/animate/index.d.ts');
  const cjsDeclaration = join(root, 'dist/animate/index.d.cts');
  if (!existsSync(esmDeclaration)) {
    throw new Error('build-animate-cjs-types: dist/animate/index.d.ts отсутствует после tsup');
  }
  const source = readFileSync(esmDeclaration);
  if (source.byteLength === 0 || !/\bexport\b/.test(source.toString('utf8'))) {
    throw new Error('build-animate-cjs-types: ESM declaration пуста или не экспортирует API');
  }
  writeFileSync(cjsDeclaration, source);
  return Object.freeze({ file: 'dist/animate/index.d.cts', bytes: source.byteLength });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const result = buildAnimateCjsTypes();
  console.log(`build-animate-cjs-types: ${result.file} — ${result.bytes} B`);
}
