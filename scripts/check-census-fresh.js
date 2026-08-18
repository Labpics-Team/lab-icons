/**
 * scripts/check-census-fresh.js — гейт свежести census.
 *
 * semantics/census.json заявляет generatedBy — значит обязан быть
 * бит-в-бит воспроизводим генератором из текущего дерева. Ручная правка
 * артефакта или устаревший census после изменения catalog/anatomy/dist —
 * HARD (класс дефекта: артефакт лжёт о своём происхождении).
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CENSUS = join(ROOT, 'semantics', 'census.json');

const committed = readFileSync(CENSUS, 'utf8');
execFileSync(process.execPath, [join(ROOT, 'scripts', 'census', 'build-census.mjs')], {
  stdio: ['ignore', 'ignore', 'inherit'],
});
const regenerated = readFileSync(CENSUS, 'utf8');

if (committed !== regenerated) {
  console.error('check-census-fresh: HARD — semantics/census.json не воспроизводится генератором.');
  console.error('Правка руками запрещена; после изменения catalog/anatomy/dist перегенерируй: node scripts/census/build-census.mjs');
  process.exit(1);
}
console.log('check-census-fresh: OK — census бит-в-бит воспроизводим генератором');
