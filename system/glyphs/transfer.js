/**
 * system/glyphs/transfer.js — семья «перенос и направление».
 *
 * Девятнадцать знаков, три конструкции.
 *
 *   1. СТРЕЛКА  = голова-шеврон 45° + хвост. Голова у всех одна и та же часть,
 *      меняются вершина, полуразмах и скругление острия.
 *   2. ПОВОРОТ  = дуговая полоса `arcBand` + та же голова. Полоса хранится
 *      центром и углами, поэтому ось вращения (то, вокруг чего reload/refresh/
 *      sync крутятся в анимации) лежит в данных, а не восстанавливается.
 *   3. КОРПУС + ЗНАК = скруглённый квадрат-контейнер (лоток, дверь, рамка) и
 *      стрелка при нём. Filled здесь НЕ жирное начертание: корпус становится
 *      сплошным, а знак вырезается из него негативом и остаётся волосяной
 *      частью снаружи — это симметрическая разность, см. `xorSign`.
 */

import { defineGlyph } from '../registry.js';
import { Path } from '../core/path.js';
import { cut } from '../core/boolean.js';
import { v2, rad } from '../core/num.js';
import * as S from '../prim/shape.js';
import { strokeSegment, strokePolyline, strokePath } from '../prim/stroke.js';

const U = Math.SQRT1_2;

// ── СЕМЕЙНЫЕ ТОКЕНЫ ───────────────────────────────────────────────────────

/**
 * СКРУГЛЕНИЕ ОСТРИЯ ГОЛОВЫ. Не ноль: рука притупляет вершину шеврона дугой по
 * СКЕЛЕТУ, и внешняя кромка получается радиусом ρ + кап. Замер внешней дуги
 * острия по корпусу: 2.00 при пере 1.8 (swap-horizontal, move, repeat) и 2.20
 * при пере 2.4 (swap-*_filled, sync_filled, move_filled, repeat_filled) —
 * то есть ρ = 1.10 и 1.00. Взят минимакс 1.05.
 * Там, где рука острия НЕ притупляла (download, upload, push, exit, enter —
 * замер даёт ровно 90°-ную дугу радиусом в кап вокруг вершины), ρ = 0.
 */
export const HEAD_RHO = 1.05;

/**
 * ПОЛУРАЗМАХ МАЛОЙ ГОЛОВЫ (по скелету). Одно число на восемь знаков; замеры:
 *   download 2.92/2.85 · upload 2.88/2.89 · push 2.88/2.89
 *   refresh 3.00/3.00 · sync 2.95/2.85 · repeat 2.96/2.88
 * Разброс руки 2.85…3.00; минимакс 2.92.
 */
export const HEAD_HALF = 2.92;

/**
 * КОРПУС-КОНТЕЙНЕР: скруглённый квадрат 14×14 со скруглением 4.
 * Габарит и радиус сняты с шести независимых корпусов и совпадают до сотых:
 *   download 14.00×13.95 r4 · upload 13.98×13.93 r4 · push 13.98×13.94 r4
 *   exit 12.02×17.26 r4 · enter 12.01×17.26 r4 · share 14.00×14.00 r4
 * (у exit/enter квадрат вытянут в дверь — радиус тот же).
 * 4 не выводится из corner.box = 5: это собственный радиус класса «корпус
 * переноса», и он объявлен здесь именем, а не вписан в токены.
 */
export const BOX_CORNER = 4;
export const BOX_HALF = 7;

/**
 * ЧЕРНИЛЬНЫЙ РАДИУС ДУГОВОЙ ПОЛОСЫ у sync и repeat. Габарит чернил при смене
 * пера СОХРАНЯЕТСЯ (замер внешней кромки: sync 7.80/7.80, repeat 7.80/7.90),
 * поэтому опорной величиной служит он, а осевой радиус выводится вычитанием
 * капа: R = ARC_INK − кап (6.90 при Regular, 6.60 при Bold — оба совпали).
 */
export const ARC_INK = 7.8;

// ── ЧАСТИ ─────────────────────────────────────────────────────────────────

/**
 * ГОЛОВА СТРЕЛКИ — шеврон 45° с притупленным остриём.
 *
 * Каноника: вершина ВВЕРХ, плечи вниз-влево и вниз-вправо под 45°.
 * Строится не обводкой скелета, а сразу контуром: при ρ < кап эквидистанта
 * дуги острия вырождается (перо шире дуги), и обводчик обязан был бы бросить
 * исключение. Физически же кромка в этом случае — честное пересечение
 * внутренних кромок плеч, то есть острый внутренний угол на биссектрисе.
 *
 * @param {number[]} apex   вершина СКЕЛЕТА (не кончик чернил)
 * @param {number} half     полуразмах по горизонтали
 * @param {number} w        перо
 * @param {number} rho      радиус притупления острия по скелету
 * @param {number} deg      поворот вокруг `about` (0 = вершина вверх)
 */
function head(apex, half, w, rho, deg = 0, about = null) {
  const h = w / 2;
  const [ax, ay] = apex;
  const C = [ax, ay + Math.SQRT2 * rho];
  const Ro = rho + h;
  const Pl = [ax - half, ay + half];
  const Pr = [ax + half, ay + half];
  const nL = [-U, -U];
  const nR = [U, -U];
  const p = new Path();
  p.move(v2.mad(Pl, nL, h));
  p.line(v2.polar(C, Ro, rad(225)));
  p.arc(C, Ro, rad(225), rad(315));
  p.line(v2.mad(Pr, nR, h));
  p.arc(Pr, h, rad(-45), rad(135));
  if (rho > h) {
    const Ri = rho - h;
    p.line(v2.polar(C, Ri, rad(315)));
    p.arc(C, Ri, rad(315), rad(225));
  } else {
    p.line([ax, ay + Math.SQRT2 * h]);
  }
  p.line(v2.mad(Pl, nL, -h));
  p.arc(Pl, h, rad(45), rad(225));
  p.close();
  return deg ? p.rotate(rad(deg), about ?? apex) : p;
}

/**
 * Кончик чернил головы лежит на биссектрисе: дуга острия радиусом ρ отстоит
 * от вершины на ρ√2, наружу выходит на ρ + кап. Отсюда обратный пересчёт
 * «кончик чернил → вершина скелета», которым задаются знаки, упирающиеся
 * в границу живой области.
 */
const apexFromTip = (tip, w, rho) => tip + w / 2 - rho * (Math.SQRT2 - 1);

/**
 * Стрелка = голова + хвост. `deg` поворачивает ТОЛЬКО голову вокруг вершины
 * (0 = вверх, 90 = вправо, 180 = вниз), хвост задаётся терминалом в канве:
 * так вершина и терминал остаются теми величинами, которые сняты с корпуса.
 */
function arrowAt(apex, tailPoint, half, w, rho, deg = 0) {
  return head(apex, half, w, rho, deg, apex).add(strokeSegment(apex, tailPoint, w));
}

/**
 * ДУГОВАЯ ПОЛОСА С ОДНИМ КРУГЛЫМ ТЕРМИНАЛОМ. Второй конец обрезан радиально
 * (butt) — он не терминал, а стык: там полоса входит в голову или в прямое
 * звено, и полукруг был бы лишними чернилами в негативе.
 */
function bandRoundStart(c, r, a0, a1, w) {
  const band = S.arcBand(c, r, a0, a1, w, 'butt');
  return band.add(S.circle(v2.polar(c, r, a0), w / 2));
}

/**
 * КЛАСС «КОРПУС И ЗНАК» для Filled: корпус сплошной, знак вырезан из него,
 * а то, что от знака выходит наружу, остаётся чернилами. Это симметрическая
 * разность, и она строится, а не проверяется: негативное пространство вокруг
 * знака внутри корпуса — ровно перо знака, без зазора (замер по exit_filled:
 * кромки выреза совпадают с кромками штриха до сотых).
 */
const xorSign = (body, sign) => cut(body, sign).add(cut(sign, body));

/** Скруглённый квадрат-корпус: контур пером либо сплошная масса. */
function box(c, halfW, halfH, w, z, solid) {
  return solid
    ? S.roundedRect(c[0], c[1], 2 * halfW, 2 * halfH, BOX_CORNER, z)
    : S.roundedRectRing(c[0], c[1], 2 * halfW, 2 * halfH, BOX_CORNER, w, z);
}

/**
 * ПРОЁМ в корпусе: рамка разрезается прямоугольником поперёк стороны, а на
 * срезах восстанавливаются полукруглые терминалы. Проём — то место, где знак
 * входит в корпус, поэтому он задаётся серединой и полушириной по скелету.
 */
function openSide(ring, side, mid, halfGap, skelLine, w) {
  const h = w / 2;
  const big = 4;
  const gap =
    side === 'h'
      ? S.roundedRect(mid, skelLine, 2 * halfGap, 2 * big, 0)
      : S.roundedRect(skelLine, mid, 2 * big, 2 * halfGap, 0);
  const out = cut(ring, gap);
  const e1 = side === 'h' ? [mid - halfGap, skelLine] : [skelLine, mid - halfGap];
  const e2 = side === 'h' ? [mid + halfGap, skelLine] : [skelLine, mid + halfGap];
  return out.add(S.circle(e1, h)).add(S.circle(e2, h));
}

// ── ПОВОРОТ: turn-off ─────────────────────────────────────────────────────

/**
 * ПОВОРОТНАЯ ОКРУЖНОСТЬ turn-off. Внешняя кромка полосы стоит на keyline
 * (замер: r=11.00 при обоих перьях — 11/9.2 в Outline, 11/8.6 в Filled),
 * поэтому осевой радиус = keyR − кап. Верхний терминал осевого штриха при
 * этом закреплён ПО СКЕЛЕТУ, а не по чернилам: 1.90 в обоих начертаниях,
 * то есть на поворотной окружности РЕГУЛЯРНОГО пера (11 − 0.9 = 10.1).
 */
defineGlyph('turn-off', {
  family: 'transfer',
  law:
    'дуговая полоса по keyline с разрывом 90° сверху (терминалы на −45° и 225°: ' +
    'замер 45.0° и 45.5° от вертикали) плюс осевой штрих от поворотной окружности ' +
    'Regular-пера (cy − 10.1) до центра канвы. Внешняя кромка полосы — на keyline, ' +
    'поэтому осевой радиус = keyR − кап, и Filled получается сменой пера',
  outline: (t) => {
    const w = t.stroke.glyph;
    const r = t.keyR - t.cap.glyph;
    const p = S.arcBand([t.cx, t.cy], r, rad(-45), rad(225), w, 'round');
    return p.add(strokeSegment([t.cx, t.cy - (t.keyR - t.cap.base)], [t.cx, t.cy], w));
  },
});

// ── ПОВОРОТ: reload ───────────────────────────────────────────────────────

/**
 * RELOAD. Осевой радиус кольца 9.70 — ОДИН И ТОТ ЖЕ при обоих перьях (замер
 * 10.6/8.8 в Outline и 10.9/8.5 в Filled даёт 9.70 и 9.70), то есть здесь рука
 * закрепила скелет, а не чернила. Центр смещён влево на 0.30 от центра канвы.
 */
export const RELOAD_R = 9.7;
export const RELOAD_DX = -0.3;
/**
 * Голова reload — не шеврон, а СПЛОШНОЙ прямоугольный треугольник со
 * скруглением 1.0 (замер: три дуги r=1.00, одинаковые в Outline и Filled —
 * голова не меняется вместе с пером). Прямой угол в точке (23, 9.5): правый
 * катет стоит на границе живой области, длина катета 8.34.
 */
export const RELOAD_LEG = 8.34;
export const RELOAD_FOOT = 9.5;

defineGlyph('reload', {
  family: 'transfer',
  law:
    'кольцевая полоса радиуса 9.70 (центр 0.30 левее центра канвы) с разрывом ' +
    'в верхнем правом секторе: круглый терминал на 19.5°, радиальный срез на −45°. ' +
    'В срез вставлена сплошная голова — прямоугольный треугольник с катетами 8.34 ' +
    'и прямым углом в углу живой области (23, 9.5), скругление 1.0. Голова одна и та ' +
    'же в обоих начертаниях, меняется только перо полосы',
  outline: (t) => {
    const c = [t.cx + RELOAD_DX, t.cy];
    const p = bandRoundStart(c, RELOAD_R, rad(19.5), rad(315), t.stroke.glyph);
    const x = t.canvas - t.margin;
    return p.add(
      S.roundedPolygon(
        [
          [x, RELOAD_FOOT - RELOAD_LEG],
          [x, RELOAD_FOOT],
          [x - RELOAD_LEG, RELOAD_FOOT],
        ],
        1,
      ),
    );
  },
});

// ── ПОВОРОТ: refresh ──────────────────────────────────────────────────────

/**
 * REFRESH. Кольцо посажено так, что снизу его чернила упираются в живую
 * область, а сверху в неё упирается плечо головы:
 *     (cyRing + R + кап) = 23,  (cyRing − R) − half − кап = 1
 * откуда cyRing = (24 + half)/2 = 13.5 и R = (22 − half)/2 − кап = 8.60.
 * Замер Outline даёт 13.47 и 8.615 — закон воспроизводит руку. В Filled рука
 * дала кольцу вылезти за живую область (13.44 и 8.50), поэтому осевой радиус
 * взят минимаксом по двум начертаниям.
 */
export const REFRESH_CY = 13.46;
export const REFRESH_R = 8.56;

defineGlyph('refresh', {
  family: 'transfer',
  law:
    'кольцевая полоса с разрывом в верхнем правом квадранте (90°): круглый терминал ' +
    'на 0°, радиальный срез на −90°. Ось головы совпадает с концом полосы, голова ' +
    'смотрит вправо. Посадка кольца выведена из живой области: снизу чернила кольца ' +
    'на 23, сверху плечо головы на 1, откуда центр (24+half)/2 и радиус (22−half)/2 − кап',
  outline: (t) => {
    const w = t.stroke.glyph;
    const c = [t.cx, REFRESH_CY];
    const p = bandRoundStart(c, REFRESH_R, 0, rad(270), w);
    const axis = REFRESH_CY - REFRESH_R;
    const apex = [t.cx + 0.8 + HEAD_HALF, axis];
    return p.add(head(apex, HEAD_HALF, w, HEAD_RHO, 90, apex));
  },
});

// ── ПОВОРОТ: sync ─────────────────────────────────────────────────────────

/**
 * SYNC — две одинаковые дуговые полосы, повёрнутые друг относительно друга на
 * 180° вокруг центра канвы. Центры разведены по горизонтали на ±0.28 (замер
 * 0.27 Outline, 0.295 Filled): полосы не концентричны, иначе они слиплись бы
 * в кольцо. Полоса идёт от 79° до 180°, дальше по касательной прямым звеном
 * вверх до оси головы (10.55 — замер 10.53/10.56, скелет закреплён).
 */
export const SYNC_DX = 0.28;
export const SYNC_A0 = 79;
export const SYNC_STEM = 10.55;

const syncArm = (t) => {
  const w = t.stroke.glyph;
  const R = ARC_INK - t.cap.glyph;
  const c = [t.cx - SYNC_DX, t.cy];
  const spine = new Path().arcFrom(c, R, rad(SYNC_A0), rad(180)).line([c[0] - R, SYNC_STEM]);
  const p = strokePath(spine, w);
  const apex = [c[0] - R, SYNC_STEM - HEAD_HALF];
  return p.add(head(apex, HEAD_HALF, w, HEAD_RHO));
};

defineGlyph('sync', {
  family: 'transfer',
  law:
    'две дуговые полосы радиуса ARC_INK − кап, центры разведены на ±0.28 от центра ' +
    'канвы; каждая идёт от 79° до 180° и продолжается касательным прямым звеном до оси ' +
    'головы. Вторая полоса — первая, повёрнутая на 180° вокруг центра канвы: одна ' +
    'конструкция, а не две. Габарит чернил дуги (7.80) сохраняется при смене пера',
  outline: (t) => {
    const a = syncArm(t);
    const b = syncArm(t).rotate(Math.PI, [t.cx, t.cy]);
    return a.add(b);
  },
});

// ── ПОВОРОТ: repeat ───────────────────────────────────────────────────────

/**
 * REPEAT — те же две полосы, но с прямым звеном ВДОЛЬ ГОРИЗОНТАЛИ и головой
 * на его конце. Посадка выведена из двух границ:
 *   · чернила полосы упираются в живую область справа ⟹ cxBand = 23 − ARC_INK;
 *   · чернильный просвет между двумя прямыми звеньями постоянен и равен 10.2
 *     (замер: 12.04 − 1.8 = 10.24 при Regular, 12.60 − 2.4 = 10.20 при Bold),
 *     ⟹ ось звена = cy + 5.1 + кап.
 * Остаток — угол свободного терминала (−11°, одинаков в обоих начертаниях) и
 * кончик чернил головы (6.98; замер 7.04/6.92).
 */
export const REPEAT_GAP = 5.1;
export const REPEAT_A0 = -11;
export const REPEAT_TIP = 6.98;

const repeatArm = (t) => {
  const w = t.stroke.glyph;
  const cap = t.cap.glyph;
  const R = ARC_INK - cap;
  const barY = t.cy + REPEAT_GAP + cap;
  const c = [t.canvas - t.margin - ARC_INK, barY - R];
  const apexX = apexFromTip(REPEAT_TIP, w, HEAD_RHO);
  const spine = new Path().arcFrom(c, R, rad(REPEAT_A0), rad(90)).line([apexX, barY]);
  const p = strokePath(spine, w);
  p.add(S.circle(v2.polar(c, R, rad(REPEAT_A0)), w / 2));
  const apex = [apexX, barY];
  return p.add(head(apex, HEAD_HALF, w, HEAD_RHO, -90, apex));
};

defineGlyph('repeat', {
  family: 'transfer',
  law:
    'две дуговые полосы с горизонтальным касательным звеном и головой на его конце, ' +
    'вторая — первая, повёрнутая на 180° вокруг центра канвы. Центр дуги выведен из ' +
    'того, что её чернила упираются в живую область (cx = 23 − 7.8), ось звена — из ' +
    'постоянного чернильного просвета 10.2 между звеньями (ось = cy + 5.1 + кап)',
  outline: (t) => {
    const a = repeatArm(t);
    const b = repeatArm(t).rotate(Math.PI, [t.cx, t.cy]);
    return a.add(b);
  },
});

// ── ДВЕ СТРЕЛКИ: swap-horizontal / swap-vertical ──────────────────────────

/**
 * SWAP. Две стрелки навстречу, разведённые на ±A от осевой линии канвы.
 * Ключ: ВНУТРЕННЕЕ плечо головы приходит ровно на ось канвы (замер 11.999 и
 * 12.005 при Regular, 11.997 и 12.000 при Bold — четыре независимых попадания),
 * то есть полуразмах головы РАВЕН разносу осей: half = A.
 * A = 4.13 — минимакс (4.18 Regular, 4.08 Bold).
 * Кончик чернил головы — на 22.0 (замер 21.99 Outline, 22.00 Filled), хвост
 * терминалом на 2.76/3.00 по скелету, то есть чернилами на 1.86/1.80.
 */
export const SWAP_A = 4.13;
export const SWAP_TIP = 22.0;
export const SWAP_TAIL_INK = 1.83;

/** Одна стрелка swap: вправо, ось на cy + A. */
const swapArm = (t) => {
  const w = t.stroke.glyph;
  const cap = t.cap.glyph;
  const y = t.cy + SWAP_A;
  const apex = [SWAP_TIP - cap + HEAD_RHO * (Math.SQRT2 - 1), y];
  return arrowAt(apex, [SWAP_TAIL_INK + cap, y], SWAP_A, w, HEAD_RHO, 90);
};

defineGlyph('swap-horizontal', {
  family: 'transfer',
  law:
    'две стрелки навстречу, оси на cy ± 4.13; полуразмах головы равен разносу осей, ' +
    'поэтому внутреннее плечо каждой головы приходит ровно на ось канвы. Кончик чернил ' +
    'на 22.0, терминал хвоста чернилами на 1.83 — оба закреплены по чернилам, ' +
    'поэтому Filled получается сменой пера. Вторая стрелка — первая, повёрнутая на 180°',
  outline: (t) => {
    const a = swapArm(t);
    return a.add(swapArm(t).rotate(Math.PI, [t.cx, t.cy]));
  },
});

defineGlyph('swap-vertical', {
  family: 'transfer',
  law: 'тот же swap, повёрнутый на 90°: одна конструкция в двух положениях, а не две иконки',
  outline: (t) => {
    const a = swapArm(t);
    a.add(swapArm(t).rotate(Math.PI, [t.cx, t.cy]));
    return a.rotate(-Math.PI / 2, [t.cx, t.cy]);
  },
});

// ── ЧЕТЫРЕ СТРЕЛКИ: move ──────────────────────────────────────────────────

/**
 * MOVE — крест из четырёх стрелок с общим центром. Кончики чернил стоят
 * на границе живой области (замер bbox 1.004…23.020 при поле 1), отсюда
 * вершина скелета: apex = margin + кап − ρ(√2 − 1).
 *
 * Полуразмах головы рука ужала вдвое сильнее прироста пера: 3.80 при 1.8 и
 * 3.17 при 2.4. Одним числом это не накрыть, но накрывается формой
 * `half = 5.59 − 2·кап` (даёт 3.79 и 3.19 — попадание в 0.02 по обоим
 * начертаниям). Двойное вычитание капа и записано в законе как факт замера.
 */
export const MOVE_HALF_INK = 5.59;

defineGlyph('move', {
  family: 'transfer',
  law:
    'четыре стрелки из центра канвы, кончики чернил на границе живой области. ' +
    'Полуразмах головы = 5.59 − 2·кап (замер 3.80 при пере 1.8 и 3.17 при 2.4: рука ' +
    'ужимает голову вдвое против прироста пера). Стволы — два штриха через центр, ' +
    'а не четыре: крест строится осями',
  outline: (t) => {
    const w = t.stroke.glyph;
    const half = MOVE_HALF_INK - 2 * t.cap.glyph;
    const a = apexFromTip(t.margin, t.stroke.base, HEAD_RHO);
    const b = t.canvas - a;
    const p = strokeSegment([t.cx, a], [t.cx, b], w).add(strokeSegment([a, t.cy], [b, t.cy], w));
    for (const [apex, deg] of [
      [[t.cx, a], 0],
      [[t.cx, b], 180],
      [[a, t.cy], 270],
      [[b, t.cy], 90],
    ]) {
      p.add(head(apex, half, w, HEAD_RHO, deg, apex));
    }
    return p;
  },
});

// ── УГОЛКИ: resize ────────────────────────────────────────────────────────

/**
 * RESIZE. Два уголка и диагональ. Вершины уголков стоят ровно там же, где
 * терминалы перечёркивания в parts.js: (canvas − margin − кап, margin + кап) —
 * замер 22.11/1.90 при Regular и 21.80/2.20 при Bold, то есть чернила уголка
 * упираются в угол живой области. Обе вершины лежат на антидиагонали канвы
 * x + y = 24, по ней же идёт диагональный штрих.
 *
 * Длина плеча 8.16 — замеры 8.18/8.15 (Outline) и 8.11/8.17 (Filled).
 * Скругление внешнего угла уголка — corner.detail (замер r = 2.00).
 */
export const RESIZE_ARM = 8.16;

/**
 * Уголок: L-образная пластина. Терминалы — ПАРЫ вершин с радиусом в полперо:
 * две смежные дуги смыкаются касательно и дают полукруг, то есть кап здесь
 * не приклеен, а выведен (тот же приём, что у `cross` в prim/shape.js).
 * dx/dy — направления плеч от вершины уголка.
 */
const bracket = (t, corner, dx, dy) => {
  const w = t.stroke.glyph;
  const h = w / 2;
  const [x, y] = corner;
  const A = RESIZE_ARM;
  const pts = [
    [x + dx * A, y - dy * h],
    [x - dx * h, y - dy * h],
    [x - dx * h, y + dy * A],
    [x + dx * h, y + dy * A],
    [x + dx * h, y + dy * h],
    [x + dx * A, y + dy * h],
  ];
  return S.roundedPolygon(pts, [h, t.corner.detail, h, h, Math.max(0, t.corner.detail - w), h]);
};

defineGlyph('resize', {
  family: 'transfer',
  law:
    'два уголка с вершинами в углах живой области — (canvas−margin−кап, margin+кап) ' +
    'и зеркально, те же точки, что у оси перечёркивания, — плюс диагональный штрих ' +
    'по антидиагонали канвы x + y = 24, соединяющий вершины. Плечо уголка 8.16, ' +
    'внешнее скругление — corner.detail, внутреннее — corner.detail − перо',
  outline: (t) => {
    const w = t.stroke.glyph;
    const cap = t.cap.glyph;
    const hi = t.canvas - t.margin - cap;
    const lo = t.margin + cap;
    const p = bracket(t, [hi, lo], -1, 1);
    p.add(bracket(t, [lo, hi], 1, -1));
    return p.add(strokeSegment([hi, lo], [lo, hi], w));
    // диагональ идёт из вершины в вершину: обе лежат на антидиагонали x + y = 24
  },
});

// ── КОРПУС И СТРЕЛКА: download / upload / push ────────────────────────────

/**
 * ЛОТОК. Корпус 14×14 со скруглением BOX_CORNER, разомкнутый там, где в него
 * входит стрелка. Полуширина проёма по скелету 3.31 (замер download: концы
 * скелета на 8.69 и 15.31 при оси стрелки 12.00), то есть по обе стороны от
 * штриха стрелки остаётся 3.31 − 0.9 = 2.41 чернильного просвета.
 *
 * Центр лотка снят по корпусу: download 15.32, push 15.35, upload 8.54.
 */
export const TRAY_GAP = 3.31;
export const TRAY_CY_DOWN = 15.33;
export const TRAY_CY_UP = 8.54;

/** Стрелка знака: замеры вершины/хвоста по обоим начертаниям (совпали). */
export const DOWNLOAD_APEX = 16.99;
export const DOWNLOAD_TAIL = 4.3;
export const UPLOAD_APEX = 7.06;
export const UPLOAD_TAIL = 19.83;
export const PUSH_APEX = 2.02;
export const PUSH_TAIL = 14.8;

const TRAY_LAW =
  'лоток — скруглённый квадрат 14×14 (скругление 4), разомкнутый с той стороны, ' +
  'куда входит стрелка: полуширина проёма 3.31 по скелету. Стрелка — голова-шеврон ' +
  'с ОСТРЫМ остриём (замер: дуга ровно 90° радиусом в кап вокруг вершины) плюс хвост. ' +
  'В Filled лоток становится сплошным, а стрелка вырезается из него негативом и ' +
  'остаётся волосяной снаружи: это симметрическая разность, знак при этом сохраняет ' +
  'РЕГУЛЯРНОЕ перо (замер: r=.9 во всех Filled этой тройки)';

const trayGlyph = (name, cyTray, topOpen, apexY, tailY, dir) => {
  const sign = (t, w) => arrowAt([t.cx, apexY], [t.cx, tailY], HEAD_HALF, w, 0, dir);
  defineGlyph(name, {
    family: 'transfer',
    law: TRAY_LAW,
    outline: (t) => {
      const w = t.stroke.glyph;
      const ring = box([t.cx, cyTray], BOX_HALF, BOX_HALF, w, t.corner.smoothing, false);
      const edge = topOpen ? cyTray - BOX_HALF + w / 2 : cyTray + BOX_HALF - w / 2;
      return openSide(ring, 'h', t.cx, TRAY_GAP, edge, w).add(sign(t, w));
    },
    filled: (t) =>
      xorSign(
        box([t.cx, cyTray], BOX_HALF, BOX_HALF, t.stroke.base, t.corner.smoothing, true),
        sign(t, t.stroke.base),
      ),
  });
};

trayGlyph('download', TRAY_CY_DOWN, true, DOWNLOAD_APEX, DOWNLOAD_TAIL, 180);
trayGlyph('upload', TRAY_CY_UP, false, UPLOAD_APEX, UPLOAD_TAIL, 0);
trayGlyph('push', TRAY_CY_DOWN, true, PUSH_APEX, PUSH_TAIL, 0);

// ── ДВЕРЬ И СТРЕЛКА: exit / enter ─────────────────────────────────────────

/**
 * ДВЕРЬ — тот же корпус, вытянутый: 12.02 × 17.26 со скруглением BOX_CORNER
 * (замер по exit и enter совпал до сотых). Разомкнута она с той стороны,
 * откуда выходит стрелка; полуширина проёма 3.35 по скелету (замер: концы
 * 8.70…15.54 у exit и 8.70…15.30 у enter).
 *
 * Стрелка горизонтальная, ось на cy: вершина 17.01 (exit) / 22.11 (enter),
 * терминал хвоста 4.23 / 9.34 — обе пары совпали в Outline и Filled.
 */
export const DOOR_HALF_W = 6.01;
export const DOOR_HALF_H = 8.63;
export const DOOR_GAP = 3.35;
export const DOOR_HEAD_HALF = 3.3;

const doorGlyph = (name, cxDoor, openRight, apexX, tailX) => {
  const sign = (t, w) => arrowAt([apexX, t.cy], [tailX, t.cy], DOOR_HEAD_HALF, w, 0, 90);
  defineGlyph(name, {
    family: 'transfer',
    law:
      'дверь — корпус 12.02×17.26 со скруглением 4, разомкнутый с той стороны, куда ' +
      'уходит стрелка (полуширина проёма 3.35 по скелету). Стрелка горизонтальная по оси ' +
      'канвы, остриё острое, полуразмах головы 3.30. Filled — сплошная дверь, стрелка ' +
      'вырезана из неё негативом и остаётся волосяной снаружи (симметрическая разность)',
    outline: (t) => {
      const w = t.stroke.glyph;
      const ring = box([cxDoor, t.cy], DOOR_HALF_W, DOOR_HALF_H, w, t.corner.smoothing, false);
      const edge = openRight ? cxDoor + DOOR_HALF_W - w / 2 : cxDoor - DOOR_HALF_W + w / 2;
      return openSide(ring, 'v', t.cy, DOOR_GAP, edge, w).add(sign(t, w));
    },
    filled: (t) =>
      xorSign(
        box([cxDoor, t.cy], DOOR_HALF_W, DOOR_HALF_H, t.stroke.base, t.corner.smoothing, true),
        sign(t, t.stroke.base),
      ),
  });
};

doorGlyph('exit', 15.24, false, 17.01, 4.23);
doorGlyph('enter', 8.8, true, 22.11, 9.34);

// ── КОРПУС И ДИАГОНАЛЬ: share ─────────────────────────────────────────────

/**
 * SHARE. Тот же корпус 14×14, но смещённый вниз-влево (центр 10.28, 13.90) и
 * разомкнутый в ВЕРХНЕМ ПРАВОМ углу — там, откуда уходит диагональ. Концы
 * рамки: на верхней стороне x = 11.22, на правой y = 12.30 (замеры совпали
 * в обоих начертаниях).
 *
 * Знак — уголок в углу с диагональю: вершина уголка (20.55, 3.42) лежит на
 * антидиагонали канвы x + y = 24 (замер 23.97), плечи 4.18 и 4.08, диагональ
 * уходит внутрь корпуса до (10.67, 13.34). Знак и в Filled остаётся пером 1.8.
 */
export const SHARE_BOX_C = [10.28, 13.9];
export const SHARE_CORNER = [20.55, 3.42];
export const SHARE_ARM = 4.13;
export const SHARE_DIAG = [10.67, 13.34];
export const SHARE_END_TOP = 11.22;
export const SHARE_END_RIGHT = 12.3;

const shareSign = (w) => {
  const [x, y] = SHARE_CORNER;
  const p = strokePolyline(
    [
      [x - SHARE_ARM, y],
      [x, y],
      [x, y + SHARE_ARM],
    ],
    w,
  );
  return p.add(strokeSegment([x, y], SHARE_DIAG, w));
};

defineGlyph('share', {
  family: 'transfer',
  law:
    'корпус 14×14 со скруглением 4, разомкнутый в верхнем правом углу: рамка обрывается ' +
    'на верхней стороне и на правой. Знак — уголок с вершиной на антидиагонали канвы ' +
    '(20.55, 3.42), плечи 4.13, и диагональ от вершины внутрь корпуса. Filled — сплошной ' +
    'корпус, знак вырезан негативом и остаётся волосяным снаружи',
  outline: (t) => {
    const w = t.stroke.glyph;
    const h = w / 2;
    const ring = box(SHARE_BOX_C, BOX_HALF, BOX_HALF, w, t.corner.smoothing, false);
    const top = SHARE_BOX_C[1] - BOX_HALF + h;
    const right = SHARE_BOX_C[0] + BOX_HALF - h;
    const big = 6;
    let p = cut(ring, S.roundedRect(SHARE_END_TOP + big, top, 2 * big, 2 * big, 0));
    p = cut(p, S.roundedRect(right, SHARE_END_RIGHT - big, 2 * big, 2 * big, 0));
    p.add(S.circle([SHARE_END_TOP, top], h));
    p.add(S.circle([right, SHARE_END_RIGHT], h));
    return p.add(shareSign(w));
  },
  filled: (t) => xorSign(box(SHARE_BOX_C, BOX_HALF, BOX_HALF, t.stroke.base, t.corner.smoothing, true), shareSign(t.stroke.base)),
});

// ── ДРОТИК: navigate ──────────────────────────────────────────────────────

/**
 * NAVIGATE — дротик, симметричный относительно АНТИДИАГОНАЛИ канвы x + y = 24
 * (замер: ось симметрии проходит через вершину клина и центр вогнутой дуги,
 * сумма координат 24.02 и 24.01). Задаётся в осевых координатах
 *     u — вдоль диагонали от центра канвы,  v — поперёк.
 * Вершина клина u = 17.34 лежит ВНЕ канвы: видимый кончик поднимает скругление
 * corner.detail на R(1/sin φ − 1) = 4.40 (замер кончика 12.94 по оси).
 * Крылья на u = −6.33, v = ±7.83, скругление 0.9. Вырез между крыльями —
 * вогнутая вершина u = −3.20 со скруглением 7.00 (замер дуги r=7.00 в обоих
 * начертаниях; во внутреннем контуре Outline та же дуга даёт 9.00 = 7 + перо,
 * то есть вогнутый радиус растёт на перо, а не убывает).
 */
export const NAVIGATE = Object.freeze({ apexU: 17.34, wingU: -6.33, wingV: 7.83, notchU: -3.2, notchR: 7 });

const axial = (u, v) => [12 + (u + v) * U, 12 + (v - u) * U];

const dartPts = () => [
  axial(NAVIGATE.apexU, 0),
  axial(NAVIGATE.wingU, NAVIGATE.wingV),
  axial(NAVIGATE.notchU, 0),
  axial(NAVIGATE.wingU, -NAVIGATE.wingV),
];

defineGlyph('navigate', {
  family: 'transfer',
  law:
    'дротик, симметричный относительно антидиагонали канвы: вершина клина за пределами ' +
    'канвы (скругление corner.detail поднимает видимый кончик на R(1/sin φ − 1)), два ' +
    'крыла со скруглением в кап и вогнутая вершина-вырез со скруглением 7. Outline — ' +
    'рамка того же дротика пером: у вогнутой вершины радиус внутренней кромки не ' +
    'убывает на перо, а РАСТЁТ (замер 7 снаружи, 9 внутри)',
  outline: (t) => {
    const w = t.stroke.glyph;
    const pts = dartPts();
    const r = [t.corner.detail, t.cap.glyph, NAVIGATE.notchR, t.cap.glyph];
    const outer = S.roundedPolygon(pts, r, t.corner.smoothing);
    const inner = S.roundedPolygon(
      S.insetPolygon(pts, w),
      [Math.max(0, t.corner.detail - w), 0, NAVIGATE.notchR + w, 0],
      t.corner.smoothing,
    );
    return outer.add(inner.reverse());
  },
  filled: (t) =>
    S.roundedPolygon(
      dartPts(),
      [t.corner.detail, t.cap.base, NAVIGATE.notchR, t.cap.base],
      t.corner.smoothing,
    ),
});
