/**
 * system/check-axes.js — ГЕЙТ ВАРИАТИВНОСТИ.
 *
 * Обещание системы: клиент двигает ось и получает свой набор — тонкий для
 * юридической конторы, круглый для детского магазина, острый для крипто-
 * стартапа. Обещание ничего не стоит, пока не проверено на КРАЯХ диапазона:
 * ломается всегда там, а не в дефолте, который все и так видят.
 *
 * Проверяется не «похоже ли», а то, что на краях диапазона не разваливается
 * КОНСТРУКЦИЯ:
 *
 *   строится            — декларация не бросает и не даёт NaN;
 *   держится в канве    — чернила не вылезли за поле;
 *   не рассыпается      — число кусков чернил не выросло против дефолта
 *                         (иначе на тонком весе глиф распадается на части);
 *   не заплывает        — счётчики не схлопнулись (иначе на жирном весе
 *                         просветы забиваются и знак читается пятном);
 *   без трещин          — вес не должен раскрывать шов, которого нет в дефолте.
 *
 * Границы берутся из AXES, а не назначаются здесь: если диапазон объявлен, он
 * обязан работать целиком, иначе диапазон объявлен неверно.
 *
 *   node system/check-axes.js
 *   node system/check-axes.js --only wght
 */

import { AXES } from './tokens.js';
import { glyphs, buildGlyph } from './registry.js';
import { maskFromPath } from './metrics.js';
import { topology } from './topology.js';
import './glyphs/index.js';

const SS = 8;
const CANVAS = 24;

const argv = process.argv.slice(2);
const only = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;

/** Точки проверки по каждой оси: минимум, дефолт, максимум. */
const points = (name) => {
  const a = AXES[name];
  return [
    ['min', a.min],
    ['def', a.def],
    ['max', a.max],
  ];
};

/**
 * ТРЕЩИНА ИЛИ ШОВ РАСТЕРИЗАТОРА — различаются масштабированием.
 *
 * Настоящий зазор имеет постоянную ширину в единицах канвы: удвоил разрешение —
 * ширина та же. Шов заливки на месте, где две почти совпавшие кромки сходятся
 * под острым углом, всегда ровно два пикселя: 0.250 при ss = 8, 0.126 при 16,
 * 0.100 при 20 — то есть 2/ss, и с разрешением он тает.
 *
 * Порог по абсолютной ширине для этого не годится и был бы опасен: настоящие
 * трещины наушников мерились 0.2 ед при ss = 10, то есть ровно на том же
 * пределе, и любой порог спрятал бы доказанный дефект. Различает только
 * поведение при смене разрешения.
 */
const crackWidths = (path, ss) =>
  topology(maskFromPath(path, CANVAS, ss, 0.02), { canvas: CANVAS, ss })
    .holes.filter((h) => 2 * h.maxR < 0.5)
    .map((h) => 2 * h.maxR)
    .sort((a, b) => b - a);

const realCracks = (path) => {
  const a = crackWidths(path, SS);
  if (!a.length) return 0;
  const b = crackWidths(path, SS * 2);
  // трещина настоящая, если на вдвое мелком пикселе она НЕ ужалась вдвое
  return b.filter((w, i) => w >= (a[i] ?? 0) * 0.6).length;
};

const shot = (path) => {
  const nums = [...path.toD().matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
  let bad = false;
  let max = 0;
  for (const v of nums) {
    if (!Number.isFinite(v)) bad = true;
    else if (Math.abs(v) > max) max = Math.abs(v);
  }
  const t = topology(maskFromPath(path, CANVAS, SS, 0.02), { canvas: CANVAS, ss: SS });
  return { bad, max, ink: t.ink, counters: t.counters, cracks: realCracks(path) };
};

const problems = [];
let checked = 0;

for (const name of [...glyphs.keys()].sort()) {
  for (const variant of ['outline', 'filled']) {
    let base;
    try {
      base = shot(buildGlyph(name, variant));
    } catch (e) {
      problems.push(`${name}/${variant}: не строится даже в дефолте — ${e.message}`);
      continue;
    }

    for (const axis of ['wght', 'crnr', 'rond']) {
      if (only && !only.has(axis)) continue;
      for (const [tag, value] of points(axis)) {
        if (tag === 'def') continue;
        const id = `${name}/${variant} @ ${axis}=${value}`;
        let cur;
        try {
          cur = shot(buildGlyph(name, variant, { [axis]: value }));
        } catch (e) {
          problems.push(`${id}: не строится — ${e.message}`);
          continue;
        }
        checked++;
        if (cur.bad) problems.push(`${id}: в пути NaN/Infinity`);
        if (cur.max > CANVAS + 2) problems.push(`${id}: координата ${cur.max.toFixed(1)} — чернила ушли за канву`);
        if (cur.ink > base.ink) {
          problems.push(`${id}: кусков чернил ${cur.ink} против ${base.ink} в дефолте — на краю оси глиф распадается`);
        }
        if (cur.counters < base.counters) {
          problems.push(`${id}: просветов ${cur.counters} против ${base.counters} в дефолте — негатив заплыл`);
        }
        if (cur.cracks > base.cracks) {
          problems.push(`${id}: трещин ${cur.cracks} против ${base.cracks} в дефолте — край оси раскрывает шов`);
        }
      }
    }
  }
}

console.log(`check-axes: ${checked} построений на краях диапазонов, ${glyphs.size} имён`);
if (problems.length) {
  console.error(`\ncheck-axes: ${problems.length} нарушений вариативности\n`);
  for (const p of problems) console.error('  • ' + p);
  process.exit(1);
}
console.log('check-axes: OK — каждая ось держит весь корпус на обоих краях объявленного диапазона');
