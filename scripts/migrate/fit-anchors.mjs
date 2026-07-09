// Подгонка inkAnchors глифа к отгружаемым файлам (координатный спуск,
// объектив = МИНИМУМ inkIoU по вариантам). Для семейств поворотов канона
// (шевроны): фитим базовый глиф, семейству якоря копируются 1:1.
// ПРОВЕРЕНО 2026-07: фиты стрелок/шевронов ОТКЛОНЕНЫ гейтами — замороженные
// полы fidelity + EO≡NZ кусают идеализацию (verify: 38 файлов / 401 тест).
// Инструмент оставлен для будущих семейств; результат фита гонять через verify.
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
const name = args.find((a) => !a.startsWith('--'));
const APPLY = args.includes('--apply');
const copyTo = (args.find((a) => a.startsWith('--copy-to=')) || '').slice(10).split(',').filter(Boolean);

const g = anatomy.glyphs[name];
if (!g?.inkAnchors) { console.error(`нет inkAnchors у «${name}»`); process.exit(2); }

// числовые листья якорей
const leaves = [];
(function walk(o, path) {
  for (const k of Object.keys(o)) {
    const v = o[k];
    if (typeof v === 'number') leaves.push({ o, k, path: `${path}.${k}` });
    else if (v && typeof v === 'object') walk(v, `${path}.${k}`);
  }
})(g.inkAnchors, 'inkAnchors');

const handFile = (v) => (v === 'outline' ? `${REPO}/svg/Outline/${name}.svg` : `${REPO}/svg/Filled/${name}_filled.svg`);
const hand = {};
const build = () => buildGlyph(g, grid, {}, anatomy.glyphs);
const d0 = build();
const variants = Object.keys(d0).filter((v) => {
  try { hand[v] = renderedPathData(readFileSync(handFile(v), 'utf8')).join(''); return true; }
  catch { return false; }
});
if (!variants.length) { console.error('нет файлов-целей'); process.exit(2); }

const score = (step) => {
  const d = build();
  let worst = 1;
  for (const v of variants) worst = Math.min(worst, inkIoU(d[v], hand[v], grid.canvas.width, step));
  return worst;
};

console.log(`«${name}»: ${leaves.length} чисел, варианты ${variants.join(',')}, старт ${(score(0.12) * 100).toFixed(2)}%`);

let cur = score(0.24);
for (const step of [0.01, 0.005, 0.0025, 0.00125, 0.0006, 0.0003, 0.00015]) {
  let moved = true;
  while (moved) {
    moved = false;
    for (const L of leaves) {
      const base = L.o[L.k];
      for (const delta of [step, -step]) {
        L.o[L.k] = base + delta;
        const s = score(0.24);
        if (s > cur + 1e-6) { cur = s; moved = true; break; }
        L.o[L.k] = base;
      }
    }
  }
}
const fin = score(0.12);
console.log(`финал (сетка 0.12): ${(fin * 100).toFixed(2)}%`);
for (const L of leaves) console.log(`  ${L.path} = ${L.o[L.k].toFixed(6)}`);

if (APPLY) {
  for (const t of copyTo) {
    if (!anatomy.glyphs[t]) { console.error(`нет глифа «${t}»`); process.exit(2); }
    anatomy.glyphs[t].inkAnchors = JSON.parse(JSON.stringify(g.inkAnchors));
  }
  writeFileSync(`${REPO}/semantics/anatomy.json`, JSON.stringify(anatomy, null, 1) + '\n');
  console.log(`ЗАПИСАНО (+копия якорей → ${copyTo.join(', ') || '—'})`);
}
