// Подгонка ТОЛЬКО translate-листьев глифа (суб-пиксельный остаток снапа
// канона на сетку f2). Якоря/веса не трогаем — форма остаётся канонической,
// правится лишь per-variant размещение. Объектив = МИНИМУМ inkIoU.
// ПРОВЕРЕНО 2026-07: на стрелках/шевронах выигрыш ниже порога решения,
// откат до бит-в-бит (см. заголовок fit-anchors.mjs); гейты — верховный судья.
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGlyph } from '../lib/anatomy-gen.js';
import { renderedPathData } from '../lib/icon-geometry.js';
import { inkIoU } from '../check-anatomy-drift.js';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const anatomy = JSON.parse(readFileSync(`${REPO}/semantics/anatomy.json`, 'utf8'));
const grid = JSON.parse(readFileSync(`${REPO}/semantics/grid.json`, 'utf8'));
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const names = args.filter((a) => !a.startsWith('--'));

for (const name of names) {
  const g = anatomy.glyphs[name];
  if (!g) { console.error(`нет глифа «${name}»`); process.exitCode = 2; continue; }
  const leaves = [];
  (function walk(o, path) {
    for (const k of Object.keys(o)) {
      const v = o[k];
      if (k === 'translate' && v && typeof v === 'object') {
        (function nums(t, p) {
          for (const kk of Object.keys(t)) {
            if (typeof t[kk] === 'number') leaves.push({ o: t, k: kk, path: `${p}.${kk}` });
            else if (t[kk] && typeof t[kk] === 'object') nums(t[kk], `${p}.${kk}`);
          }
        })(v, `${path}.translate`);
      } else if (v && typeof v === 'object') walk(v, `${path}.${k}`);
    }
  })(g, name);
  if (!leaves.length) { console.log(`«${name}»: translate-листьев нет — пропуск`); continue; }

  const handFile = (v) => (v === 'outline' ? `${REPO}/svg/Outline/${name}.svg` : `${REPO}/svg/Filled/${name}_filled.svg`);
  const hand = {};
  const build = () => buildGlyph(g, grid, {}, anatomy.glyphs);
  const variants = Object.keys(build()).filter((v) => {
    try { hand[v] = renderedPathData(readFileSync(handFile(v), 'utf8')).join(''); return true; }
    catch { return false; }
  });
  const score = () => {
    const d = build();
    let worst = 1;
    for (const v of variants) worst = Math.min(worst, inkIoU(d[v], hand[v], grid.canvas.width, 0.12));
    return worst;
  };
  const start = score();
  let cur = start;
  for (const step of [0.005, 0.0025, 0.00125, 0.0006, 0.0003, 0.00015, 0.00008]) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const L of leaves) {
        const base = L.o[L.k];
        for (const delta of [step, -step]) {
          L.o[L.k] = base + delta;
          const s = score();
          if (s > cur + 1e-7) { cur = s; moved = true; break; }
          L.o[L.k] = base;
        }
      }
    }
  }
  console.log(`«${name}»: ${(start * 100).toFixed(2)}% → ${(cur * 100).toFixed(2)}%  (${leaves.length} чисел)`);
}
if (APPLY) {
  writeFileSync(`${REPO}/semantics/anatomy.json`, JSON.stringify(anatomy, null, 1) + '\n');
  console.log('ЗАПИСАНО');
}
