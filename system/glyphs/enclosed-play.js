/**
 * system/glyphs/enclosed-play.js — перемотка в круге.
 *
 * Продолжение класса «в круге» (system/glyphs/enclosed.js): те же кольцо и
 * правило Filled, другая начинка. Начинка здесь — КЛИН, та же часть, что у
 * play-circle: `parts.wedge`. Меняется только количество клиньев, их размер и
 * наличие стенки.
 *
 *   play-forward       = два клина подряд
 *   play-skip-forward  = клин + стенка
 *   *-back             = то же зеркально относительно вертикали канвы
 *
 * Ни одна из четырёх иконок не описывает форму клина сама: пропорция, радиус
 * вершин и мягкость входа приходят из токена `wedge`. До этого здесь жили две
 * независимые подгонки — у двойного клина радиус НОЛЬ, у клина со стенкой
 * 0.76/0.36, а у play-circle третий вариант 1.5/1.15. Три записи одной фигуры
 * расходились и на глаз (разная угловатость острий), и по устройству: острый
 * клин пережимал штрих в точку там, где рука держит 1.41 единицы.
 */

import { declare, PEN } from './enclosed.js';
import { wedge, strokeSegment } from '../parts.js';

/**
 * ДВОЙНОЙ КЛИН (play-forward). Высота клина 8.49, центры на ±3.15 от оси
 * канвы — только эти два числа и отличают его от одиночного.
 */
export const DOUBLE = Object.freeze({ h: 8.49, gap: 3.15 });

/**
 * КЛИН СО СТЕНКОЙ (play-skip-forward). Клин крупнее двойного (9.15) и сдвинут
 * назад на 1.02, чтобы уступить место стенке — штриху пером контейнера на
 * x = 15.72 полувысотой 3.58.
 */
export const SKIP = Object.freeze({ h: 9.15, dx: -1.02, wallX: 15.72, wallHalf: 3.58 });

const mirror = (p, t) => p.mirrorX(t.cx);

const doubleWedge = (t) =>
  wedge(t, [t.cx - DOUBLE.gap, t.cy], DOUBLE.h).add(wedge(t, [t.cx + DOUBLE.gap, t.cy], DOUBLE.h));

const wedgeWall = (t) =>
  wedge(t, [t.cx + SKIP.dx, t.cy], SKIP.h).add(
    strokeSegment([SKIP.wallX, t.cy - SKIP.wallHalf], [SKIP.wallX, t.cy + SKIP.wallHalf], PEN(t)),
  );

declare('play-forward-circle', 'два клина части wedge высотой 8.49, центры на ±3.15 от оси канвы', doubleWedge);
declare('play-back-circle', 'тот же двойной клин, зеркально относительно вертикали канвы', (t) => mirror(doubleWedge(t), t));
declare(
  'play-skip-forward-circle',
  'клин части wedge высотой 9.15 со сдвигом −1.02 плюс стенка: штрих пером контейнера на x = 15.72',
  wedgeWall,
);
declare('play-skip-back-circle', 'тот же клин со стенкой, зеркально относительно вертикали канвы', (t) => mirror(wedgeWall(t), t));
