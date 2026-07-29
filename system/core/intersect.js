/**
 * system/core/intersect.js — пересечения аналитических рёбер.
 *
 * Прямая×прямая, прямая×дуга, дуга×дуга решаются формулой (точно). Кубика
 * решается сходящимся делением пополам по перекрытию габаритов + уточнением.
 * Полигонализация не применяется НИГДЕ: она даёт ступеньки на скруглениях —
 * ровно тот дефект, ради устранения которого написан этот файл.
 */

import { TEPS, v2 } from './num.js';
import { edgeAt, edgeLen, subEdge } from './path.js';

const TAU = Math.PI * 2;
/** Допуск попадания в параметрический диапазон ребра. */
const PAD = 1e-7;

/** Параметр t точки на дуге (или null, если точка вне углового диапазона). */
function arcT(e, p) {
  const a = Math.atan2(p[1] - e.c[1], p[0] - e.c[0]);
  const d = e.a1 - e.a0;
  if (Math.abs(d) < TEPS) return null;
  // подобрать ветвь угла, попадающую в [a0, a1]
  for (let k = -2; k <= 2; k++) {
    const t = (a + k * TAU - e.a0) / d;
    if (t >= -PAD && t <= 1 + PAD) return Math.min(1, Math.max(0, t));
  }
  return null;
}

function lineT(e, p) {
  const dx = e.b[0] - e.a[0];
  const dy = e.b[1] - e.a[1];
  const l2 = dx * dx + dy * dy;
  if (l2 < TEPS) return null;
  const t = ((p[0] - e.a[0]) * dx + (p[1] - e.a[1]) * dy) / l2;
  return t >= -PAD && t <= 1 + PAD ? Math.min(1, Math.max(0, t)) : null;
}

/** Параметр точки на ребре любого типа. */
export function paramAt(e, p) {
  if (e.type === 'line') return lineT(e, p);
  if (e.type === 'arc') return arcT(e, p);
  return cubicT(e, p);
}

function cubicT(e, p) {
  let best = null;
  let bestD = Infinity;
  const N = 64;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const d = v2.dist(edgeAt(e, t), p);
    if (d < bestD) {
      bestD = d;
      best = t;
    }
  }
  // уточнение золотым делением по окрестности
  let lo = Math.max(0, best - 1 / N);
  let hi = Math.min(1, best + 1 / N);
  for (let i = 0; i < 60; i++) {
    const m1 = lo + (hi - lo) / 3;
    const m2 = hi - (hi - lo) / 3;
    if (v2.dist(edgeAt(e, m1), p) < v2.dist(edgeAt(e, m2), p)) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  return v2.dist(edgeAt(e, t), p) < 1e-6 ? t : null;
}

function lineLine(e1, e2) {
  const r = v2.sub(e1.b, e1.a);
  const s = v2.sub(e2.b, e2.a);
  const den = v2.cross(r, s);
  if (Math.abs(den) < 1e-12) return [];
  const qp = v2.sub(e2.a, e1.a);
  const t = v2.cross(qp, s) / den;
  const u = v2.cross(qp, r) / den;
  if (t < -PAD || t > 1 + PAD || u < -PAD || u > 1 + PAD) return [];
  return [{ t1: Math.min(1, Math.max(0, t)), t2: Math.min(1, Math.max(0, u)), p: v2.mad(e1.a, r, t) }];
}

function lineCircle(a, b, c, r) {
  const d = v2.sub(b, a);
  const f = v2.sub(a, c);
  const A = v2.dot(d, d);
  if (A < 1e-14) return [];
  const B = 2 * v2.dot(f, d);
  const C = v2.dot(f, f) - r * r;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return [];
  const sq = Math.sqrt(disc);
  const out = [];
  for (const t of [(-B - sq) / (2 * A), (-B + sq) / (2 * A)]) {
    if (t >= -PAD && t <= 1 + PAD) out.push(v2.mad(a, d, t));
  }
  return out;
}

function circleCircle(c1, r1, c2, r2) {
  const d = v2.dist(c1, c2);
  if (d < 1e-12 || d > r1 + r2 || d < Math.abs(r1 - r2)) return [];
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h2 = r1 * r1 - a * a;
  if (h2 < 0) return [];
  const h = Math.sqrt(h2);
  const m = v2.mad(c1, v2.mul(v2.sub(c2, c1), 1 / d), a);
  const n = [(c2[1] - c1[1]) / d, -(c2[0] - c1[0]) / d];
  if (h < 1e-12) return [m];
  return [v2.mad(m, n, h), v2.mad(m, n, -h)];
}

/** Габарит ребра (для отбраковки при делении кубик×что-угодно). */
function ebox(e) {
  if (e.type === 'line') {
    return [Math.min(e.a[0], e.b[0]), Math.min(e.a[1], e.b[1]), Math.max(e.a[0], e.b[0]), Math.max(e.a[1], e.b[1])];
  }
  if (e.type === 'cubic') {
    const xs = e.p.map((q) => q[0]);
    const ys = e.p.map((q) => q[1]);
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const n = 16;
  for (let i = 0; i <= n; i++) {
    const p = edgeAt(e, i / n);
    x0 = Math.min(x0, p[0]);
    y0 = Math.min(y0, p[1]);
    x1 = Math.max(x1, p[0]);
    y1 = Math.max(y1, p[1]);
  }
  return [x0, y0, x1, y1];
}

const overlap = (A, B) => A[0] <= B[2] + 1e-7 && B[0] <= A[2] + 1e-7 && A[1] <= B[3] + 1e-7 && B[1] <= A[3] + 1e-7;

/** Общий случай с кубикой: рекурсивное деление до сходимости. */
function numeric(e1, e2, t1a = 0, t1b = 1, t2a = 0, t2b = 1, depth = 0, out = []) {
  const s1 = subEdge(e1, t1a, t1b);
  const s2 = subEdge(e2, t2a, t2b);
  if (!overlap(ebox(s1), ebox(s2))) return out;
  const l1 = edgeLen(s1);
  const l2 = edgeLen(s2);
  if (depth > 42 || (l1 < 1e-7 && l2 < 1e-7)) {
    const t1 = (t1a + t1b) / 2;
    const t2 = (t2a + t2b) / 2;
    const p = edgeAt(e1, t1);
    if (v2.dist(p, edgeAt(e2, t2)) < 1e-5 && !out.some((o) => Math.abs(o.t1 - t1) < 1e-6)) {
      out.push({ t1, t2, p });
    }
    return out;
  }
  const m1 = (t1a + t1b) / 2;
  const m2 = (t2a + t2b) / 2;
  const splitA = l1 >= l2;
  if (splitA) {
    numeric(e1, e2, t1a, m1, t2a, t2b, depth + 1, out);
    numeric(e1, e2, m1, t1b, t2a, t2b, depth + 1, out);
  } else {
    numeric(e1, e2, t1a, t1b, t2a, m2, depth + 1, out);
    numeric(e1, e2, t1a, t1b, m2, t2b, depth + 1, out);
  }
  return out;
}

/**
 * Пересечения двух рёбер. Возвращает [{t1, t2, p}], t — параметры на рёбрах.
 */
export function intersectEdges(e1, e2) {
  let pts = null;
  if (e1.type === 'line' && e2.type === 'line') return lineLine(e1, e2);
  if (e1.type === 'line' && e2.type === 'arc') pts = lineCircle(e1.a, e1.b, e2.c, e2.r);
  else if (e1.type === 'arc' && e2.type === 'line') pts = lineCircle(e2.a, e2.b, e1.c, e1.r);
  else if (e1.type === 'arc' && e2.type === 'arc') pts = circleCircle(e1.c, e1.r, e2.c, e2.r);

  if (pts) {
    const out = [];
    for (const p of pts) {
      const t1 = paramAt(e1, p);
      const t2 = paramAt(e2, p);
      if (t1 != null && t2 != null) out.push({ t1, t2, p });
    }
    return out;
  }
  return numeric(e1, e2);
}
