/**
 * system/glyphs/media.js — семья «воспроизведение и звук».
 *
 * Четыре конструкции на четырнадцать имён:
 *
 *   1. УКАЗАТЕЛЬ  — скруглённый равнобедренный треугольник (play, play-skip-*,
 *                   play-back, play-forward). Отличаются числом, размером и
 *                   направлением, но не построением.
 *   2. БРУС       — скруглённый прямоугольник (pause; стенка play-skip-*).
 *   3. РУПОР      — шестиугольник «коробка + конус» + дуги-волны (volume-*).
 *                   Число волн — ось громкости: одна конструкция на 6 имён.
 *   4. ДУГИ ИЗ ЦЕНТРА — концентрические полосы (radio) и обод (headphone).
 *
 * Все свободные числа либо выведены из токенов, либо объявлены здесь
 * именованным семейным токеном с замерами по корпусу.
 */

import { defineGlyph } from '../registry.js';
import * as S from '../prim/shape.js';
import { strokeSegment } from '../prim/stroke.js';
import { Path } from '../core/path.js';
import { v2, rad } from '../core/num.js';
import { cut } from '../core/boolean.js';
import { insetPolygon } from '../prim/shape.js';

// ── ЛОКАЛЬНЫЕ ПРИМИТИВЫ ───────────────────────────────────────────────────

/**
 * РАМКА-МНОГОУГОЛЬНИК С ВОГНУТЫМИ ВЕРШИНАМИ.
 *
 * `S.roundedPolygonRing` уменьшает КАЖДЫЙ радиус на перо. Для выпуклой
 * вершины это верно (rInner = rOuter − перо), для вогнутой — ровно наоборот:
 * эквидистанта внутрь РАСПРЯМЛЯЕТ выпуклый угол и ЗАКРУГЛЯЕТ вогнутый, то
 * есть там rInner = rOuter + перо. У рупора плечо между коробкой и конусом —
 * вогнутая вершина, и корпус это подтверждает: снаружи радиус 5.06, изнутри
 * 6.90, разность ровно +1.8. Отсюда локальная версия с учётом знака поворота.
 */
function polyRing(points, radii, weight, smoothing = 0) {
  const n = points.length;
  const turn = points.map((_, i) => {
    const a = points[(i - 1 + n) % n];
    const b = points[i];
    const c = points[(i + 1) % n];
    return v2.cross(v2.norm(v2.sub(b, a)), v2.norm(v2.sub(c, b)));
  });
  const outer = S.roundedPolygon(points, radii, smoothing);
  const inPts = insetPolygon(points, weight);
  const rIn = radii.map((r, i) => Math.max(0, turn[i] >= 0 ? r - weight : r + weight));
  return outer.add(S.roundedPolygon(inPts, rIn, smoothing).reverse());
}

/**
 * Зеркало относительно вертикали канвы. Заливка nonzero к ориентации
 * безразлична, поэтому отражение целого пути (внешний контур + дырки) остаётся
 * корректным: обход просто меняет знак у всех подпутей сразу.
 */
const flipX = (path, cx) => path.mirrorX(cx);

// ══ 1. УКАЗАТЕЛЬ ══════════════════════════════════════════════════════════

/**
 * СКРУГЛЕНИЕ БОЛЬШОГО ТРЕУГОЛЬНИКА play. Замер по корпусу (play.svg):
 *   • плоское левое ребро чернил стоит на x = 3.846, центроид чернил 10.986
 *     ⟹ вписанный радиус ρ = 7.14, описанный r = 14.29;
 *   • правое остриё чернил на x = 22.001 ⟹ r − R = 11.008 = Rkey.
 * То есть УГЛОВЫЕ ДУГИ ТРЕУГОЛЬНИКА КАСАЮТСЯ KEYLINE-ОКРУЖНОСТИ изнутри —
 * тот же закон вписанности, что у скруглённого квадрата. Остаётся один
 * свободный радиус: 3.31 по левому ребру, 3.27 по верхней кромке.
 */
export const PLAY_CORNER = 3.3;

/**
 * ζ большого треугольника. Замер: скруглённая зона у вершины тянется по ребру
 * на 8.21 при td = R/tan30° = 5.72 ⟹ 1 + ζ = 1.435. Своё, не общеканоничное
 * 0.6: при 0.6 дуга сократилась бы настолько, что верхняя точка силуэта ушла
 * бы с дуги на кубику, а корпус даёт её ровно на дуге (2.036 против расчётных
 * 2.034).
 */
export const PLAY_SMOOTH = 0.435;

/**
 * УКАЗАТЕЛЬ — равносторонний треугольник, скруглённый радиусом R и вписанный
 * УГЛОВЫМИ ДУГАМИ в окружность радиуса rKey: описанный радиус r = rKey + R.
 *
 * Положение по горизонтали задаёт ОПТИЧЕСКИЙ ЦЕНТР (токен opticalCenterBias):
 * центр bbox чернил ⟶ центроид чернил с байасом 0.5 должен попасть в центр
 * канвы. Для этой фигуры центроид = центр треугольника C, а bbox чернил идёт
 * от C − r/2 (плоское ребро) до C + rKey (остриё), откуда
 *     opt = C + (rKey − R)/8   ⟹   C = cx − (rKey − R)/8.
 * Корпус: расчёт 11.04, замер 11.00.
 */
function pointerTriangle(t, { rKey, R, smoothing, right = true }) {
  const r = rKey + R;
  const C = [t.cx - (rKey - R) / 8, t.cy];
  const s = right ? 1 : -1;
  const pts = [
    [C[0] - (s * r) / 2, C[1] - (r * Math.sqrt(3)) / 2],
    [C[0] + s * r, C[1]],
    [C[0] - (s * r) / 2, C[1] + (r * Math.sqrt(3)) / 2],
  ];
  return right ? pts : [pts[2], pts[1], pts[0]];
}

const playPts = (t, right) =>
  pointerTriangle(t, { rKey: t.keyR, R: PLAY_CORNER, smoothing: PLAY_SMOOTH, right });

const PLAY_LAW =
  'равносторонний треугольник остриём вправо, скруглённый радиусом 3.3 и вписанный ' +
  'УГЛОВЫМИ ДУГАМИ в keyline-окружность (описанный радиус = Rkey + R); по горизонтали ' +
  'посажен по ОПТИЧЕСКОМУ ЦЕНТРУ: bbox-центр ⟶ центроид чернил с байасом 0.5 попадает ' +
  'в центр канвы. Outline — рамка пером base, Filled — тот же силуэт сплошным';

defineGlyph('play', {
  family: 'media',
  law: PLAY_LAW,
  outline: (t) => polyRing(playPts(t, true), [PLAY_CORNER, PLAY_CORNER, PLAY_CORNER], t.stroke.base, PLAY_SMOOTH),
  filled: (t) => S.roundedPolygon(playPts(t, true), PLAY_CORNER, PLAY_SMOOTH),
});

// ── стенка play-skip ──────────────────────────────────────────────────────

/**
 * СТЕНКА play-skip — вертикальный штрих во всю живую область: терминалы на
 * margin + кап и canvas − margin − кап, то есть чернила ровно 22 = живая
 * область (замер: 1.000 … 23.096). По горизонтали стенка НЕ самостоятельна:
 * её внешняя кромка совпадает с остриём указателя (замеры 22.00 и 22.00),
 * поэтому ось = остриё − кап.
 */
function skipWall(t) {
  const cap = t.cap.base;
  const tip = t.cx - (t.keyR - PLAY_CORNER) / 8 + t.keyR;
  const x = tip - cap;
  return strokeSegment([x, t.margin + cap], [x, t.canvas - t.margin - cap], t.stroke.base);
}

const SKIP_LAW =
  'указатель play плюс вертикальная стенка: штрих пером base во всю живую область ' +
  '(терминалы на margin+кап и canvas−margin−кап), ось на canvas−margin−кап — так ' +
  'кромка стенки и остриё указателя стоят на одной вертикали. play-skip-back — ' +
  'зеркало, а не второй рисунок';

defineGlyph('play-skip-forward', {
  family: 'media',
  law: SKIP_LAW,
  outline: (t) =>
    polyRing(playPts(t, true), [PLAY_CORNER, PLAY_CORNER, PLAY_CORNER], t.stroke.base, PLAY_SMOOTH).add(skipWall(t)),
  filled: (t) => S.roundedPolygon(playPts(t, true), PLAY_CORNER, PLAY_SMOOTH).add(skipWall(t)),
});

defineGlyph('play-skip-back', {
  family: 'media',
  law: SKIP_LAW,
  outline: (t) =>
    flipX(
      polyRing(playPts(t, true), [PLAY_CORNER, PLAY_CORNER, PLAY_CORNER], t.stroke.base, PLAY_SMOOTH).add(skipWall(t)),
      t.cx,
    ),
  filled: (t) => flipX(S.roundedPolygon(playPts(t, true), PLAY_CORNER, PLAY_SMOOTH).add(skipWall(t)), t.cx),
});

// ══ 2. ДВОЙНОЙ УКАЗАТЕЛЬ (play-back / play-forward) ═══════════════════════

/**
 * МАЛЫЙ УКАЗАТЕЛЬ. Не равносторонний: замер по play-forward.svg даёт
 * полувысоту 8.256 при выносе 13.008, то есть половинный угол при острие
 * atan(8.256/13.008) = 32.4° (у равностороннего было бы 30°).
 * Скругление 2.82 (замер: зона скругления по левому ребру 5.125 при
 * td = R/tan(β/2), β = 57.6°), ζ = 0 (замер: разность зон скругления внешнего
 * и внутреннего контуров равна ровно перу, значит удлинения нет).
 */
export const DUO_HALF_H = 8.256;
export const DUO_RUN = 13.008;
export const DUO_CORNER = 2.82;
/** Шаг между двумя указателями (замер: левые рёбра 2.19 и 11.82). */
export const DUO_STEP = 9.63;
/** Левое ребро первого указателя (замер play-forward.svg: 2.188 ≈ margin + 1.19). */
export const DUO_X0 = 2.19;

function duoPts(xL) {
  return [
    [xL, 12 - DUO_HALF_H],
    [xL + DUO_RUN, 12],
    [xL, 12 + DUO_HALF_H],
  ];
}

function duoPair(t, weight) {
  const p = new Path();
  for (const xL of [DUO_X0, DUO_X0 + DUO_STEP]) {
    const pts = duoPts(xL);
    p.add(weight ? polyRing(pts, [DUO_CORNER, DUO_CORNER, DUO_CORNER], weight, 0) : S.roundedPolygon(pts, DUO_CORNER, 0));
  }
  return p;
}

const DUO_LAW =
  'два одинаковых указателя со сдвигом 9.63: тот же скруглённый треугольник, что у play, ' +
  'но с половинным углом при острие 32.4° и скруглением 2.82; остриё переднего выходит ' +
  'на margin, заднее прячется за плоским ребром переднего. play-back — зеркало';

defineGlyph('play-forward', {
  family: 'media',
  law: DUO_LAW,
  outline: (t) => duoPair(t, t.stroke.base),
  filled: (t) => duoPair(t, 0),
});

defineGlyph('play-back', {
  family: 'media',
  law: DUO_LAW,
  outline: (t) => flipX(duoPair(t, t.stroke.base), t.cx),
  filled: (t) => flipX(duoPair(t, 0), t.cx),
});

// ══ 3. БРУС (pause) ═══════════════════════════════════════════════════════

/**
 * КОРОБКА pause — скруглённый квадрат, ВПИСАННЫЙ в keyline-окружность при
 * радиусе скругления 2.4: h = R + (Rkey − R)/√2 = 8.481, габарит 16.96.
 * Корпус: 17.00 по горизонтали и 16.97 по вертикали — два независимых замера
 * на одно выведенное число.
 */
export const PAUSE_CORNER = 2.4;

/**
 * КАНАЛ между брусками — единственное, что отличает начертания.
 * Замеры: Outline 12.73 − 11.27 = 1.46; Filled 13.73 − 10.27 = 3.46.
 * Filled делит коробку как 2 : 1 : 2 (брус : канал : брус), то есть канал
 * ровно пятая часть габарита (16.96/5 = 3.39). Outline вдвое с лишним уже:
 * там канал граничит не со сплошными чернилами, а со стенками пера 1.8, и
 * негатив читается тяжелее, чем весит.
 */
export const PAUSE_CHANNEL = 1.46;

function pauseBars(t, channel, weight) {
  const h = t.squareHalf(PAUSE_CORNER);
  const bw = (2 * h - channel) / 2;
  const p = new Path();
  for (const s of [-1, 1]) {
    const cx = t.cx + s * (channel / 2 + bw / 2);
    p.add(
      weight
        ? S.roundedRectRing(cx, t.cy, bw, 2 * h, PAUSE_CORNER, weight, 0)
        : S.roundedRect(cx, t.cy, bw, 2 * h, PAUSE_CORNER, 0),
    );
  }
  return p;
}

defineGlyph('pause', {
  family: 'media',
  law:
    'два бруска в скруглённом квадрате, вписанном в keyline-окружность при R = 2.4 ' +
    '(габарит 16.96, замер 17.00). Ширина бруска = (габарит − канал)/2. Outline — рамка ' +
    'пером base, внутренний радиус = 2.4 − 1.8 = 0.6 (замер a.6.6); Filled — сплошные ' +
    'бруски и канал в пятую часть габарита',
  outline: (t) => pauseBars(t, PAUSE_CHANNEL, t.stroke.base),
  filled: (t) => pauseBars(t, 2 * t.squareHalf(PAUSE_CORNER) / 5, 0),
});

// ══ 4. РУПОР И ВОЛНЫ (volume-*) ═══════════════════════════════════════════

/**
 * РУПОР — шестиугольник «коробка + конус», одинаковый во всех шести именах
 * семьи (замер: габарит чернил 10.35 × 12.62 в каждом файле до третьего знака).
 * Числа сняты с volume-high.svg, отсчёт от левой кромки чернил:
 *   коробка: полувысота 3.12, от 0 до плеча 3.211;
 *   конус:   правое ребро на 10.36, полувысота 8.035 (наклон 34.5°);
 *   скругления: 1.315 у коробки (прямой угол), 5.06 на плече (вогнутая
 *   вершина, 145.5°), 2.504 у раструба (55.5°).
 * Плечо — вогнутая вершина, поэтому её внутренний радиус БОЛЬШЕ внешнего на
 * перо (замер 6.90 против 5.06) — см. polyRing.
 */
export const HORN = Object.freeze({
  boxHalf: 3.12,
  shoulder: 3.211,
  mouth: 10.36,
  mouthHalf: 8.035,
  rBox: 1.315,
  rShoulder: 5.06,
  rMouth: 2.504,
});

function hornPts(t, x0) {
  const { boxHalf, shoulder, mouth, mouthHalf } = HORN;
  return [
    [x0, t.cy - boxHalf],
    [x0 + shoulder, t.cy - boxHalf],
    [x0 + mouth, t.cy - mouthHalf],
    [x0 + mouth, t.cy + mouthHalf],
    [x0 + shoulder, t.cy + boxHalf],
    [x0, t.cy + boxHalf],
  ];
}

const HORN_R = [HORN.rBox, HORN.rShoulder, HORN.rMouth, HORN.rMouth, HORN.rShoulder, HORN.rBox];

const horn = (t, x0, weight) =>
  weight ? polyRing(hornPts(t, x0), HORN_R, weight, 0) : S.roundedPolygon(hornPts(t, x0), HORN_R, 0);

/**
 * ВОЛНЫ — дуговые полосы пером base. Три волны это ОДНА дуга, подобно
 * увеличенная из общего источника: замер по volume-high даёт вершины дуг на
 * 15.516 / 18.800 / 22.100 и радиусы 6.295 / 11.633 / 17.017; отношение
 * r / (вершина − источник) одинаково у всех трёх при источнике x = 11.644
 * (проверка: коэффициенты подобия 1 : 1.848 : 2.704 совпадают по обоим рядам
 * до 0.1%). Источник лежит на 0.28 правее раструба, шаг вершин 3.292.
 */
export const WAVE = Object.freeze({
  /** Смещение источника подобия от раструба рупора (замер 11.644 − 11.362). */
  src: 0.282,
  /** Вынос первой волны от источника (замер 15.516 − 11.644). */
  first: 3.872,
  /** Шаг вершин (замеры 3.284 и 3.300). */
  step: 3.292,
  /** Радиус на единицу выноса (замер 6.295/3.872 = 11.633/7.164 = 1.626). */
  curv: 1.626,
  /** Полураствор дуги, градусы (замеры 30.8 / 31.5 / 31.7). */
  spread: 31.3,
});

function waves(t, x0, count) {
  const p = new Path();
  const src = x0 + HORN.mouth + WAVE.src;
  for (let i = 0; i < count; i++) {
    const lead = WAVE.first + i * WAVE.step;
    const r = WAVE.curv * lead;
    const c = [src + lead - r, t.cy];
    p.add(S.arcBand(c, r, rad(-WAVE.spread), rad(WAVE.spread), t.stroke.base, 'round'));
  }
  return p;
}

/**
 * ПОСАДКА ГРУППЫ. Левая кромка чернил рупора по числу волн — замер по корпусу:
 *   0 волн (volume)        5.560
 *   1 волна (volume-low)   4.850
 *   2 волны (volume-middle) 3.200
 *   3 волны (volume-high)  1.000  ← группа ровно в живую область: 1.000…23.000
 * Закон один только у volume-high (чернила = живая область). Остальные рука
 * подвинула вправо на 0.55 от центрированного положения; volume без волн
 * стоит ещё левее — под зарезервированное место волн.
 */
export const HORN_X = Object.freeze([5.56, 4.85, 3.2, 1.0]);

const VOLUME_LAW =
  'рупор (шестиугольник «коробка + конус») плюс n дуг-волн; n — ось громкости, ' +
  'одна конструкция на четыре имени. Волны — подобия одной дуги из общего источника ' +
  'на 0.28 правее раструба, шаг вершин 3.292. Outline — рамка рупора пером base, ' +
  'Filled — сплошной рупор; перо волн в обоих начертаниях остаётся base (замер: кап 0.9 ' +
  'и в Outline, и в Filled)';

for (const [name, n] of [
  ['volume', 0],
  ['volume-low', 1],
  ['volume-middle', 2],
  ['volume-high', 3],
]) {
  defineGlyph(name, {
    family: 'media',
    law: VOLUME_LAW,
    outline: (t) => horn(t, HORN_X[n], t.stroke.base).add(waves(t, HORN_X[n], n)),
    filled: (t) => horn(t, HORN_X[n], 0).add(waves(t, HORN_X[n], n)),
  });
}

// ── перечёркнутый и заглушённый ───────────────────────────────────────────

/**
 * ОСЬ ПЕРЕЧЁРКИВАНИЯ volume-mute идёт по ГЛАВНОЙ диагонали (сверху слева вниз
 * направо) — в отличие от канонического slashAxis, который идёт по побочной.
 * Терминалы там же: margin + кап … canvas − margin − кап (замер 1.86 и 22.14).
 */
function muteAxis(t) {
  const cap = t.cap.base;
  const lo = t.margin + cap;
  const hi = t.canvas - t.margin - cap;
  return [
    [lo, lo],
    [hi, hi],
  ];
}

const muteSlash = (t, extra = 0) => {
  const [a, b] = muteAxis(t);
  return strokeSegment(a, b, t.stroke.base + 2 * extra);
};

defineGlyph('volume-mute', {
  family: 'media',
  law:
    'volume-high, перечёркнутый по ГЛАВНОЙ диагонали живой области: носитель сначала ' +
    'вырезает тень оси (полуширина = кап + clearance.slash), и только потом ось ложится ' +
    'сверху — негатив строится, а не проверяется',
  outline: (t) =>
    cut(horn(t, HORN_X[3], t.stroke.base).add(waves(t, HORN_X[3], 3)), muteSlash(t, t.clearance.slash)).add(
      muteSlash(t),
    ),
  filled: (t) =>
    cut(horn(t, HORN_X[3], 0).add(waves(t, HORN_X[3], 3)), muteSlash(t, t.clearance.slash)).add(muteSlash(t)),
});

/**
 * КРЕСТ volume-muted. Замер: перо 2.0 (кап 1.0 — `a1 1`), то есть
 * stroke.containerGlyph, а не base: крест стоит рядом с рупором как отдельный
 * знак и оптически тяжелее его стенки. Плечи ±3.0155 от центра (15.26 … 21.29),
 * центр (18.275, 12).
 */
export const MUTED_ARM = 3.0155;
export const MUTED_CENTER_X = 18.275;
/** Левая кромка чернил рупора в volume-muted (замер 1.810). */
export const MUTED_HORN_X = 1.81;

function mutedCross(t) {
  const c = [MUTED_CENTER_X, t.cy];
  const a = MUTED_ARM;
  const w = t.stroke.containerGlyph;
  return strokeSegment([c[0] - a, c[1] - a], [c[0] + a, c[1] + a], w).add(
    strokeSegment([c[0] + a, c[1] - a], [c[0] - a, c[1] + a], w),
  );
}

defineGlyph('volume-muted', {
  family: 'media',
  law:
    'тот же рупор плюс косой крест вместо волн: перо containerGlyph (замер кап 1.0), ' +
    'плечи ±3.0155 от центра креста. Крест — это `close` из geometric в другом кегле ' +
    'и другом месте, а не новая фигура',
  outline: (t) => horn(t, MUTED_HORN_X, t.stroke.base).add(mutedCross(t)),
  filled: (t) => horn(t, MUTED_HORN_X, 0).add(mutedCross(t)),
});

// ══ 5. RADIO ══════════════════════════════════════════════════════════════

/**
 * RADIO — три пары дуговых полос, симметричных относительно вертикали, плюс
 * точка-источник в центре.
 *
 * Внешняя дуга: ось на Rkey − кап (замер 10.081 при кап 0.9 ⟹ 10.1), то есть
 * её чернила упираются в живую область.
 * Шаг внутрь = перо + зазор: замеры дают шаг 2.99 при пере 1.6 (Outline) и
 * 3.335 при пере 1.9 (Filled) — зазор 1.39 и 1.435, одно число 1.41.
 * Перо своё, легче base: шесть дуг пером 1.8 сомкнулись бы (замер кап 0.8 в
 * Outline и 0.95 в Filled).
 */
export const RADIO_PEN = Object.freeze({ outline: 1.6, filled: 1.9 });
export const RADIO_GAP = 1.41;
/** Полураствор дуги, градусы (замеры 40.0 / 40.0 / 36.0 — взято большинство). */
export const RADIO_SPREAD = 40;
/** Радиус точки-источника (замеры 1.40 Outline / 1.36 Filled). */
export const RADIO_DOT = 1.38;

function radioArcs(t, pen) {
  const p = new Path();
  const rOut = t.keyR - t.cap.base;
  const step = pen + RADIO_GAP;
  for (let i = 0; i < 3; i++) {
    const r = rOut - i * step;
    for (const s of [0, Math.PI]) {
      p.add(
        S.arcBand([t.cx, t.cy], r, s - rad(RADIO_SPREAD), s + rad(RADIO_SPREAD), pen, 'round'),
      );
    }
  }
  return p.add(S.circle([t.cx, t.cy], RADIO_DOT));
}

defineGlyph('radio', {
  family: 'media',
  law:
    'три пары дуговых полос вокруг центра канвы: внешняя ось на Rkey − кап (чернила ' +
    'упираются в живую область), шаг внутрь = перо + зазор 1.41, полураствор 40°. ' +
    'В центре точка-источник радиуса 1.38. Перо своё, легче base: шесть дуг пером 1.8 ' +
    'сомкнулись бы',
  outline: (t) => radioArcs(t, RADIO_PEN.outline),
  filled: (t) => radioArcs(t, RADIO_PEN.filled),
});

// ══ 6. HEADPHONE ══════════════════════════════════════════════════════════

/**
 * ОБОД — дуговая полоса по той же оси, что и у radio: центр канвы, ось
 * Rkey − кап = 10.1 (замер: внешняя кромка обода лежит на окружности 11.0,
 * внутренняя на 9.2 — ровно Rkey и Rkey − перо). Раствор от 143.5° до 36.5°
 * через верх (замер по концам обода 3.60 / 18.22 и 20.40 / 18.22).
 */
export const BAND_END_DEG = 143.5;

/**
 * ЧАШКА — выпуклая оболочка двух кругов (скошенная «капля»): узкий конец
 * вверху у обода, широкий внизу. Замер по headphone_filled.svg:
 *   ось наклонена на 60.35° к горизонтали, верхний центр (18.05, 13.05)
 *   радиуса 1.37, нижний (16.75, 19.62) радиуса 3.39.
 */
export const CUP = Object.freeze({
  topC: [18.05, 13.05],
  topR: 1.37,
  botC: [16.75, 19.62],
  botR: 3.39,
});

/** Выпуклая оболочка двух кругов: два внешних касательных отрезка + две дуги. */
function twoCircleHull(c1, r1, c2, r2) {
  const d = v2.dist(c1, c2);
  const base = Math.atan2(c2[1] - c1[1], c2[0] - c1[0]);
  const phi = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  const p = new Path();
  p.arcFrom(c1, r1, base + phi, base - phi + 2 * Math.PI);
  p.arc(c2, r2, base - phi, base + phi);
  return p.close();
}

function cupShape(t, weight) {
  const { topC, topR, botC, botR } = CUP;
  const outer = twoCircleHull(topC, topR, botC, botR);
  if (!weight) return outer;
  const ri1 = Math.max(0.01, topR - weight);
  const ri2 = Math.max(0.01, botR - weight);
  // внутренняя кромка — оболочка тех же кругов, ужатых на перо
  return outer.add(twoCircleHull(topC, ri1, botC, ri2).reverse());
}

function headphone(t, weight) {
  const c = [t.cx, t.cy];
  const r = t.keyR - t.cap.base;
  const band = S.arcBand(c, r, rad(BAND_END_DEG), rad(360 - BAND_END_DEG + 360), t.stroke.base, 'round');
  const p = new Path().add(band);
  p.add(cupShape(t, weight));
  p.add(cupShape(t, weight).mirrorX(t.cx));
  return p;
}

defineGlyph('headphone', {
  family: 'media',
  law:
    'обод — дуговая полоса по оси Rkey − кап (внешняя кромка ложится ровно на ' +
    'keyline-окружность, внутренняя на Rkey − перо), раствор 143.5°…36.5° через верх; ' +
    'две чашки — выпуклые оболочки двух кругов (узкий конец у обода, широкий внизу), ' +
    'зеркальные друг другу',
  outline: (t) => headphone(t, t.stroke.base),
  filled: (t) => headphone(t, 0),
});
