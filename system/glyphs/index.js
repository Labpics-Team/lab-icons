/**
 * system/glyphs/index.js — автосборка деклараций.
 *
 * Модули семей подхватываются по каталогу, а не перечнем: список импортов —
 * это ещё одно место, где декларация может разойтись с реальностью, и оно тут
 * не нужно. Реестр запрещает повторное объявление имени, поэтому коллизия
 * семей падает на сборке, а не расходится тихо.
 */

import { readdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const files = readdirSync(here)
  .filter((f) => f.endsWith('.js') && f !== 'index.js' && !f.endsWith('.test.js'))
  .sort();

/**
 * Модуль, который сейчас пишут, может быть синтаксически неполон — при
 * параллельной работе это нормальное транзиторное состояние, а не поломка
 * системы. Падать всей сборкой из-за соседа нельзя: тогда ни измерить, ни
 * посмотреть остальные семьи невозможно. Поэтому сбой импорта — предупреждение
 * и продолжение; гейт check-system всё равно увидит недостачу имён.
 */
export const loadedFamilies = [];
export const failedFamilies = [];

for (const f of files) {
  try {
    await import(pathToFileURL(`${here}/${f}`).href);
    loadedFamilies.push(f);
  } catch (e) {
    failedFamilies.push({ file: f, error: String(e.message || e).split('\n')[0] });
    if (!process.env.LAB_QUIET) console.warn(`  ! семья не загрузилась: ${f} — ${String(e.message || e).split('\n')[0]}`);
  }
}
