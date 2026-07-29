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

for (const f of files) {
  await import(pathToFileURL(`${here}/${f}`).href);
}

export const loadedFamilies = files;
