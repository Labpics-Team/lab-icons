/**
 * system/glyphs/geometric.js — чистая геометрия: круг, квадрат, крест, штрих.
 *
 * Это опорная семья: на ней проверяются сами токены. Если здесь расхождение
 * с оригиналом больше дребезга руки, значит неверен токен, а не глиф.
 */

import { defineGlyph } from '../registry.js';
import * as S from '../prim/shape.js';
import { strokeSegment } from '../prim/stroke.js';
import { dots } from '../parts.js';
import { DERIVED } from '../tokens.js';

/**
 * ОСЕВОЙ ТЕРМИНАЛЬНЫЙ KEYLINE = 6 (при канве 24).
 *
 * Снят с корпуса и подтверждён тремя независимыми глифами: у minus терминалы
 * стоят на 6 и 18.06; у plus — на 6/18.11 по обеим осям; у close (Filled)
 * центр терминала лежит на (7.75, 7.75), то есть на расстоянии 6.01 от центра
 * по диагонали. Три разных глифа, три разных построения, одно число.
 */
export const AXIAL = 6;

defineGlyph('minus', {
  family: 'geometric',
  law: 'горизонтальный штрих пером glyph, терминалы на осевом keyline ±6 от центра',
  outline: (t) => strokeSegment([t.cx - AXIAL, t.cy], [t.cx + AXIAL, t.cy], t.stroke.glyph),
});

defineGlyph('plus', {
  family: 'geometric',
  law: 'крест: 12-угольник с плечами до осевого keyline ±6, внешний радиус вершины = кап (два смежных скругления смыкаются в полный терминал), внутренние вершины острые',
  outline: (t) => S.cross([t.cx, t.cy], AXIAL + t.cap.glyph, t.cap.glyph, t.cap.glyph, 0),
});

defineGlyph('close', {
  family: 'geometric',
  law: 'тот же крест, повёрнутый на 45°: X и + — одна форма в двух положениях, а не две иконки',
  outline: (t) => S.cross([t.cx, t.cy], AXIAL + t.cap.glyph, t.cap.glyph, t.cap.glyph, 0, Math.PI / 4),
});

defineGlyph('ellipse', {
  family: 'geometric',
  law: 'кольцо по keyline-окружности (d = живая область), внутренний радиус = внешний − перо',
  outline: (t) => S.ring([t.cx, t.cy], t.keyR, t.stroke.base),
  filled: (t) => S.circle([t.cx, t.cy], t.keyR),
});

defineGlyph('square', {
  family: 'geometric',
  law: 'скруглённый квадрат, ВПИСАННЫЙ углами в keyline-окружность: h = R + (Rkey − R)/√2 при R = corner.box ⟹ габарит 18.485; внутренняя рамка = внешняя − перо, её радиус = R − перо',
  argument:
    'габарит не задан, а выведен из вписанности в круг-keyline: рука нарисовала 18.48, формула даёт 18.485 — совпадение не подгонка, а причина.',
  outline: (t) => {
    const h = t.squareHalf();
    return S.roundedRectRing(t.cx, t.cy, 2 * h, 2 * h, t.corner.box, t.stroke.base, t.corner.smoothing);
  },
  filled: (t) => {
    const h = t.squareHalf();
    return S.roundedRect(t.cx, t.cy, 2 * h, 2 * h, t.corner.box, t.corner.smoothing);
  },
});

/**
 * ТОЧКА-ДЕТАЛЬ REGULAR: радиус = corner.detail (2). Замер руки: `a2 2 0 1 1 0 4`.
 * Шаг 7 снят с корпуса (центры 5 / 12 / 19) — чернила трёх точек занимают
 * ровно 18 = 2·(7 + 2).
 */
export const DOT_STEP = 7;

/**
 * ТОЧКА-ДЕТАЛЬ BOLD — САМОСТОЯТЕЛЬНЫЙ КАЛИБР, а не тот же диск.
 *
 * Диск не имеет штрихового прочтения, поэтому ось fill его не трогает: система
 * строила Filled тем же радиусом 2, что и Outline. Рука так не делает. Замер
 * оригиналов Filled (радиус выписан в `d` буквально, три независимых файла):
 *   ellipsis-horizontal_filled  `a2.5 2.5` ×3
 *   ellipsis-vertical_filled    `a2.5 2.5` ×3
 *   apps_filled                 `a2.5 2.5` ×9
 * Центры дуг, восстановленные по формуле SVG-дуги из эндпоинтов, дают у
 * ellipsis-horizontal ровно (6.000, 12.000) · (12.000, 12.000) · (18.000, 12.000);
 * у apps сетка 6.05 / 12.05 / 18.05 по обеим осям. То есть крайняя точка Bold
 * стоит на ОСЕВОМ ТЕРМИНАЛЬНОМ KEYLINE ±AXIAL — там же, где терминалы minus,
 * plus и close, — а шаг ряда равен самому AXIAL.
 *
 * Независимая проверка без разбора дуг — габарит чернил ellipsis-horizontal/filled:
 * x от 3.500 до 20.500, y от 9.500 до 14.500. Высота 5.000 = 2·2.5 даёт радиус,
 * полуширина 8.500 = AXIAL + 2.5 даёт шаг. Оба числа сходятся до третьего знака.
 *
 * Радиус 2.5 из токенов не выводится: это отдельный калибр детали в Bold,
 * объявленный замером. Отношение к Regular 2.5/2 = 1.25 не равно ни bold/base
 * (1.333), ни приросту на полперa (2.3) — подставлять их было бы выдумкой.
 */
export const DOT_R_BOLD = 2.5;

defineGlyph('ellipsis-horizontal', {
  family: 'geometric',
  law:
    'три диска в ряд по горизонтали. Regular: радиус corner.detail, шаг 7 (центры 5/12/19). ' +
    'Bold: радиус 2.5 — самостоятельный калибр детали, объявленный замером трёх оригиналов Filled; ' +
    'шаг равен осевому терминальному keyline AXIAL, крайние диски центрами стоят на ±AXIAL',
  outline: (t) => dots(t, { count: 3, r: t.corner.detail, gap: DOT_STEP }),
  filled: (t) => dots(t, { count: 3, r: DOT_R_BOLD, gap: AXIAL }),
});

defineGlyph('ellipsis-vertical', {
  family: 'geometric',
  law: 'тот же ряд дисков в обоих начертаниях, повёрнутый на 90°: одна конструкция в двух положениях',
  argument:
    'Filled 7.6% — это ЦЕЛИКОМ жёсткий сдвиг оригинала с оси канвы, а не расхождение формы. ' +
    'Габарит чернил оригинала по x — от 9.634 до 14.654, то есть центр столбца 12.144 при ' +
    'центре канвы 12.000: столбец смещён на 0.144 вправо. Доказательство, что смещён оригинал, ' +
    'а не система: у ellipsis-vertical/outline тот же габарит даёт центр 12.000, у ' +
    'ellipsis-horizontal/filled — 12.000, у него же по y — 12.000. Три записи руки из четырёх ' +
    'стоят на оси, сошла только четвёртая. Перестроение системы по центрам руки даёт 0.48%: ' +
    'остаток 7.09 п.п. — ровно этот сдвиг, форма и калибр совпадают. Медиана смещения контура ' +
    '0.110 ед (0.046 пера Bold), p95 0.166. Система берёт большинство и держит ось.',
  outline: (t) => dots(t, { count: 3, r: t.corner.detail, gap: DOT_STEP, axis: 'vertical' }),
  filled: (t) => dots(t, { count: 3, r: DOT_R_BOLD, gap: AXIAL, axis: 'vertical' }),
});

defineGlyph('rhomb', {
  family: 'geometric',
  law: 'тот же вписанный скруглённый квадрат, что и square, повёрнутый на 45°: одна форма в двух положениях. Рамка пером, внутренний радиус = внешний − перо',
  outline: (t) => {
    const h = t.squareHalf();
    return S.roundedRectRing(t.cx, t.cy, 2 * h, 2 * h, t.corner.box, t.stroke.base, t.corner.smoothing).rotate(
      Math.PI / 4,
      [t.cx, t.cy],
    );
  },
  filled: (t) => {
    const h = t.squareHalf();
    return S.roundedRect(t.cx, t.cy, 2 * h, 2 * h, t.corner.box, t.corner.smoothing).rotate(Math.PI / 4, [t.cx, t.cy]);
  },
});
