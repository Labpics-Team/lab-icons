/**
 * rect-scan.mjs — волна разметки rounded-rect-container (BL-015):
 * ищет в корпусе ЧИСТЫЕ контейнеры-рамки (Outline: ровно 2 контура —
 * внешний прямоугольник со скруглениями + внутренний офсет; Filled:
 * ровно 1 силуэт), автозамеряет (cx, cy, w, h, rOuter), собирает
 * генератом и принимает при IoU ≥ 97% на обоих вариантах.
 *
 * Запуск: node rect-scan.mjs [--write] — write дописывает декларации
 * в semantics/anatomy.json (status hand).
 */
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { samplePolylines } from '../lib/curve-sampling.js';
import { buildGlyph } from '../lib/anatomy-gen.js';
import { inkIoU } from '../check-anatomy-drift.js';
import { renderedPathData } from '../lib/icon-geometry.js';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const grid = JSON.parse(readFileSync(`${REPO}/semantics/grid.json`, 'utf8'));
const anatomy = JSON.parse(readFileSync(`${REPO}/semantics/anatomy.json`, 'utf8'));
const WRITE = process.argv.includes('--write');

const bbox = (p) => {
  let a = 1e9, b = 1e9, x = -1e9, y = -1e9;
  for (const [px, py] of p) {
    a = Math.min(a, px); b = Math.min(b, py);
    x = Math.max(x, px); y = Math.max(y, py);
  }
  return { x0: a, y0: b, x1: x, y1: y, w: x - a, h: y - b };
};

/** Прямоугольность: доли периметра на строгих верт/гор рёбрах ≥ порога. */
function rectness(poly) {
  let straight = 0, total = 0;
  for (let i = 0; i < poly.length; i++) {
    const a2 = poly[i], b2 = poly[(i + 1) % poly.length];
    const len = Math.hypot(b2[0] - a2[0], b2[1] - a2[1]);
    total += len;
    if (Math.abs(b2[0] - a2[0]) < 0.01 || Math.abs(b2[1] - a2[1]) < 0.01) straight += len;
  }
  return straight / (total || 1);
}

/** Радиус скругления: полудлина зоны угла (грань-конец до края bbox). */
function cornerR(poly, bb) {
  // максимум |x−край| среди точек с y в 0.4 юнита от верхнего края
  const top = poly.filter(([, y]) => Math.abs(y - bb.y0) < 0.03).map(([x]) => x);
  if (!top.length) return null;
  return Math.min(Math.min(...top) - bb.x0 + 0, bb.x1 - Math.max(...top));
}

const names = readdirSync(`${REPO}/svg/Outline`).map((f) => f.replace('.svg', ''));
const accepted = [];
const rejected = [];
for (const name of names) {
  if (anatomy.glyphs[name]) continue; // уже размечен
  const oC = renderedPathData(readFileSync(`${REPO}/svg/Outline/${name}.svg`, 'utf8')).join('');
  const fC = renderedPathData(readFileSync(`${REPO}/svg/Filled/${name}_filled.svg`, 'utf8')).join('');
  const oPolys = samplePolylines(oC, 32).filter((p) => p.length > 2);
  const fPolys = samplePolylines(fC, 32).filter((p) => p.length > 2);
  if (oPolys.length !== 2 || fPolys.length !== 1) continue;
  const [outer, inner] = oPolys.map((p) => ({ p, bb: bbox(p) })).sort((a, b) => b.bb.w * b.bb.h - a.bb.w * a.bb.h);
  if (rectness(outer.p) < 0.55) continue; // не прямоугольная рамка
  const R = cornerR(outer.p, outer.bb);
  if (!R || R < 0.8 || R > 6) continue;
  // перо: офсет рамки
  const pen = ((inner.bb.x0 - outer.bb.x0) + (outer.bb.x1 - inner.bb.x1) + (inner.bb.y0 - outer.bb.y0) + (outer.bb.y1 - inner.bb.y1)) / 4;
  const entry = {
    archetype: 'rounded-rect-container',
    status: { outline: 'hand', filled: 'hand' },
    params: {
      cx: ((outer.bb.x0 + outer.bb.x1) / 2) / 24,
      cy: ((outer.bb.y0 + outer.bb.y1) / 2) / 24,
      w: outer.bb.w / 24,
      h: outer.bb.h / 24,
      rOuter: R / 24,
    },
    weights: { outline: Math.abs(pen - 1.8) < 0.25 ? 'base' : +(pen / 24).toFixed(6) },
  };
  let built;
  try {
    built = buildGlyph(entry, grid);
  } catch {
    continue;
  }
  const iouO = inkIoU(built.outline, oC, 24);
  const iouF = inkIoU(built.filled, fC, 24);
  if (iouO >= 0.97 && iouF >= 0.97) {
    accepted.push({ name, entry, iouO, iouF, pen, R });
  } else {
    rejected.push(`${name}: IoU O ${(iouO * 100).toFixed(1)} F ${(iouF * 100).toFixed(1)} (перо ${pen.toFixed(2)}, R ${R.toFixed(2)})`);
  }
}

console.log(`ПРИНЯТО ${accepted.length}:`);
for (const a of accepted) {
  console.log(`  ${a.name}: IoU O ${(a.iouO * 100).toFixed(2)} F ${(a.iouF * 100).toFixed(2)} | ${(a.entry.params.w * 24).toFixed(1)}×${(a.entry.params.h * 24).toFixed(1)} R ${a.R.toFixed(2)} перо ${a.pen.toFixed(2)}`);
}
console.log(`Отклонено кандидатов: ${rejected.length}`);
for (const r of rejected.slice(0, 8)) console.log('  ✗ ' + r);

if (WRITE && accepted.length) {
  for (const a of accepted) {
    // доли: округлить до 6 знаков
    for (const k of Object.keys(a.entry.params)) a.entry.params[k] = Math.round(a.entry.params[k] * 1e6) / 1e6;
    anatomy.glyphs[a.name] = a.entry;
  }
  writeFileSync(`${REPO}/semantics/anatomy.json`, JSON.stringify(anatomy, null, 1));
  console.log(`ЗАПИСАНО деклараций: ${accepted.length}`);
}
