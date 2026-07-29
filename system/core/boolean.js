/**
 * system/core/boolean.js — аналитическая разность путей.
 *
 * Единственная нужная системе булева операция — ВЫЧИТАНИЕ, потому что все
 * накладные классы (перечёркивание, бейдж, конструктивный зазор) описываются
 * одинаково: «вырезать из глифа тень накладки, расширенную на охранный зазор».
 * Негативное пространство здесь не проверяется постфактум — оно СТРОИТСЯ.
 *
 * Операция аналитическая: прямая остаётся прямой, дуга — дугой, центр дуги
 * сохраняется. Полигонализации нет ⇒ нет ступенек на скруглениях.
 *
 * Ориентация: внешние контуры — по часовой (положительная площадь при y вниз),
 * дырки — против. Это позволяет выводить систему на fill-rule nonzero и
 * структурно исключить класс дефектов «контур залился блобом».
 */

import { v2 } from './num.js';
import { Path, edgeAt, edgeEnd, edgeStart, splitEdge, pathFromEdges } from './path.js';
import { intersectEdges } from './intersect.js';

const JOIN_TOL = 1e-5;
const key = (p) => `${Math.round(p[0] * 1e5)}:${Math.round(p[1] * 1e5)}`;

/** Ненулевая намотка: точка внутри пути. */
export function containsPoint(path, p, tol = 0.004) {
  const polys = path.flatten(tol);
  let w = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a[1] <= p[1]) {
        if (b[1] > p[1] && v2.cross(v2.sub(b, a), v2.sub(p, a)) > 0) w++;
      } else if (b[1] <= p[1] && v2.cross(v2.sub(b, a), v2.sub(p, a)) < 0) w--;
    }
  }
  return w !== 0;
}

/** Суммарная знаковая площадь (положительная = преобладает «по часовой»). */
export function signedArea(path) {
  let a = 0;
  for (let i = 0; i < path.subs.length; i++) a += path.subArea(i);
  return a;
}

/** Привести внешний контур к «по часовой» (для регионов-вычитателей). */
export function orientCW(path) {
  const p = path.clone();
  if (signedArea(p) < 0) p.reverse();
  return p;
}

function collectSplits(aEdges, bEdges) {
  const ta = aEdges.map(() => []);
  const tb = bEdges.map(() => []);
  for (let i = 0; i < aEdges.length; i++) {
    for (let j = 0; j < bEdges.length; j++) {
      for (const x of intersectEdges(aEdges[i], bEdges[j])) {
        ta[i].push(x.t1);
        tb[j].push(x.t2);
      }
    }
  }
  return [ta, tb];
}

function splitAll(edges, ts) {
  const out = [];
  for (let i = 0; i < edges.length; i++) out.push(...splitEdge(edges[i], ts[i]));
  return out;
}

const midOf = (e) => edgeAt(e, 0.5);

function reverseEdge(e) {
  if (e.type === 'line') return { ...e, a: e.b, b: e.a };
  if (e.type === 'arc') return { ...e, a0: e.a1, a1: e.a0, a: e.b, b: e.a };
  return { ...e, p: [e.p[3], e.p[2], e.p[1], e.p[0]] };
}

/**
 * Сшивка ориентированных рёбер в замкнутые циклы.
 * Предпочтение отдаётся смене источника (subject↔region): на честном
 * пересечении куски всегда чередуются, и это снимает неоднозначность узла.
 */
function chain(edges) {
  const buckets = new Map();
  edges.forEach((e, i) => {
    const k = key(edgeStart(e));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  });
  const used = new Array(edges.length).fill(false);
  const loops = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const loop = [];
    let cur = i;
    let guard = 0;
    while (cur != null && !used[cur] && guard++ < edges.length + 4) {
      used[cur] = true;
      loop.push(edges[cur]);
      const end = edgeEnd(edges[cur]);
      const cand = (buckets.get(key(end)) || []).filter((j) => !used[j]);
      if (!cand.length) {
        cur = null;
        break;
      }
      const src = edges[cur].src;
      cur = cand.find((j) => edges[j].src !== src) ?? cand[0];
    }
    if (loop.length) {
      const closed = v2.dist(edgeEnd(loop[loop.length - 1]), edgeStart(loop[0])) < JOIN_TOL * 20;
      loops.push({ edges: loop, closed });
    }
  }
  return loops;
}

/**
 * subject − region. Регион должен быть замкнутым путём; его ориентация
 * нормализуется внутри.
 *
 * @param {Path} subject
 * @param {Path} region
 * @returns {Path}
 */
export function cut(subject, region) {
  const reg = orientCW(region);
  const sEdges = subject.edges().map((e) => ({ ...e, src: 's' }));
  const rEdges = reg.edges().map((e) => ({ ...e, src: 'r' }));
  const [ts, tr] = collectSplits(sEdges, rEdges);
  const anyHit = ts.some((t) => t.length) || tr.some((t) => t.length);

  if (!anyHit) {
    const out = new Path();
    for (let i = 0; i < subject.subs.length; i++) {
      const sub = subject.subs[i];
      if (!sub.segs.length) continue;
      const probe = sub.segs[0].to;
      if (!containsPoint(reg, probe)) out.subs.push(structuredClone(sub));
    }
    // регион целиком внутри тела — становится дыркой
    const rp = reg.subs[0];
    if (rp && rp.segs.length && containsPoint(subject, rp.segs[0].to) && !out.isEmpty()) {
      out.add(reg.clone().reverse());
    }
    return out;
  }

  const sParts = splitAll(sEdges, ts).filter((e) => !containsPoint(reg, midOf(e)));
  const rParts = splitAll(rEdges, tr)
    .filter((e) => containsPoint(subject, midOf(e)))
    .map((e) => ({ ...reverseEdge(e), src: 'r' }));

  const loops = chain([...sParts, ...rParts]);
  const out = new Path();
  for (const l of loops) {
    if (l.edges.length < 2 && !l.closed) continue;
    out.add(pathFromEdges(l.edges, true));
  }
  return out;
}

/** Вычесть несколько регионов подряд. */
export function cutAll(subject, regions) {
  let p = subject;
  for (const r of regions) {
    if (r && !r.isEmpty()) p = cut(p, r);
  }
  return p;
}

export { pathFromEdges };
