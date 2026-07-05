/**
 * scripts/lib/circle-dictionary.js — словарь конструктивных окружностей
 * (Волна-6, WAVE6-CIRCLES-PREP §2): центральная линия глифа = цепь из дуг
 * окружностей и прямых, стыки — АНАЛИТИЧЕСКИЕ (касания, пересечения,
 * fillet-дуги), никакого подбора точек.
 *
 * Представление цепи (юниты канвы, углы в радианах):
 *   {kind:'line', p0:[x,y], p1:[x,y]}
 *   {kind:'arc', c:[x,y], r, a0, a1, dir}   dir=+1 угол растёт (SVG sweep=1)
 *
 * Оффсеты: смещение точки = s·rot90(t), rot90(t)=(ty,−tx), t — касательная
 * по ходу. Дуга при этом остаётся дугой того же центра (r+dir·s), прямая —
 * параллельной прямой: оффсет ТОЧНЫЙ, без аппроксимаций (преимущество
 * словаря «только окружности»). G1-стыки центральной линии переживают
 * оффсет тождественно (нормаль непрерывна); угловые стыки решаются как у
 * руки: сторона перекрытия — аналитическое пересечение соседних оффсетов,
 * сторона зазора — круглый join R=|s| вокруг вершины (cloud: внутренние
 * дуги R=0.9 у cusp'ов — снято с руки, rms 0.0000).
 */

import { parsePathData } from './path-data.js';

const TAU = Math.PI * 2;
const EPS = 1e-9;
const f3 = (v) => {
  let s = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  s = s.replace(/^(-?)0\./, '$1.');
  return s === '' || s === '-' ? '0' : s;
};
const P = (p) => `${f3(p[0])} ${f3(p[1])}`;
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const norm = (a) => Math.hypot(a[0], a[1]);
const unit = (a) => { const l = norm(a) || 1; return [a[0] / l, a[1] / l]; };
const ept = (c, r, a) => [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)];
const ang = (c, p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
/** Нормализация span в направлении dir: (0, 2π]. */
const spanOf = (a0, a1, dir) => {
  let d = (a1 - a0) * dir;
  d = ((d % TAU) + TAU) % TAU;
  return d < 1e-12 ? TAU : d;
};

export const segStart = (s) => (s.kind === 'line' ? s.p0 : ept(s.c, s.r, s.a0));
export const segEnd = (s) => (s.kind === 'line' ? s.p1 : ept(s.c, s.r, s.a1));
/** Единичная касательная по ходу обхода (atEnd: в конце сегмента). */
export function segTangent(s, atEnd) {
  if (s.kind === 'line') return unit(sub(s.p1, s.p0));
  const a = atEnd ? s.a1 : s.a0;
  return [-Math.sin(a) * s.dir, Math.cos(a) * s.dir];
}

/**
 * d-эмиттер цепи: дуги режутся на куски ≤120° (largeArc не нужен). Дуги,
 * близкие к 180°, вырождены для восстановления центра из концов+радиуса
 * (f3-шум 5e-4 даёт ложные ~0.3° в G1-замере); куски ≤120° обусловлены хорошо.
 */
export function emitChain(chain, closed = true) {
  const MAX_SPAN = (2 * Math.PI) / 3; // 120°
  let d = `M${P(segStart(chain[0]))}`;
  for (const s of chain) {
    if (s.kind === 'line') {
      d += `L${P(s.p1)}`;
    } else {
      const span = spanOf(s.a0, s.a1, s.dir);
      const sweep = s.dir > 0 ? 1 : 0;
      const R = f3(s.r);
      const n = Math.max(1, Math.ceil(span / MAX_SPAN - 1e-9));
      for (let k = 1; k <= n; k++) {
        const a = s.a0 + s.dir * ((span * k) / n);
        d += `A${R} ${R} 0 0 ${sweep} ${P(k === n ? segEnd(s) : ept(s.c, s.r, a))}`;
      }
    }
  }
  return d + (closed ? 'Z' : '');
}

export function reverseChain(chain) {
  return chain
    .slice()
    .reverse()
    .map((s) =>
      s.kind === 'line'
        ? { kind: 'line', p0: s.p1, p1: s.p0 }
        : { kind: 'arc', c: s.c, r: s.r, a0: s.a1, a1: s.a0, dir: -s.dir },
    );
}

/** Знаковая площадь цепи (шнуровка по сэмплам, 24/сегмент). */
export function chainArea(chain) {
  const pts = [];
  for (const s of chain) {
    if (s.kind === 'line') {
      pts.push(s.p0);
    } else {
      const span = spanOf(s.a0, s.a1, s.dir);
      for (let i = 0; i < 24; i++) pts.push(ept(s.c, s.r, s.a0 + s.dir * span * (i / 24)));
    }
  }
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i], q = pts[(i + 1) % pts.length];
    a += p[0] * q[1] - q[0] * p[1];
  }
  return a / 2;
}

// ── аналитические пересечения ──
export function circleCircle(c1, r1, c2, r2) {
  const d = norm(sub(c2, c1));
  if (d < EPS || d > r1 + r2 + EPS || d < Math.abs(r1 - r2) - EPS) return [];
  const a = (d * d + r1 * r1 - r2 * r2) / (2 * d);
  const h2 = r1 * r1 - a * a;
  const h = Math.sqrt(Math.max(0, h2));
  const u = unit(sub(c2, c1));
  const m = add(c1, u, a);
  const n = [-u[1], u[0]];
  return h < EPS ? [m] : [add(m, n, h), add(m, n, -h)];
}
export function lineCircle(p, dvec, c, r) {
  const d = unit(dvec);
  const f = sub(p, c);
  const b = 2 * dot(f, d);
  const q = dot(f, f) - r * r;
  const disc = b * b - 4 * q;
  if (disc < -EPS) return [];
  const sq = Math.sqrt(Math.max(0, disc));
  return [add(p, d, (-b + sq) / 2), add(p, d, (-b - sq) / 2)];
}
export function lineLine(p1, d1, p2, d2) {
  const den = cross(d1, d2);
  if (Math.abs(den) < EPS) return null;
  const t = cross(sub(p2, p1), d2) / den;
  return add(p1, d1, t);
}
const nearest = (cands, hint) =>
  cands.reduce((best, q) => (!best || norm(sub(q, hint)) < norm(sub(best, hint)) ? q : best), null);

// ── резолвер касательной цепи ──
/**
 * Носители (carriers): {circle:{c,r,dir}} | {line:{p,d, end?}} |
 * терминал дуги {circle:{..., endA}} (endA — угол конца в ГРАДУСАХ, для
 * открытых цепей). Соединители (connectors[i] между i и i+1):
 *   {type:'kiss'}                 — точка касания окружностей (на линии центров;
 *                                   инвариант |d−(r1+r2)| или |d−|r1−r2|| ≤ tol);
 *   {type:'touch'}                — касание прямая↔окружность (dist(c,line)≈r);
 *   {type:'corner', hint}         — пересечение носителей, ближайшее к hint;
 *   {type:'tangent', hint}        — общая внешняя касательная двух окружностей
 *                                   (вставляет line-сегмент, G1 с обеих сторон);
 *   {type:'fillet', r, hint}      — дуга радиуса r, касательная обоим носителям.
 * Возвращает цепь и список индексов угловых стыков (для G1-гейта).
 */
export function resolveTangentChain(elements, connectors, closed) {
  const n = elements.length;
  const TOL = 0.05; // допуск деклараций (q6-квант + канон-снап)
  const joints = []; // {at: junction point, corner: bool}
  // junctions[i] — стык между elements[i] и elements[i+1]; для соединителя
  // tangent/fillet — {p1, p2, mid: вставной сегмент}
  const junctions = [];
  const count = closed ? n : n - 1;
  for (let i = 0; i < count; i++) {
    const A = elements[i], B = elements[(i + 1) % n];
    const con = connectors[i] ?? { type: 'corner' };
    if (con.type === 'kiss') {
      if (!A.circle || !B.circle) throw new Error('circle-dictionary: kiss требует две окружности');
      const d = norm(sub(B.circle.c, A.circle.c));
      const ok = Math.abs(d - (A.circle.r + B.circle.r)) <= TOL || Math.abs(d - Math.abs(A.circle.r - B.circle.r)) <= TOL;
      if (!ok) throw new Error(`circle-dictionary: kiss без касания (d=${d.toFixed(4)}, r=${A.circle.r},${B.circle.r})`);
      const p = add(A.circle.c, unit(sub(B.circle.c, A.circle.c)), A.circle.r);
      junctions.push({ p1: p, p2: p });
      joints.push({ at: p, corner: false });
    } else if (con.type === 'touch') {
      const L = A.line ?? B.line, C = A.circle ?? B.circle;
      if (!L || !C) throw new Error('circle-dictionary: touch требует прямую и окружность');
      const dline = unit(L.d);
      const t = dot(sub(C.c, L.p), dline);
      const foot = add(L.p, dline, t);
      const dist = norm(sub(C.c, foot));
      if (Math.abs(dist - C.r) > TOL) {
        throw new Error(`circle-dictionary: touch без касания (dist=${dist.toFixed(4)} ≠ r=${C.r})`);
      }
      // точная точка касания: проекция центра на прямую, снап на окружность
      // (q6-квант деклараций даёт |dist−r| до ~1e-5 — стык обязан лежать
      // ровно на дуге, иначе оффсеты наследуют микрозазор)
      const tp = add(C.c, unit(sub(foot, C.c)), C.r);
      junctions.push({ p1: tp, p2: tp });
      joints.push({ at: tp, corner: false });
    } else if (con.type === 'corner') {
      const hint = con.hint;
      let cands;
      if (A.circle && B.circle) cands = circleCircle(A.circle.c, A.circle.r, B.circle.c, B.circle.r);
      else if (A.line && B.line) { const q = lineLine(A.line.p, A.line.d, B.line.p, B.line.d); cands = q ? [q] : []; }
      else { const L = A.line ?? B.line, C = A.circle ?? B.circle; cands = lineCircle(L.p, L.d, C.c, C.r); }
      if (cands.length === 0) throw new Error('circle-dictionary: corner — носители не пересекаются');
      const p = hint ? nearest(cands, hint) : cands[0];
      junctions.push({ p1: p, p2: p });
      joints.push({ at: p, corner: true });
    } else if (con.type === 'tangent') {
      if (!A.circle || !B.circle) throw new Error('circle-dictionary: tangent требует две окружности');
      const { c: c1, r: r1 } = A.circle, { c: c2, r: r2 } = B.circle;
      const dv = sub(c2, c1), d = norm(dv);
      if (d < Math.abs(r1 - r2) - EPS) throw new Error('circle-dictionary: внешней касательной нет (окружность поглощена)');
      // внешняя касательная: единичная нормаль n, n·(c2−c1) = r1 − r2
      const k = (r1 - r2) / d;
      const u = unit(dv);
      const w = Math.sqrt(Math.max(0, 1 - k * k));
      const nrm = [[u[0] * k - u[1] * w, u[1] * k + u[0] * w], [u[0] * k + u[1] * w, u[1] * k - u[0] * w]];
      const picks = nrm.map((nn) => ({ t1: add(c1, nn, r1), t2: add(c2, nn, r2) }));
      const pick = con.hint
        ? picks.reduce((b, q) => {
            const mid = [(q.t1[0] + q.t2[0]) / 2, (q.t1[1] + q.t2[1]) / 2];
            return !b || norm(sub(mid, con.hint)) < norm(sub(b.mid, con.hint)) ? { ...q, mid } : b;
          }, null)
        : { ...picks[0] };
      junctions.push({ p1: pick.t1, p2: pick.t2, mid: { kind: 'line', p0: pick.t1, p1: pick.t2 } });
      joints.push({ at: pick.t1, corner: false }, { at: pick.t2, corner: false });
    } else if (con.type === 'fillet') {
      const rf = con.r;
      if (!(rf > 0)) throw new Error('circle-dictionary: fillet требует r > 0');
      // локус центров fillet: оффсет каждого носителя на ±rf; перебор знаков,
      // берём кандидата с точками касания ближе всего к hint.
      // Для круга две ветви: внешнее касание (d = R + rf) и внутреннее
      // (d = |R − rf|; rf < R — fillet в носителе, rf > R — носитель в fillet:
      // апексный бленд плоской дугой, eye Волны-6)
      const loci = (E) => {
        if (E.circle) return [{ kind: 'c', c: E.circle.c, r: E.circle.r + rf }, ...(Math.abs(E.circle.r - rf) > EPS ? [{ kind: 'c', c: E.circle.c, r: Math.abs(E.circle.r - rf) }] : [])];
        const dl = unit(E.line.d);
        const nl = [dl[1], -dl[0]];
        return [{ kind: 'l', p: add(E.line.p, nl, rf), d: dl, base: E.line }, { kind: 'l', p: add(E.line.p, nl, -rf), d: dl, base: E.line }];
      };
      let best = null;
      for (const la of loci(A)) {
        for (const lb of loci(B)) {
          let cs = [];
          if (la.kind === 'c' && lb.kind === 'c') cs = circleCircle(la.c, la.r, lb.c, lb.r);
          else if (la.kind === 'l' && lb.kind === 'l') { const q = lineLine(la.p, la.d, lb.p, lb.d); cs = q ? [q] : []; }
          else { const L = la.kind === 'l' ? la : lb, C = la.kind === 'c' ? la : lb; cs = lineCircle(L.p, L.d, C.c, C.r); }
          for (const cf of cs) {
            // точка касания на круге-носителе: c ± unit(cf−c)·R — знак тот,
            // при котором точка лежит на fillet-окружности (|t−cf| = rf);
            // «+» для внешнего и fillet-в-носителе, «−» для носителя-в-fillet
            const tOnCircle = (C) => {
              const u = unit(sub(cf, C.c));
              const tp = add(C.c, u, C.r), tm = add(C.c, u, -C.r);
              return Math.abs(norm(sub(tp, cf)) - rf) <= Math.abs(norm(sub(tm, cf)) - rf) ? tp : tm;
            };
            const t1 = A.circle ? tOnCircle(A.circle) : projOnLine(A.line, cf);
            const t2 = B.circle ? tOnCircle(B.circle) : projOnLine(B.line, cf);
            const score = con.hint ? norm(sub(cf, con.hint)) : 0;
            if (!best || score < best.score) best = { cf, t1, t2, score };
          }
        }
      }
      if (!best) throw new Error('circle-dictionary: fillet не построился (нет пересечения локусов)');
      const dirF = arcDirBetween(best.cf, rf, best.t1, best.t2);
      junctions.push({
        p1: best.t1, p2: best.t2,
        mid: { kind: 'arc', c: best.cf, r: rf, a0: ang(best.cf, best.t1), a1: ang(best.cf, best.t2), dir: dirF },
      });
      joints.push({ at: best.t1, corner: false }, { at: best.t2, corner: false });
    } else {
      throw new Error(`circle-dictionary: неизвестный соединитель «${con.type}»`);
    }
  }
  // сборка: кусок носителя i идёт от junctions[i−1].p2 до junctions[i].p1
  const chain = [];
  const corners = [];
  for (let i = 0; i < n; i++) {
    const jPrev = closed ? junctions[(i - 1 + n) % n] : junctions[i - 1];
    const jNext = closed ? junctions[i] : i < n - 1 ? junctions[i] : null;
    const E = elements[i];
    const from = jPrev ? jPrev.p2 : terminalPoint(E, 'start');
    const to = jNext ? jNext.p1 : terminalPoint(E, 'end');
    if (E.circle) {
      const a0 = ang(E.circle.c, from), a1 = ang(E.circle.c, to);
      chain.push({ kind: 'arc', c: E.circle.c, r: E.circle.r, a0, a1, dir: E.circle.dir ?? 1 });
    } else {
      chain.push({ kind: 'line', p0: from, p1: to });
    }
    if (jNext?.mid) chain.push(jNext.mid);
  }
  for (const j of joints) if (j.corner) corners.push(j.at);
  return { chain, corners };
}
function projOnLine(line, q) {
  const d = unit(line.d);
  return add(line.p, d, dot(sub(q, line.p), d));
}
/** Направление fillet-дуги: короткая дуга от t1 к t2 (fillet < 180°). */
function arcDirBetween(c, r, t1, t2) {
  const a0 = ang(c, t1), a1 = ang(c, t2);
  const dPlus = spanOf(a0, a1, 1);
  return dPlus <= Math.PI ? 1 : -1;
}
function terminalPoint(E, which) {
  if (E.line?.[which === 'start' ? 'start' : 'end']) return E.line[which === 'start' ? 'start' : 'end'];
  if (E.circle?.[which === 'start' ? 'startA' : 'endA'] != null) {
    const a = (E.circle[which === 'start' ? 'startA' : 'endA'] * Math.PI) / 180;
    return ept(E.circle.c, E.circle.r, a);
  }
  throw new Error('circle-dictionary: открытая цепь требует терминалов (line.start/end или circle.startA/endA)');
}

// ── оффсеты ──
function offsetSeg(s, off) {
  if (s.kind === 'line') {
    const t = segTangent(s, false);
    const nrm = [t[1], -t[0]];
    return { kind: 'line', p0: add(s.p0, nrm, off), p1: add(s.p1, nrm, off) };
  }
  const r2 = s.r + s.dir * off;
  if (r2 <= EPS) throw new Error(`circle-dictionary: оффсет ${off} вырождает дугу R=${s.r}`);
  return { kind: 'arc', c: s.c, r: r2, a0: s.a0, a1: s.a1, dir: s.dir };
}
/** Попытка обрезать оба оффсет-сегмента до общего пересечения (укорочение). */
function tryTrim(sa, sb) {
  let cands;
  if (sa.kind === 'line' && sb.kind === 'line') { const q = lineLine(sa.p0, sub(sa.p1, sa.p0), sb.p0, sub(sb.p1, sb.p0)); cands = q ? [q] : []; }
  else if (sa.kind === 'arc' && sb.kind === 'arc') cands = circleCircle(sa.c, sa.r, sb.c, sb.r);
  else { const L = sa.kind === 'line' ? sa : sb, A2 = sa.kind === 'arc' ? sa : sb; cands = lineCircle(L.p0, sub(L.p1, L.p0), A2.c, A2.r); }
  const endA = segEnd(sa), startB = segStart(sb);
  let best = null;
  for (const q of cands) {
    if (!shortens(sa, q, 'end') || !shortens(sb, q, 'start')) continue;
    const score = norm(sub(q, endA)) + norm(sub(q, startB));
    if (!best || score < best.score) best = { q, score };
  }
  if (!best) return false;
  trimTo(sa, best.q, 'end');
  trimTo(sb, best.q, 'start');
  return true;
}
function shortens(s, q, side) {
  if (s.kind === 'line') {
    const u = unit(sub(s.p1, s.p0));
    const t = dot(sub(q, s.p0), u);
    const len = norm(sub(s.p1, s.p0));
    return side === 'end' ? t > EPS && t < len - EPS : t > EPS && t < len - EPS;
  }
  const span = spanOf(s.a0, s.a1, s.dir);
  const aq = ang(s.c, q);
  const t = spanOf(s.a0, aq, s.dir);
  return t > 1e-6 && t < span - 1e-6;
}
function trimTo(s, q, side) {
  if (s.kind === 'line') { if (side === 'end') s.p1 = q; else s.p0 = q; return; }
  const aq = ang(s.c, q);
  if (side === 'end') s.a1 = aq; else s.a0 = aq;
}
/**
 * Оффсет цепи на s (знак = сторона): G1-стыки проходят насквозь, углы —
 * обрезка пересечением (сторона перекрытия) или круглый join R=|s| вокруг
 * вершины (сторона зазора — дисциплина руки, cloud/eye).
 */
export function offsetChain(chain, off, closed) {
  const segs = chain.map((s) => offsetSeg(s, off));
  const out = [];
  const count = closed ? segs.length : segs.length - 1;
  for (let i = 0; i < segs.length; i++) {
    out.push(segs[i]);
    if (i >= count && !closed) break;
    const j = (i + 1) % segs.length;
    const sa = segs[i], sb = segs[j];
    const gap = norm(sub(segEnd(sa), segStart(sb)));
    // G1 — оффсеты сомкнулись сами; порог 1e-4 покрывает микрозазор
    // q6-квантования (~1e-5), реальные углы дают зазор ≥ ~1e-2
    if (gap < 1e-4) continue;
    const jn = tryTrim(sa, sb) ? null : roundJoin(chain, i, j, sa, sb, off);
    if (jn) out.push(jn);
  }
  return out;
}
function roundJoin(chain, i, j, sa, sb, off) {
  // вершина оригинала: конец сегмента i (== начало j)
  const V = segEnd(chain[i]);
  const pA = segEnd(sa), pB = segStart(sb);
  const a0 = ang(V, pA), a1 = ang(V, pB);
  const span = spanOf(a0, a1, 1);
  // вырожденный стык (a0≈a1): spanOf трактует 0 как TAU → петля 360°; пропуск
  if (span < 1e-3 || span > TAU - 1e-3) return null;
  // направление: короткой дугой (зазор всегда < 180°)
  const dir = span <= Math.PI ? 1 : -1;
  return { kind: 'arc', c: V, r: Math.abs(off), a0, a1, dir };
}

/** Полукруглый/плоский кап открытого штриха. */
function capSeg(Pend, from, to, style) {
  if (style === 'flat') return { kind: 'line', p0: from, p1: to };
  const a0 = ang(Pend, from), a1 = ang(Pend, to);
  const dir = spanOf(a0, a1, 1) <= Math.PI + 1e-9 ? 1 : -1;
  return { kind: 'arc', c: Pend, r: norm(sub(from, Pend)), a0, a1, dir };
}

/**
 * Обводка центральной линии пером pen.
 * Закрытая цепь → {outer, inner} (inner реверсирован — честная дырка под
 * evenodd И nonzero, как genRing). Открытая → один замкнутый контур с
 * капами (round|flat на каждом конце: caps=[start,end]).
 */
export function strokeChain(chain, pen, { closed = false, caps = ['round', 'round'] } = {}) {
  const h = pen / 2;
  if (closed) {
    const oPlus = offsetChain(chain, +h, true);
    const oMinus = offsetChain(chain, -h, true);
    const outerIsPlus = Math.abs(chainArea(oPlus)) >= Math.abs(chainArea(oMinus));
    const outer = outerIsPlus ? oPlus : oMinus;
    const inner = outerIsPlus ? oMinus : oPlus;
    return { outer, inner: reverseChain(inner) };
  }
  const sideA = offsetChain(chain, +h, false);
  const sideB = reverseChain(offsetChain(chain, -h, false));
  const endPt = segEnd(chain[chain.length - 1]);
  const startPt = segStart(chain[0]);
  const contour = [
    ...sideA,
    capSeg(endPt, segEnd(sideA[sideA.length - 1]), segStart(sideB[0]), caps[1]),
    ...sideB,
    capSeg(startPt, segEnd(sideB[sideB.length - 1]), segStart(sideA[0]), caps[0]),
  ];
  return { contour };
}

/** Силуэт закрытой штрихованной цепи: внешний оффсет-контур (закон №1 cloud). */
export function silhouetteChain(chain, pen) {
  return strokeChain(chain, pen, { closed: true }).outer;
}

/** Нормализация ориентации: положительная площадь (или отрицательная). */
export function orientChain(chain, positive = true) {
  const a = chainArea(chain);
  return (a >= 0) === positive ? chain : reverseChain(chain);
}

// ── четырёхдуговой овал (rotated-ellipse, approx four-arc; преп §2.4) ──
/**
 * Центральная линия наклонного овала: большая полуось a (локальная ось Y),
 * малая b (X), концевые дуги rEnd; боковой радиус ВЫВОДИТСЯ из касания:
 * Rs = (a² + b² − 2·a·rEnd) / (2·(b − rEnd)) — стыки G1 by construction.
 * phi — наклон большой оси от вертикали в градусах (знак = зеркальность).
 */
export function fourArcOval(c, a, b, rEnd, phiDeg) {
  if (!(rEnd < b && b < a)) throw new Error(`four-arc-oval: требуется rEnd < b < a (rEnd=${rEnd}, b=${b}, a=${a})`);
  const Rs = (a * a + b * b - 2 * a * rEnd) / (2 * (b - rEnd));
  const t = (phiDeg * Math.PI) / 180;
  const ux = [Math.cos(t), Math.sin(t)]; // локальная X (малая ось)
  const uy = [-Math.sin(t), Math.cos(t)]; // локальная Y (большая ось)
  const at = (lx, ly) => [c[0] + ux[0] * lx + uy[0] * ly, c[1] + ux[1] * lx + uy[1] * ly];
  const elements = [
    { circle: { c: at(0, -(a - rEnd)), r: rEnd, dir: 1 } },
    { circle: { c: at(b - Rs, 0), r: Rs, dir: 1 } },
    { circle: { c: at(0, a - rEnd), r: rEnd, dir: 1 } },
    { circle: { c: at(-(b - Rs), 0), r: Rs, dir: 1 } },
  ];
  const connectors = [{ type: 'kiss' }, { type: 'kiss' }, { type: 'kiss' }, { type: 'kiss' }];
  return resolveTangentChain(elements, connectors, true).chain;
}

// ── зеркало (arrow-undo = mirror(arrow-redo), один источник) ──
/** Отражение d-пути относительно вертикали x=cx: координаты, sweep-флаги. */
export function mirrorPathX(d, cx) {
  const X = (x) => f3(2 * cx - x);
  const Y = (y) => f3(y);
  let out = '';
  for (const g of parsePathData(d)) {
    if (g.cmd === 'M' || g.cmd === 'L') out += `${g.cmd}${X(g.x)} ${Y(g.y)}`;
    else if (g.cmd === 'C') out += `C${X(g.x1)} ${Y(g.y1)} ${X(g.x2)} ${Y(g.y2)} ${X(g.x)} ${Y(g.y)}`;
    else if (g.cmd === 'Q') out += `Q${X(g.x1)} ${Y(g.y1)} ${X(g.x)} ${Y(g.y)}`;
    else if (g.cmd === 'A') out += `A${f3(g.rx)} ${f3(g.ry)} ${f3(g.rotation)} ${g.largeArc} ${g.sweep ? 0 : 1} ${X(g.x)} ${Y(g.y)}`;
    else if (g.cmd === 'Z') out += 'Z';
  }
  return out;
}

// ── сборка части композиции из декларации ──
/** Круг-вырез: противо-намотка к genRing-внешнему (sweep 1) — честная дырка. */
export function cutoutCircle(cx, cy, r) {
  return `M${f3(cx - r)} ${f3(cy)}a${f3(r)} ${f3(r)} 0 1 1 ${f3(2 * r)} 0a${f3(r)} ${f3(r)} 0 1 1 ${f3(-2 * r)} 0Z`;
}

const sc = (v, k) => v * k;
const scPt = (p, k) => [p[0] * k, p[1] * k];
function scaleElements(elements, k) {
  return elements.map((E) => {
    if (E.circle) {
      const c2 = { c: scPt(E.circle.c, k), r: sc(E.circle.r, k), dir: E.circle.dir ?? 1 };
      if (E.circle.startA != null) c2.startA = E.circle.startA;
      if (E.circle.endA != null) c2.endA = E.circle.endA;
      return { circle: c2 };
    }
    const L = { p: scPt(E.line.p, k), d: E.line.d.slice() };
    if (E.line.start) L.start = scPt(E.line.start, k);
    if (E.line.end) L.end = scPt(E.line.end, k);
    return { line: L };
  });
}
function scaleConnectors(connectors, k) {
  return connectors.map((c) => {
    const o = { type: c.type };
    if (c.hint) o.hint = scPt(c.hint, k);
    if (c.r != null) o.r = sc(c.r, k);
    return o;
  });
}
/** Ориентация: внешние/сплошные — как genRing-внешний (CCW экрана, area<0). */
const orientSolid = (chain) => orientChain(chain, false);
const orientHole = (chain) => orientChain(chain, true);

/**
 * Часть композиции семьи «словарь окружностей». Параметры декларации —
 * доли канвы (конвенция единиц buildGlyph), резолв ×cw здесь.
 * @param {string} primitive tangent-chain|circle-hull|arc-splice|four-arc-oval|arc-chain
 * @param {object} pp params варианта (доли канвы)
 * @param {string} mode stroke|silhouette|contour|frame|solid
 * @param {number} pen перо в юнитах (для stroke/silhouette/frame)
 * @param {number} cw ширина канвы
 * @returns {string} d-фрагмент
 */
export function buildDictPart(primitive, pp, mode, pen, cw) {
  let chain;
  if (primitive === 'tangent-chain') {
    const closed = pp.closed !== false;
    chain = resolveTangentChain(scaleElements(pp.elements, cw), scaleConnectors(pp.connectors ?? [], cw), closed).chain;
    return emitChainMode(chain, mode, pen, closed, pp.caps);
  }
  if (primitive === 'circle-hull') {
    // сглаженный union окружностей (преп §2.1): соседние пересекаются,
    // никто не поглощён; baseline — касательная хорда-обрез (touch-инвариант)
    const circles = pp.circles.map((q) => ({ c: scPt(q.c, cw), r: sc(q.r, cw), dir: q.dir ?? 1 }));
    for (let i = 0; i + 1 < circles.length; i++) {
      const A = circles[i], B = circles[i + 1];
      const d = norm(sub(B.c, A.c));
      if (d >= A.r + B.r) throw new Error(`circle-hull: круги ${i},${i + 1} не пересекаются (d=${d.toFixed(3)})`);
      if (d <= Math.abs(A.r - B.r)) throw new Error(`circle-hull: круг поглощён (пара ${i},${i + 1})`);
    }
    const elements = circles.map((c) => ({ circle: c }));
    const connectors = (pp.joints ?? []).map((j) => ({
      type: j.type ?? 'corner',
      ...(j.hint ? { hint: scPt(j.hint, cw) } : {}),
      ...(j.r != null ? { r: sc(j.r, cw) } : {}),
    }));
    if (pp.baseline) {
      elements.push({ line: { p: [0, sc(pp.baseline.y, cw)], d: [pp.baseline.dirX ?? 1, 0] } });
      connectors.push({ type: 'touch' }); // последний круг → базовая линия
      connectors.push({ type: 'touch' }); // базовая линия → первый круг
    }
    chain = resolveTangentChain(elements, connectors, true).chain;
    return emitChainMode(chain, mode, pen, true);
  }
  if (primitive === 'arc-splice') {
    // сшивка дуг fillet-дугами (преп §2.3, vesica — частный случай)
    const elements = pp.arcs.map((q) => ({ circle: { c: scPt(q.c, cw), r: sc(q.r, cw), dir: q.dir ?? 1 } }));
    const connectors = pp.fillets.map((fl) => ({ type: 'fillet', r: sc(fl.r, cw), ...(fl.hint ? { hint: scPt(fl.hint, cw) } : {}) }));
    chain = resolveTangentChain(elements, connectors, true).chain;
    return emitChainMode(chain, mode, pen, true);
  }
  if (primitive === 'four-arc-oval') {
    chain = fourArcOval(scPt(pp.c, cw), sc(pp.a, cw), sc(pp.b, cw), sc(pp.rEnd, cw), pp.phi ?? 0);
    if (mode === 'frame') mode = 'stroke';
    return emitChainMode(chain, mode === 'solid' ? 'contour' : mode, pen, true);
  }
  if (primitive === 'arc-chain') {
    // честный composite по замерам: узлы + сегменты, без конструктива
    const nodes = pp.nodes.map((q) => scPt(q, cw));
    let d = `M${P(nodes[0])}`;
    const m = pp.closed === false ? pp.nodes.length - 1 : pp.nodes.length;
    for (let i = 0; i < m; i++) {
      const to = nodes[(i + 1) % nodes.length];
      const s = pp.segs[i];
      if (!s || s.t === 'l') {
        d += `L${P(to)}`;
      } else {
        const r = sc(s.r, cw);
        const chord = norm(sub(to, nodes[i]));
        if (2 * r < chord - 1e-6) throw new Error(`arc-chain: R=${r.toFixed(3)} меньше полухорды (сегмент ${i})`);
        d += `A${f3(r)} ${f3(r)} 0 ${s.large ? 1 : 0} ${s.sweep ? 1 : 0} ${P(to)}`;
      }
    }
    return d + (pp.closed === false ? '' : 'Z');
  }
  throw new Error(`circle-dictionary: неизвестный примитив «${primitive}»`);
}
function emitChainMode(chain, mode, pen, closed, caps) {
  if (mode === 'contour') return emitChain(orientSolid(chain), true);
  if (mode === 'cutout-contour') return emitChain(orientHole(chain), true);
  if (mode === 'silhouette') {
    if (!closed) throw new Error('circle-dictionary: silhouette требует замкнутую центральную линию');
    return emitChain(orientSolid(silhouetteChain(chain, pen)), true);
  }
  if (mode === 'stroke') {
    if (closed) {
      const { outer, inner } = strokeChain(chain, pen, { closed: true });
      const o = orientSolid(outer);
      const oArea = chainArea(o) < 0;
      // inner уже реверсирован относительно outer; согласуем с нормализацией
      const i2 = orientChain(inner, oArea ? true : false);
      return emitChain(o, true) + emitChain(i2, true);
    }
    const { contour } = strokeChain(chain, pen, { closed: false, caps: caps ?? ['round', 'round'] });
    return emitChain(orientSolid(contour), true);
  }
  throw new Error(`circle-dictionary: неизвестный режим «${mode}»`);
}

// ── G1-гейт: углы касательных на стыках готового d (метод замерного скрипта) ──
/**
 * Возвращает стыки [{at:[x,y], deg}] между соседними сегментами каждого
 * суб-пути (включая замыкание Z). Касательные аналитические (L/A/C/Q).
 */
export function junctionAngles(d) {
  const subs = [];
  let cur = null;
  let prev = null;
  let start = null;
  for (const g of parsePathData(d)) {
    if (g.cmd === 'M') {
      cur = { segs: [] };
      subs.push(cur);
      prev = [g.x, g.y];
      start = prev;
      continue;
    }
    if (g.cmd === 'Z') {
      if (cur && norm(sub(prev, start)) > 1e-6) cur.segs.push(lineTans(prev, start));
      cur = null;
      continue;
    }
    if (g.cmd === 'L') {
      cur.segs.push(lineTans(prev, [g.x, g.y]));
      prev = [g.x, g.y];
    } else if (g.cmd === 'A') {
      cur.segs.push(arcTans(prev, g));
      prev = [g.x, g.y];
    } else if (g.cmd === 'C') {
      const p0 = prev, p1 = [g.x1, g.y1], p2 = [g.x2, g.y2], p3 = [g.x, g.y];
      const t0 = unit(norm(sub(p1, p0)) > 1e-9 ? sub(p1, p0) : sub(p2, p0));
      const t1 = unit(norm(sub(p3, p2)) > 1e-9 ? sub(p3, p2) : sub(p3, p1));
      cur.segs.push({ from: p0, to: p3, t0, t1 });
      prev = p3;
    } else if (g.cmd === 'Q') {
      const p0 = prev, p1 = [g.x1, g.y1], p2 = [g.x, g.y];
      cur.segs.push({ from: p0, to: p2, t0: unit(sub(p1, p0)), t1: unit(sub(p2, p1)) });
      prev = p2;
    }
  }
  const out = [];
  for (const s2 of subs) {
    const m = s2.segs.length;
    if (m < 2) continue;
    for (let i = 0; i < m; i++) {
      const a = s2.segs[i], b = s2.segs[(i + 1) % m];
      if (norm(sub(a.to, b.from)) > 1e-3) continue; // открытый суб-путь: конец≠начало
      const c2 = Math.max(-1, Math.min(1, dot(a.t1, b.t0)));
      out.push({ at: a.to, deg: (Math.acos(c2) * 180) / Math.PI });
    }
  }
  return out;
}
function lineTans(p0, p1) {
  const t = unit(sub(p1, p0));
  return { from: p0, to: p1, t0: t, t1: t };
}
function arcTans(p0, g) {
  // круговые дуги (rx==ry): центр из концов + радиуса + флагов
  const p1 = [g.x, g.y];
  const r = g.rx;
  const q = sub(p1, p0);
  const dch = norm(q);
  const h = Math.sqrt(Math.max(0, r * r - (dch / 2) * (dch / 2)));
  const mid = [(p0[0] + p1[0]) / 2, (p0[1] + p1[1]) / 2];
  const nq = unit([-q[1], q[0]]);
  // выбор центра по флагам (SVG F.6.5): largeArc≠sweep → центр слева от хорды
  const sgn = g.largeArc !== g.sweep ? 1 : -1;
  const c = add(mid, nq, sgn * h);
  const dir = g.sweep ? 1 : -1;
  const tan = (p) => {
    const e = unit(sub(p, c));
    return [-e[1] * dir, e[0] * dir];
  };
  return { from: p0, to: p1, t0: tan(p0), t1: tan(p1) };
}
