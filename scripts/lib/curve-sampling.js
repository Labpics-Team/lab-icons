/**
 * scripts/lib/curve-sampling.js — выборка и геометрия кривых (zero-dep).
 * Ядро гейтов СТАТИКИ (анатомия, качество кривых, пары O↔F, сетка):
 * полилинии суб-путей из точного парсера path-data (де Кастельжо/шаг
 * по дуге), пересечение чернил, пересечение отрезков.
 * Transform-функции (parseTransformString/transformPoint/transformAt)
 * используются гейтами моушна в ветке анимаций — модель повторяет
 * рантайм WAAPI (линейная интерполяция аргументов между кадрами).
 *
 * Экспорт:
 *   samplePolylines(d, stepsPerSeg)  → полилинии суб-путей (рёбра/чернила)
 *   inkOverlap(polysA, polysB)       → пересечение чернил (рёбра + even-odd)
 *   segmentsCross(a, b, c, d)        → пересечение отрезков
 *   parseTransformString / transformPoint / transformAt — моушн-модель
 */

import { parsePathData } from './path-data.js';

// ─── Transform-строки генерата ───────────────────────────────────────────────

const FN_RE = /([a-zA-Z]+)\(([^)]*)\)/g;

/** @returns {Array<{fn: string, args: number[]}>} */
export function parseTransformString(s) {
  if (!s) return [];
  const fns = [];
  for (const m of s.matchAll(FN_RE)) {
    const args = m[2]
      .split(',')
      .map((a) => Number.parseFloat(a.trim()));
    if (args.some((v) => !Number.isFinite(v))) {
      throw new Error(`curve-sampling: неконечный аргумент в transform "${s}"`);
    }
    fns.push({ fn: m[1], args });
  }
  return fns;
}

/**
 * Точка после списка transform-функций вокруг якоря.
 * CSS-порядок: левая функция — внешняя, поэтому применяем справа налево.
 */
export function transformPoint(point, fns, anchor) {
  let [x, y] = point;
  const [ax, ay] = anchor;
  for (let i = fns.length - 1; i >= 0; i--) {
    const { fn, args } = fns[i];
    if (fn === 'translate') {
      x += args[0] ?? 0;
      y += args[1] ?? 0;
    } else if (fn === 'rotate') {
      const rad = ((args[0] ?? 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const dx = x - ax;
      const dy = y - ay;
      x = ax + dx * cos - dy * sin;
      y = ay + dx * sin + dy * cos;
    } else if (fn === 'scale') {
      const sx = args[0] ?? 1;
      const sy = args.length > 1 ? args[1] : sx;
      x = ax + (x - ax) * sx;
      y = ay + (y - ay) * sy;
    } else if (fn === 'scaleX') {
      x = ax + (x - ax) * (args[0] ?? 1);
    } else if (fn === 'scaleY') {
      y = ay + (y - ay) * (args[0] ?? 1);
    } else {
      throw new Error(`curve-sampling: неизвестная transform-функция "${fn}"`);
    }
  }
  return [x, y];
}

// ─── Значение transform части во времени (delay/стаггер/fill both) ──────────

/**
 * @param {{keyframes: Array<{offset:number, transform?:string}>,
 *          timing: {duration:number, delay:number}}} part
 * @param {number} tMs — момент от старта анимации иконки
 * @param {number} staggerDelayMs — добавка стаггера этого таргета
 */
export function transformAt(part, tMs, staggerDelayMs) {
  const start = part.timing.delay + staggerDelayMs;
  const progress = Math.min(1, Math.max(0, (tMs - start) / part.timing.duration));
  const kfs = part.keyframes;
  let hi = kfs.findIndex((k) => k.offset >= progress);
  if (hi === -1) hi = kfs.length - 1;
  if (hi === 0) return parseTransformString(kfs[0].transform);
  const a = kfs[hi - 1];
  const b = kfs[hi];
  const span = b.offset - a.offset;
  const w = span > 0 ? (progress - a.offset) / span : 1;
  const fa = parseTransformString(a.transform);
  const fb = parseTransformString(b.transform);
  if (fa.length !== fb.length) {
    throw new Error('curve-sampling: структура transform между кадрами не совпадает');
  }
  return fa.map((f, i) => ({
    fn: f.fn,
    args: f.args.map((v, j) => v + ((fb[i].args[j] ?? v) - v) * w),
  }));
}

// ─── Полилинии суб-путей ─────────────────────────────────────────────────────

function cubicAt(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function quadAt(p0, p1, p2, t) {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

/** Центральная параметризация дуги (W3C SVG 1.1 B.2.4), как в path-data. */
function arcSamples(cx, cy, seg, steps, out) {
  const { rx: rxRaw, ry: ryRaw, rotation, largeArc, sweep, x, y } = seg;
  let rx = Math.abs(rxRaw);
  let ry = Math.abs(ryRaw);
  if (rx === 0 || ry === 0 || (cx === x && cy === y)) {
    out.push([x, y]);
    return;
  }
  const phi = (rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (cx - x) / 2;
  const dy2 = (cy - y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const sign = largeArc !== sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const ccx = cosPhi * cxp - sinPhi * cyp + (cx + x) / 2;
  const ccy = sinPhi * cxp + cosPhi * cyp + (cy + y) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep && dTheta < 0) dTheta += 2 * Math.PI;
  for (let i = 1; i <= steps; i++) {
    const theta = theta1 + (dTheta * i) / steps;
    const px = rx * Math.cos(theta);
    const py = ry * Math.sin(theta);
    out.push([ccx + cosPhi * px - sinPhi * py, ccy + sinPhi * px + cosPhi * py]);
  }
}

/**
 * Полилинии суб-путей d (раздельно по M — рёбра между суб-путями не выдумываются).
 * @returns {Array<Array<[number, number]>>}
 */
export function samplePolylines(d, stepsPerSeg = 8) {
  const segs = parsePathData(d);
  const polys = [];
  let poly = null;
  let cx = 0;
  let cy = 0;
  let sx = 0;
  let sy = 0;
  for (const seg of segs) {
    if (seg.cmd === 'M') {
      poly = [[seg.x, seg.y]];
      polys.push(poly);
      cx = seg.x;
      cy = seg.y;
      sx = seg.x;
      sy = seg.y;
      continue;
    }
    if (!poly) continue;
    if (seg.cmd === 'Z') {
      poly.push([sx, sy]);
      cx = sx;
      cy = sy;
      continue;
    }
    if (seg.cmd === 'L') {
      poly.push([seg.x, seg.y]);
    } else if (seg.cmd === 'C') {
      for (let i = 1; i <= stepsPerSeg; i++) {
        const t = i / stepsPerSeg;
        poly.push([cubicAt(cx, seg.x1, seg.x2, seg.x, t), cubicAt(cy, seg.y1, seg.y2, seg.y, t)]);
      }
    } else if (seg.cmd === 'Q') {
      for (let i = 1; i <= stepsPerSeg; i++) {
        const t = i / stepsPerSeg;
        poly.push([quadAt(cx, seg.x1, seg.x, t), quadAt(cy, seg.y1, seg.y, t)]);
      }
    } else if (seg.cmd === 'A') {
      arcSamples(cx, cy, seg, stepsPerSeg, poly);
    }
    cx = seg.x;
    cy = seg.y;
  }
  return polys;
}

// ─── Пересечение чернил (even-odd) ───────────────────────────────────────────

export function segmentsCross(a1, a2, b1, b2) {
  const d = (p, q, r) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = d(b1, b2, a1);
  const d2 = d(b1, b2, a2);
  const d3 = d(a1, a2, b1);
  const d4 = d(a1, a2, b2);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Точка внутри чернил фигуры (even-odd по ВСЕМ суб-путям — дырки честные). */
function pointInInk(point, polys) {
  const [px, py] = point;
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i];
      const [xj, yj] = poly[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

function polyBounds(polys) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const poly of polys) {
    for (const [x, y] of poly) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

/**
 * Наслоение чернил двух фигур: пересечение рёбер контуров ИЛИ точка одной
 * фигуры внутри чернил другой (покрывает полное поглощение без пересечений).
 */
export function inkOverlap(polysA, polysB) {
  const ba = polyBounds(polysA);
  const bb = polyBounds(polysB);
  if (ba.minX > bb.maxX || bb.minX > ba.maxX || ba.minY > bb.maxY || bb.minY > ba.maxY) {
    return false;
  }
  for (const pa of polysA) {
    for (let i = 0; i + 1 < pa.length; i++) {
      for (const pb of polysB) {
        for (let j = 0; j + 1 < pb.length; j++) {
          if (segmentsCross(pa[i], pa[i + 1], pb[j], pb[j + 1])) return true;
        }
      }
    }
  }
  if (!polysA.length || !polysB.length || !polysA[0].length || !polysB[0].length) return false;
  return pointInInk(polysA[0][0], polysB) || pointInInk(polysB[0][0], polysA);
}
