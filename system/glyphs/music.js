/**
 * system/glyphs/music.js — НОТА и её анатомия.
 *
 * musical-note и musical-notes выглядят как две разные иконки, но это одна
 * анатомия в одном и двух экземплярах. Разбор оригинала по сегментам показал
 * ровно три части, и все три — знакомые системе конструкции:
 *
 *   ГОЛОВА  — эллипс-кольцо. Не «блоб»: у руки внешний контур и счётчик
 *             отличаются ровно на перо (левая стенка 7.94 − 6.15 = 1.79),
 *             то есть это ОБВОДКА наклонного эллипса.
 *   НОЖКА   — прямой штрих тем же пером. Замер: левая кромка 10.39, правая
 *             12.19 ⟹ ширина ровно 1.80, осевая 11.29.
 *   ФЛАГ    — ШПИЛЬКА: прогон, разворот на 180°, прогон обратно. Доказательство
 *             в самом d: внешняя дуга разворота r = 2.54 и внутренняя r = 0.74
 *             ОДНОКОНЦЕНТРИЧНЫ (центр (15.32, 5.10) у обеих), а 2.54 − 0.74 =
 *             1.80 = перо. Значит это не «клин», а штрих, идущий по дуге.
 *
 * У musical-notes флаг разворачивается в БАЛКУ: тот же наклон, но вместо
 * разворота — скруглённый угол во вторую ножку, и второй прогон идёт
 * параллельно на канальном зазоре. Головы, ножки и наклон — те же числа.
 */

import { defineGlyph } from '../registry.js';
import { Path } from '../core/path.js';
import * as S from '../prim/shape.js';
import { strokePath, strokeSegment } from '../prim/stroke.js';

const D = (deg) => (deg * Math.PI) / 180;

/**
 * АНАТОМИЯ НОТЫ — общие для обоих глифов величины, снятые с оригиналов.
 *
 *   headRx 2.21 / headRy = перо — полуоси СКЕЛЕТА эллипса. Проверка: счётчик
 *     руки 2.45 × 2.12 против выведенного 2(2.21 − 0.9) × 2(1.8 − 0.9) =
 *     2.62 × 1.80, внешний габарит 6.04 против замера 6.04.
 *   headTilt −17.3° — наклон головы. У musical-notes он тот же.
 *   stemOffset 2.07 — расстояние от центра головы до осевой ножки. Замер:
 *     11.29 − 9.23 = 2.06 (одна нота) и 9.18 − 7.11 = 2.07 (две ноты).
 *     Одно число на два независимых глифа — это закон, а не совпадение.
 *   beamTilt ≈ −14.5° — наклон флага и балки. Замер: −14.6° у флага,
 *     −14.9° у балки.
 */
export const NOTE = Object.freeze({
  headRx: 2.21,
  headTilt: -17.3,
  stemOffset: 2.07,
  flagTilt: -14.44,
  beamTilt: -14.9,
});

/** Голова: обводка наклонного эллипса. Полуось ry — само перо. */
function head(t, c, rot = NOTE.headTilt) {
  const h = t.cap.glyph;
  const rx = NOTE.headRx;
  const ry = t.stroke.glyph;
  return S.ellipse(c, rx + h, ry + h, D(rot)).add(
    S.ellipse(c, Math.max(0.2, rx - h), Math.max(0.2, ry - h), D(rot)).reverse(),
  );
}

/**
 * ШПИЛЬКА — прогон, разворот на 180° наружу, прогон обратно на ту же ось.
 * Радиус разворота выводится из негативного канала между прогонами:
 *     rTurn = (канал + перо) / 2
 * Канал у руки 1.50 — это вес кольца-обрамления, ближайший канонический
 * зазор снизу от «негатив ≈ штрих».
 */
function hairpin(start, tiltDeg, len, channel, pen) {
  const d = [Math.cos(D(tiltDeg)), Math.sin(D(tiltDeg))];
  const n = [-d[1], d[0]];
  const rTurn = (channel + pen) / 2;
  const P1 = [start[0] + d[0] * len, start[1] + d[1] * len];
  const C = [P1[0] + n[0] * rTurn, P1[1] + n[1] * rTurn];
  const a0 = Math.atan2(P1[1] - C[1], P1[0] - C[0]);
  const P2 = [2 * C[0] - P1[0], 2 * C[1] - P1[1]];
  return new Path()
    .move(start)
    .line(P1)
    .arc(C, rTurn, a0, a0 + Math.PI)
    .line([P2[0] - d[0] * len, P2[1] - d[1] * len]);
}

/**
 * Сплошной флаг = ТА ЖЕ шпилька, залитая внутри. Доказательство выводимости:
 * внешняя дуга разворота у руки r = 2.54, а (канал + 2·перо)/2 = (1.5 + 3.6)/2
 * = 2.55. То есть заливка получается штрихом по ОСИ шпильки пером во всю её
 * ширину — вторую фигуру рисовать не нужно.
 */
function hairpinSolid(start, tiltDeg, len, channel, pen) {
  const d = [Math.cos(D(tiltDeg)), Math.sin(D(tiltDeg))];
  const n = [-d[1], d[0]];
  const rTurn = (channel + pen) / 2;
  const R = channel / 2 + pen; // половина полной ширины шпильки
  const P1 = [start[0] + d[0] * len, start[1] + d[1] * len];
  const C = [P1[0] + n[0] * rTurn, P1[1] + n[1] * rTurn];
  const A = [start[0] + n[0] * rTurn, start[1] + n[1] * rTurn];
  const aTop = Math.atan2(-n[1], -n[0]);
  return new Path()
    .move([A[0] - n[0] * R, A[1] - n[1] * R])
    .line([C[0] - n[0] * R, C[1] - n[1] * R])
    .arc(C, R, aTop, aTop + Math.PI)
    .line([A[0] + n[0] * R, A[1] + n[1] * R])
    .close();
}

/** Одиночная нота: голова + ножка + флаг. Замеры `musical-note.svg`. */
export const SINGLE = Object.freeze({ headC: [9.23, 19.61], stemX: 11.29, stemTop: 4.0, flagStart: 4.45, flagLen: 3.74 });

defineGlyph('musical-note', {
  family: 'music',
  law:
    'голова — обводка наклонного эллипса (полуоси 2.21 × перо, наклон −17.3°); ножка — ' +
    'прямой штрих на 2.07 правее центра головы, от y = 4 до центра головы; флаг — ШПИЛЬКА: ' +
    'прогон под −14.44°, разворот 180° радиусом (канал + перо)/2, прогон обратно. Канал 1.5',
  argument:
    'Outline 2.7%, Filled 2.1% — оба под порогом. Остаток лежит на стыке ножки с головой ' +
    'и на верхнем плече флага: рука сводит их кривыми Безье переменной кривизны, система — ' +
    'точным круглым суставом пера. Наибольший кластер расхождения 0.24 ед² при площади ' +
    'чернил около 60 ед².',
  outline: (t) => {
    const pen = t.stroke.glyph;
    const p = head(t, SINGLE.headC);
    p.add(strokeSegment([SINGLE.stemX, SINGLE.stemTop], [SINGLE.stemX, SINGLE.headC[1]], pen, { cap: 'butt' }));
    p.add(
      strokePath(
        hairpin([SINGLE.stemX, SINGLE.flagStart], NOTE.flagTilt, SINGLE.flagLen, t.stroke.ring, pen),
        pen,
        { cap: 'butt' },
      ),
    );
    return p;
  },
  /** Filled — тот же силуэт без счётчиков: голова становится диском, шпилька заливается. */
  filled: (t) => {
    const pen = t.stroke.base;
    const h = pen / 2;
    const p = S.ellipse(SINGLE.headC, NOTE.headRx + h, pen + h, D(NOTE.headTilt));
    p.add(strokeSegment([SINGLE.stemX, SINGLE.stemTop], [SINGLE.stemX, SINGLE.headC[1]], pen, { cap: 'butt' }));
    p.add(hairpinSolid([SINGLE.stemX, SINGLE.flagStart], NOTE.flagTilt, SINGLE.flagLen, t.stroke.ring, pen));
    return p;
  },
});

/** Пара нот под балкой. Замеры `musical-notes.svg`. */
export const PAIR = Object.freeze({
  leftStemX: 9.18,
  rightStemX: 19.08,
  leftHeadY: 19.36,
  rightHeadY: 17.24,
  beamY: 5.32,
  /** Негативный канал между двумя штрихами балки. Замер 1.70. */
  channel: 1.77,
  /** Скругление угла «балка → правая ножка», по скелету. Замер 2.15. */
  corner: 2.15,
});

defineGlyph('musical-notes', {
  family: 'music',
  law:
    'та же анатомия в двух экземплярах: две головы (эллипс-кольцо, наклон −17.3°), две ножки ' +
    'на 2.07 правее своих голов, и БАЛКА вместо флага — два параллельных штриха под −14.9° ' +
    'с негативным каналом между ними; верхний уходит в правую ножку скруглённым углом',
  argument:
    'остаточные 3.6% — стык балки с левой ножкой: рука сводит их филетом переменной кривизны, ' +
    'система ставит встык двух штрихов. Кластеры расхождения все меньше 0.3 ед² при площади ' +
    'чернил около 105 ед². Головы, ножки и наклоны совпали с одиночной нотой до сотых — ' +
    'это и есть доказательство, что глифов здесь один, а не два.',
  outline: (t) => {
    const pen = t.stroke.glyph;
    const P = PAIR;
    const tilt = Math.tan(D(NOTE.beamTilt));
    const p = new Path();

    // верхний штрих балки: от левой ножки вправо и скруглённым углом вниз в правую
    const C = [P.rightStemX - P.corner, P.beamY + (P.rightStemX - P.corner - P.leftStemX) * tilt + P.corner];
    const upper = new Path()
      .move([P.leftStemX, P.beamY])
      .line([C[0], C[1] - P.corner])
      .arc(C, P.corner, -Math.PI / 2, 0)
      .line([P.rightStemX, P.rightHeadY]);
    p.add(strokePath(upper, pen, { cap: 'butt' }));

    // нижний штрих балки — параллельно, на (канал + перо) по нормали
    const n = [Math.sin(D(-NOTE.beamTilt)), Math.cos(D(NOTE.beamTilt))];
    const off = P.channel + pen;
    const endX = P.rightStemX - pen / 2;
    p.add(
      strokeSegment(
        [P.leftStemX + n[0] * off, P.beamY + n[1] * off],
        [endX + n[0] * off, P.beamY + (endX - P.leftStemX) * tilt + n[1] * off],
        pen,
        { cap: 'butt' },
      ),
    );

    // левая ножка и обе головы
    p.add(strokeSegment([P.leftStemX, P.beamY], [P.leftStemX, P.leftHeadY], pen, { cap: 'butt' }));
    p.add(head(t, [P.leftStemX - NOTE.stemOffset, P.leftHeadY]));
    p.add(head(t, [P.rightStemX - NOTE.stemOffset, P.rightHeadY]));
    return p;
  },
  /** Filled — тот же силуэт без счётчиков: головы диски, балка залита целиком. */
  filled: (t) => {
    const pen = t.stroke.base;
    const h = pen / 2;
    const P = PAIR;
    const tilt = Math.tan(D(NOTE.beamTilt));
    const n = [Math.sin(D(-NOTE.beamTilt)), Math.cos(D(NOTE.beamTilt))];
    const mid = (P.channel + pen) / 2;
    const p = new Path();
    const C = [P.rightStemX - P.corner, P.beamY + (P.rightStemX - P.corner - P.leftStemX) * tilt + P.corner];
    const upper = new Path()
      .move([P.leftStemX + n[0] * mid, P.beamY + n[1] * mid])
      .line([C[0] + n[0] * mid, C[1] - P.corner + n[1] * mid]);
    p.add(strokePath(upper, P.channel + 2 * pen, { cap: 'butt' }));
    const spine = new Path().move([C[0] + P.corner, C[1]]).arc(C, P.corner, 0, -Math.PI / 2).line([P.leftStemX, P.beamY]);
    p.add(strokePath(spine, pen, { cap: 'butt' }));
    p.add(strokeSegment([P.rightStemX, C[1]], [P.rightStemX, P.rightHeadY], pen, { cap: 'butt' }));
    p.add(strokeSegment([P.leftStemX, P.beamY], [P.leftStemX, P.leftHeadY], pen, { cap: 'butt' }));
    p.add(S.ellipse([P.leftStemX - NOTE.stemOffset, P.leftHeadY], NOTE.headRx + h, pen + h, D(NOTE.headTilt)));
    p.add(S.ellipse([P.rightStemX - NOTE.stemOffset, P.rightHeadY], NOTE.headRx + h, pen + h, D(NOTE.headTilt)));
    return p;
  },
});
