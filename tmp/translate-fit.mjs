// translate-fit: коарс-ту-файн подбор per-variant translate для глифов,
// у которых фиттер не нашёл свободных листьев (все числа под lock).
// Топология не трогается — только глобальный сдвиг варианта (дрейф руки).
import { readFileSync } from 'node:fs';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { renderedPathData } from '../scripts/lib/icon-geometry.js';
import { inkIoU } from '../scripts/check-anatomy-drift.js';

const anatomy = JSON.parse(readFileSync('./semantics/anatomy.json', 'utf8'));
const grid = JSON.parse(readFileSync('./semantics/grid.json', 'utf8'));
const cw = grid.canvas.width;

const names = process.argv.slice(2);
const handPath = (n, v) =>
  v === 'outline' ? `./svg/Outline/${n}.svg` : `./svg/Filled/${n}_filled.svg`;

for (const n of names) {
  const entry = anatomy.glyphs[n];
  if (!entry) { console.log(`${n}: нет в анатомии`); continue; }
  const variants = Object.keys(entry.status);
  const hand = {};
  for (const v of variants) {
    try { hand[v] = renderedPathData(readFileSync(handPath(n, v), 'utf8')).join(''); }
    catch { /* руки нет — вариант пропустим */ }
  }
  const iou = (e, v, step) => {
    const b = buildGlyph(e, grid, {}, anatomy.glyphs);
    return b[v] ? inkIoU(b[v], hand[v], cw, step) : -1;
  };
  const result = { name: n, translate: {}, fid: {}, start: {} };
  for (const v of variants) {
    if (!hand[v]) continue;
    const base = { ...entry };
    delete base.translate;
    result.start[v] = iou(base, v, 0.12);
    let cx = 0, cy = 0, sc = result.start[v];
    for (const step of [0.005, 0.002, 0.001]) {
      const r = step === 0.005 ? 0.02 : step * 2;
      for (let dx = cx - r; dx <= cx + r + 1e-9; dx += step)
        for (let dy = cy - r; dy <= cy + r + 1e-9; dy += step) {
          const e = { ...base, translate: { [v]: [dx, dy] } };
          const s = iou(e, v, 0.12);
          if (s > sc) { sc = s; cx = dx; cy = dy; }
        }
    }
    result.translate[v] = [Number(cx.toFixed(5)), Number(cy.toFixed(5))];
    result.fid[v] = Number(sc.toFixed(4));
  }
  const line = Object.keys(result.fid)
    .map((v) => `${v}: ${(result.start[v] * 100).toFixed(2)}% → ${(result.fid[v] * 100).toFixed(2)}% t=[${result.translate[v]}]`)
    .join('  ');
  console.log(`${n.padEnd(16)} ${line}`);
  console.log(`  JSON ${JSON.stringify({ translate: result.translate, fidelityToHand: result.fid })}`);
}
