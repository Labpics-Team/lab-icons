/**
 * system/prim/stroke.js — обводка скелета в контур.
 *
 * Библиотека поставляет ЗАЛИТЫЕ контуры, а не атрибут stroke: только так глиф
 * масштабируется без сюрпризов и не зависит от vector-effect потребителя. Но
 * рисуется он всё равно СКЕЛЕТОМ — осевой линией + пером. Скелет остаётся в
 * метаданных: это he самое, за что берётся анимация (draw, morph, вращение
 * вокруг оси дуги).
 *
 * Скелет допускает только прямые и ОКРУЖНЫЕ дуги. Ограничение намеренное:
 * точный эквидистант существует для них и только для них, а «примерно
 * эквидистантная» кубика — источник переменного пера, то есть грязи.
 */

import { Path, edgeAt, edgeStart, edgeEnd, pathFromEdges } from '../core/path.js';
import { intersectEdges } from '../core/intersect.js';
import { v2, TEPS } from '../core/num.js';
import { TOKENS } from '../tokens.js';

const TAU = Math.PI * 2;

/** Единичная касательная ребра в параметре t. */
function tangent(e, t) {
  if (e.type === 'line') return v2.norm(v2.sub(e.b, e.a));
  if (e.type === 'arc') {
    const a = e.a0 + (e.a1 - e.a0) * t;
    const s = Math.sign(e.a1 - e.a0) || 1;
    return v2.norm([-Math.sin(a) * s, Math.cos(a) * s]);
  }
  throw new Error('скелет обводки допускает только прямые и окружные дуги');
}

/** Левая нормаль по ходу движения (y вниз). */
const leftN = (t) => [t[1], -t[0]];

/** Эквидистанта ребра влево на h (h<0 — вправо). Точная. */
function offsetEdge(e, h) {
  if (e.type === 'line') {
    const d = v2.norm(v2.sub(e.b, e.a));
    const n = v2.mul(leftN(d), h);
    return { type: 'line', a: v2.add(e.a, n), b: v2.add(e.b, n) };
  }
  if (e.type === 'arc') {
    const dir = Math.sign(e.a1 - e.a0) || 1;
    const r = e.r + h * dir;
    if (r <= TEPS) throw new Error('перо шире дуги: эквидистанта вырождается');
    return { type: 'arc', c: e.c, r, a0: e.a0, a1: e.a1, a: v2.polar(e.c, r, e.a0), b: v2.polar(e.c, r, e.a1) };
  }
  throw new Error('скелет обводки допускает только прямые и окружные дуги');
}

/** Дуга-соединение (круглый сустав) вокруг вершины скелета. */
function jointArc(vertex, h, from, to, dir) {
  let a0 = Math.atan2(from[1] - vertex[1], from[0] - vertex[0]);
  let a1 = Math.atan2(to[1] - vertex[1], to[0] - vertex[0]);
  if (dir > 0) while (a1 < a0) a1 += TAU;
  else while (a1 > a0) a1 -= TAU;
  if (Math.abs(a1 - a0) > Math.PI + 1e-9) a1 -= Math.sign(a1 - a0) * TAU;
  return { type: 'arc', c: vertex, r: h, a0, a1, a: v2.polar(vertex, h, a0), b: v2.polar(vertex, h, a1) };
}

/**
 * Полукруглый терминал. Заметать всегда в положительную сторону: контур
 * обводки идёт по часовой целиком, и терминал — его же часть, а не отдельная
 * фигура со своей ориентацией. `dir` выбирает только НАЧАЛЬНЫЙ угол
 * (левая нормаль на конце, правая — в начале), но не направление обхода.
 */
function capArc(point, h, alongDir, dir) {
  const n = leftN(alongDir);
  const a0 = Math.atan2(n[1] * dir, n[0] * dir);
  const a1 = a0 + Math.PI;
  return { type: 'arc', c: point, r: h, a0, a1, a: v2.polar(point, h, a0), b: v2.polar(point, h, a1) };
}

/** Обрезка двух смежных рёбер по их взаимному пересечению (внутренняя сторона). */
function trimPair(prev, next, vertex) {
  const hits = intersectEdges(prev, next);
  if (!hits.length) return null;
  let best = null;
  let bestD = Infinity;
  for (const x of hits) {
    const d = v2.dist(x.p, vertex);
    if (d < bestD) {
      bestD = d;
      best = x;
    }
  }
  if (!best) return null;
  return [sliceTo(prev, best.t1), sliceFrom(next, best.t2)];
}

function sliceTo(e, t) {
  if (t >= 1 - TEPS) return e;
  if (e.type === 'line') return { ...e, b: edgeAt(e, t) };
  const a1 = e.a0 + (e.a1 - e.a0) * t;
  return { ...e, a1, b: v2.polar(e.c, e.r, a1) };
}
function sliceFrom(e, t) {
  if (t <= TEPS) return e;
  if (e.type === 'line') return { ...e, a: edgeAt(e, t) };
  const a0 = e.a0 + (e.a1 - e.a0) * t;
  return { ...e, a0, a: v2.polar(e.c, e.r, a0) };
}

/**
 * ПЛАВНЫЙ ВХОД В СУСТАВ и ФАСКА ВНУТРЕННЕГО ЛОКТЯ.
 *
 * Замер корпуса: у наружного локтя шеврона и стрелки рука держит мягкость
 * ε = 1.29…1.68, а система ставила голую дугу радиуса пера (ε = 1 ровно) —
 * 52 таких узла. У внутреннего локтя рука кладёт фаску R = 0.23…0.39, система
 * оставляла честное пересечение эквидистант, то есть голое остриё — ещё 48.
 *
 * Оба дефекта — один узел, поэтому и правка одна. Наружная сторона получает
 * тот же ζ-вход, что и вершина многоугольника; внутренняя — маленькую галтель.
 * Это не украшение: остриё внутреннего локтя режет негативное пространство
 * между плечами, и на мелком кегле оно первым забивается.
 *
 * Ease применяется, только когда соседнее ребро — ПРЯМАЯ (кривизна нуль):
 * кубика с заданными касательными на обоих концах имеет ровно один свободный
 * параметр, и его уже забирает условие k = 1/h на стыке с дугой. Для дуги-
 * соседа условие было бы несовместным, и там честнее оставить голый сустав.
 */

/** Опора кубики, дающая на стыке с дугой радиуса r ровно кривизну 1/r. */
function easeHandle(E, X, A, r) {
  const dx = v2.sub(X, E);
  const lex = v2.len(dx);
  if (lex < TEPS) return null;
  const u = v2.mul(dx, 1 / lex);
  const ax = v2.sub(A, X);
  const m = v2.len(ax);
  if (m < TEPS) return null;
  const sinT = Math.abs(v2.cross(v2.mul(ax, 1 / m), u));
  if (sinT < 1e-6) return null;
  const p = lex - (1.5 * m * m) / (r * sinT);
  return p <= TEPS ? null : v2.mad(E, u, p);
}

const lineCross = (p1, d1, p2, d2) => {
  const den = v2.cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  return v2.mad(p1, d1, v2.cross(v2.sub(p2, p1), d2) / den);
};

/** Точка на прямом ребре, отступив `d` от его конца (или начала при from=true). */
function backOff(e, d, from) {
  const u = v2.norm(v2.sub(e.b, e.a));
  return from ? v2.mad(e.a, u, d) : v2.mad(e.b, u, -d);
}

/**
 * Смягчить сустав: вернуть [prevУкороченное, кубика, дугаУкороченная, кубика,
 * nextУкороченное] либо null, если места не хватило.
 */
function easedJoint(prev, arc, next, zeta) {
  if (zeta <= 1e-6 || prev.type !== 'line' || next.type !== 'line') return null;
  const h = arc.r;
  const theta = arc.a1 - arc.a0;
  const dir = Math.sign(theta) || 1;
  const shrink = (Math.abs(theta) * zeta) / 2;
  if (Math.abs(theta) - 2 * shrink < 1e-6) return null;
  const b0 = arc.a0 + dir * shrink;
  const b1 = arc.a1 - dir * shrink;
  const P0 = v2.polar(arc.c, h, b0);
  const P1 = v2.polar(arc.c, h, b1);
  const tan0 = [-Math.sin(b0) * dir, Math.cos(b0) * dir];
  const tan1 = [-Math.sin(b1) * dir, Math.cos(b1) * dir];

  // Отступ по прямым — та же доля ζ от касательного расстояния, что и у
  // вершины многоугольника: миterная точка минус точка касания дуги.
  const miter = lineCross(prev.a, v2.norm(v2.sub(prev.b, prev.a)), next.b, v2.norm(v2.sub(next.b, next.a)));
  if (!miter) return null;
  const td = v2.dist(miter, edgeEnd(prev));
  const run = td * zeta;
  if (run < 1e-6) return null;
  if (v2.dist(prev.a, prev.b) <= run + TEPS || v2.dist(next.a, next.b) <= run + TEPS) return null;

  const E0 = backOff(prev, run, false);
  const E1 = backOff(next, run, true);
  const u0 = v2.norm(v2.sub(prev.b, prev.a));
  const u1 = v2.norm(v2.sub(next.a, next.b));
  const X0 = lineCross(E0, u0, P0, tan0);
  const X1 = lineCross(E1, u1, P1, tan1);
  if (!X0 || !X1) return null;
  const H0 = easeHandle(E0, X0, P0, h);
  const H1 = easeHandle(E1, X1, P1, h);
  if (!H0 || !H1) return null;

  return [
    { ...prev, b: E0 },
    { type: 'cubic', p: [E0, H0, X0, P0] },
    { ...arc, a0: b0, a1: b1, a: P0, b: P1 },
    { type: 'cubic', p: [P1, X1, H1, E1] },
    { ...next, a: E1 },
  ];
}

/**
 * ГАЛТЕЛЬ НАРУЖНОГО ЛОКТЯ радиуса r между двумя эквидистантами.
 *
 * Круглый сустав (дуга радиуса пера/2 вокруг вершины скелета) — не то, что
 * делает рука. Замер: chevron-forward несёт на локте буквальное `A1.8 1.8`,
 * то есть радиус, равный ПЕРУ, вдвое больше круглого сустава; по 32 локтям
 * корпуса R/перо = 0.85…1.00 при медиане 0.93. Круглый сустав дал бы 0.50.
 *
 * Разница не косметическая: галтель радиуса больше пера СРЕЗАЕТ угол, чуть
 * сужая штрих на локте, — отчего локоть и читается мягким. Круглый сустав
 * такого сужения не даёт и выглядит острее при том же пере.
 *
 * Прямые здесь НЕ сходятся в общей точке: эквидистанты встречаются за вершиной,
 * в миterной точке. Поэтому галтель строится от неё, а не от конца ребра.
 */
function outerFillet(prev, next, r, h) {
  if (r <= h + 1e-9 || prev.type !== 'line' || next.type !== 'line') return null;
  const u0 = v2.norm(v2.sub(prev.b, prev.a));
  const u1 = v2.norm(v2.sub(next.b, next.a));
  const M = lineCross(prev.a, u0, next.a, u1);
  if (!M) return null;
  const cosP = Math.max(-1, Math.min(1, v2.dot(v2.mul(u0, -1), u1)));
  const phi = Math.acos(cosP);
  if (phi < 1e-6 || Math.PI - phi < 1e-6) return null;
  const td = r / Math.tan(phi / 2);
  const T0 = v2.mad(M, u0, -td);
  const T1 = v2.mad(M, u1, td);
  // хватает ли длины рёбер, чтобы галтель на них села
  if (v2.dot(v2.sub(T0, prev.a), u0) < 0 || v2.dot(v2.sub(next.b, T1), u1) < 0) return null;
  const bis = v2.norm(v2.add(v2.mul(u0, -1), u1));
  const cen = v2.mad(M, bis, r / Math.sin(phi / 2));
  let a0 = Math.atan2(T0[1] - cen[1], T0[0] - cen[0]);
  let a1 = Math.atan2(T1[1] - cen[1], T1[0] - cen[0]);
  const d = Math.sign(v2.cross(u0, u1)) || 1;
  if (d > 0) while (a1 < a0) a1 += TAU;
  else while (a1 > a0) a1 -= TAU;
  if (Math.abs(a1 - a0) > Math.PI) a1 -= Math.sign(a1 - a0) * TAU;
  return [
    { ...prev, b: T0 },
    { type: 'arc', c: cen, r, a0, a1, a: T0, b: T1 },
    { ...next, a: T1 },
  ];
}

/** Фаска радиуса r во внутреннем локте: две прямые, сходящиеся в точке Q. */
function innerFillet(prev, next, r) {
  if (r <= 1e-6 || prev.type !== 'line' || next.type !== 'line') return null;
  const Q = edgeEnd(prev);
  const u0 = v2.norm(v2.sub(prev.a, prev.b)); // от Q назад по prev
  const u1 = v2.norm(v2.sub(next.b, next.a)); // от Q вперёд по next
  const cosP = Math.max(-1, Math.min(1, v2.dot(u0, u1)));
  const phi = Math.acos(cosP);
  if (phi < 1e-6 || Math.PI - phi < 1e-6) return null;
  const td = r / Math.tan(phi / 2);
  if (v2.dist(prev.a, prev.b) <= td + TEPS || v2.dist(next.a, next.b) <= td + TEPS) return null;
  const T0 = v2.mad(Q, u0, td);
  const T1 = v2.mad(Q, u1, td);
  const bis = v2.norm(v2.add(u0, u1));
  const cen = v2.mad(Q, bis, r / Math.sin(phi / 2));
  let a0 = Math.atan2(T0[1] - cen[1], T0[0] - cen[0]);
  let a1 = Math.atan2(T1[1] - cen[1], T1[0] - cen[0]);
  const turn = v2.cross(v2.sub(Q, prev.a), v2.sub(next.b, Q));
  const d = Math.sign(turn) || 1;
  if (d > 0) while (a1 < a0) a1 += TAU;
  else while (a1 > a0) a1 -= TAU;
  if (Math.abs(a1 - a0) > Math.PI) a1 -= Math.sign(a1 - a0) * TAU;
  return [
    { ...prev, b: T0 },
    { type: 'arc', c: cen, r, a0, a1, a: T0, b: T1 },
    { ...next, a: T1 },
  ];
}

/** Одна сторона обводки: цепочка эквидистант с суставами. */
function sideChain(edges, h, closed, jt) {
  const off = edges.map((e) => offsetEdge(e, h));
  const out = [off[0]];
  for (let i = 1; i < off.length; i++) {
    joinInto(out, edges[i - 1], edges[i], off[i], h, false, jt);
  }
  if (closed) {
    joinInto(out, edges[edges.length - 1], edges[0], out[0], h, true, jt);
  }
  return out;
}

function joinInto(out, ePrev, eNext, offNext, h, wrap = false, jt = {}) {
  const prev = out[out.length - 1];
  const vertex = edgeEnd(ePrev);
  const tIn = tangent(ePrev, 1);
  const tOut = tangent(eNext, 0);
  const turn = v2.cross(tIn, tOut);
  if (Math.abs(turn) < 1e-9) {
    if (wrap) out[0] = offNext;
    else out.push(offNext);
    return;
  }
  // Сторона расхождения (внешняя) получает круглый сустав; сторона схождения
  // (внутренняя) — честное пересечение эквидистант.
  const outerSide = turn > 0 ? 1 : -1; // +1 = левая сторона внешняя
  const thisSideIsOuter = Math.sign(h) === outerSide;
  if (thisSideIsOuter) {
    // Галтель радиуса `jt.outer`; если места нет — честный круглый сустав.
    const fil = outerFillet(prev, offNext, jt.outer, Math.abs(h));
    const arc = fil ? fil[1] : jointArc(vertex, Math.abs(h), edgeEnd(prev), edgeStart(offNext), Math.sign(turn));
    const pv = fil ? fil[0] : prev;
    const nx = fil ? fil[2] : offNext;
    if (fil) out[out.length - 1] = pv;
    const eased = easedJoint(pv, arc, nx, jt.ease ?? 0);
    if (eased) {
      out[out.length - 1] = eased[0];
      out.push(eased[1], eased[2], eased[3]);
      if (wrap) out[0] = eased[4];
      else out.push(eased[4]);
      return;
    }
    out.push(arc);
    if (wrap) out[0] = nx;
    else out.push(nx);
    return;
  }
  const trimmed = trimPair(prev, offNext, vertex);
  if (trimmed) {
    const filleted = innerFillet(trimmed[0], trimmed[1], jt.inner ?? 0);
    if (filleted) {
      out[out.length - 1] = filleted[0];
      out.push(filleted[1]);
      if (wrap) out[0] = filleted[2];
      else out.push(filleted[2]);
      return;
    }
    out[out.length - 1] = trimmed[0];
    if (wrap) out[0] = trimmed[1];
    else out.push(trimmed[1]);
  } else {
    // эквидистанты не встретились (звено короче пера) — сшиваем через вершину
    out.push({ type: 'line', a: edgeEnd(prev), b: vertex });
    out.push({ type: 'line', a: vertex, b: edgeStart(offNext) });
    if (wrap) out[0] = offNext;
    else out.push(offNext);
  }
}

const reverseEdge = (e) =>
  e.type === 'line'
    ? { ...e, a: e.b, b: e.a }
    : e.type === 'cubic'
      ? { type: 'cubic', p: [e.p[3], e.p[2], e.p[1], e.p[0]] }
      : { ...e, a0: e.a1, a1: e.a0, a: e.b, b: e.a };

/**
 * Обводка скелета.
 *
 * @param {Path} spine   открытый или замкнутый путь-скелет (прямые + дуги)
 * @param {number} weight перо
 * @param {{cap?:'round'|'butt'}} [opt]
 * @returns {Path} залитый контур, ориентация «по часовой»
 */
export function strokePath(spine, weight, opt = {}) {
  const cap = opt.cap ?? 'round';
  // Смягчение сустава — свойство ПЕРА, а не иконки: одинаково у каждого
  // шеврона, стрелки и галочки корпуса. Фаска задана долей пера и потому едет
  // за весом сама. `opt.joint` — это разрешённый t.corner: через него до
  // сустава доходят оси crnr и rond.
  const jt = {
    ease: opt.joint?.smoothing ?? opt.jointEase ?? TOKENS.corner.smoothing,
    inner: weight * (opt.joint?.joint ?? opt.jointInner ?? TOKENS.corner.joint),
    outer: weight * (opt.joint?.elbow ?? opt.jointOuter ?? TOKENS.corner.elbow),
  };
  const h = weight / 2;
  const out = new Path();
  for (let si = 0; si < spine.subs.length; si++) {
    const sub = spine.subs[si];
    if (!sub.segs.length) continue;
    const edges = new Path([sub]).edges();
    const closed = sub.closed;

    if (edges.length === 1 && edges[0].type === 'arc' && Math.abs(edges[0].a1 - edges[0].a0) >= TAU - 1e-6) {
      // полное кольцо: две окружности, дырка развёрнута
      const e = edges[0];
      out.add(ringOf(e.c, e.r, h));
      continue;
    }

    const left = sideChain(edges, h, closed, jt);
    const right = sideChain(edges, -h, closed, jt).map(reverseEdge).reverse();

    if (closed) {
      // `right` уже развёрнута в sideChain-обработке (map(reverseEdge).reverse()),
      // то есть идёт против обхода внешнего контура и УЖЕ является дыркой.
      // Второй разворот вернул бы ей внешнюю ориентацию и залил бы просвет.
      out.add(pathFromEdges(left, true));
      out.add(pathFromEdges(right, true));
      continue;
    }
    const chainEdges = [...left];
    if (cap === 'round') {
      chainEdges.push(capArc(edgeEnd(edges[edges.length - 1]), h, tangent(edges[edges.length - 1], 1), 1));
    } else {
      chainEdges.push({ type: 'line', a: edgeEnd(left[left.length - 1]), b: edgeStart(right[0]) });
    }
    chainEdges.push(...right);
    if (cap === 'round') {
      chainEdges.push(capArc(edgeStart(edges[0]), h, tangent(edges[0], 0), -1));
    } else {
      chainEdges.push({ type: 'line', a: edgeEnd(right[right.length - 1]), b: edgeStart(left[0]) });
    }
    out.add(pathFromEdges(chainEdges, true));
  }
  return out;
}

function ringOf(c, r, h) {
  const p = new Path();
  p.arcFrom(c, r + h, -Math.PI / 2, Math.PI / 2).arc(c, r + h, Math.PI / 2, Math.PI * 1.5).close();
  const inner = new Path().arcFrom(c, r - h, -Math.PI / 2, Math.PI / 2).arc(c, r - h, Math.PI / 2, Math.PI * 1.5).close();
  return p.add(inner.reverse());
}

/** Скелет-ломаная из точек. */
export function polySpine(points, closed = false) {
  const p = new Path().move(points[0]);
  for (let i = 1; i < points.length; i++) p.line(points[i]);
  if (closed) {
    p.line(points[0]);
    p.close();
  }
  return p;
}

/** Обводка ломаной — самый частый штриховой глиф (checkmark, chevron, menu). */
export function strokePolyline(points, weight, opt) {
  return strokePath(polySpine(points, opt?.closed), weight, opt);
}

/** Прямой штрих между двумя точками (капсула, выведенная как обводка). */
export function strokeSegment(a, b, weight, opt) {
  return strokePath(new Path().move(a).line(b), weight, opt);
}

/** Скелет-дуга. */
export function arcSpine(c, r, a0, a1) {
  return new Path().arcFrom(c, r, a0, a1);
}
