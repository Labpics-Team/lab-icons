/**
 * system/core/path.js — модель пути.
 *
 * Дуга хранится ЦЕНТРОМ И УГЛАМИ, а не эндпоинт-параметризацией SVG. Это не
 * стилистика: центр — та самая ось, вокруг которой глиф будет вращаться на
 * этапе анимации (reload по оси кругового штриха, earth вокруг своей). Хранить
 * дугу эндпоинтами значит выбросить ось и потом угадывать её обратно.
 *
 * Сегменты:
 *   {k:'L', to}
 *   {k:'A', c, r, a0, a1, to}   — точная окружная дуга; знак (a1−a0) = направление
 *   {k:'C', c1, c2, to}         — кубика (только там, где кривая НЕ окружная)
 */

import { EPS, TEPS, fmt, fmtP, v2, norm2pi } from './num.js';

const TAU = Math.PI * 2;

export class Path {
  constructor(subs = []) {
    /** @type {{from:number[], segs:object[], closed:boolean}[]} */
    this.subs = subs;
  }

  get last() {
    return this.subs[this.subs.length - 1];
  }

  /** Текущая точка пера. */
  get cur() {
    const s = this.last;
    if (!s) return null;
    return s.segs.length ? s.segs[s.segs.length - 1].to : s.from;
  }

  move(p) {
    this.subs.push({ from: [p[0], p[1]], segs: [], closed: false });
    return this;
  }

  line(p) {
    this.last.segs.push({ k: 'L', to: [p[0], p[1]] });
    return this;
  }

  curve(c1, c2, p) {
    this.last.segs.push({ k: 'C', c1: [c1[0], c1[1]], c2: [c2[0], c2[1]], to: [p[0], p[1]] });
    return this;
  }

  /**
   * Дуга от текущего угла a0 до a1 вокруг центра c радиуса r.
   * Направление задаётся знаком (a1 − a0) — никаких флагов «по/против».
   */
  arc(c, r, a0, a1) {
    const to = v2.polar(c, r, a1);
    if (!this.last || this.last.segs.length === 0) {
      const from = v2.polar(c, r, a0);
      if (!this.last) this.move(from);
      else if (!v2.eq(this.last.from, from)) this.move(from);
    }
    this.last.segs.push({ k: 'A', c: [c[0], c[1]], r, a0, a1, to });
    return this;
  }

  /** Начать подпуть дугой (аналог move+arc). */
  arcFrom(c, r, a0, a1) {
    this.move(v2.polar(c, r, a0));
    return this.arc(c, r, a0, a1);
  }

  close() {
    if (this.last) this.last.closed = true;
    return this;
  }

  /** Присоединить подпути другого пути (без изменения исходного). */
  add(other) {
    if (!other) return this;
    for (const s of other.subs) this.subs.push(cloneSub(s));
    return this;
  }

  clone() {
    return new Path(this.subs.map(cloneSub));
  }

  isEmpty() {
    return this.subs.length === 0 || this.subs.every((s) => s.segs.length === 0);
  }

  /** Строка d-атрибута. Узлы сливаются на выводе — модель не трогается. */
  toD() {
    let d = '';
    for (const sub of this.subs) {
      if (!sub.segs.length) continue;
      d += `M${fmtP(sub.from)}`;
      let cur = sub.from;
      for (const s of mergeSegs(sub.from, sub.segs)) {
        if (s.k === 'L') {
          if (Math.abs(s.to[0] - cur[0]) < 5e-4) d += `V${fmt(s.to[1])}`;
          else if (Math.abs(s.to[1] - cur[1]) < 5e-4) d += `H${fmt(s.to[0])}`;
          else d += `L${fmtP(s.to)}`;
        } else if (s.k === 'C') {
          d += `C${fmtP(s.c1)} ${fmtP(s.c2)} ${fmtP(s.to)}`;
        } else {
          d += arcD(s);
        }
        cur = s.to;
      }
      if (sub.closed) d += 'Z';
    }
    return d;
  }

  /** Плоские рёбра для булевых операций и метрик. */
  edges() {
    const out = [];
    for (let i = 0; i < this.subs.length; i++) {
      const sub = this.subs[i];
      let cur = sub.from;
      for (const s of sub.segs) {
        out.push(toEdge(cur, s, i));
        cur = s.to;
      }
      if (sub.closed && !v2.eq(cur, sub.from)) {
        out.push({ type: 'line', a: cur, b: sub.from, sub: i });
      }
    }
    return out;
  }

  /** Полилинии (по подпутям) с заданной стрелкой прогиба. */
  flatten(tol = 0.02) {
    const out = [];
    for (const sub of this.subs) {
      const pts = [sub.from.slice()];
      let cur = sub.from;
      for (const s of sub.segs) {
        flattenSeg(cur, s, tol, pts);
        cur = s.to;
      }
      if (sub.closed && v2.eq(pts[pts.length - 1], pts[0])) pts.pop();
      if (pts.length > 1) out.push(pts);
    }
    return out;
  }

  bbox(tol = 0.005) {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const poly of this.flatten(tol)) {
      for (const p of poly) {
        if (p[0] < x0) x0 = p[0];
        if (p[1] < y0) y0 = p[1];
        if (p[0] > x1) x1 = p[0];
        if (p[1] > y1) y1 = p[1];
      }
    }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
  }

  /** Знаковая площадь подпути (y вниз: положительная = по часовой). */
  subArea(i, tol = 0.01) {
    const poly = polyOf(this.subs[i], tol);
    let a = 0;
    for (let j = 0; j < poly.length; j++) {
      const p = poly[j];
      const n = poly[(j + 1) % poly.length];
      a += p[0] * n[1] - n[0] * p[1];
    }
    return a / 2;
  }

  /** Развернуть подпуть i (для выреза негативом при fill-rule nonzero). */
  reverseSub(i) {
    this.subs[i] = reverseSub(this.subs[i]);
    return this;
  }

  reverse() {
    this.subs = this.subs.map(reverseSub);
    return this;
  }

  /**
   * Аффинное преобразование ПОДОБИЯ (перенос/поворот/равномерный масштаб/
   * отражение). Только оно сохраняет окружную дугу окружной — потому только
   * оно и разрешено: неравномерный масштаб превратил бы перо в переменное.
   */
  transform(m) {
    const det = m.a * m.d - m.b * m.c;
    const k = Math.sqrt(Math.abs(det));
    const flip = det < 0;
    const ap = (p) => [m.a * p[0] + m.c * p[1] + m.e, m.b * p[0] + m.d * p[1] + m.f];
    const angOf = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
    for (const sub of this.subs) {
      let cur = sub.from;
      const segs = [];
      for (const s of sub.segs) {
        if (s.k === 'L') segs.push({ k: 'L', to: ap(s.to) });
        else if (s.k === 'C') segs.push({ k: 'C', c1: ap(s.c1), c2: ap(s.c2), to: ap(s.to) });
        else {
          const c = ap(s.c);
          const p0 = ap(v2.polar(s.c, s.r, s.a0));
          const p1 = ap(s.to);
          const b0 = angOf(c, p0);
          let delta = s.a1 - s.a0;
          if (flip) delta = -delta;
          segs.push({ k: 'A', c, r: s.r * k, a0: b0, a1: b0 + delta, to: p1 });
        }
        cur = s.to;
      }
      sub.from = ap(sub.from);
      sub.segs = segs;
    }
    return this;
  }

  translate(dx, dy) {
    return this.transform({ a: 1, b: 0, c: 0, d: 1, e: dx, f: dy });
  }

  /** Поворот вокруг точки на угол (радианы). */
  rotate(ang, about = [0, 0]) {
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return this.transform({
      a: c,
      b: s,
      c: -s,
      d: c,
      e: about[0] - c * about[0] + s * about[1],
      f: about[1] - s * about[0] - c * about[1],
    });
  }

  /** Зеркало относительно вертикали x = ax. */
  mirrorX(ax) {
    return this.transform({ a: -1, b: 0, c: 0, d: 1, e: 2 * ax, f: 0 });
  }

  /** Зеркало относительно горизонтали y = ay. */
  mirrorY(ay) {
    return this.transform({ a: 1, b: 0, c: 0, d: -1, e: 0, f: 2 * ay });
  }

  scale(k, about = [0, 0]) {
    return this.transform({
      a: k,
      b: 0,
      c: 0,
      d: k,
      e: about[0] * (1 - k),
      f: about[1] * (1 - k),
    });
  }
}

// ── помощники модели ──

export function cloneSub(s) {
  return {
    from: s.from.slice(),
    closed: s.closed,
    segs: s.segs.map((g) =>
      g.k === 'A'
        ? { k: 'A', c: g.c.slice(), r: g.r, a0: g.a0, a1: g.a1, to: g.to.slice() }
        : g.k === 'C'
          ? { k: 'C', c1: g.c1.slice(), c2: g.c2.slice(), to: g.to.slice() }
          : { k: 'L', to: g.to.slice() },
    ),
  };
}

function reverseSub(sub) {
  const pts = [sub.from, ...sub.segs.map((s) => s.to)];
  const segs = [];
  for (let i = sub.segs.length - 1; i >= 0; i--) {
    const s = sub.segs[i];
    const to = pts[i];
    if (s.k === 'L') segs.push({ k: 'L', to: to.slice() });
    else if (s.k === 'C') segs.push({ k: 'C', c1: s.c2.slice(), c2: s.c1.slice(), to: to.slice() });
    else segs.push({ k: 'A', c: s.c.slice(), r: s.r, a0: s.a1, a1: s.a0, to: to.slice() });
  }
  return { from: pts[pts.length - 1].slice(), segs, closed: sub.closed };
}

/**
 * СЛИЯНИЕ УЗЛОВ НА ВЫВОДЕ — точная операция, не упрощение.
 *
 * Конструктор естественно порождает соседние дуги одной окружности (у креста
 * два смежных скругления плеча — это один полукруглый терминал, разрезанный
 * пополам вершиной многоугольника). Оставить их порознь значит поставить в
 * контур лишний узел там, где рука ставит один: у неё plus — 14 команд, а у
 * наивного вывода 21. Лишний узел — это лишняя точка, которая на этапе
 * анимации поедет отдельно от соседей.
 *
 * Сливаются только СТРОГО совпадающие вещи: дуги с общим центром, радиусом и
 * стыкующимся углом; сонаправленные коллинеарные прямые; вырожденные сегменты
 * выбрасываются. Модель при этом не меняется — центры дуг остаются на месте.
 */
function mergeSegs(from, segs) {
  const out = [];
  let cur = from;
  for (const s of segs) {
    const prev = out[out.length - 1];
    const start = out.length ? out[out.length - 1].to : from;

    if (s.k === 'L' && v2.dist(start, s.to) < 1e-9) continue;
    if (s.k === 'A' && Math.abs(s.a1 - s.a0) < 1e-9) continue;

    if (prev && prev.k === 'A' && s.k === 'A' && prev.r === s.r && v2.eq(prev.c, s.c, 1e-9)) {
      const d1 = prev.a1 - prev.a0;
      const d2 = s.a1 - s.a0;
      // Углы могут отличаться на целый оборот (ветвь atan2 у соседних вершин
      // разная) — стык проверяется по модулю 2π, а не вычитанием «в лоб».
      const dd = s.a0 - prev.a1;
      const joined = Math.abs(dd - Math.round(dd / TAU) * TAU) < 1e-9;
      if (joined && Math.sign(d1) === Math.sign(d2) && Math.abs(d1 + d2) < TAU - 1e-9) {
        out[out.length - 1] = { k: 'A', c: prev.c, r: prev.r, a0: prev.a0, a1: prev.a0 + d1 + d2, to: s.to };
        continue;
      }
    }
    if (prev && prev.k === 'L' && s.k === 'L') {
      const a = v2.norm(v2.sub(prev.to, out.length > 1 ? out[out.length - 2].to : from));
      const b = v2.norm(v2.sub(s.to, prev.to));
      if (Math.abs(v2.cross(a, b)) < 1e-9 && v2.dot(a, b) > 0) {
        out[out.length - 1] = { k: 'L', to: s.to };
        continue;
      }
    }
    out.push(s);
    cur = s.to;
  }
  return out;
}

function arcD(s) {
  const delta = s.a1 - s.a0;
  const sweep = delta > 0 ? 1 : 0;
  const abs = Math.abs(delta);
  if (abs >= TAU - 1e-6) {
    // Полная окружность неоднозначна одной дугой — рубим пополам.
    const mid = v2.polar(s.c, s.r, s.a0 + delta / 2);
    return (
      `A${fmt(s.r)} ${fmt(s.r)} 0 0 ${sweep} ${fmtP(mid)}` +
      `A${fmt(s.r)} ${fmt(s.r)} 0 0 ${sweep} ${fmtP(s.to)}`
    );
  }
  const large = abs > Math.PI ? 1 : 0;
  return `A${fmt(s.r)} ${fmt(s.r)} 0 ${large} ${sweep} ${fmtP(s.to)}`;
}

function toEdge(from, s, sub) {
  if (s.k === 'L') return { type: 'line', a: from.slice(), b: s.to.slice(), sub };
  if (s.k === 'C') return { type: 'cubic', p: [from.slice(), s.c1, s.c2, s.to], sub };
  return { type: 'arc', c: s.c, r: s.r, a0: s.a0, a1: s.a1, a: from.slice(), b: s.to.slice(), sub };
}

function flattenSeg(from, s, tol, out) {
  if (s.k === 'L') {
    out.push(s.to.slice());
    return;
  }
  if (s.k === 'A') {
    const delta = s.a1 - s.a0;
    const step = s.r <= tol ? Math.PI / 2 : 2 * Math.acos(Math.max(-1, 1 - tol / s.r));
    const n = Math.max(2, Math.ceil(Math.abs(delta) / Math.min(step, Math.PI / 2)));
    for (let i = 1; i <= n; i++) out.push(v2.polar(s.c, s.r, s.a0 + (delta * i) / n));
    return;
  }
  const n = cubicSteps(from, s.c1, s.c2, s.to, tol);
  for (let i = 1; i <= n; i++) out.push(cubicAt(from, s.c1, s.c2, s.to, i / n));
}

function cubicSteps(p0, p1, p2, p3, tol) {
  const d = Math.max(v2.dist(p0, p1) + v2.dist(p1, p2) + v2.dist(p2, p3), TEPS);
  return Math.max(4, Math.min(96, Math.ceil(Math.sqrt(d / Math.max(tol, 1e-4)) * 1.2)));
}

export function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return [
    a * p0[0] + b * p1[0] + c * p2[0] + d * p3[0],
    a * p0[1] + b * p1[1] + c * p2[1] + d * p3[1],
  ];
}

function polyOf(sub, tol) {
  const pts = [sub.from.slice()];
  let cur = sub.from;
  for (const s of sub.segs) {
    flattenSeg(cur, s, tol, pts);
    cur = s.to;
  }
  if (v2.eq(pts[pts.length - 1], pts[0])) pts.pop();
  return pts;
}

/** Точка на ребре по параметру t∈[0,1]. */
export function edgeAt(e, t) {
  if (e.type === 'line') return [e.a[0] + (e.b[0] - e.a[0]) * t, e.a[1] + (e.b[1] - e.a[1]) * t];
  if (e.type === 'arc') return v2.polar(e.c, e.r, e.a0 + (e.a1 - e.a0) * t);
  return cubicAt(e.p[0], e.p[1], e.p[2], e.p[3], t);
}

/** Разрез ребра по возрастающему списку параметров. */
export function splitEdge(e, ts) {
  const cuts = [0, ...ts.filter((t) => t > TEPS && t < 1 - TEPS).sort((x, y) => x - y), 1];
  const parts = [];
  for (let i = 0; i < cuts.length - 1; i++) {
    const t0 = cuts[i];
    const t1 = cuts[i + 1];
    if (t1 - t0 < TEPS) continue;
    parts.push(subEdge(e, t0, t1));
  }
  return parts;
}

export function subEdge(e, t0, t1) {
  if (e.type === 'line') return { ...e, a: edgeAt(e, t0), b: edgeAt(e, t1) };
  if (e.type === 'arc') {
    const a0 = e.a0 + (e.a1 - e.a0) * t0;
    const a1 = e.a0 + (e.a1 - e.a0) * t1;
    return { ...e, a0, a1, a: v2.polar(e.c, e.r, a0), b: v2.polar(e.c, e.r, a1) };
  }
  const p = cubicSlice(e.p, t0, t1);
  return { ...e, p };
}

function cubicSlice(p, t0, t1) {
  const right = cubicRight(p, t0);
  const u = t1 === 1 ? 1 : (t1 - t0) / (1 - t0);
  return cubicLeft(right, u);
}
function cubicLeft(p, t) {
  const [p0, p1, p2, p3] = p;
  const a = v2.mad(p0, v2.sub(p1, p0), t);
  const b = v2.mad(p1, v2.sub(p2, p1), t);
  const c = v2.mad(p2, v2.sub(p3, p2), t);
  const d = v2.mad(a, v2.sub(b, a), t);
  const e = v2.mad(b, v2.sub(c, b), t);
  return [p0, a, d, v2.mad(d, v2.sub(e, d), t)];
}
function cubicRight(p, t) {
  const [p0, p1, p2, p3] = p;
  const a = v2.mad(p0, v2.sub(p1, p0), t);
  const b = v2.mad(p1, v2.sub(p2, p1), t);
  const c = v2.mad(p2, v2.sub(p3, p2), t);
  const d = v2.mad(a, v2.sub(b, a), t);
  const e = v2.mad(b, v2.sub(c, b), t);
  return [v2.mad(d, v2.sub(e, d), t), e, c, p3];
}

/** Сборка пути из последовательности рёбер (рёбра должны стыковаться). */
export function pathFromEdges(edges, closed = true) {
  const p = new Path();
  if (!edges.length) return p;
  p.move(edgeStart(edges[0]));
  for (const e of edges) {
    if (e.type === 'line') p.line(e.b);
    else if (e.type === 'arc') p.last.segs.push({ k: 'A', c: e.c, r: e.r, a0: e.a0, a1: e.a1, to: v2.polar(e.c, e.r, e.a1) });
    else p.curve(e.p[1], e.p[2], e.p[3]);
  }
  if (closed) p.close();
  return p;
}

export const edgeStart = (e) => (e.type === 'cubic' ? e.p[0] : e.type === 'arc' ? v2.polar(e.c, e.r, e.a0) : e.a);
export const edgeEnd = (e) => (e.type === 'cubic' ? e.p[3] : e.type === 'arc' ? v2.polar(e.c, e.r, e.a1) : e.b);

/** Длина ребра (для эвристик и метрик). */
export function edgeLen(e) {
  if (e.type === 'line') return v2.dist(e.a, e.b);
  if (e.type === 'arc') return Math.abs(e.a1 - e.a0) * e.r;
  let l = 0;
  let prev = e.p[0];
  for (let i = 1; i <= 16; i++) {
    const cur = cubicAt(e.p[0], e.p[1], e.p[2], e.p[3], i / 16);
    l += v2.dist(prev, cur);
    prev = cur;
  }
  return l;
}

export { TAU, norm2pi, EPS };
