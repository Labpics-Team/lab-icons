/**
 * system/numerals.js — СОБСТВЕННЫЙ ЦИФРОВОЙ ЗНАК.
 *
 * Зачем свой, а не системный шрифт. Иконка с цифрой (calendar-number) обязана
 * выглядеть одинаково на любой платформе и в любом рендерере; ссылка на
 * SF Rounded — это зависимость от чужого файла, лицензии и метрик. Здесь цифры
 * построены ТЕМ ЖЕ пером и теми же примитивами, что и остальная библиотека:
 * скелет из прямых и окружных дуг + круглые терминалы. Никакого шрифтового
 * файла, никакого пути «на глаз».
 *
 * МЕТРИКИ (безразмерные, от высоты знака H):
 *   перо        w  = 0.20·H      (замер календаря руки: 1.46 при H = 7.2)
 *   скелет      Hs = H − w       терминал добавляет по w/2 сверху и снизу
 *   ширина      Ws = 0.62·Hs     (замер: 3.54 при Hs = 5.74)
 *   чаша        r  = Ws/2        радиус нижней чаши = полуширина знака
 *
 * ТАБУЛЯРНОСТЬ: у всех цифр один и тот же ADVANCE. Календарь меняет число
 * ежедневно, и «1» не имеет права дёргать соседа.
 */

import { Path } from './core/path.js';
import { strokePath, polySpine } from './prim/stroke.js';
import { v2 } from './core/num.js';

const TAU = Math.PI * 2;
const D = (deg) => (deg * Math.PI) / 180;

export const NUMERAL = Object.freeze({
  penRatio: 0.2,
  widthRatio: 0.62,
  /** Межбуквенный просвет как доля ширины знака (табулярный трекинг). */
  trackingRatio: 0.16,
});

/**
 * Скелет цифры в коробке [0..Ws] × [0..Hs], y вниз.
 * Возвращает массив путей-скелетов (у «4» и «5» их больше одного).
 */
function skeleton(digit, Ws, Hs) {
  const r = Ws / 2;
  const mx = Ws / 2;
  const P = (x, y) => [x, y];
  const arc = (c, rad, a0, a1) => new Path().arcFrom(c, rad, a0, a1);

  switch (digit) {
    case 0: {
      // Овал-стадион: две полуокружности + прямые бока. Замкнутый скелет.
      const p = new Path().arcFrom([mx, r], r, D(180), D(360));
      p.line(P(Ws, Hs - r));
      p.arc([mx, Hs - r], r, D(0), D(180));
      p.line(P(0, r));
      p.close();
      return [p];
    }
    case 1: {
      // Стойка по центру advance (табулярность) + флаг под 45°.
      const flagY = 0.24 * Hs;
      return [polySpine([P(mx - flagY, flagY), P(mx, 0), P(mx, Hs)])];
    }
    case 2: {
      // Дуга-плечо + диагональ + основание.
      const a0 = D(190);
      const a1 = D(48);
      const p = arc([mx, r], r, a0, a1 + TAU);
      p.line(P(0.02 * Ws, Hs));
      p.line(P(Ws, Hs));
      return [p];
    }
    case 3: {
      // Две чаши одного радиуса, пересекающиеся в талии. Точка талии —
      // пересечение окружностей, а не подобранный узел.
      const dy = (Hs - 2 * r) / 2;
      const dx = Math.sqrt(Math.max(0, r * r - dy * dy));
      const waist = [mx + dx, Hs / 2];
      const aUp = Math.atan2(waist[1] - r, waist[0] - mx);
      const aDn = Math.atan2(waist[1] - (Hs - r), waist[0] - mx);
      // Раствор чаш: 205° сверху и 150° снизу — чашa должна ЧИТАТЬСЯ как
      // открытая. Замкни её сильнее — и «3» превращается в «8».
      const p = arc([mx, r], r, D(205), aUp + TAU);
      p.arc([mx, Hs - r], r, aDn + TAU, D(150) + TAU);
      return [p];
    }
    case 4: {
      const barY = 0.7 * Hs;
      const stemX = 0.74 * Ws;
      return [polySpine([P(stemX, 0), P(0, barY), P(Ws, barY)]), polySpine([P(stemX, 0.3 * Hs), P(stemX, Hs)])];
    }
    case 5: {
      // Верхняя полка + стойка + чаша на 280°. Начало чаши задано углом,
      // стойка приходит ровно в него — стык by construction, не «встык».
      const a0 = D(200);
      const start = v2.polar([mx, Hs - r], r, a0);
      const p = new Path().move(P(Ws, 0));
      p.line(P(start[0], 0));
      p.line(start);
      p.arc([mx, Hs - r], r, a0, a0 + D(280));
      return [p];
    }
    case 6: {
      // Чаша + хвост. Хвост — дуга, КАСАЮЩАЯСЯ чаши в её левой точке
      // (вертикальная касательная ⟹ центр хвоста лежит на той же горизонтали).
      // Радиус хвоста выводится из требования пройти через начало знака.
      const bowl = new Path().arcFrom([mx, Hs - r], r, D(-90), D(90)).arc([mx, Hs - r], r, D(90), D(270)).close();
      const start = [0.9 * Ws, 0.1 * Hs];
      const cy = Hs - r;
      const R2 = (start[0] ** 2 + (start[1] - cy) ** 2) / (2 * start[0]);
      const c2 = [R2, cy];
      const aS = Math.atan2(start[1] - cy, start[0] - R2);
      const tail = arc(c2, R2, aS + TAU, D(180));
      return [bowl, tail];
    }
    case 7: {
      return [polySpine([P(0, 0), P(Ws, 0), P(0.24 * Ws, Hs)])];
    }
    case 8: {
      // Две касающиеся окружности: r1 + r2 = Hs/2 при r2 = Ws/2.
      const r2 = r;
      const r1 = Math.max(0.12 * Hs, Hs / 2 - r2);
      const up = new Path().arcFrom([mx, r1], r1, D(-90), D(90)).arc([mx, r1], r1, D(90), D(270)).close();
      const dn = new Path().arcFrom([mx, Hs - r2], r2, D(-90), D(90)).arc([mx, Hs - r2], r2, D(90), D(270)).close();
      return [up, dn];
    }
    case 9: {
      // Ровно «6», повёрнутая на 180° вокруг центра коробки. Это не приём
      // экономии — это факт геометрического санса, и он же даёт бесплатный
      // морф 6↔9 на этапе анимации.
      return skeleton(6, Ws, Hs).map((p) => p.rotate(Math.PI, [Ws / 2, Hs / 2]));
    }
    default:
      throw new Error(`нет скелета для цифры ${digit}`);
  }
}

/** Габариты знака при заданной высоте чернил. */
export function numeralMetrics(capHeight, penOverride) {
  const pen = penOverride ?? NUMERAL.penRatio * capHeight;
  const Hs = capHeight - pen;
  const Ws = NUMERAL.widthRatio * Hs;
  return { pen, Hs, Ws, advance: Ws + pen + NUMERAL.trackingRatio * Ws, inkWidth: Ws + pen };
}

/**
 * Одна цифра. `origin` — левый верхний угол ЧЕРНИЛ (не скелета).
 * @param {number} d 0..9
 */
export function numeral(d, { capHeight, origin = [0, 0], pen } = {}) {
  const m = numeralMetrics(capHeight, pen);
  const out = new Path();
  for (const s of skeleton(d, m.Ws, m.Hs)) {
    out.add(strokePath(s.translate(origin[0] + m.pen / 2, origin[1] + m.pen / 2), m.pen));
  }
  return out;
}

/**
 * Число целиком, отцентрованное по указанной точке. Табулярно: ширина строки
 * зависит только от количества знаков.
 */
export function numeralString(text, { capHeight, center, pen } = {}) {
  const s = String(text);
  const m = numeralMetrics(capHeight, pen);
  const total = s.length * m.inkWidth + (s.length - 1) * NUMERAL.trackingRatio * m.Ws;
  const step = m.inkWidth + NUMERAL.trackingRatio * m.Ws;
  const x0 = center[0] - total / 2;
  const y0 = center[1] - capHeight / 2;
  const out = new Path();
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i) - 48;
    if (ch < 0 || ch > 9) continue;
    out.add(numeral(ch, { capHeight, pen, origin: [x0 + i * step, y0] }));
  }
  return out;
}

/** Сегодняшнее число месяца по локальному времени сборки. */
export const today = () => new Date().getDate();
