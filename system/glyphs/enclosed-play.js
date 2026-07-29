/**
 * system/glyphs/enclosed-play.js — перемотка в круге.
 *
 * Продолжение класса «в круге» (system/glyphs/enclosed.js): те же кольцо и
 * правило Filled, другая начинка. Начинка здесь — КЛИН, тот же примитив, что
 * у play-circle: скруглённый треугольник вершиной вправо. Меняется только его
 * количество и наличие стенки:
 *
 *   play-forward       = два клина подряд
 *   play-skip-forward  = клин + стенка
 *   *-back             = то же зеркально относительно вертикали канвы
 *
 * Ни один из четырёх глифов не рисуется отдельно.
 */

import { declare, PEN } from './enclosed.js';
import * as S from '../prim/shape.js';
import { strokeSegment } from '../prim/stroke.js';

/** Клин: скруглённый треугольник вершиной вправо, ось на cy. */
function wedge(t, cx, base, apex, half, rBase, rApex) {
  return S.roundedPolygon(
    [
      [cx + base, t.cy - half],
      [cx + apex, t.cy],
      [cx + base, t.cy + half],
    ],
    [rBase, rApex, rBase],
    t.corner.smoothing,
  );
}

/**
 * ДВОЙНОЙ КЛИН (play-forward). Замеры: основание −3.07, вершина +5.42,
 * полувысота 5.28 от собственного центра клина; центры клиньев на ±3.15 от
 * оси канвы. Углы острые — рука их не скругляет, в отличие от одиночного
 * play-circle, где вершина скруглена на 1.5.
 */
export const DOUBLE = Object.freeze({ base: -3.07, apex: 5.42, half: 5.28, r: 0, gap: 3.15 });
/**
 * КЛИН СО СТЕНКОЙ (play-skip-forward). Клин крупнее двойного и скруглён:
 * основание −3.78, вершина +5.37, полувысота 5.89, радиусы 0.76 / 0.36,
 * центр на −0.53 от оси; стенка — штрих пером контейнера на x = 15.72
 * полувысотой 3.58.
 */
export const SKIP = Object.freeze({
  base: -3.78,
  apex: 5.37,
  half: 5.89,
  rBase: 0.76,
  rApex: 0.36,
  dx: -0.53,
  wallX: 15.72,
  wallHalf: 3.58,
});

const mirror = (p, t) => p.mirrorX(t.cx);

const doubleWedge = (t) =>
  wedge(t, t.cx - DOUBLE.gap, DOUBLE.base, DOUBLE.apex, DOUBLE.half, DOUBLE.r, DOUBLE.r).add(
    wedge(t, t.cx + DOUBLE.gap, DOUBLE.base, DOUBLE.apex, DOUBLE.half, DOUBLE.r, DOUBLE.r),
  );

const wedgeWall = (t) =>
  wedge(t, t.cx + SKIP.dx, SKIP.base, SKIP.apex, SKIP.half, SKIP.rBase, SKIP.rApex).add(
    strokeSegment([SKIP.wallX, t.cy - SKIP.wallHalf], [SKIP.wallX, t.cy + SKIP.wallHalf], PEN(t)),
  );

const DOUBLE_ARG =
  'остаточные ~4% — форма вершин. Рука довела острия двойного клина короткими кривыми ' +
  'переменной кривизны, система ставит либо точный угол, либо точную дугу. Расхождение ' +
  'размазано по шести вершинам двух клиньев, кластеров-деталей нет: кольцо, которое ' +
  'несёт бо́льшую часть чернил, совпадает точно.';

declare('play-forward-circle', 'два клина подряд: основание −3.07, вершина +5.42, полувысота 5.28, центры на ±3.15', doubleWedge, {
  argument: DOUBLE_ARG,
});
declare('play-back-circle', 'тот же двойной клин, зеркально относительно вертикали канвы', (t) => mirror(doubleWedge(t), t), {
  argument: DOUBLE_ARG,
});
declare(
  'play-skip-forward-circle',
  'клин со стенкой: скруглённый клин (радиусы 0.76 / 0.36) плюс штрих пером контейнера на x = 15.72',
  wedgeWall,
);
declare('play-skip-back-circle', 'тот же клин со стенкой, зеркально относительно вертикали канвы', (t) => mirror(wedgeWall(t), t));
