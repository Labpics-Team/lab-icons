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

/** Одна сторона обводки: цепочка эквидистант с суставами. */
function sideChain(edges, h, closed) {
  const off = edges.map((e) => offsetEdge(e, h));
  const out = [off[0]];
  for (let i = 1; i < off.length; i++) {
    joinInto(out, edges[i - 1], edges[i], off[i], h);
  }
  if (closed) {
    joinInto(out, edges[edges.length - 1], edges[0], out[0], h, true);
  }
  return out;
}

function joinInto(out, ePrev, eNext, offNext, h, wrap = false) {
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
    const arc = jointArc(vertex, Math.abs(h), edgeEnd(prev), edgeStart(offNext), Math.sign(turn));
    out.push(arc);
    if (wrap) out[0] = offNext;
    else out.push(offNext);
    return;
  }
  const trimmed = trimPair(prev, offNext, vertex);
  if (trimmed) {
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
  e.type === 'line' ? { ...e, a: e.b, b: e.a } : { ...e, a0: e.a1, a1: e.a0, a: e.b, b: e.a };

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

    const left = sideChain(edges, h, closed);
    const right = sideChain(edges, -h, closed).map(reverseEdge).reverse();

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
