/**
 * scripts/lib/ring-canon.js — измерение keyline-кольца (enclosure ring).
 *
 * Корпус легально несёт ДВА канона веса кольца-обрамления (grid.json BL-017:
 * контейнер 1.50 оптически легче глифа; предметный круг 1.80 на базисе).
 * Этот модуль даёт исполняемое измерение: радиальный ray-scan вокруг центра
 * чернил находит внешнее кольцо (внешний край ≈ keyline r=11) и возвращает
 * медианную толщину и разброс (thSpread). Медиана устойчива к локальным
 * слияниям глифа с кольцом (ban-слэш и т.п.); разброс — их детектор.
 */

import { renderedPathData } from './icon-geometry.js';
import { samplePolylines } from './curve-sampling.js';

/**
 * Легальные веса кольца (grid BL-017): 1.5 — контейнер-обрамление (оптически
 * легче глифа), 1.8 — предметный круг на базисе Regular, 2.4 — Bold-начертание
 * штрихового кольца в Filled (ban: filled = Bold того же штриха).
 */
export const RING_CANONS = Object.freeze([1.5, 1.8, 2.4]);
/** Допуск медианы к канону: половина шага между канонами (0.3/2). */
export const CANON_TOLERANCE = 0.15;
/** Порог равномерности кольца (census владельца: thSpread > 0.08 = дефект). */
export const SPREAD_LIMIT = 0.08;

const ANGLES = 96;

function inkPolylines(svg) {
  return renderedPathData(svg)
    .flatMap((d) => samplePolylines(d, 24))
    .filter((p) => p.length > 2);
}

function inkBBoxCenter(polys) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of polys) for (const [x, y] of p) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [(minX + maxX) / 2, (minY + maxY) / 2];
}

/** Чётно-нечётные ink-интервалы вдоль луча из center под углом theta. */
function radialRuns(polys, center, theta) {
  const [cx, cy] = center;
  const dx = Math.cos(theta), dy = Math.sin(theta);
  const ts = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      // пересечение луча C+tD (t>0) с сегментом A+sE (0<=s<1), Крамер:
      // tD - sE = A - C; t = ((A-C)×E)/(D×E), s = ((A-C)×D)/(D×E)
      const ex = x2 - x1, ey = y2 - y1;
      const denom = dx * ey - dy * ex;
      if (Math.abs(denom) < 1e-12) continue;
      const ax = x1 - cx, ay = y1 - cy;
      const t = (ax * ey - ay * ex) / denom;
      const s = (ax * dy - ay * dx) / denom;
      if (t > 1e-9 && s >= 0 && s < 1) ts.push(t);
    }
  }
  ts.sort((a, b) => a - b);
  // Нечётное число пересечений = центр сам внутри чернил (глиф через центр,
  // напр. восклицательный столб alert-circle): луч начинается в чернилах.
  if (ts.length % 2 === 1) ts.unshift(0);
  const runs = [];
  for (let i = 0; i + 1 < ts.length; i += 2) runs.push([ts[i], ts[i + 1]]);
  return runs;
}

/**
 * Измеряет внешнее keyline-кольцо SVG.
 * @param {string} svg
 * @returns {{found:boolean, median:number, spread:number, outerRadius:number,
 *            coverage:number}}
 *   found=false, если внешний край кольца ≈11 виден меньше чем на 90% углов.
 */
export function measureRing(svg) {
  const polys = inkPolylines(svg);
  if (polys.length === 0) return { found: false, median: 0, spread: 0, outerRadius: 0, coverage: 0 };
  const center = inkBBoxCenter(polys);
  const thicknesses = [];
  let outerSum = 0;
  for (let a = 0; a < ANGLES; a++) {
    const theta = (2 * Math.PI * a) / ANGLES;
    const runs = radialRuns(polys, center, theta);
    if (runs.length === 0) continue;
    const outer = runs[runs.length - 1];
    // keyline-кольцо: внешний край в окне 10.5..11.5 и это аннулюс, а не
    // сплошной диск/слияние на весь радиус (толщина луча < 3).
    if (outer[1] < 10.5 || outer[1] > 11.5) continue;
    if (outer[1] - outer[0] >= 3) continue;
    thicknesses.push(outer[1] - outer[0]);
    outerSum += outer[1];
  }
  const coverage = thicknesses.length / ANGLES;
  if (coverage < 0.9) return { found: false, median: 0, spread: 0, outerRadius: 0, coverage };
  const sorted = [...thicknesses].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  // разброс по устойчивым квантилям (p2/p98): единичные лучи через слияние
  // глифа с кольцом не должны маскировать канон, но реальная неравномерность
  // (полукольца двух весов) обязана быть видна.
  const p2 = sorted[Math.floor(sorted.length * 0.02)];
  const p98 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.98))];
  return {
    found: true,
    median: +median.toFixed(3),
    spread: +(p98 - p2).toFixed(3),
    outerRadius: +(outerSum / thicknesses.length).toFixed(3),
    coverage: +coverage.toFixed(3),
  };
}

/** Ближайший легальный канон к измеренной медиане. */
export function nearestCanon(median) {
  return RING_CANONS.reduce((best, canon) => (
    Math.abs(canon - median) < Math.abs(best - median) ? canon : best
  ));
}

function circleFit(poly) {
  // Kåsa least-squares: минимизирует Σ(x²+y²+Dx+Ey+F)² — устойчив к
  // неравномерной дискретизации дуг (центроид полилинии смещён и даёт
  // ложный «разброс» ~0.1 на идеальных кольцах).
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sxz = 0, syz = 0, sz = 0;
  const n = poly.length;
  for (const [x, y] of poly) {
    const z = x * x + y * y;
    sxx += x * x; sxy += x * y; syy += y * y;
    sx += x; sy += y;
    sxz += x * z; syz += y * z; sz += z;
  }
  // нормальные уравнения для [D,E,F]
  const A = [
    [sxx, sxy, sx],
    [sxy, syy, sy],
    [sx, sy, n],
  ];
  const b = [-sxz, -syz, -sz];
  // Гаусс 3×3
  for (let i = 0; i < 3; i++) {
    let p = i;
    for (let k = i + 1; k < 3; k++) if (Math.abs(A[k][i]) > Math.abs(A[p][i])) p = k;
    [A[i], A[p]] = [A[p], A[i]];
    [b[i], b[p]] = [b[p], b[i]];
    if (Math.abs(A[i][i]) < 1e-12) return { cx: 0, cy: 0, r: 0, deviation: Infinity };
    for (let k = i + 1; k < 3; k++) {
      const f = A[k][i] / A[i][i];
      for (let j = i; j < 3; j++) A[k][j] -= f * A[i][j];
      b[k] -= f * b[i];
    }
  }
  const sol = [0, 0, 0];
  for (let i = 2; i >= 0; i--) {
    let acc = b[i];
    for (let j = i + 1; j < 3; j++) acc -= A[i][j] * sol[j];
    sol[i] = acc / A[i][i];
  }
  const cx = -sol[0] / 2;
  const cy = -sol[1] / 2;
  const r = Math.sqrt(Math.max(0, cx * cx + cy * cy - sol[2]));
  let rMin = Infinity, rMax = -Infinity;
  for (const [x, y] of poly) {
    const rr = Math.hypot(x - cx, y - cy);
    if (rr < rMin) rMin = rr;
    if (rr > rMax) rMax = rr;
  }
  return { cx, cy, r, deviation: rMax - rMin };
}

/**
 * Все кольца файла: пары вложенных окружность-подобных суб-путей (внешний +
 * внутренний, зазор радиусов < 3.5). Для каждой пары — толщина по углам от
 * центра внешней окружности и её разброс (census владельца: неравномерное
 * кольцо = смещённые/неконцентричные окружности, thSpread > 0.08 — дефект).
 * @returns {Array<{cx:number, cy:number, outerR:number, thickness:number,
 *                  spread:number}>}
 */
export function measureAllRings(svg) {
  const polys = inkPolylines(svg);
  const circles = [];
  for (const poly of polys) {
    const fit = circleFit(poly);
    // окружность-подобный контур: отклонение от идеала < 12% радиуса
    // (squircle-контейнеры и дуги отбрасываются)
    if (fit.r > 0.4 && fit.deviation < Math.max(0.1, fit.r * 0.12)) circles.push(fit);
  }
  circles.sort((a, b) => b.r - a.r);
  const used = new Set();
  const rings = [];
  for (let i = 0; i < circles.length; i++) {
    if (used.has(i)) continue;
    const outer = circles[i];
    let best = -1;
    let bestGap = Infinity;
    for (let j = i + 1; j < circles.length; j++) {
      if (used.has(j)) continue;
      const inner = circles[j];
      const centerDist = Math.hypot(inner.cx - outer.cx, inner.cy - outer.cy);
      const gap = outer.r - inner.r;
      // вложенная пара одного кольца: внутренняя внутри внешней, толщина < 3.5
      if (gap <= 0.05 || gap >= 3.5) continue;
      if (centerDist + inner.r >= outer.r + 0.2) continue;
      if (gap < bestGap) { bestGap = gap; best = j; }
    }
    if (best === -1) continue;
    used.add(i); used.add(best);
    const inner = circles[best];
    const d = Math.hypot(inner.cx - outer.cx, inner.cy - outer.cy);
    // толщина по углу θ: |outer.r - (проекция смещения) - inner.r| точно =
    // outer.r - inner.r ± d; разброс = 2d при неконцентричности
    const thickness = +(outer.r - inner.r).toFixed(3);
    const spread = +(2 * d).toFixed(3);
    rings.push({
      cx: +outer.cx.toFixed(2),
      cy: +outer.cy.toFixed(2),
      outerR: +outer.r.toFixed(3),
      thickness,
      spread,
    });
  }
  return rings;
}
