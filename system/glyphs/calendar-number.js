/**
 * system/glyphs/calendar-number.js — календарь с сегодняшним числом.
 *
 * Единственный глиф библиотеки, зависящий от внешнего состояния. Число берётся
 * из даты сборки и рисуется СОБСТВЕННЫМ цифровым знаком (system/numerals.js) —
 * тем же пером и теми же дугами, что и остальные иконки. Ни одного шрифтового
 * файла: иначе иконка выглядела бы по-разному там, где нет SF Rounded.
 *
 * Оригинал зафиксировал 13-е число, поэтому сходимость меряется при `day = 13`
 * (поле `refAxes`), а рисуется — при сегодняшнем.
 */

import { defineGlyph } from '../registry.js';
import * as S from '../prim/shape.js';
import { strokeSegment } from '../prim/stroke.js';
import { numeralString, today } from '../numerals.js';

/**
 * ПЛАНШЕТ КАЛЕНДАРЯ — замеры оригинала (calendar.svg и calendar-number.svg
 * совпадают до сотых): рамка 18.94 × 19.02 с центром (12, 11.79), скругление
 * 4.9, внутреннее 3.1 = 4.9 − перо. Планшет НЕ вписан в keyline-окружность:
 * его углы уходят на 11.36 при Rkey = 11 — он живёт по своему габариту,
 * потому что сверху из него торчат ушки, и вписанность считается по ним.
 */
export const PLATE = Object.freeze({ w: 18.94, h: 19.02, cy: 11.79, r: 4.9 });
/** Ушки: вертикальные штрихи на x = 12 ± 4.16, терминал на y = 1.75. */
export const EAR_X = 4.16;
export const EAR_TOP = 1.75;
export const EAR_BOTTOM = 4.1;
/** Разделитель шапки: ось на y = 7.5, во всю внутреннюю ширину. */
export const DIVIDER_Y = 7.5;
/** Высота цифры: 7.3 при просвете тела 11 — по 1.85 зазора сверху и снизу. */
export const DIGIT_CAP = 7.3;
/**
 * Залитое тело Filled-варианта: замеры оригинала — верхняя кромка 8.4 (та же
 * линия, что нижняя кромка разделителя в Outline), низ 21.05, полуширина 9.32,
 * нижнее скругление 4.75. Тело чуть уже рамки: залитая масса оптически тяжелее
 * штриха и обязана отступить.
 */
export const BODY = Object.freeze({ top: 8.4, bottom: 21.05, halfW: 9.32, r: 4.75 });

function plate(t, penOverride) {
  const w = PLATE.w;
  const h = PLATE.h;
  const cy = PLATE.cy;
  const pen = penOverride ?? t.stroke.glyph;
  const r = PLATE.r;
  const p = S.roundedRect(t.cx, cy, w, h, r, t.corner.smoothing);
  p.add(S.roundedRect(t.cx, cy, w - 2 * pen, h - 2 * pen, Math.max(0, r - pen), t.corner.smoothing).reverse());
  return p;
}

function ears(t, penOverride) {
  const pen = penOverride ?? t.stroke.glyph;
  const p = S.circle([0, 0], 0);
  p.subs.length = 0;
  for (const s of [-1, 1]) {
    p.add(strokeSegment([t.cx + s * EAR_X, EAR_TOP], [t.cx + s * EAR_X, EAR_BOTTOM], pen));
  }
  return p;
}

function divider(t) {
  const pen = t.stroke.glyph;
  const half = PLATE.w / 2 - pen;
  return strokeSegment([t.cx - half, DIVIDER_Y], [t.cx + half, DIVIDER_Y], pen, { cap: 'butt' });
}

/** Центр окна тела: между разделителем и нижней внутренней кромкой. */
function bodyCenter(t) {
  const pen = t.stroke.glyph;
  const top = DIVIDER_Y + pen / 2;
  const bottom = PLATE.cy + PLATE.h / 2 - pen;
  return [t.cx, (top + bottom) / 2];
}

const LAW =
  'планшет 18.94 × 19.02 со скруглением 4.9 (внутреннее 3.1 = 4.9 − перо) + два ушка-штриха ' +
  'на x = 12 ± 4.16 + разделитель шапки на y = 7.5 + число собственным округлым знаком ' +
  '(высота 7.3, табулярный набор), центрованное в окне тела';

defineGlyph('calendar-number', {
  family: 'time',
  law: LAW,
  argument:
    'оригинал нарисован с числом 13, поэтому сходимость меряется при day = 13; в поставку ' +
    'глиф уходит с числом дня сборки. Остаточное расхождение — рисунок цифры: рука вела ' +
    'её кривыми переменной толщины, система — скелетом постоянного пера 1.44 (замер руки 1.46) ' +
    'с круглыми терминалами. Это осознанная замена: цифра переменной толщины не масштабируется ' +
    'вместе с осью веса и не поддаётся морфингу при смене числа.',
  axes: {
    day: {
      min: 1,
      def: today(),
      max: 31,
      unit: 'число месяца',
      note: 'по умолчанию — день сборки; цифры табулярные, поэтому 1 и 30 занимают одинаковое место',
    },
  },
  refAxes: { day: 13 },
  outline: (t, ax) => {
    const p = plate(t);
    p.add(ears(t));
    p.add(divider(t));
    p.add(numeralString(Math.round(ax.day), { capHeight: DIGIT_CAP, center: bodyCenter(t) }));
    return p;
  },
  /**
   * Filled: тело залито, а число ВЫБИТО негативом. Разворот подпутей цифры
   * делает её дыркой — и заодно возвращает в чернила счётчик «0» и «8»,
   * что для выбитого знака и есть правильное прочтение.
   */
  filled: (t, ax) => {
    const { top, bottom, halfW } = BODY;
    const body = S.roundedPolygon(
      [
        [t.cx - halfW, top],
        [t.cx + halfW, top],
        [t.cx + halfW, bottom],
        [t.cx - halfW, bottom],
      ],
      [0, 0, BODY.r, BODY.r],
      t.corner.smoothing,
    );
    const digits = numeralString(Math.round(ax.day), {
      capHeight: DIGIT_CAP,
      center: [t.cx, (top + bottom) / 2],
    });
    // Рамка в Filled идёт весом КОНТЕЙНЕРА (1.5), а не Bold: тело уже залито,
    // и обрамление обязано оптически уступить содержимому. Замер руки: кап
    // ушка в calendar-number_filled — 0.75, то есть перо ровно 1.5.
    const p = plate(t, t.stroke.ring);
    p.add(ears(t, t.stroke.ring));
    p.add(body);
    p.add(digits.reverse());
    return p;
  },
});
