/**
 * scripts/check-semantics.js — гейт семантики анимаций (эпик ds-icons, ch02).
 *
 * Инвариант: КАЖДОЕ имя иконки покрыто валидной семантикой — двунаправленно:
 *   1. нет иконки без записи в semantics/assignments.json;
 *   2. нет записи-фантома без пары SVG (Outline + Filled);
 *   3. class — только из закрытого перечня semantics.json;
 *   4. direction-иконки несут params.dir из закрытого перечня направлений;
 *   5. wholeOnly, если задан, — строго boolean true;
 *   6. геометрия каждой иконки парсится (слои извлекаемы) — якоря внутри viewBox.
 *
 * Любое нарушение → ненулевой exit (CI падает). Запускается в pnpm verify.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { iconGeometry } from './lib/icon-geometry.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const semantics = JSON.parse(readFileSync(join(root, 'semantics', 'semantics.json'), 'utf8'));
const assignments = JSON.parse(readFileSync(join(root, 'semantics', 'assignments.json'), 'utf8'));

const CLASSES = new Set(semantics.classes);
const DIRECTIONS = new Set(semantics.directions);

const outlineNames = readdirSync(join(root, 'svg', 'Outline'))
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.replace(/\.svg$/, ''));

const errors = [];

// 1. Каждая иконка имеет запись
for (const name of outlineNames) {
  if (!(name in assignments)) errors.push(`нет семантики: "${name}"`);
}

// 2-5. Каждая запись валидна и не фантом
const outlineSet = new Set(outlineNames);
for (const [name, entry] of Object.entries(assignments)) {
  if (!outlineSet.has(name)) {
    errors.push(`фантомная запись: "${name}" — нет svg/Outline/${name}.svg`);
    continue;
  }
  if (!CLASSES.has(entry.class)) {
    errors.push(`"${name}": класс "${entry.class}" вне перечня`);
  }
  if (entry.class === 'direction') {
    const dir = entry.params?.dir;
    if (!DIRECTIONS.has(dir)) {
      errors.push(`"${name}": direction требует params.dir из перечня, получено "${dir}"`);
    }
  }
  if ('wholeOnly' in entry && entry.wholeOnly !== true) {
    errors.push(`"${name}": wholeOnly может быть только true (или отсутствовать)`);
  }
}

// 6. Геометрия каждой иконки извлекаема, якоря в границах viewBox (+0.5 сглаживание)
for (const name of outlineNames) {
  for (const [variant, file] of [
    ['Outline', `${name}.svg`],
    ['Filled', `${name}_filled.svg`],
  ]) {
    let g;
    try {
      g = iconGeometry(readFileSync(join(root, 'svg', variant, file), 'utf8'));
    } catch (e) {
      errors.push(`${variant}/${file}: геометрия не извлекается — ${e.message}`);
      continue;
    }
    for (const p of g.paths) {
      if (
        p.anchor.x < g.viewBox.x - 0.5 ||
        p.anchor.x > g.viewBox.x + g.viewBox.width + 0.5 ||
        p.anchor.y < g.viewBox.y - 0.5 ||
        p.anchor.y > g.viewBox.y + g.viewBox.height + 0.5
      ) {
        errors.push(`${variant}/${file}: якорь слоя ${p.index} вне viewBox (${p.anchor.x}, ${p.anchor.y})`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error(`check-semantics: FAIL — нарушений: ${errors.length}`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}

const classCount = {};
for (const entry of Object.values(assignments)) {
  classCount[entry.class] = (classCount[entry.class] ?? 0) + 1;
}
console.log(
  `check-semantics: OK — ${outlineNames.length} имён покрыты; ` +
    Object.entries(classCount)
      .sort((a, b) => b[1] - a[1])
      .map(([c, n]) => `${c}=${n}`)
      .join(' '),
);
