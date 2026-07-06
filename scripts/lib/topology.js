/**
 * scripts/lib/topology.js — топологический примитив для check-topology (zero-dep).
 *
 * КЛАСС дефекта (уникальный — НЕ покрыт другими гейтами): РАЗРЫВ НЕЗАКРЫТОГО
 * СУБ-ПУТИ. Суб-путь чертил линии/кривые, но не имеет команды Z и его последняя
 * точка далеко от старта. Заливка SVG обязана замкнуть контур — и делает это
 * ПРЯМОЙ хордой из последней точки в старт, СРЕЗАЯ форму через тело глифа. Глаз
 * видит «отрезанный угол»; площадная IoU — почти нет (срез мал по площади);
 * check-fill-rule видит только расхождение evenodd/nonzero (тут его нет);
 * check-path-quality проверяет микро-щель ЗАМЫКАНИЯ (subpath С Z и крошечным
 * зазором) — но НЕ большой разрыв БЕЗ Z. Топология — про СВЯЗНОСТЬ контура.
 *
 * СОЗНАТЕЛЬНО НЕ ГЕЙТИМ самопересечение суб-пути: корпус рендерится под nonzero,
 * а nonzero-намотка ТЕРПИТ самопересечение по определению (винтинг ±2 в нахлёсте
 * всё равно ненулевой → залито). Замер по корпусу: 144/222 контурных иконок
 * содержат легальные самопересечения — гейт на них = 65% ложных срабатываний,
 * театр. Расхождение evenodd/nonzero (единственный случай, где намотка кусается)
 * уже стережёт check-fill-rule.
 *
 * Мера детерминирована, считается по геометрии d через общий парсер path-data
 * (DRY — свой парсер не пишем).
 */

import { parsePathData } from './path-data.js';

/**
 * Разрывы незакрытых суб-путей d. Суб-путь, начерченный командами рисования, но
 * БЕЗ Z и с последней точкой далеко от старта, помечается: заливка замкнёт его
 * хордой через тело формы. Порог — доля диагонали bbox СУБ-ПУТИ (относителен
 * размеру формы, а не канве: маленький глиф со своим малым срезом тоже ловится).
 *
 * Суб-путь, самостоятельно пришедший в старт (gap≈0) без Z — легально замкнут
 * геометрически (заливка соединит совпадающие точки, хорды нет); НЕ флагаем.
 *
 * @param {string} d            path-data
 * @param {number} gapRatio     доля диагонали bbox суб-пути (по умолчанию 0.02)
 * @returns {Array<{sub:number, gap:number, diag:number}>}
 */
export function unclosedGaps(d, gapRatio = 0.02) {
  const segs = parsePathData(d);
  const gaps = [];
  let sub = -1;
  let sx = 0;
  let sy = 0;
  let cx = 0;
  let cy = 0;
  let drew = false;
  let hasZ = false;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const acc = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };
  const flush = () => {
    if (sub < 0 || !drew || hasZ) return;
    const gap = Math.hypot(cx - sx, cy - sy);
    const diag = Math.hypot(maxX - minX, maxY - minY);
    if (diag > 1e-9 && gap > gapRatio * diag) gaps.push({ sub, gap, diag });
  };
  for (const seg of segs) {
    if (seg.cmd === 'M') {
      flush();
      sub++;
      sx = cx = seg.x;
      sy = cy = seg.y;
      drew = false;
      hasZ = false;
      minX = maxX = seg.x;
      minY = maxY = seg.y;
      continue;
    }
    if (seg.cmd === 'Z') {
      hasZ = true;
      cx = sx;
      cy = sy;
      continue;
    }
    drew = true;
    acc(seg.x, seg.y);
    cx = seg.x;
    cy = seg.y;
  }
  flush();
  return gaps;
}

/**
 * Топологический вердикт по одному d.
 * @param {string} d
 * @returns {{unclosed:Array, count:number}}
 */
export function topologyDefects(d) {
  const unclosed = unclosedGaps(d);
  return { unclosed, count: unclosed.length };
}
