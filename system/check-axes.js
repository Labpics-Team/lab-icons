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

const shot = (path) => {
  const nums = [...path.toD().matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));
  let bad = false;
  let max = 0;
  for (const v of nums) {
    if (!Number.isFinite(v)) bad = true;
    else if (Math.abs(v) > max) max = Math.abs(v);
  }
  const t = topology(maskFromPath(path, CANVAS, SS, 0.02), { canvas: CANVAS, ss: SS });
  return { bad, max, ink: t.ink, counters: t.counters, cracks: t.cracks };
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
