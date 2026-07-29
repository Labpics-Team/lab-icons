/**
 * system/glyphs/dice.js — КУБИК: шестиугольник, Y-шов, фишки.
 *
 * Разобрано дуктусом (`node system/ductus.js dice`), а не на глаз:
 *   • чернила распадаются на 8 связных кусков — корпус и 7 фишек;
 *   • мода пера по гребню 1.8 с долей 93% ⟹ весь корпус ведён базовым пером;
 *   • три счётчика площадью 58.7 / 56.7 / 51.1 — это три видимые грани куба;
 *   • габарит фишки 1.5 × 2.25 ⟹ эллипс 0.75 × 1.125.
 *
 * Конструкция, которая всё это объясняет: скруглённый ШЕСТИУГОЛЬНИК с
 * вертикальными боками (изометрия куба) + Y-шов из центра к трём вершинам +
 * фишки-эллипсы. Скругление 3.9 — не подгон: ровно эта цифра стоит в `d`
 * оригинала (`a3.9 3.9`), и находится она подгоном ТОЛЬКО при включённом
 * сглаживании ζ. Без ζ оптимум уезжает на 3.2 и глиф теряет 1% сходимости —
 * то есть рука вела углы именно сглаженными.
 */

import { defineGlyph } from '../registry.js';
import * as S from '../prim/shape.js';
import { Path } from '../core/path.js';
import { cut } from '../core/boolean.js';
import { strokeSegment } from '../prim/stroke.js';

/**
 * КОРПУС. Полуширина 10.05, полувысота 11.6; боковые вершины на половине
 * полувысоты — это и даёт изометрическую проекцию куба. Скругление 3.9.
 */
export const BODY = Object.freeze({ halfW: 10.05, halfH: 11.6, corner: 3.9 });
/** Узел Y-шва — центр канвы. Замер 11.96. */
export const SEAM_Y = 11.96;
/** Фишка: эллипс 0.77 × 1.155. На верхней грани он повёрнут на 90°. */
export const PIP = Object.freeze({ a: 0.77, b: 1.155 });
/**
 * Расклад фишек, снятый дуктусом по габаритам связных кусков: 1 на верхней
 * грани, 2 на левой, 4 на правой. Смещения от центра канвы.
 */
export const PIPS = Object.freeze({
  top: [0, -5.33],
  left: [
    [-6.44, 2.645],
    [-2.8, 2.105],
  ],
  right: [
    [2.82, 5.355],
    [6.45, 2.655],
    [2.82, 2.115],
    [6.45, -0.435],
  ],
});

function corpus(t) {
  const { halfW: W, halfH: H, corner } = BODY;
  const h = H / 2;
  const V = [
    [t.cx, t.cy - H],
    [t.cx + W, t.cy - h],
    [t.cx + W, t.cy + h],
    [t.cx, t.cy + H],
    [t.cx - W, t.cy + h],
    [t.cx - W, t.cy - h],
  ];
  const pen = t.stroke.glyph;
  const p = S.roundedPolygonRing(V, corner, pen, t.corner.smoothing);
  // Y-шов: из узла к верхним боковым вершинам и вниз к нижней
  const node = [t.cx, SEAM_Y];
  p.add(strokeSegment(node, V[1], pen, { cap: 'butt' }));
  p.add(strokeSegment(node, V[5], pen, { cap: 'butt' }));
  p.add(strokeSegment(node, [t.cx, V[3][1]], pen, { cap: 'butt' }));
  return p;
}

function pips(t) {
  const side = (dx, dy) => S.ellipse([t.cx + dx, t.cy + dy], PIP.a, PIP.b, 0);
  const p = S.ellipse([t.cx + PIPS.top[0], t.cy + PIPS.top[1]], PIP.b, PIP.a, 0);
  for (const [dx, dy] of PIPS.left) p.add(side(dx, dy));
  for (const [dx, dy] of PIPS.right) p.add(side(dx, dy));
  return p;
}

/** Вычесть каждый подпуть региона по очереди: `cut` берёт регион одним куском. */
function subtractEach(base, region) {
  let p = base;
  for (const sub of region.clone().subs) {
    if (sub.segs.length) p = cut(p, new Path([sub]));
  }
  return p;
}

/** Y-шов как ВЫЧИТАЕМЫЙ регион (для залитого варианта). */
function seam(t, pen) {
  const { halfW: W, halfH: H } = BODY;
  const h = H / 2;
  const node = [t.cx, SEAM_Y];
  const p = new Path();
  p.subs.length = 0;
  p.add(strokeSegment(node, [t.cx + W, t.cy - h], pen, { cap: 'butt' }));
  p.add(strokeSegment(node, [t.cx - W, t.cy - h], pen, { cap: 'butt' }));
  p.add(strokeSegment(node, [t.cx, t.cy + H], pen, { cap: 'butt' }));
  return p;
}

defineGlyph('dice', {
  family: 'objects',
  law:
    'скруглённый шестиугольник с вертикальными боками (боковые вершины на половине полувысоты — ' +
    'изометрия куба), полуразмеры 10.05 × 11.6, скругление 3.9 со сглаживанием ζ; Y-шов пером из ' +
    'узла к двум верхним вершинам и вниз; фишки — эллипс 0.77 × 1.155, на верхней грани повёрнутый на 90°',
  argument:
    'скругление 3.9 не подобрано, а найдено: подгон при включённом ζ сходится ровно к 3.926, а в ' +
    'оригинале в `d` стоит `a3.9 3.9`. Без сглаживания оптимум уезжает на 3.2 и сходимость падает ' +
    'на процент — значит рука вела углы сглаженными, и ζ здесь не украшение, а замер.',
  outline: (t) => corpus(t).add(pips(t)),
  /**
   * Filled: тот же корпус сплошным, Y-шов и фишки ВЫБИТЫ негативом. Дуктус
   * оригинала: три куска чернил (три грани) и семь просветов (фишки) — ровно
   * то, что даёт эта конструкция, и ни одной лишней фигуры.
   */
  filled: (t) => {
    const { halfW: W, halfH: H, corner } = BODY;
    const h = H / 2;
    const V = [
      [t.cx, t.cy - H],
      [t.cx + W, t.cy - h],
      [t.cx + W, t.cy + h],
      [t.cx, t.cy + H],
      [t.cx - W, t.cy + h],
      [t.cx - W, t.cy - h],
    ];
    let p = S.roundedPolygon(V, corner, t.corner.smoothing);
    p = subtractEach(p, seam(t, t.stroke.base));
    p = subtractEach(p, pips(t));
    return p;
  },
});
