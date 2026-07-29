/**
 * system/glyphs/arrows.js — семья стрелок.
 *
 * Стрелка = шеврон + хвост. Голова у всех одна; меняется ТОЛЬКО длина хвоста.
 * Отсюда arrow-forward, download, upload и resize — одно построение с разными
 * значениями одного параметра, а не четыре рисунка.
 */

import { defineGlyph } from '../registry.js';
import { arrow } from '../parts.js';

/**
 * ГАБАРИТЫ ЧЕРНИЛ (не скелета — см. пояснение в chevrons.js): при смене пера
 * Outline → Filled рука сохраняет габарит и поджимает скелет на кап.
 * Замер по четырём направлениям и двум начертаниям:
 *   кончик вершины  +7.40 от центра   (рука: 19.42 при канве 24)
 *   терминал хвоста −7.10 от центра   (рука: 4.90; Filled-терминал 6.09 = 4.90 + 1.2 ✓)
 *   полувысота головы 6.64
 */
export const ARROW_INK_TIP = 7.4;
export const ARROW_INK_TAIL = 7.1;
export const ARROW_INK_HALF = 6.64;

const LAW =
  'шеврон 45° + хвост, заданные габаритом чернил: кончик вершины на +7.40, ' +
  'терминал хвоста на −7.10, полувысота головы 6.64. Скелет выводится вычитанием ' +
  'капа ⟹ Filled — то же начертание пером Bold. Ось `tail` от 0 (голый шеврон) до 1';

const ARG =
  'штриховой глиф: 1−IoU ≈ 2δ/(2w−δ), 4–5% отклонения = смещение контура 0.04–0.05 ед. ' +
  'Разброс самой руки между направлениями больше: вершина стоит на 18.27 (back) против ' +
  '18.52 (forward) при одном и том же построении.';

for (const dir of ['down', 'up', 'back', 'forward']) {
  defineGlyph(`arrow-${dir}`, {
    family: 'arrow',
    law: LAW,
    argument: ARG,
    axes: {
      tail: {
        min: 0,
        def: 1,
        max: 1,
        unit: 'доля полного хвоста',
        note: 'tail = 0 вырождает стрелку в шеврон — это одна конструкция, а не две',
      },
    },
    outline: (t, ax) => {
      const cap = t.cap.glyph;
      const apexAt = t.cy + ARROW_INK_TIP - cap;
      const tailAt = t.cy - ARROW_INK_TAIL + cap;
      return arrow(t, {
        dir,
        half: ARROW_INK_HALF - cap,
        open: 45,
        weight: t.stroke.glyph,
        apexAt,
        tail: (apexAt - tailAt) * ax.tail,
      });
    },
  });
}
