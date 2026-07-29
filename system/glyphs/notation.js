/**
 * system/glyphs/notation.js — ЛЕНТА и КЛАСС «СТОПКА».
 *
 * bookmark и bookmarks — не две иконки, а одна лента в одном и двух
 * экземплярах. Второй экземпляр порождает КЛАСС, который в корпусе встречается
 * далеко за пределами закладок (copy, duplicate, files, images, chatbubbles,
 * layers): задний экземпляр сначала ВЫРЕЗАЕТ из себя тень переднего с охранным
 * зазором и только потом передний ложится сверху. Иначе два контура слипаются
 * в кашу на мелком кегле.
 */

import { defineGlyph } from '../registry.js';
import * as S from '../prim/shape.js';
import { cut } from '../core/boolean.js';

/**
 * ЛЕНТА — пятиугольник: прямоугольник, у которого нижняя сторона заменена
 * вырезом-стрелкой. Скругления по-вершинно: верх — корпусное, хвосты —
 * детальное, остриё выреза острое (рука его не скругляет).
 *
 * Вершина хвоста лежит НИЖЕ видимого кончика и даже ниже канвы. Это не ошибка:
 * скругление радиуса r при внутреннем угле φ поднимает кончик над вершиной на
 * r·(1/sin(φ/2) − 1); при φ ≈ 56° и r = 1.87 это 2.1 ед. Задавать вершину —
 * значит задавать конструкцию; задавать кончик — значит задавать результат.
 */
function ribbon(cx, halfW, top, tailVertex, apexY, rTop, rTail, pen) {
  const pts = [
    [cx - halfW, top],
    [cx + halfW, top],
    [cx + halfW, tailVertex],
    [cx, apexY],
    [cx - halfW, tailVertex],
  ];
  return S.roundedPolygonRing(pts, [rTop, rTop, rTail, 0, rTail], pen);
}

/** Тот же силуэт сплошным — тень для класса «стопка». */
function ribbonSolid(cx, halfW, top, tailVertex, apexY, rTop, rTail, grow) {
  const pts = [
    [cx - halfW, top - grow],
    [cx + halfW + grow, top - grow],
    [cx + halfW + grow, tailVertex + grow],
    [cx, apexY + grow * 1.5],
    [cx - halfW - grow, tailVertex + grow],
  ];
  pts[0][0] = cx - halfW - grow;
  return S.roundedPolygon(pts, [rTop + grow, rTop + grow, rTail + grow, grow, rTail + grow]);
}

/** Одиночная лента, Outline (замеры оригинала `bookmark.svg`). */
export const RIBBON = Object.freeze({ halfW: 7.17, top: 1.6, tail: 23.97, apex: 16.37, rTop: 3.21, rTail: 1.87 });
/**
 * Та же лента в Filled. Силуэт УЖЕ и ниже: halfW 7.05 против 7.17, верх 2.02
 * против 1.60. Это не другая иконка — это тот же приём, что у залитого тела
 * календаря: сплошная масса оптически тяжелее рамки и обязана отступить.
 * Скругления при этом те же (3.17 / 1.84 против 3.21 / 1.87 — разброс замера).
 */
export const RIBBON_FILLED = Object.freeze({ halfW: 7.05, top: 2.02, tail: 24.28, apex: 16.39, rTop: 3.17, rTail: 1.84 });
/**
 * Лента в стопке: та же форма, ужатая так, чтобы ПАРА уложилась в живую
 * область. Сдвиг ровно 3 по обеим осям — то есть диагональный, под 45°,
 * на шкале направлений. Зазор выреза 1.0.
 */
export const STACK = Object.freeze({
  halfW: 6.04,
  top: 3.11,
  tail: 21.89,
  apex: 16.26,
  rTop: 2.66,
  rTail: 1.85,
  shift: 3.0,
  clearance: 1.02,
});

defineGlyph('bookmark', {
  family: 'notation',
  law:
    'лента: пятиугольник с вырезом-стрелкой снизу, рамка пером. Скругление верха — ' +
    'корпусное, хвостов — детальное, остриё выреза острое. Вершина хвоста задаётся ' +
    'конструктивно (ниже канвы), видимый кончик поднимает скругление на r(1/sin(φ/2) − 1)',
  argument:
    'Outline расходится на 3.4%, Filled — на 1.4%; в обоих случаях расхождение это форма хвоста. Рука довела кончик хвоста тремя кривыми Безье ' +
    'переменной кривизны, система ставит одну дугу постоянного радиуса. Разница лежит ' +
    'кольцевой каймой шириной около 0.1 ед. по двум хвостам; ни одна деталь не потеряна ' +
    'и не добавлена. Дуга выбрана сознательно: у неё есть центр, то есть ось, вокруг ' +
    'которой хвост будет двигаться при анимации закладки.',
  outline: (t) =>
    ribbon(t.cx, RIBBON.halfW, RIBBON.top, RIBBON.tail, RIBBON.apex, RIBBON.rTop, RIBBON.rTail, t.stroke.glyph),
  filled: (t) => {
    const F = RIBBON_FILLED;
    return ribbonSolid(t.cx, F.halfW, F.top, F.tail, F.apex, F.rTop, F.rTail, 0);
  },
});

defineGlyph('bookmarks', {
  family: 'notation',
  law:
    'та же лента в двух экземплярах со сдвигом 3 по обеим осям (диагональ 45° на шкале ' +
    'направлений); класс «стопка» — задний экземпляр вырезает из себя тень переднего ' +
    'с зазором 1.0, передний ложится сверху. Лента ужата так, чтобы пара уложилась в живую область',
  argument:
    'остаточные 4.8% — та же кривизна хвостов, что и у одиночной ленты, только удвоенная: ' +
    'хвостов теперь четыре. Плюс рука сделала задний экземпляр чуть короче переднего ' +
    '(её хвост обрывается на 17.0 против 18.4 у системы) — но это не закон, а следствие ' +
    'того, что она рисовала его отдельно, а не тем же силуэтом.',
  outline: (t) => {
    const pen = t.stroke.glyph;
    const s = STACK.shift / 2;
    const back = ribbon(t.cx + s, STACK.halfW, STACK.top - s, STACK.tail - s, STACK.apex - s, STACK.rTop, STACK.rTail, pen);
    const front = ribbon(t.cx - s, STACK.halfW, STACK.top + s, STACK.tail + s, STACK.apex + s, STACK.rTop, STACK.rTail, pen);
    const shadow = ribbonSolid(
      t.cx - s,
      STACK.halfW,
      STACK.top + s,
      STACK.tail + s,
      STACK.apex + s,
      STACK.rTop,
      STACK.rTail,
      STACK.clearance,
    );
    return cut(back, shadow).add(front);
  },
  /** Filled: те же два силуэта сплошными, класс «стопка» работает так же. */
  filled: (t) => {
    const s = STACK.shift / 2;
    const back = ribbonSolid(t.cx + s, STACK.halfW, STACK.top - s, STACK.tail - s, STACK.apex - s, STACK.rTop, STACK.rTail, 0);
    const front = ribbonSolid(t.cx - s, STACK.halfW, STACK.top + s, STACK.tail + s, STACK.apex + s, STACK.rTop, STACK.rTail, 0);
    const shadow = ribbonSolid(
      t.cx - s, STACK.halfW, STACK.top + s, STACK.tail + s, STACK.apex + s, STACK.rTop, STACK.rTail, STACK.clearance,
    );
    return cut(back, shadow).add(front);
  },
});
