/**
 * system/glyphs/media.js — семья «воспроизведение и звук».
 *
 * Четыре конструкции на четырнадцать имён:
 *
 *   1. УКАЗАТЕЛЬ — скруглённый равнобедренный треугольник (play, play-skip-*,
 *      play-back, play-forward). Отличаются кеглем, числом и направлением,
 *      но не построением.
 *   2. БРУС — скруглённый прямоугольник в keyline-квадрате (pause).
 *   3. РУПОР + ВОЛНЫ — шестиугольник «коробка + конус» и дуговые полосы;
 *      число волн есть ОСЬ ГРОМКОСТИ: одна конструкция на шесть имён.
 *   4. ДУГИ ИЗ ЦЕНТРА — концентрические полосы (radio) и обод (headphone).
 *
 * Общее для всей семьи: скругления идут с каноническим сглаживанием
 * ζ = corner.smoothing. Это не украшение — рука рисовала углы «сквиркл»-ом, и
 * при ζ = 0 верхние точки силуэтов уезжают на полтысячных канвы (у рупора
 * 5.69 против 6.22), что на площадной метрике стоит несколько процентов.
 */

import { defineGlyph } from '../registry.js';
import * as S from '../prim/shape.js';
import { insetPolygon } from '../prim/shape.js';
import { strokeSegment } from '../prim/stroke.js';
import { Path } from '../core/path.js';
import { v2, rad } from '../core/num.js';
import { cut } from '../core/boolean.js';

// ── ЛОКАЛЬНЫЕ ПРИМИТИВЫ ───────────────────────────────────────────────────

/**
 * ДУГОВАЯ ПОЛОСА С ДВУМЯ ПОЛУКРУГЛЫМИ ТЕРМИНАЛАМИ.
 *
 * Локальная, потому что общий `S.arcBand` заметает НАЧАЛЬНЫЙ терминал в
 * сторону движения, а не против: полукруг ложится внутрь полосы и гасит
 * собственную площадь. Проверка: `S.arcBand([12,12], 10.084, ∓40°, 1.594)`
 * даёт площадь 22.438 = перо × длина дуги, то есть ровно «без терминалов»
 * (один добавил 2.0, второй отнял 2.0), и bbox выходит несимметричным
 * (5.006…19.276 вместо 4.724…19.276). Здесь начальный терминал заметается
 * назад — a0 + dir·π → a0 + 2·dir·π.
 */
function band(c, r, a0, a1, weight) {
  const h = weight / 2;
  const dir = Math.sign(a1 - a0) || 1;
  const p = new Path();
  p.arcFrom(c, r + h, a0, a1);
  p.arc(v2.polar(c, r, a1), h, a1, a1 + dir * Math.PI);
  p.arc(c, r - h, a1, a0);
  p.arc(v2.polar(c, r, a0), h, a0 + dir * Math.PI, a0 + 2 * dir * Math.PI);
  return p.close();
}

/**
 * РАМКА-МНОГОУГОЛЬНИК С ВОГНУТЫМИ ВЕРШИНАМИ.
 *
 * Общий `S.roundedPolygonRing` уменьшает КАЖДЫЙ радиус на перо. Для выпуклой
 * вершины это верно (rInner = rOuter − перо), для вогнутой — наоборот:
 * эквидистанта внутрь распрямляет выпуклый угол и ЗАКРУГЛЯЕТ вогнутый, то
 * есть там rInner = rOuter + перо. У рупора плечо между коробкой и конусом —
 * вогнутая вершина, и корпус это подтверждает: снаружи 5.06, изнутри 6.90,
 * разность ровно +1.8. Отсюда локальная версия, учитывающая знак поворота.
 */
function polyRing(points, radii, weight, smoothing) {
  const n = points.length;
  const turn = points.map((_, i) => {
    const a = points[(i - 1 + n) % n];
    const b = points[i];
    const c = points[(i + 1) % n];
    return v2.cross(v2.norm(v2.sub(b, a)), v2.norm(v2.sub(c, b)));
  });
  const outer = S.roundedPolygon(points, radii, smoothing);
  const rIn = radii.map((r, i) => Math.max(0, turn[i] >= 0 ? r - weight : r + weight));
  return outer.add(S.roundedPolygon(insetPolygon(points, weight), rIn, smoothing).reverse());
}

/** Скруглённый многоугольник: рамка при weight > 0, силуэт при weight = 0. */
const poly = (pts, radii, weight, z) =>
  weight ? polyRing(pts, radii, weight, z) : S.roundedPolygon(pts, radii, z);

// ══ 1. УКАЗАТЕЛЬ ══════════════════════════════════════════════════════════

/**
 * СКРУГЛЕНИЕ БОЛЬШОГО УКАЗАТЕЛЯ. Замеры по play.svg:
 *   • плоское левое ребро чернил на x = 3.846 при центроиде чернил 10.986
 *     ⟹ вписанный радиус треугольника 7.14, описанный 14.29;
 *   • правое остриё чернил на x = 22.001 ⟹ описанный − скругление = 11.008.
 * Второе равенство и есть закон: УГЛОВЫЕ ДУГИ ТРЕУГОЛЬНИКА КАСАЮТСЯ
 * KEYLINE-ОКРУЖНОСТИ изнутри, ровно как углы скруглённого квадрата в
 * DERIVED.inscribedSquareHalf. Свободным остаётся один радиус: 3.31 по левому
 * ребру, 3.27 по верхней кромке, 3.30 по подгону.
 */
export const PLAY_CORNER = 3.3;

/**
 * УКАЗАТЕЛЬ — равносторонний треугольник, скруглённый радиусом R и вписанный
 * УГЛОВЫМИ ДУГАМИ в окружность радиуса rKey: описанный радиус r = rKey + R,
 * вписанный ρ = (rKey + R)/2.
 *
 * Положение по горизонтали задаёт ОПТИЧЕСКИЙ ЦЕНТР (токен opticalCenterBias):
 * точка на пути «центр bbox чернил ⟶ центроид чернил» с байасом 0.5 обязана
 * попасть в центр канвы. Для этой фигуры центроид совпадает с центром
 * треугольника C, а чернила идут от C − r/2 (плоское ребро) до C + rKey
 * (остриё), откуда
 *     opt = C + (rKey − R)/8   ⟹   C = cx − (rKey − R)/8.
 * Корпус: закон даёт 11.038, замер 11.001, подгон 11.012.
 */
function playPts(t) {
  const R = PLAY_CORNER;
  const r = t.keyR + R;
  const C = [t.cx - (t.keyR - R) / 8, t.cy];
  const h = (r * Math.sqrt(3)) / 2;
  return [
    [C[0] - r / 2, C[1] - h],
    [C[0] + r, C[1]],
    [C[0] - r / 2, C[1] + h],
  ];
}

/** Остриё указателя = C + rKey: к нему привязана стенка play-skip. */
const playTip = (t) => t.cx - (t.keyR - PLAY_CORNER) / 8 + t.keyR;

const PLAY_R3 = [PLAY_CORNER, PLAY_CORNER, PLAY_CORNER];

const playShape = (t, weight) => poly(playPts(t), PLAY_R3, weight, t.corner.smoothing);

const PLAY_LAW =
  'равносторонний треугольник остриём вправо, скруглённый радиусом 3.3 и вписанный ' +
  'УГЛОВЫМИ ДУГАМИ в keyline-окружность (описанный радиус = Rkey + R, вписанный = ' +
  '(Rkey + R)/2); по горизонтали посажен по ОПТИЧЕСКОМУ ЦЕНТРУ — точка «центр bbox ⟶ ' +
  'центроид чернил» с байасом 0.5 попадает в центр канвы. Outline — рамка пером base, ' +
  'Filled — тот же силуэт сплошным';

defineGlyph('play', {
  family: 'media',
  law: PLAY_LAW,
  outline: (t) => playShape(t, t.stroke.base),
  filled: (t) => playShape(t, 0),
});

/**
 * СТЕНКА play-skip — вертикальный штрих во всю живую область: терминалы на
 * margin + кап и canvas − margin − кап, то есть чернила ровно 22 (замер
 * 1.000…23.096). По горизонтали стенка не самостоятельна: её внешняя кромка
 * совпадает с остриём указателя (два замера, оба 22.00), значит ось = остриё − кап.
 */
function skipWall(t) {
  const cap = t.cap.base;
  const x = playTip(t) - cap;
  return strokeSegment([x, t.margin + cap], [x, t.canvas - t.margin - cap], t.stroke.base);
}

const SKIP_LAW =
  'указатель play плюс вертикальная стенка: штрих пером base во всю живую область ' +
  '(терминалы на margin + кап и canvas − margin − кап), ось на «остриё − кап» — так ' +
  'кромка стенки и остриё указателя стоят на одной вертикали. play-skip-back — ' +
  'зеркало того же построения, а не второй рисунок';

const skipShape = (t, weight) => playShape(t, weight).add(skipWall(t));

defineGlyph('play-skip-forward', {
  family: 'media',
  law: SKIP_LAW,
  outline: (t) => skipShape(t, t.stroke.base),
  filled: (t) => skipShape(t, 0),
});

defineGlyph('play-skip-back', {
  family: 'media',
  law: SKIP_LAW,
  outline: (t) => skipShape(t, t.stroke.base).mirrorX(t.cx),
  filled: (t) => skipShape(t, 0).mirrorX(t.cx),
});

// ── двойной указатель ─────────────────────────────────────────────────────

/**
 * МАЛЫЙ УКАЗАТЕЛЬ (play-back / play-forward). Не равносторонний: замер по
 * play-forward.svg даёт полувысоту 8.26 при выносе 13.03, то есть половинный
 * угол при острие atan(8.26/13.03) = 32.4° вместо 30°. Скругление 2.11
 * (подгон; замер по длине скруглённой зоны левого ребра 5.125 при
 * td = R/tan(β/2), β = 57.6°, даёт тот же порядок). Шаг между указателями
 * 9.63 — ровно столько, чтобы остриё заднего пряталось за плоским ребром
 * переднего, а переднее остриё вышло на margin (замер правой кромки 23.010).
 */
export const DUO = Object.freeze({
  halfH: 8.269,
  run: 13.027,
  corner: 2.111,
  /** Левое ребро заднего указателя (замер 2.188 ≈ margin + 1.18). */
  x0: 2.176,
  step: 9.632,
});

const duoPts = (t, xL) => [
  [xL, t.cy - DUO.halfH],
  [xL + DUO.run, t.cy],
  [xL, t.cy + DUO.halfH],
];

function duoPair(t, weight) {
  const p = new Path();
  const rr = [DUO.corner, DUO.corner, DUO.corner];
  for (const xL of [DUO.x0, DUO.x0 + DUO.step]) p.add(poly(duoPts(t, xL), rr, weight, t.corner.smoothing));
  return p;
}

const DUO_LAW =
  'два одинаковых указателя со сдвигом 9.63: тот же скруглённый треугольник, что у play, ' +
  'но с половинным углом при острие 32.4° и скруглением 2.11. Остриё переднего выходит на ' +
  'margin, остриё заднего прячется за плоским ребром переднего. play-back — зеркало';

defineGlyph('play-forward', {
  family: 'media',
  law: DUO_LAW,
  outline: (t) => duoPair(t, t.stroke.base),
  filled: (t) => duoPair(t, 0),
});

defineGlyph('play-back', {
  family: 'media',
  law: DUO_LAW,
  outline: (t) => duoPair(t, t.stroke.base).mirrorX(t.cx),
  filled: (t) => duoPair(t, 0).mirrorX(t.cx),
});

// ══ 2. БРУС (pause) ═══════════════════════════════════════════════════════

/**
 * КОРОБКА pause — скруглённый квадрат, ВПИСАННЫЙ в keyline-окружность при
 * радиусе скругления 2.4: h = R + (Rkey − R)/√2 = 8.481, габарит 16.96.
 * Корпус: 17.00 по горизонтали и 16.97 по вертикали — два независимых замера
 * на одно выведенное число; подгон даёт 8.483 и 2.378.
 */
export const PAUSE_CORNER = 2.4;

/**
 * КАНАЛ между брусками — единственное, чем отличаются начертания.
 * Замеры: Outline 12.73 − 11.27 = 1.46; Filled 13.73 − 10.27 = 3.46.
 * Filled делит коробку как 2 : 1 : 2 (брус : канал : брус), то есть канал —
 * ровно пятая часть габарита (16.96/5 = 3.392 при замере 3.46). Outline вдвое
 * с лишним уже: там канал граничит не со сплошными чернилами, а со стенками
 * пера 1.8, и негатив читается тяжелее, чем весит.
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
    '(габарит 16.96, замеры 17.00 и 16.97). Ширина бруска = (габарит − канал)/2. ' +
    'Outline — рамка пером base, внутренний радиус = 2.4 − 1.8 = 0.6 (замер a.6.6); ' +
    'Filled — сплошные бруски, канал ровно пятая часть габарита (деление 2:1:2)',
  outline: (t) => pauseBars(t, PAUSE_CHANNEL, t.stroke.base),
  filled: (t) => pauseBars(t, (2 * t.squareHalf(PAUSE_CORNER)) / 5, 0),
});

// ══ 3. РУПОР И ВОЛНЫ (volume-*) ═══════════════════════════════════════════

/**
 * РУПОР — шестиугольник «коробка + конус», одинаковый во всех шести именах
 * семьи: замер габарита чернил даёт 10.35 × 12.62 в каждом файле до третьего
 * знака. Числа сняты с volume-high.svg, отсчёт от левой кромки чернил:
 *   коробка  полувысота 3.075, плечо на 3.228;
 *   конус    правое ребро на 10.371, полувысота 8.133 (наклон 34.5°);
 *   скругления 1.286 (прямой угол коробки), 4.898 (плечо, вогнутая вершина
 *   145.5°), 1.936 (раструб, 55.5°).
 * Плечо — вогнутая вершина, поэтому её ВНУТРЕННИЙ радиус больше внешнего на
 * перо (замер 6.90 против 5.06); см. polyRing.
 */
export const HORN = Object.freeze({
  boxHalf: 3.075,
  shoulder: 3.228,
  mouth: 10.371,
  mouthHalf: 8.133,
  rBox: 1.286,
  rShoulder: 4.898,
  rMouth: 1.936,
});

const HORN_R = [HORN.rBox, HORN.rShoulder, HORN.rMouth, HORN.rMouth, HORN.rShoulder, HORN.rBox];

const hornPts = (t, x0) => [
  [x0, t.cy - HORN.boxHalf],
  [x0 + HORN.shoulder, t.cy - HORN.boxHalf],
  [x0 + HORN.mouth, t.cy - HORN.mouthHalf],
  [x0 + HORN.mouth, t.cy + HORN.mouthHalf],
  [x0 + HORN.shoulder, t.cy + HORN.boxHalf],
  [x0, t.cy + HORN.boxHalf],
];

const horn = (t, x0, weight) => poly(hornPts(t, x0), HORN_R, weight, t.corner.smoothing);

/**
 * ВОЛНЫ — дуговые полосы пером base. Три волны это ОДНА дуга, ПОДОБНО
 * увеличенная из общего источника. Замер по volume-high: вершины дуг стоят на
 * 15.516 / 18.800 / 22.100, радиусы 6.295 / 11.633 / 17.017; отношение
 * «радиус / вынос вершины от источника» одинаково у всех трёх при источнике
 * x = 11.644 — коэффициенты подобия 1 : 1.848 : 2.704 совпадают по обоим
 * рядам до 0.1%. Источник лежит на 0.37 правее раструба, шаг вершин 3.32.
 */
export const WAVE = Object.freeze({
  /** Вынос источника подобия за раструб рупора. */
  src: 0.368,
  /** Вынос вершины первой волны от источника. */
  first: 3.794,
  /** Шаг вершин (замеры 3.284 и 3.300, подгон 3.321). */
  step: 3.321,
  /** Радиус на единицу выноса (замеры 6.295/3.872 = 11.633/7.164 = 1.626). */
  curv: 1.676,
  /** Полураствор дуги, градусы (замеры 30.8 / 31.5 / 31.7). */
  spread: 30.967,
});

function waves(t, x0, count) {
  const p = new Path();
  const src = x0 + HORN.mouth + WAVE.src;
  for (let i = 0; i < count; i++) {
    const lead = WAVE.first + i * WAVE.step;
    const r = WAVE.curv * lead;
    p.add(band([src + lead - r, t.cy], r, -rad(WAVE.spread), rad(WAVE.spread), t.stroke.base));
  }
  return p;
}

/**
 * ПОСАДКА ГРУППЫ — левая кромка чернил рупора по числу волн. Замеры:
 *   0 волн (volume)         5.560   подгон 5.563
 *   1 волна (volume-low)    4.850   подгон 4.841
 *   2 волны (volume-middle) 3.200   подгон 3.207
 *   3 волны (volume-high)   1.000   подгон 0.999
 * Закон предъявляет только volume-high: его чернила занимают живую область
 * ровно, от 1.000 до 23.000. Остальные рука подвинула правее центрированного
 * положения на 0.55, а volume без волн — ещё левее, под зарезервированное
 * место волн; общего правила у этих трёх нет, поэтому таблица замеров.
 */
export const HORN_X = Object.freeze([5.563, 4.841, 3.207, 0.999]);

const VOLUME_LAW =
  'рупор (шестиугольник «коробка + конус») плюс n дуг-волн; n — ось громкости, одна ' +
  'конструкция на четыре имени. Волны — подобия одной дуги из общего источника на 0.37 ' +
  'правее раструба, шаг вершин 3.32, полураствор 31°. Outline — рамка рупора пером base, ' +
  'Filled — сплошной рупор; перо волн в обоих начертаниях остаётся base (замер: кап 0.9 ' +
  'и в Outline, и в Filled — волна не жирнеет вместе с корпусом)';

const volumeShape = (t, n, weight) => horn(t, HORN_X[n], weight).add(waves(t, HORN_X[n], n));

for (const [name, n] of [
  ['volume', 0],
  ['volume-low', 1],
  ['volume-middle', 2],
  ['volume-high', 3],
]) {
  defineGlyph(name, {
    family: 'media',
    law: VOLUME_LAW,
    argument:
      n === 0
        ? 'Filled этого имени рука перерисовала отдельно: габарит чернил рупора там ' +
          '11.13 × 12.28 против 10.35 × 12.62 в Outline и во всех пяти остальных ' +
          'volume-*. То есть один и тот же рупор в одном файле шире на 0.78 и ниже ' +
          'на 0.34 — при равной площади (94.6 против 93.0). Система строит один рупор ' +
          'на шесть имён и платит за это 7% площади ровно здесь; развести их значило бы ' +
          'объявить близнеца ради дребезга одного файла.'
        : undefined,
    outline: (t) => volumeShape(t, n, t.stroke.base),
    filled: (t) => volumeShape(t, n, 0),
  });
}

// ── перечёркнутый и заглушённый ───────────────────────────────────────────

/**
 * ОСЬ ПЕРЕЧЁРКИВАНИЯ volume-mute идёт по ГЛАВНОЙ диагонали (сверху слева вниз
 * направо), а не по побочной, как канонический parts.slashAxis. Терминалы там
 * же: margin + кап … canvas − margin − кап (замер 1.86 и 22.14).
 */
function muteSlash(t, extra = 0) {
  const cap = t.cap.base;
  const lo = t.margin + cap;
  const hi = t.canvas - t.margin - cap;
  return strokeSegment([lo, lo], [hi, hi], t.stroke.base + 2 * extra);
}

defineGlyph('volume-mute', {
  family: 'media',
  law:
    'volume-high, перечёркнутый по ГЛАВНОЙ диагонали живой области: носитель сначала ' +
    'вырезает тень оси (полуширина = кап + clearance.slash), и только потом ось ложится ' +
    'сверху — негативное пространство строится, а не проверяется',
  outline: (t) => cut(volumeShape(t, 3, t.stroke.base), muteSlash(t, t.clearance.slash)).add(muteSlash(t)),
  filled: (t) => cut(volumeShape(t, 3, 0), muteSlash(t, t.clearance.slash)).add(muteSlash(t)),
});

/**
 * КРЕСТ volume-muted. Замер: перо 2.0 (кап 1.0 — `a1 1`), то есть
 * stroke.containerGlyph, а не base: крест стоит рядом с рупором самостоятельным
 * знаком и оптически тяжелее его стенки. Плечи ±3.0155 от центра (терминалы
 * скелета 15.26 и 21.29), центр креста (18.275, cy).
 */
export const MUTED = Object.freeze({ arm: 3.0155, cx: 18.275, hornX: 1.81 });

function mutedCross(t) {
  const a = MUTED.arm;
  const w = t.stroke.containerGlyph;
  return strokeSegment([MUTED.cx - a, t.cy - a], [MUTED.cx + a, t.cy + a], w).add(
    strokeSegment([MUTED.cx + a, t.cy - a], [MUTED.cx - a, t.cy + a], w),
  );
}

defineGlyph('volume-muted', {
  family: 'media',
  law:
    'тот же рупор плюс косой крест вместо волн: перо containerGlyph (замер кап 1.0), ' +
    'плечи ±3.0155 от центра креста. Крест — это `close` из geometric в другом кегле и ' +
    'в другом месте, а не новая фигура',
  outline: (t) => horn(t, MUTED.hornX, t.stroke.base).add(mutedCross(t)),
  filled: (t) => horn(t, MUTED.hornX, 0).add(mutedCross(t)),
});

// ══ 4. RADIO ══════════════════════════════════════════════════════════════

/**
 * RADIO — три пары дуговых полос, симметричных относительно вертикали, плюс
 * точка-источник в центре.
 *
 * Внешняя ось на Rkey − кап (замеры 10.081 в обоих начертаниях, закон даёт
 * 10.1): чернила внешней дуги упираются в живую область.
 * Шаг внутрь = перо + зазор. Замеры: шаг 2.99 при пере 1.6 (Outline) и 3.335
 * при пере 1.9 (Filled) — зазор 1.39 и 1.435, одно число 1.41.
 * Перо своё и легче base: шесть дуг пером 1.8 съели бы зазор (замер кап 0.8 в
 * Outline и 0.95 в Filled).
 */
export const RADIO_PEN = Object.freeze({ outline: 1.607, filled: 1.9 });
export const RADIO_GAP = 1.41;
/**
 * Полурастворы дуг, градусы. Две внешние дуги стоят на 40.0 в обоих
 * начертаниях (четыре независимых замера), внутренняя короче: 36.0 в Outline и
 * 35.0 в Filled. Одним числом их не накрыть — внутренняя пара намеренно
 * поджата, иначе три дуги сошлись бы в сплошной веер у самой точки.
 */
export const RADIO_SPREAD = Object.freeze([40, 40, 35.3]);
/** Радиус точки-источника (замеры 1.40 Outline / 1.36 Filled). */
export const RADIO_DOT = 1.385;

function radioArcs(t, pen) {
  const p = new Path();
  const rOut = t.keyR - t.cap.base;
  const step = pen + RADIO_GAP;
  for (let i = 0; i < 3; i++) {
    const r = rOut - i * step;
    const a = rad(RADIO_SPREAD[i]);
    for (const s of [0, Math.PI]) p.add(band([t.cx, t.cy], r, s - a, s + a, pen));
  }
  return p.add(S.circle([t.cx, t.cy], RADIO_DOT));
}

defineGlyph('radio', {
  family: 'media',
  law:
    'три пары дуговых полос вокруг центра канвы: внешняя ось на Rkey − кап (её чернила ' +
    'упираются в живую область), шаг внутрь = перо + зазор 1.41, полураствор 40° у двух ' +
    'внешних пар и 35.3° у внутренней. В центре точка-источник радиуса 1.385. Перо своё, ' +
    'легче base: шесть дуг пером 1.8 съели бы зазор',
  outline: (t) => radioArcs(t, RADIO_PEN.outline),
  filled: (t) => radioArcs(t, RADIO_PEN.filled),
});

// ══ 5. HEADPHONE ══════════════════════════════════════════════════════════

/**
 * ОБОД — дуговая полоса по той же оси, что и дуги radio: центр канвы, ось
 * Rkey − кап = 10.1. Замер прямой: внешняя кромка обода лежит на окружности
 * 11.0, внутренняя на 9.2, то есть ровно Rkey и Rkey − перо.
 * Раствор — от 143.5° до 36.5° через верх (замер по концам обода 3.60/18.22 и
 * 20.40/18.22).
 */
export const BAND_END_DEG = 143.5;

/**
 * ЧАШКА — конусная капсула: выпуклая оболочка двух кругов, узкого у обода и
 * широкого внизу-снаружи. Замеры по headphone_filled.svg (правая чашка):
 * габарит чернил 8.99 × 11.33, остриё 18.84 / 11.68, длинное прямое ребро от
 * 13.12 / 19.94 до 17.34 / 12.53 — наклон оси 60.35°.
 */
export const CUP = Object.freeze({
  topC: [19.122, 14.125],
  topR: 2.354,
  botC: [16.824, 19.762],
  botR: 3.13,
});

/** Выпуклая оболочка двух кругов: два внешних касательных отрезка и две дуги. */
function twoCircleHull(c1, r1, c2, r2) {
  const d = v2.dist(c1, c2);
  const base = Math.atan2(c2[1] - c1[1], c2[0] - c1[0]);
  const phi = Math.acos(Math.max(-1, Math.min(1, (r1 - r2) / d)));
  return new Path()
    .arcFrom(c1, r1, base + phi, base - phi + 2 * Math.PI)
    .arc(c2, r2, base - phi, base + phi)
    .close();
}

function cupShape(weight) {
  const { topC, topR, botC, botR } = CUP;
  const outer = twoCircleHull(topC, topR, botC, botR);
  if (!weight) return outer;
  // внутренняя кромка — оболочка тех же кругов, ужатых на перо: для прямых
  // касательных это точная эквидистанта, для дуг — закон rInner = rOuter − перо
  return outer.add(twoCircleHull(topC, topR - weight, botC, botR - weight).reverse());
}

function headphone(t, weight) {
  const p = band([t.cx, t.cy], t.keyR - t.cap.base, rad(BAND_END_DEG), rad(720 - BAND_END_DEG), t.stroke.base);
  p.add(cupShape(weight));
  p.add(cupShape(weight).mirrorX(t.cx));
  return p;
}

defineGlyph('headphone', {
  family: 'media',
  law:
    'обод — дуговая полоса по оси Rkey − кап (внешняя кромка ложится ровно на ' +
    'keyline-окружность, внутренняя на Rkey − перо — два прямых замера), раствор ' +
    '143.5°…36.5° через верх; две чашки — конусные капсулы (выпуклая оболочка узкого ' +
    'круга у обода и широкого внизу) вдоль оси 60.35°, зеркальные друг другу',
  argument:
    'ЧЕСТНО: чашка не сходится, и в отчёте это имя показывает вдвое худшее число, чем ' +
    'есть на деле. Две причины, обе числовые.\n' +
    '1) Замер испорчен файлом. headphone.svg — единственный в семье, где рисунок обёрнут ' +
    'в <clipPath> с прямоугольником M0 0h24v24H0z. Замерялка читает КАЖДЫЙ <path> файла, ' +
    'поэтому эталонная маска здесь — сплошной квадрат 576 ед² вместо 158 ед² настоящих ' +
    'чернил; отсюда 74% в колонке площади. По эталону со снятым <defs> отклонение 21.5% ' +
    '(Outline) и 14.3% (Filled) при медиане смещения контура 0.099 и 0.079 ед.\n' +
    '2) Чашка — рисунок, а не конструкция. Её внешняя кромка трижды меняет кривизну: ' +
    'у острия дуга радиуса 2.92 с центром (19.01, 14.95), в середине — 8.35 с центром ' +
    '(13.55, 15.32), внизу — около 6.1. Ни один односоставный примитив такого не даёт: ' +
    'выпуклая оболочка двух кругов держит остриё (11.77 против 11.68) и низ (22.89 против ' +
    '23.01), но недобирает вынос наружу (21.48 против 21.89) и переливает внутрь у низа — ' +
    'два кластера по 6 ед². Обод при этом сошёлся точно: замер внешней кромки 11.0 = Rkey, ' +
    'внутренней 9.2 = Rkey − перо. Объявлен каркас (обод + ось и габарит чашек); дорисовать ' +
    'чашку до совпадения можно только перечислив узлы, то есть отказавшись от закона.',
  outline: (t) => headphone(t, t.stroke.base),
  filled: (t) => headphone(t, 0),
});
