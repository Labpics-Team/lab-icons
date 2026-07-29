/**
 * system/tokens.js — КОНСТИТУЦИЯ системы.
 *
 * Единственный источник числовых законов. Ни один примитив, часть или глиф не
 * имеет права ввести собственную константу: всё, что не выводится из токенов
 * формулой, — фантазия, и гейт её ловит.
 *
 * ПРАВИЛО ОТНОСИТЕЛЬНОСТИ. Токены хранятся ДОЛЯМИ канвы. Номиналы в
 * комментариях — при канве 24 (историческая канва корпуса). Смена канвы
 * масштабирует всю дисциплину пропорционально; абсолютов в системе нет.
 *
 * ПРАВИЛО ВЫВОДИМОСТИ. Радиусы, зазоры, внутренние кромки — не отдельные
 * токены, а СЛЕДСТВИЯ:
 *     cap      = weight / 2                (терминал = полукруг пера)
 *     rInner   = rOuter − weight           (внутренняя кромка обводки)
 *     hSquare  = R + (Rkey − R)/√2         (скруглённый квадрат, вписанный
 *                                           углами в keyline-окружность)
 * Список выводов — в DERIVED ниже; каждый снабжён доказательством в корпусе.
 */

/** Историческая канва корпуса: все номиналы в комментариях даны при ней. */
export const NOMINAL_CANVAS = 24;

/** Номинал (в единицах канвы 24) → безразмерная доля канвы. */
const r = (nominal) => nominal / NOMINAL_CANVAS;

export const TOKENS = Object.freeze({
  /** Рамка: канва, поле, живая область. */
  frame: Object.freeze({
    /** Поле от края канвы до самой внешней точки чернил. Номинал 1. */
    margin: r(1),
    /**
     * Живая область = канва − 2·margin. Номинал 22.
     * Все keyline-фигуры вписаны в неё, не в канву.
     */
    live: r(22),
  }),

  /**
   * KEYLINE-СЕМЬЯ — опорные габариты силуэтов. Круг задаёт семью: остальные
   * формы вписаны в него, а не подобраны на глаз (ratio-logo-конструкция).
   * Овершут круга относительно квадрата — не «магия 10%», а следствие
   * вписанности: круг r=11 описан вокруг скруглённого квадрата.
   */
  keyline: Object.freeze({
    /** Диаметр опорной окружности. Номинал 22 = живая область. */
    circle: r(22),
    /**
     * Габарит скруглённого квадрата НЕ хранится: он ВЫВОДИТСЯ из радиуса
     * скругления через DERIVED.inscribedSquare — см. доказательство там.
     */
    /** Прямоугольные keylines как доли живой области (wide/tall — 22×20). */
    wideRatio: 20 / 22,
  }),

  /**
   * ВЕСА ПЕРА. Два независимых типографских базиса (как Regular/Bold шрифта),
   * не формула ×4/3; плюс два служебных веса контейнера.
   */
  stroke: Object.freeze({
    /** Regular — базовое перо контура. Номинал 1.8. */
    base: r(1.8),
    /** Bold — начертание того же штриха в Filled-варианте. Номинал 2.4. */
    bold: r(2.4),
    /** Перо глифа внутри контейнера (оптически тяжелее кольца). Номинал 2.0. */
    containerGlyph: r(2),
    /** Кольцо-обрамление: контейнер оптически легче глифа. Номинал 1.5. */
    ring: r(1.5),
    /** Волосяное перо служебной разметки (циферблат, насечки). Номинал 1.2. */
    hair: r(1.2),
  }),

  /**
   * НЕГАТИВНОЕ ПРОСТРАНСТВО — первоклассный токен, не остаток.
   * Пики клиренсов корпуса соразмерны весам пера: «негатив ≈ штрих».
   */
  clearance: Object.freeze({
    /** Абсолютный минимум зазора между чернилами. Номинал 0.8. */
    min: r(0.8),
    /** Рабочий зазор внутри глифа (ниже — слипание на мелких кеглях). 1.2. */
    snug: r(1.2),
    /** Канальный зазор ≈ перо: негатив читается как штрих. Номинал 1.8. */
    channel: r(1.8),
    /**
     * Зазор вокруг ПЕРЕЧЁРКИВАНИЯ. Номинал 1.35 — снят с корпуса замером
     * расстояния от кромки оси до ближайших чернил носителя:
     *   eye-off 1.354 · heart-off 1.354 · notifications-off 1.354 · cloud-off 1.354
     *   mic-off 1.796 · video-camera-off 1.796
     * Четыре независимых носителя дают одно число до третьего знака; два
     * стоят шире. Взято большинство. Итоговая полуширина выреза = кап + 1.35.
     */
    slash: r(1.35),
    /**
     * Зазор вокруг БЕЙДЖА. Номинал 1.5: mail-unread даёт 1.498, то есть радиус
     * выреза ровно 4.5 = 1.5 × радиуса бейджа. (notifications-unread 1.607 —
     * там носитель в этом месте и так отступает.)
     */
    badge: r(1.5),
    /** Общий псевдоним для накладок без собственного замера. */
    overlay: r(1.35),
  }),

  /** СКРУГЛЕНИЯ. Радиус — абсолютный токен (как терминал шрифта), не доля. */
  corner: Object.freeze({
    /** Скругление корпусной формы (квадрат, конверт, календарь). Номинал 5. */
    box: r(5),
    /** Скругление мелкой детали (клавиша, зуб, ярлык). Номинал 2. */
    detail: r(2),
    /** Скругление острия штрихового сустава = радиус пера (выводится). */
    /** ζ — профиль сглаживания перепада кривизны (Figma corner smoothing). */
    smoothing: 0.6,
  }),

  /** ШКАЛА НАПРАВЛЕНИЙ прямых рёбер. Всё, что вне шкалы, — намеренная диагональ. */
  angles: Object.freeze([0, 30, 45, 90, 135]),

  /** Допуск снапа к шкале направлений, градусы. */
  angleSnapDeg: 4,

  /**
   * ОПТИЧЕСКИЙ ЦЕНТР. Якорь выравнивания асимметричного силуэта — точка на
   * пути bbox-центр → центроид чернил с байасом 0.5.
   */
  opticalCenterBias: 0.5,
});

/**
 * ОСИ ВАРИАТИВНОСТИ (модель Roboto Flex: именованная ось, зарегистрированный
 * диапазон, дефолт). Глиф может объявить собственные оси поверх этих.
 */
export const AXES = Object.freeze({
  /**
   * wght — множитель весов пера.
   * min = cap/ring = 0.9/1.5 = 0.6: ниже тончайшее каноническое кольцо
   *   становится тоньше собственного терминала — предел различимости пера.
   * max = 1 + (ring − clearanceMin)/bold = 1 + (1.5 − 0.8)/2.4 = 1.291(6):
   *   выше узчайший канонический негатив-канал между двумя bold-штрихами
   *   проседает ниже охранного минимума.
   */
  wght: Object.freeze({ min: 0.6, def: 1, max: 1.291666 }),
  /** crnr — ζ сглаживания скруглений (валидный диапазон Figma). */
  crnr: Object.freeze({ min: 0, def: TOKENS.corner.smoothing, max: 1 }),
  /** rond — множитель объявленных радиусов скругления (0 = острый угол). */
  rond: Object.freeze({ min: 0, def: 1, max: 1.6 }),
  /** fill — 0 контур, 1 заливка (дискретна на сегодня, ось задела под морф). */
  fill: Object.freeze({ min: 0, def: 0, max: 1 }),
});

/** Клампинг значения оси в её зарегистрированный диапазон. */
export const clampAxis = (name, value) => {
  const a = AXES[name];
  if (!a) throw new Error(`неизвестная ось: ${name}`);
  return value == null ? a.def : Math.min(a.max, Math.max(a.min, value));
};

/**
 * ВЫВОДЫ (DERIVED) — законы, связывающие токены. Каждый снабжён указанием на
 * доказательство в корпусе: если корпус говорит иное, спор решается корпусом.
 */
export const DERIVED = Object.freeze({
  /**
   * Терминал пера = полукруг радиусом в половину пера.
   * Корпус: перо 1.8 ↔ `a.9 .9 0 0 1` во всех штриховых глифах.
   */
  cap: (weight) => weight / 2,

  /**
   * Внутренняя кромка обводки: радиус внешней минус перо.
   * Корпус: square 5 → 3.2 (5−1.8); sun-диск 5 → 3.2; mail 5 → 3.2.
   */
  inner: (outer, weight) => outer - weight,

  /**
   * СКРУГЛЁННЫЙ КВАДРАТ, ВПИСАННЫЙ В KEYLINE-ОКРУЖНОСТЬ.
   *
   * Центры угловых дуг лежат на расстоянии (h − R) от осей, то есть на
   * расстоянии (h − R)·√2 от центра. Самая дальняя точка силуэта — на этой же
   * диагонали, дальше центра дуги ещё на R:
   *     (h − R)·√2 + R = Rkey     ⟹     h = R + (Rkey − R)/√2
   *
   * Проверка на корпусе: Rkey = 11, R = 5 ⟹ h = 5 + 6/√2 = 9.2426,
   * габарит 18.485. Рука (`square.svg`): 21.24 − 2.76 = 18.48. Δ = 0.005.
   * Это не подгон под руку — это причина, по которой рука нарисовала 18.48.
   */
  inscribedSquareHalf: (cornerR, keyR) => cornerR + (keyR - cornerR) / Math.SQRT2,

  /**
   * Обратный вывод: радиус скругления квадрата заданного габарита, вписанного
   * в ту же окружность. h = R + (Rkey−R)/√2 ⟹ R = (h·√2 − Rkey)/(√2 − 1).
   */
  inscribedSquareCorner: (half, keyR) => (half * Math.SQRT2 - keyR) / (Math.SQRT2 - 1),

  /**
   * Радиус сустава штриховой ломаной (chevron, checkmark): дуга радиусом в
   * перо вокруг внутреннего острия. Корпус: chevron-down `Q13.46 15.66`.
   */
  jointR: (weight) => weight,

  /**
   * Полуширина «тени» накладного класса: собственная полуширина + зазор.
   * Именно она вырезается из глифа, а не сам класс — гарантия негатива.
   */
  overlayShadow: (halfWidth, clearance) => halfWidth + clearance,
});

/**
 * Разрешение конституции в абсолютные единицы конкретной канвы и осей.
 *
 * @param {{canvas?:number, wght?:number, crnr?:number, rond?:number, fill?:number}} [opt]
 */
export function resolve(opt = {}) {
  const canvas = opt.canvas ?? NOMINAL_CANVAS;
  const wght = clampAxis('wght', opt.wght);
  const crnr = clampAxis('crnr', opt.crnr);
  const rond = clampAxis('rond', opt.rond);
  const fill = clampAxis('fill', opt.fill);
  const u = (ratio) => ratio * canvas;

  const stroke = {
    base: u(TOKENS.stroke.base) * wght,
    bold: u(TOKENS.stroke.bold) * wght,
    containerGlyph: u(TOKENS.stroke.containerGlyph) * wght,
    ring: u(TOKENS.stroke.ring) * wght,
    hair: u(TOKENS.stroke.hair) * wght,
  };
  /**
   * ПЕРО ГЛИФА — то, чем построитель рисует, не зная про варианты. Ось fill
   * переключает Regular↔Bold здесь и только здесь: штриховой глиф в Filled —
   * это его же жирное начертание, а не вторая иконка. Построитель, который
   * пишет `t.stroke.base` вместо `t.stroke.glyph`, отказывается от оси fill.
   */
  stroke.glyph = fill >= 0.5 ? stroke.bold : stroke.base;

  const margin = u(TOKENS.frame.margin);
  const keyR = u(TOKENS.keyline.circle) / 2;

  return {
    canvas,
    axes: { wght, crnr, rond, fill },
    center: [canvas / 2, canvas / 2],
    cx: canvas / 2,
    cy: canvas / 2,
    margin,
    /** Границы живой области: [min, max] по обеим осям. */
    live: [margin, canvas - margin],
    keyR,
    stroke,
    /** Терминалы — производные весов, не токены. */
    cap: {
      base: DERIVED.cap(stroke.base),
      bold: DERIVED.cap(stroke.bold),
      ring: DERIVED.cap(stroke.ring),
      containerGlyph: DERIVED.cap(stroke.containerGlyph),
      hair: DERIVED.cap(stroke.hair),
      glyph: DERIVED.cap(stroke.glyph),
    },
    clearance: {
      min: u(TOKENS.clearance.min),
      snug: u(TOKENS.clearance.snug),
      channel: u(TOKENS.clearance.channel),
      slash: u(TOKENS.clearance.slash),
      badge: u(TOKENS.clearance.badge),
      overlay: u(TOKENS.clearance.overlay),
    },
    corner: {
      box: u(TOKENS.corner.box) * rond,
      detail: u(TOKENS.corner.detail) * rond,
      smoothing: crnr,
    },
    fill,
    /** Габарит скруглённого квадрата, вписанного в keyline-окружность. */
    squareHalf(cornerR = u(TOKENS.corner.box) * rond) {
      return DERIVED.inscribedSquareHalf(cornerR, keyR);
    },
    u,
  };
}

/** Дефолтная резолюция — канва 24, все оси в дефолте. */
export const T = resolve();
