/**
 * system/parts.js — переиспользуемые части и НАКЛАДНЫЕ КЛАССЫ.
 *
 * Часть — это примитив, за которым закреплён СМЫСЛ. Шеврон не «ломаная из
 * трёх точек», а «указатель направления»: у него есть направление, вершина и
 * раствор, и стрелка вырастает из него хвостом, а не рисуется заново.
 *
 * Накладной класс — операция над ЛЮБЫМ глифом (перечёркивание, бейдж,
 * обрамление). Класс обязан сначала ВЫРЕЗАТЬ из носителя свою тень с охранным
 * зазором и только потом лечь сверху: негативное пространство здесь не
 * проверяется, оно строится.
 */

import { Path } from './core/path.js';
import { cut } from './core/boolean.js';
import { v2, rad } from './core/num.js';
import * as S from './prim/shape.js';
import { strokePath, strokePolyline, strokeSegment, polySpine } from './prim/stroke.js';
import { DERIVED } from './tokens.js';

const TAU = Math.PI * 2;

/** Направление → угол поворота канонической конструкции («вниз» = 0). */
export const DIR = { down: 0, left: 90, up: 180, right: 270, forward: 270, back: 90 };

const rotAbout = (path, deg, c) => (deg ? path.rotate(rad(deg), c) : path);

// ── ШЕВРОН И СТРЕЛКА ──────────────────────────────────────────────────────

/**
 * ШЕВРОН — V-знак. Каноника: вершина внизу, плечи вверх.
 *
 * @param {object} t   разрешённые токены
 * @param {{dir?:string, half?:number, apex?:number[], open?:number,
 *          weight?:number, spine?:boolean}} o
 *   half   — полуразмах (по горизонтали для каноники)
 *   open   — угол раствора плеча от оси, градусы (45 = каноническая диагональ)
 *   apex   — вершина в канонической ориентации
 */
export function chevron(t, o = {}) {
  const w = o.weight ?? t.stroke.base;
  const half = o.half ?? 6;
  const open = o.open ?? 45;
  const depth = half / Math.tan(rad(open));
  const apex = o.apex ?? [t.cx, t.cy + depth / 2];
  const pts = [
    [apex[0] - half, apex[1] - depth],
    [apex[0], apex[1]],
    [apex[0] + half, apex[1] - depth],
  ];
  const spine = polySpine(pts);
  const p = strokePath(spine, w, { joint: t.corner });
  const deg = DIR[o.dir ?? 'down'] ?? 0;
  rotAbout(p, deg, [t.cx, t.cy]);
  rotAbout(spine, deg, [t.cx, t.cy]);
  return o.spine ? { path: p, spine, apex: spine.subs[0].segs[0].to } : p;
}

/**
 * СТРЕЛКА = ШЕВРОН + ХВОСТ. Длина хвоста — свободный параметр: ровно за счёт
 * него arrow-forward, download и resize оказываются одной конструкцией с
 * разными значениями, а не тремя рисунками.
 *
 * @param {{dir?:string, half?:number, open?:number, tail?:number,
 *          weight?:number, apexAt?:number}} o
 *   tail    — длина хвоста ОТ ВЕРШИНЫ назад по оси (0 = чистый шеврон)
 *   apexAt  — координата вершины вдоль оси в канонической ориентации
 */
export function arrow(t, o = {}) {
  const w = o.weight ?? t.stroke.base;
  const half = o.half ?? 5.784;
  const open = o.open ?? 45;
  const depth = half / Math.tan(rad(open));
  const apexY = o.apexAt ?? t.cy + (o.tail ?? 0) / 2;
  const apex = [t.cx, apexY];
  const tail = o.tail ?? 0;
  const pts = [
    [apex[0] - half, apex[1] - depth],
    [apex[0], apex[1]],
    [apex[0] + half, apex[1] - depth],
  ];
  const head = polySpine(pts);
  const p = strokePath(head, w, { joint: t.corner });
  if (tail > 0) p.add(strokeSegment(apex, [apex[0], apex[1] - tail], w));
  const deg = DIR[o.dir ?? 'down'] ?? 0;
  return rotAbout(p, deg, [t.cx, t.cy]);
}

// ── КЛИН ──────────────────────────────────────────────────────────────────

/**
 * КЛИН — указатель воспроизведения: равнобедренный треугольник остриём вправо.
 *
 * Один примитив на всё семейство play. Ни одна иконка не задаёт форму клина
 * сама: она объявляет ТОЛЬКО где его центр и какой он высоты. Пропорция,
 * радиус скругления и его мягкость приходят из токена и потому одинаковы у
 * play, play-circle, перемотки и клина со стенкой — иначе одинаковые на вид
 * острия оказываются скруглены по-разному, что и было.
 *
 * Скругление ЕДИНО во всех трёх вершинах: замеры оригиналов дают R/H = 0.17…
 * 0.195 без выделения острия. Нулевой радиус запрещён конструкцией — острая
 * вершина пережимает штрих в точку, чего рука не делает нигде.
 *
 * @param {object} t     разрешённые токены
 * @param {number[]} c   оптический центр клина
 * @param {number} h     высота (от основания до острия)
 * @param {{dir?:number, r?:number}} [o] поворот в градусах и переопределение радиуса
 */
export function wedge(t, c, h, o = {}) {
  const W = t.wedge;
  const back = h * W.anchor;
  const fwd = h - back;
  const half = (h * (o.aspect ?? W.aspect)) / 2;
  const r = o.r ?? h * W.corner;
  const p = S.roundedPolygon(
    [
      [c[0] - back, c[1] - half],
      [c[0] + fwd, c[1]],
      [c[0] - back, c[1] + half],
    ],
    r,
    t.corner.smoothing,
  );
  return rotAbout(p, o.dir ?? 0, c);
}

// ── ШТРИХОВЫЕ НАБОРЫ ──────────────────────────────────────────────────────

/**
 * СТОПКА ПРУТЬЕВ — menu, filter, list, text, options, stats.
 * Ширины задаются списком: убывающий список даёт воронку фильтра, равный —
 * гамбургер. Шаг между осями — токен, а не вкус.
 */
export function bars(t, o = {}) {
  const w = o.weight ?? t.stroke.base;
  const gap = o.gap ?? w + t.clearance.channel;
  const widths = o.widths ?? [12, 12];
  const n = widths.length;
  const x = o.cx ?? t.cx;
  const y0 = (o.cy ?? t.cy) - ((n - 1) * gap) / 2;
  const align = o.align ?? 'center';
  const p = new Path();
  widths.forEach((ww, i) => {
    const y = y0 + i * gap;
    const left = align === 'start' ? x - widths[0] / 2 : align === 'end' ? x + widths[0] / 2 - ww : x - ww / 2;
    p.add(strokeSegment([left, y], [left + ww, y], w));
  });
  return p;
}

/** РЯД ТОЧЕК — ellipsis, chatbubble-ellipses, dice. */
export function dots(t, o = {}) {
  const r = o.r ?? t.cap.base;
  const gap = o.gap ?? 2 * r + t.clearance.channel;
  const n = o.count ?? 3;
  const dir = o.axis === 'vertical' ? [0, 1] : [1, 0];
  const c = o.center ?? [t.cx, t.cy];
  const p = new Path();
  for (let i = 0; i < n; i++) {
    const k = i - (n - 1) / 2;
    p.add(S.circle(v2.mad(c, dir, k * gap), r));
  }
  return p;
}

// ── ЛУЧИ ──────────────────────────────────────────────────────────────────

/**
 * РАДИАЛЬНЫЕ ЛУЧИ — sun, sun-low, sparkle, flash-семья, loader.
 *
 * Внешний терминал ЗАКРЕПЛЁН на keyline (rOuter = Rkey − cap): луч не
 * «висит», он упирается в границу живой области. Растёт он ВНУТРЬ, и длина —
 * единственный свободный параметр:
 *     len = 0            → sun-low (луч выродился в точку-терминал)
 *     len = перо         → sun (канонический)
 *     len = maxRayLen(…) → предел, за которым съеден охранный зазор до тела
 */
export function rays(t, o = {}) {
  const w = o.weight ?? t.stroke.base;
  const cap = DERIVED.cap(w);
  const n = o.count ?? 8;
  const rOuter = o.rOuter ?? t.keyR - cap;
  const len = Math.max(0, o.len ?? 0);
  const phase = o.phase ?? Math.PI / 2;
  const c = o.center ?? [t.cx, t.cy];
  const p = new Path();
  for (let i = 0; i < n; i++) {
    const a = phase + (TAU * i) / n;
    const outer = v2.polar(c, rOuter, a);
    if (len < 1e-6) p.add(S.circle(outer, cap));
    else p.add(strokeSegment(outer, v2.polar(c, rOuter - len, a), w));
  }
  return p;
}

/** Предельная длина луча: дальше зазор до тела проседает ниже охранного. */
export function maxRayLen(t, bodyR, o = {}) {
  const w = o.weight ?? t.stroke.base;
  const cap = DERIVED.cap(w);
  const rOuter = o.rOuter ?? t.keyR - cap;
  return Math.max(0, rOuter - bodyR - (o.clearance ?? t.clearance.min) - cap);
}

// ── НАКЛАДНЫЕ КЛАССЫ ──────────────────────────────────────────────────────

/**
 * ПЕРЕЧЁРКИВАНИЕ. Ось — диагональ живой области, терминалы упираются в её
 * углы: от (canvas−margin−cap, margin+cap) до (margin+cap, canvas−margin−cap).
 * Носитель разрезается тенью той же оси, расширенной на охранный зазор.
 */
export function slashAxis(t, o = {}) {
  const w = o.weight ?? t.stroke.base;
  const cap = DERIVED.cap(w);
  const lo = t.margin + cap;
  const hi = t.canvas - t.margin - cap;
  const shrink = o.shrink ?? 0;
  const a = [hi - shrink, lo + shrink];
  const b = [lo + shrink, hi - shrink];
  return { a, b, weight: w };
}

export function slash(t, o = {}) {
  const ax = slashAxis(t, o);
  return strokeSegment(ax.a, ax.b, ax.weight);
}

/** Тень перечёркивания — то, что вырезается из носителя. */
export function slashShadow(t, o = {}) {
  const ax = slashAxis(t, o);
  const clr = o.clearance ?? t.clearance.slash;
  return strokeSegment(ax.a, ax.b, ax.weight + 2 * clr);
}

/** Класс «перечёркнуто»: вырезать тень, положить ось. */
export function withSlash(path, t, o = {}) {
  return cut(path, slashShadow(t, o)).add(slash(t, o));
}

/**
 * БЕЙДЖ-УВЕДОМЛЕНИЕ. Диск вписан в верхний правый угол живой области:
 * центр (canvas−margin−r, margin+r) — единственное положение, при котором он
 * касается обеих границ, а не «примерно там».
 */
export function badgeDisc(t, o = {}) {
  const r = o.r ?? t.canvas / 8;
  const c = o.center ?? [t.canvas - t.margin - r, t.margin + r];
  return { c, r };
}

export function badge(t, o = {}) {
  const b = badgeDisc(t, o);
  return S.circle(b.c, b.r);
}

export function badgeShadow(t, o = {}) {
  const b = badgeDisc(t, o);
  return S.circle(b.c, b.r + (o.clearance ?? t.clearance.badge));
}

/** Класс «с уведомлением». */
export function withBadge(path, t, o = {}) {
  return cut(path, badgeShadow(t, o)).add(badge(t, o));
}

// ── ОБРАМЛЕНИЕ ────────────────────────────────────────────────────────────

/**
 * КОЛЬЦО-КОНТЕЙНЕР. Вес кольца легче веса глифа — контейнер оптически не
 * должен спорить с содержимым (приём SF Symbols, зафиксирован токенами).
 */
export function enclosureRing(t, o = {}) {
  return S.ring(o.center ?? [t.cx, t.cy], o.r ?? t.keyR, o.weight ?? t.stroke.ring);
}

/** Диск-контейнер (заливка). */
export function enclosureDisc(t, o = {}) {
  return S.circle(o.center ?? [t.cx, t.cy], o.r ?? t.keyR);
}

/**
 * Класс «в круге». Outline: кольцо + глиф, ужатый к внутреннему keyline.
 * Filled: диск минус тот же глиф негативом — одна конструкция, два прочтения.
 *
 * @param {(t:object)=>Path} makeGlyph  строитель глифа в полной канве
 */
export function enclosed(t, makeGlyph, o = {}) {
  const scale = o.scale ?? 0.62;
  const glyph = makeGlyph(t).scale(scale, [t.cx, t.cy]);
  if (o.filled) return cut(enclosureDisc(t, o), glyph);
  return enclosureRing(t, o).add(glyph);
}

// ── ПРОЧЕЕ ────────────────────────────────────────────────────────────────

/** Корпусная пластина — экран, конверт, карточка, календарь. */
export function plate(t, o = {}) {
  const w = o.w ?? 2 * t.squareHalf();
  const h = o.h ?? w;
  const r = o.r ?? t.corner.box;
  const weight = o.weight ?? t.stroke.base;
  const c = o.center ?? [t.cx, t.cy];
  const z = o.smoothing ?? t.corner.smoothing;
  return o.solid
    ? S.roundedRect(c[0], c[1], w, h, r, z)
    : S.roundedRectRing(c[0], c[1], w, h, r, weight, z);
}

export { strokePath, strokePolyline, strokeSegment, polySpine, cut, S };
