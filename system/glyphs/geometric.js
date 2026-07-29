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
 * ТОЧКА-ДЕТАЛЬ: радиус = corner.detail (2). Замер руки: `a2 2 0 1 1 0 4`.
 * Шаг 7 снят с корпуса (центры 5 / 12 / 19) — чернила трёх точек занимают
 * ровно 18 = 2·(7 + 2).
 */
export const DOT_STEP = 7;

defineGlyph('ellipsis-horizontal', {
  family: 'geometric',
  law: 'три диска радиуса corner.detail в ряд с шагом 7; заливка = тот же ряд (точка не имеет штрихового прочтения)',
  outline: (t) => dots(t, { count: 3, r: t.corner.detail, gap: DOT_STEP }),
  deriveFilled: 'none',
});

defineGlyph('ellipsis-vertical', {
  family: 'geometric',
  law: 'тот же ряд дисков, повёрнутый на 90°',
  outline: (t) => dots(t, { count: 3, r: t.corner.detail, gap: DOT_STEP, axis: 'vertical' }),
  deriveFilled: 'none',
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
