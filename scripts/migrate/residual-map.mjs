/**
 * residual-map.mjs — карта остатка «рука vs генерат» для fidelity-стопов.
 *
 * Показывает, ГДЕ расходятся чернила (а не «на сколько процентов»):
 *   #  чернила у обоих (совпадение)
 *   +  только у генерата (закон рисует лишнее)
 *   -  только у руки (закон не дорисовал)
 * плюс кластеры расхождений с bbox в юнитах канвы — по ним видно, какой
 * элемент топологии виноват (кончик линзы, хвост, засечка...).
 *
 * Запуск: node scripts/migrate/residual-map.mjs <glyph> <outline|filled> [--res 48]
 *         [--draft file.json]  — генерат из черновика, не из anatomy.json
 */
import { readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGlyph } from '../lib/anatomy-gen.js';
import { renderedPathData } from '../lib/icon-geometry.js';
import { samplePolylines } from '../lib/curve-sampling.js';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const grid = JSON.parse(readFileSync(`${REPO}/semantics/grid.json`, 'utf8'));
const cw = grid.canvas.width;

const [name, variant = 'outline'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const opt = (k) => {
  const i = process.argv.indexOf(k);
  return i >= 0 ? process.argv[i + 1] : null;
};
const RES = Number(opt('--res') ?? 48);

const anatomy = JSON.parse(readFileSync(`${REPO}/semantics/anatomy.json`, 'utf8'));
const entry = opt('--draft')
  ? JSON.parse(readFileSync(opt('--draft'), 'utf8'))
  : anatomy.glyphs[name];
if (!entry) {
  console.error(`нет декларации «${name}»`);
  process.exit(2);
}
const handFile =
  variant === 'outline'
    ? `${REPO}/svg/Outline/${name}.svg`
    : `${REPO}/svg/Filled/${name}_filled.svg`;
const handD = renderedPathData(readFileSync(handFile, 'utf8')).join('');
const genD = buildGlyph(entry, grid, {}, anatomy.glyphs)[variant];
if (!genD) {
  console.error(`декларация не строит вариант ${variant}`);
  process.exit(2);
}

// non-zero winding по полилиниям (модель inkAt из check-anatomy-drift)
function makeInk(d) {
  const polys = samplePolylines(d, 24).filter((p) => p.length > 2);
  return (x, y) => {
    let w = 0;
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i];
        const [x2, y2] = poly[(i + 1) % poly.length];
        if (y1 <= y ? y2 > y : y2 <= y) {
          const t = (y - y1) / (y2 - y1);
          if (x < x1 + t * (x2 - x1)) w += y2 > y1 ? 1 : -1;
        }
      }
    }
    return w !== 0;
  };
}
const inkH = makeInk(handD);
const inkG = makeInk(genD);

const step = cw / RES;
const rows = [];
const diffs = []; // {x,y,kind}
let both = 0, onlyH = 0, onlyG = 0;
for (let gy = 0; gy < RES; gy++) {
  let row = '';
  const y = (gy + 0.5) * step;
  for (let gx = 0; gx < RES; gx++) {
    const x = (gx + 0.5) * step;
    const h = inkH(x, y);
    const g = inkG(x, y);
    if (h && g) { row += '#'; both++; }
    else if (h) { row += '-'; onlyH++; diffs.push({ x, y, k: '-' }); }
    else if (g) { row += '+'; onlyG++; diffs.push({ x, y, k: '+' }); }
    else row += '·';
  }
  rows.push(row);
}
console.log(`${name}.${variant}: IoU≈${((both / (both + onlyH + onlyG)) * 100).toFixed(2)}% (сетка ${RES})`);
console.log(rows.join('\n'));

// кластеры расхождений (flood по соседству 8-связно, юниты канвы)
const seen = new Set();
const key = (d) => `${d.x.toFixed(3)}_${d.y.toFixed(3)}`;
const byKey = new Map(diffs.map((d) => [key(d), d]));
const clusters = [];
for (const d of diffs) {
  if (seen.has(key(d))) continue;
  const q = [d];
  seen.add(key(d));
  const cl = { minX: 99, minY: 99, maxX: -99, maxY: -99, n: 0, plus: 0, minus: 0 };
  while (q.length) {
    const c = q.pop();
    cl.n++;
    cl[c.k === '+' ? 'plus' : 'minus']++;
    cl.minX = Math.min(cl.minX, c.x); cl.maxX = Math.max(cl.maxX, c.x);
    cl.minY = Math.min(cl.minY, c.y); cl.maxY = Math.max(cl.maxY, c.y);
    for (const dx of [-step, 0, step]) for (const dy of [-step, 0, step]) {
      const nk = `${(c.x + dx).toFixed(3)}_${(c.y + dy).toFixed(3)}`;
      if (!seen.has(nk) && byKey.has(nk)) {
        seen.add(nk);
        q.push(byKey.get(nk));
      }
    }
  }
  clusters.push(cl);
}
clusters.sort((a, b) => b.n - a.n);
console.log(`\nкластеры расхождений (топ-8 из ${clusters.length}):`);
for (const c of clusters.slice(0, 8)) {
  const kind = c.plus && c.minus ? '±' : c.plus ? '+генерат' : '−рука';
  console.log(
    `  ${kind}  bbox [${c.minX.toFixed(1)},${c.minY.toFixed(1)} → ${c.maxX.toFixed(1)},${c.maxY.toFixed(1)}]  клеток ${c.n}`,
  );
}
