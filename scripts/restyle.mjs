/**
 * scripts/restyle.mjs — ползунок стиля (север владельца: вариативный язык).
 *
 * Одна команда с осью restyle-ит ВЕСЬ задекларированный корпус — не
 * трогая shipped svg/, а в отдельную demo-папку. Доказывает: стиль
 * набора = функция глобальных осей, а не ручная перерисовка каждой иконки.
 *
 *   node scripts/restyle.mjs --weight 1.3            # толще весь набор
 *   node scripts/restyle.mjs --weight 0.75 --out demo/thin
 *
 * Действует на генеративно-задекларированные глифы (status=generated).
 * Оси: weight (множитель штриховых токенов). Расширяемо (roundness…).
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGlyph } from './lib/anatomy-gen.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (flag, def) => {
  const i = process.argv.indexOf(flag);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
};
const axes = { weight: parseFloat(arg('--weight', '1')) };
const outDir = join(root, arg('--out', `demo/weight-${axes.weight}`));

const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
const wrap = (d) => `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="${d}"/></svg>`;

mkdirSync(join(outDir, 'Outline'), { recursive: true });
mkdirSync(join(outDir, 'Filled'), { recursive: true });

let n = 0;
for (const [name, g] of Object.entries(anatomy.glyphs)) {
  const gen = g.status?.outline === 'generated' || g.status?.filled === 'generated';
  if (!gen) continue;
  const built = buildGlyph(g, grid, axes);
  if (built.outline) writeFileSync(join(outDir, 'Outline', `${name}.svg`), wrap(built.outline));
  if (built.filled) writeFileSync(join(outDir, 'Filled', `${name}_filled.svg`), wrap(built.filled));
  n++;
}
const declared = Object.values(anatomy.glyphs).filter((g) => g.status?.outline === 'generated' || g.status?.filled === 'generated').length;
console.log(`restyle: ось weight=${axes.weight} → ${n}/${declared} generated-глифов пересобрано в ${arg('--out', `demo/weight-${axes.weight}`)}`);
console.log(`(shipped svg/ не тронут; одна ось restyle-ила весь задекларированный корпус)`);
