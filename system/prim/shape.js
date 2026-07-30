/**
 * system/prim/shape.js — примитивы-формулы.
 *
 * Каждая фигура здесь описана ФОРМУЛОЙ, а не набором узлов. Это не эстетская
 * прихоть: формула даёт центр, ось и параметр, то есть ровно то, за что можно
 * взяться на этапе анимации (вращать кольцо вокруг его оси, растить луч вдоль
 * его направления, дышать диском по радиусу). Набор узлов даёт только узлы.
 *
 * Ориентация по умолчанию — «по часовой» (положительная площадь при y вниз);
 * дырки возвращаются развёрнутыми. Система живёт на fill-rule nonzero.
 */

import { Path } from '../core/path.js';
import { cut } from '../core/boolean.js';
import { intersectEdges } from '../core/intersect.js';
import { v2, rad, TEPS } from '../core/num.js';
import { DERIVED } from '../tokens.js';

const TAU = Math.PI * 2;

/** Круг (диск). Две дуги по 180° — однозначная запись полной окружности. */
export function circle(c, r) {
  return new Path().arcFrom(c, r, -Math.PI / 2, Math.PI / 2).arc(c, r, Math.PI / 2, Math.PI * 1.5).close();
}

/** Кольцо: внешняя окружность + внутренняя дырка. rInner выводится из пера. */
export function ring(c, rOuter, weight) {
  const rIn = DERIVED.inner(rOuter, weight);
  const p = circle(c, rOuter);
  if (rIn > TEPS) p.add(circle(c, rIn).reverse());
  return p;
}

/**
 * Дуговая полоса — штрих, идущий по окружности (reload, refresh, циферблат).
 * Ось полосы — сама окружность (c, r): ровно та ось, вокруг которой глиф
 * вращается в анимации.
 *
 * @param {'round'|'butt'} caps
 */
export function arcBand(c, r, a0, a1, weight, caps = 'round') {
  const h = weight / 2;
  const ro = r + h;
  const ri = r - h;
  const p = new Path();
  const dir = Math.sign(a1 - a0) || 1;
  p.arcFrom(c, ro, a0, a1);
  if (caps === 'round') {
    const e = v2.polar(c, r, a1);
    p.arc(e, h, a1 + (dir > 0 ? 0 : Math.PI), a1 + (dir > 0 ? Math.PI : 0));
  } else {
    p.line(v2.polar(c, ri, a1));
  }
  p.arc(c, ri, a1, a0);
  if (caps === 'round') {
    const s = v2.polar(c, r, a0);
    p.arc(s, h, a0 + (dir > 0 ? Math.PI : 0), a0 + (dir > 0 ? 0 : Math.PI));
  }
  return p.close();
}

/** Сектор диска (клин): пирог от a0 до a1. */
export function sector(c, r, a0, a1) {
  return new Path().move(c).line(v2.polar(c, r, a0)).arc(c, r, a0, a1).close();
}

/** Эллипс четырьмя кубиками: радиальная ошибка < 3e-4·r — ниже кванта вывода. */
const K = 0.5522847498307936;
export function ellipse(c, rx, ry, rotation = 0) {
  const p = new Path();
  const pts = [
    [rx, 0],
    [0, ry],
    [-rx, 0],
    [0, -ry],
  ];
  const tan = [
    [0, ry * K],
    [-rx * K, 0],
    [0, -ry * K],
    [rx * K, 0],
  ];
  const R = (q) => v2.add(c, v2.rot(q, rotation));
  p.move(R(pts[0]));
  for (let i = 0; i < 4; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % 4];
    const ta = tan[i];
    const tb = tan[(i + 1) % 4];
    p.curve(R(v2.add(a, ta)), R(v2.sub(b, tb)), R(b));
  }
  return p.close();
}

/**
 * СКРУГЛЁННЫЙ МНОГОУГОЛЬНИК — базовый конструктор всех угловатых силуэтов
 * (крест, ромб, треугольник, звезда, шеврон-заливка, стрелка-заливка).
 *
 * Радиус задаётся на вершину; вогнутые вершины скругляются в другую сторону
 * автоматически по знаку поворота. Радиус, превышающий геометрический бюджет
 * ребра, зажимается — «скругление больше стороны» физически невозможно и
 * молчаливое переполнение даёт ту самую грязь, ради которой всё это писалось.
 */
export function roundedPolygon(points, radius, smoothing = 0) {
  const n = points.length;
  const rOf = (i) => (Array.isArray(radius) ? (radius[i] ?? 0) : radius);
  const V = points.map((p) => [p[0], p[1]]);

  /**
   * ГЕОМЕТРИЧЕСКИЙ БЮДЖЕТ: скругление вершины не может съесть больше половины
   * каждого прилежащего ребра, иначе соседние скругления пересекутся.
   *
   * Съедает ребро не касательное расстояние td, а РАЗБЕГ СГЛАЖИВАНИЯ td·(1+ζ):
   * плавный вход начинается на ζ·td раньше точки касания. Раньше в бюджет шло
   * только td, и на большом радиусе разбег вылезал за соседнюю вершину — контур
   * складывался сам на себя. Цена, показанная гейтом осей: внутренний контур
   * дротика navigate при максимальном весе распадался на СЕМЬ кусков (радиус
   * выреза 7 + перо 2.32 = 9.32), и в чернилах открывались волосяные щели
   * 0.14 ед. Без ζ тот же контур цел — доказательство от противного.
   *
   * Площадь этого не видит вовсе: отклонение 2.74% что с дефектом, что без.
   */
  const len = V.map((p, i) => v2.dist(p, V[(i + 1) % n]));
  const tanDist = new Array(n).fill(0);
  const geom = [];
  for (let i = 0; i < n; i++) {
    const prev = V[(i - 1 + n) % n];
    const nxt = V[(i + 1) % n];
    const d1 = v2.norm(v2.sub(V[i], prev));
    const d2 = v2.norm(v2.sub(nxt, V[i]));
    const turn = v2.cross(d1, d2);
    const cosT = Math.max(-1, Math.min(1, v2.dot(v2.mul(d1, -1), d2)));
    const phi = Math.acos(cosT); // внутренний угол при вершине
    geom.push({ prev, nxt, d1, d2, turn, phi });
    tanDist[i] = Math.abs(turn) < 1e-9 || phi < 1e-9 ? 0 : rOf(i) / Math.tan(phi / 2);
  }
  const scale = new Array(n).fill(1);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const need = tanDist[i] + tanDist[j];
    if (need > len[i] + 1e-9 && need > 0) {
      const k = len[i] / need;
      scale[i] = Math.min(scale[i], k);
      scale[j] = Math.min(scale[j], k);
    }
  }

  /**
   * МЕСТО ПОД СГЛАЖИВАНИЕ считается ОТДЕЛЬНО от места под радиус.
   *
   * Радиус — это замер, его уменьшать нельзя без причины. Сглаживание — это
   * профиль входа, и когда разбега td·(1+ζ) не хватает, поджимается ОНО.
   *
   * Раньше разбег не проверялся вовсе: на большом радиусе он вылезал за соседнюю
   * вершину, и контур складывался сам на себя. Гейт осей показал цену —
   * внутренний контур дротика navigate при максимальном весе распадался на СЕМЬ
   * кусков (радиус выреза 7 + перо 2.32 = 9.32), в чернилах открывались щели
   * 0.14 ед. Без ζ тот же контур цел: доказательство от противного. Площадь
   * этого не видела вовсе — 2.74% что с дефектом, что без.
   *
   * ζ поджимается, а НЕ выключается, и это тоже замер, а не вкус. Первая версия
   * правки выключала сглаживание целиком там, где полного разбега не хватало, и
   * спектр углов немедленно предъявил счёт: претензий «БЕЗ СГЛАЖИВАНИЯ» стало
   * 72 против 32 — сорок узлов корпуса потеряли плавный вход без нужды. Предел
   * решается точно: td_i(1+ζ) + td_j(1+ζ) ≤ len, то есть
   * ζ ≤ len/(td_i + td_j) − 1, и по каждой вершине берётся минимум по двум
   * прилежащим рёбрам.
   */
  const ease = new Array(n).fill(smoothing);
  if (smoothing > 1e-6) {
    for (let i = 0; i < n; i++) {
      const j = (i + 1) % n;
      const need = tanDist[i] * scale[i] + tanDist[j] * scale[j];
      if (need <= 1e-9) continue;
      const zMax = Math.max(0, len[i] / need - 1);
      ease[i] = Math.min(ease[i], zMax);
      ease[j] = Math.min(ease[j], zMax);
    }
  }

  const p = new Path();
  let started = false;
  for (let i = 0; i < n; i++) {
    const g = geom[i];
    const r = rOf(i) * scale[i];
    const td = tanDist[i] * scale[i];
    if (r < 1e-6 || td < 1e-6) {
      if (!started) {
        p.move(V[i]);
        started = true;
      } else p.line(V[i]);
      continue;
    }
    const T1 = v2.mad(V[i], g.d1, -td);
    const T2 = v2.mad(V[i], g.d2, td);
    const bis = v2.norm(v2.add(v2.mul(g.d1, -1), g.d2));
    const cen = v2.mad(V[i], bis, r / Math.sin(g.phi / 2));
    const a0 = Math.atan2(T1[1] - cen[1], T1[0] - cen[0]);
    let a1 = Math.atan2(T2[1] - cen[1], T2[0] - cen[0]);
    const dir = Math.sign(g.turn);
    while (dir > 0 && a1 < a0) a1 += TAU;
    while (dir < 0 && a1 > a0) a1 -= TAU;

    const s = ease[i];
    if (s > 1e-6 && scale[i] > 0.999) {
      // СГЛАЖИВАНИЕ ζ. Радиус вершины НЕ меняется — сокращается дуга, а вход
      // в неё берёт на себя кубика с нулевой кривизной у прямой стороны (G2)
      // и касательным стыком с дугой (G1). Именно перепад кривизны «прямая →
      // дуга» глаз читает как жёсткость угла; радиус тут ни при чём.
      const theta = a1 - a0;
      const shrink = (Math.abs(theta) * s) / 2;
      const b0 = a0 + Math.sign(theta) * shrink;
      const b1 = a1 - Math.sign(theta) * shrink;
      const P0 = v2.polar(cen, r, b0);
      const P1 = v2.polar(cen, r, b1);
      const tan0 = v2.norm([-Math.sin(b0) * Math.sign(theta), Math.cos(b0) * Math.sign(theta)]);
      const tan1 = v2.norm([-Math.sin(b1) * Math.sign(theta), Math.cos(b1) * Math.sign(theta)]);
      const pRun = td * (1 + s);
      const E0 = v2.mad(V[i], g.d1, -pRun);
      const E1 = v2.mad(V[i], g.d2, pRun);
      const X0 = lineCross(E0, g.d1, P0, tan0);
      const X1 = lineCross(E1, v2.mul(g.d2, -1), P1, v2.mul(tan1, -1));
      const h0 = X0 && easeHandle(E0, X0, P0, r);
      const h1 = X1 && easeHandle(E1, X1, P1, r);
      if (h0 && h1) {
        if (!started) {
          p.move(E0);
          started = true;
        } else p.line(E0);
        p.curve(h0, X0, P0);
        p.arc(cen, r, b0, b1);
        p.curve(X1, h1, E1);
        continue;
      }
    }

    if (!started) {
      p.move(T1);
      started = true;
    } else p.line(T1);
    p.arc(cen, r, a0, a1);
  }
  return p.close();
}

/**
 * РУЧКА ПЛАВНОГО ВХОДА в дугу — та, при которой кривизна на стыке РАВНА 1/r.
 *
 * Кубика E→A с опорными точками (E + p·u, X) имеет нулевую кривизну в E при
 * любом p: три первые точки лежат на одной прямой. А вот кривизна в A зависит
 * от p, и «на глазок» взятое p = 2/3 давало на стыке 0.368 против 0.250 у
 * дуги — вход оказывался КРУЧЕ того, во что входит. Глаз читает это как
 * защип: скругление поджимается перед дугой и отпускает после.
 *
 * Кривизна кубики в конце: k = (2/3)·|(P₃−P₂)×(P₂−P₁)| / |P₃−P₂|³. Здесь
 * P₃−P₂ = A−X, P₂−P₁ = (|X−E| − p)·u, значит
 *
 *      k = (2/3)·|A−X|·sinθ·(|X−E| − p) / |A−X|³,
 *
 * и требование k = 1/r решается относительно p однозначно:
 *
 *      p = |X−E| − (3/2)·|A−X|² / (r·sinθ),   θ = ∠(A−X, u).
 *
 * Возвращает null, если бюджет сглаживания не оставляет места (p ≤ 0): тогда
 * честнее нарисовать голую галтель, чем подсунуть кривую с защипом.
 */
function easeHandle(E, X, A, r) {
  const dx = v2.sub(X, E);
  const lex = v2.len(dx);
  if (lex < TEPS) return null;
  const u = v2.mul(dx, 1 / lex);
  const ax = v2.sub(A, X);
  const m = v2.len(ax);
  const sinT = Math.abs(v2.cross(v2.mul(ax, 1 / Math.max(m, TEPS)), u));
  if (m < TEPS || sinT < 1e-6) return null;
  const p = lex - (1.5 * m * m) / (r * sinT);
  if (p <= TEPS) return null;
  return v2.mad(E, u, p);
}

/** Пересечение двух прямых, заданных точкой и направлением. */
function lineCross(p1, d1, p2, d2) {
  const den = v2.cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const t = v2.cross(v2.sub(p2, p1), d2) / den;
  return v2.mad(p1, d1, t);
}

/**
 * ВНУТРЕННИЙ ОФСЕТ МНОГОУГОЛЬНИКА на d: каждое ребро сдвигается внутрь по
 * нормали, вершины пересчитываются как пересечения сдвинутых прямых.
 * Ориентация «по часовой» считается внешней.
 */
export function insetPolygon(points, d) {
  const n = points.length;
  const out = [];
  for (let i = 0; i < n; i++) {
    const a = points[(i - 1 + n) % n];
    const b = points[i];
    const c = points[(i + 1) % n];
    const d1 = v2.norm(v2.sub(b, a));
    const d2 = v2.norm(v2.sub(c, b));
    // внутренняя нормаль при обходе по часовой (y вниз) — правая
    const n1 = v2.mul(v2.rnorm(d1), d);
    const n2 = v2.mul(v2.rnorm(d2), d);
    const p1 = v2.add(a, n1);
    const p2 = v2.add(b, n2);
    const den = v2.cross(d1, d2);
    if (Math.abs(den) < 1e-9) {
      out.push(v2.add(b, n1));
      continue;
    }
    const t = v2.cross(v2.sub(p2, p1), d2) / den;
    out.push(v2.mad(p1, d1, t));
  }
  return out;
}

/**
 * РАМКА-МНОГОУГОЛЬНИК: контур пером. Внутренний радиус выводится из внешнего
 * тем же законом, что и у прямоугольника: rInner = rOuter − перо.
 */
export function roundedPolygonRing(points, radius, weight, smoothing = 0) {
  const outer = roundedPolygon(points, radius, smoothing);
  const inPts = insetPolygon(points, weight);
  const rIn = Array.isArray(radius)
    ? radius.map((r) => Math.max(0, r - weight))
    : Math.max(0, radius - weight);
  return outer.add(roundedPolygon(inPts, rIn, smoothing).reverse());
}

/** Правильный n-угольник-рамка, вписанный в окружность. */
export function regularPolygonRing(c, r, n, cornerR, weight, phase = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(v2.polar(c, r, phase + (TAU * i) / n));
  return roundedPolygonRing(pts, cornerR, weight);
}

/** Прямоугольник со скруглением (углы 90°, радиус общий или по-вершинно). */
export function roundedRect(cx, cy, w, h, r, smoothing = 0) {
  const x0 = cx - w / 2;
  const x1 = cx + w / 2;
  const y0 = cy - h / 2;
  const y1 = cy + h / 2;
  return roundedPolygon(
    [
      [x0, y0],
      [x1, y0],
      [x1, y1],
      [x0, y1],
    ],
    r,
    smoothing,
  );
}

/** Рамка-прямоугольник: внешний контур + дырка, rInner = rOuter − перо. */
export function roundedRectRing(cx, cy, w, h, rOuter, weight, smoothing = 0) {
  const p = roundedRect(cx, cy, w, h, rOuter, smoothing);
  const iw = w - 2 * weight;
  const ih = h - 2 * weight;
  if (iw > TEPS && ih > TEPS) {
    p.add(roundedRect(cx, cy, iw, ih, Math.max(0, DERIVED.inner(rOuter, weight)), smoothing).reverse());
  }
  return p;
}

/**
 * СКРУГЛЁННЫЙ КВАДРАТ, ВПИСАННЫЙ В KEYLINE-ОКРУЖНОСТЬ.
 * Габарит не задаётся — он ВЫВОДИТСЯ (см. DERIVED.inscribedSquareHalf).
 */
export function inscribedSquare(c, keyR, cornerR, smoothing = 0) {
  const h = DERIVED.inscribedSquareHalf(cornerR, keyR);
  return roundedRect(c[0], c[1], 2 * h, 2 * h, cornerR, smoothing);
}

/** Полумесяц: диск минус смещённый диск. Одна формула — вся семья moon. */
export function crescent(c, r, biteC, biteR) {
  return cut(circle(c, r), circle(biteC, biteR));
}

/** Линза (пересечение двух дисков) — глаз, лист, рыба. */
export function lens(c1, r1, c2, r2) {
  const d = v2.dist(c1, c2);
  if (d >= r1 + r2 || d < TEPS) return new Path();
  const a = (r1 * r1 - r2 * r2 + d * d) / (2 * d);
  const h = Math.sqrt(Math.max(0, r1 * r1 - a * a));
  const u = v2.mul(v2.sub(c2, c1), 1 / d);
  const m = v2.mad(c1, u, a);
  const nrm = [u[1], -u[0]];
  const P1 = v2.mad(m, nrm, h);
  const P2 = v2.mad(m, nrm, -h);
  const ang = (cc, p) => Math.atan2(p[1] - cc[1], p[0] - cc[0]);
  const p = new Path().move(P1);
  let a0 = ang(c1, P1);
  let a1 = ang(c1, P2);
  while (a1 < a0) a1 += TAU;
  if (a1 - a0 > Math.PI * 2) a1 -= TAU;
  p.arc(c1, r1, a0, a1);
  let b0 = ang(c2, P2);
  let b1 = ang(c2, P1);
  while (b1 < b0) b1 += TAU;
  p.arc(c2, r2, b0, b1);
  return p.close();
}

/**
 * Симметричная линза-«глаз»: задаётся полушириной и полувысотой, радиус дуги
 * выводится из них (R = (hw² + hh²) / (2·hh)) — классика построения овала
 * двумя дугами, ровно то, чем нарисован глаз в корпусе.
 */
export function eyeLens(c, hw, hh) {
  const R = (hw * hw + hh * hh) / (2 * hh);
  return lens([c[0], c[1] + R - hh], R, [c[0], c[1] - R + hh], R);
}

/** Капля: круг радиуса r + касательный клин к вершине на расстоянии d. */
export function teardrop(c, r, apex) {
  const d = v2.dist(c, apex);
  if (d <= r + TEPS) return circle(c, r);
  const base = Math.atan2(apex[1] - c[1], apex[0] - c[0]);
  const half = Math.acos(r / d); // угол касательной
  const t1 = base - half;
  const t2 = base + half;
  const p = new Path().move(v2.polar(c, r, t2));
  p.arc(c, r, t2, t1 + TAU);
  p.line(apex);
  return p.close();
}

/** Правильный n-угольник, вписанный в окружность, со скруглением. */
export function regularPolygon(c, r, n, cornerR, phase = -Math.PI / 2) {
  const pts = [];
  for (let i = 0; i < n; i++) pts.push(v2.polar(c, r, phase + (TAU * i) / n));
  return roundedPolygon(pts, cornerR);
}

/** Звезда: n лучей, вершины на rOuter, впадины на rInner. */
export function star(c, n, rOuter, rInner, cornerOuter, cornerInner, phase = -Math.PI / 2) {
  const pts = [];
  const rs = [];
  for (let i = 0; i < 2 * n; i++) {
    const even = i % 2 === 0;
    pts.push(v2.polar(c, even ? rOuter : rInner, phase + (Math.PI * i) / n));
    rs.push(even ? cornerOuter : cornerInner);
  }
  return roundedPolygon(pts, rs);
}

/**
 * КРЕСТ — 12-угольник с плечами. Плюс и «X» (повёрнутый крест) — одна форма.
 * Внешний радиус, равный полуширине плеча, даёт полный круглый терминал: два
 * смежных скругления смыкаются касательно, то есть кап не приклеен, а ВЫВЕДЕН.
 */
export function cross(c, armLen, halfW, rOuter, rInner = 0, rotation = 0) {
  const a = halfW;
  const L = armLen;
  const pts = [
    [-a, -L], [a, -L], [a, -a], [L, -a],
    [L, a], [a, a], [a, L], [-a, L],
    [-a, a], [-L, a], [-L, -a], [-a, -a],
  ];
  const rs = [rOuter, rOuter, rInner, rOuter, rOuter, rInner, rOuter, rOuter, rInner, rOuter, rOuter, rInner];
  const R = (q) => v2.add(c, v2.rot(q, rotation));
  return roundedPolygon(pts.map(R), rs);
}

/** Прямоугольная «пилюля» (капсула): скругление = половина короткой стороны. */
export function capsule(cx, cy, w, h) {
  return roundedRect(cx, cy, w, h, Math.min(w, h) / 2);
}

export { rad, TAU };

/**
 * ПРОСТОЙ ЛИ КОНТУР: нет ли самопересечений между НЕсмежными рёбрами.
 *
 * Смежные рёбра касаются друг друга по построению — их общая точка не
 * пересечение. Всё остальное пересечение означает, что фигура сложилась сама
 * на себя, и под nonzero это даёт либо лишние дырки, либо волосяные щели.
 */
export function isSimple(path) {
  const es = path.edges();
  const n = es.length;
  if (n < 4) return true;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue; // замыкающая пара тоже смежная
      for (const x of intersectEdges(es[i], es[j])) {
        // касание в общей вершине — не самопересечение
        const atEnds = (x.t1 < 1e-6 || x.t1 > 1 - 1e-6) && (x.t2 < 1e-6 || x.t2 > 1 - 1e-6);
        if (!atEnds) return false;
      }
    }
  }
  return true;
}
