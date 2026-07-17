import {
  _closedRecord as closedRecord,
  _deepFreeze as deepFreeze,
  _finite as finiteNumber,
  _negativeSpaceConstraint as negativeSpaceConstraint,
  _positive as positiveNumber,
  opticalLimits,
} from './glyph-operators.js';

/**
 * Геометрический kernel номера дня для calendar-number.
 *
 * Здесь нет шрифта, DOM и «сегодня»: imperative shell обязан передать instant
 * и IANA time zone. Цифры — rounded-монолиния из декларативных line/cubic
 * примитивов. Фиксированный advance даёт tnum-семантику, а стабильные слоты
 * tens/ones не привязывают будущую анимацию к индексу path.
 *
 * Закон opsz 16..48:
 * - на малом кегле штрих толще, межцифровой просвет больше, жесты проще;
 * - к display-кеглю штрих деликатнее, скелет шире, характерные изгибы полнее;
 * - smoothstep интерполирует один master interval: список команд не меняется.
 * Десяток исчезает только потому, что в числе 1..9 его нет, а не из-за opsz.
 */

export const CALENDAR_OPSZ_RANGE = Object.freeze({ min: 16, default: 24, max: 48 });
export const CALENDAR_CANVAS_SIZE = 24;

// Ratio-token снят с реального внутреннего окна calendar-number: он не заходит
// в header и оставляет телу нижний просвет. Абсолютный 24-unit aperture ниже —
// только target lowering, а не второй набор независимых magic coordinates.
export const CALENDAR_APERTURE_RATIO = Object.freeze({
  x: 6.25 / CALENDAR_CANVAS_SIZE,
  y: 9.75 / CALENDAR_CANVAS_SIZE,
  width: 11.5 / CALENDAR_CANVAS_SIZE,
  height: 8.25 / CALENDAR_CANVAS_SIZE,
});
export const DEFAULT_CALENDAR_APERTURE = Object.freeze(Object.fromEntries(
  Object.entries(CALENDAR_APERTURE_RATIO)
    .map(([name, value]) => [name, value * CALENDAR_CANVAS_SIZE]),
));

const MASTER_INTERVAL = 'calendar-rounded-16-48-v1';
const MIN_CELL_PIXELS = 2;
const SLOT_IDS = Object.freeze({
  tens: 'calendar.date.tens',
  ones: 'calendar.date.ones',
});

function parseOpsz(value = CALENDAR_OPSZ_RANGE.default) {
  const opsz = finiteNumber(value, 'opsz');
  if (opsz < CALENDAR_OPSZ_RANGE.min || opsz > CALENDAR_OPSZ_RANGE.max) {
    throw new RangeError(
      `opsz: ${CALENDAR_OPSZ_RANGE.min}..${CALENDAR_OPSZ_RANGE.max}; got ${opsz}`,
    );
  }
  return opsz;
}

function parseAperture(value = DEFAULT_CALENDAR_APERTURE) {
  const aperture = closedRecord(value, 'aperture', ['x', 'y', 'width', 'height']);
  const parsed = {
    x: finiteNumber(aperture.x, 'aperture.x'),
    y: finiteNumber(aperture.y, 'aperture.y'),
    width: positiveNumber(aperture.width, 'aperture.width'),
    height: positiveNumber(aperture.height, 'aperture.height'),
  };
  if (
    parsed.x < 0 ||
    parsed.y < 0 ||
    parsed.x + parsed.width > CALENDAR_CANVAS_SIZE ||
    parsed.y + parsed.height > CALENDAR_CANVAS_SIZE
  ) {
    throw new RangeError(`aperture: не внутри 0..${CALENDAR_CANVAS_SIZE}`);
  }
  return parsed;
}

/**
 * Перевод registered opsz в конструктивные параметры мастера. Smoothstep
 * убирает излом скорости у крайних master-координат; clamp здесь намеренно нет.
 */
function opszProfile(opsz) {
  const linear = (opsz - CALENDAR_OPSZ_RANGE.min)
    / (CALENDAR_OPSZ_RANGE.max - CALENDAR_OPSZ_RANGE.min);
  const t = linear * linear * (3 - 2 * linear);
  return {
    normalized: t,
    // Толщина относительно высоты aperture: малый растр требует больше ink.
    strokeRatio: 0.165 - 0.04 * t,
    // На малом растре два штриха нельзя сближать ценой counter-space.
    gapRatio: 0.085 - 0.03 * t,
    // Нулевая амплитуда схлопнула бы детали и дала вырожденный master.
    detail: 0.28 + 0.72 * t,
    // К display-кеглю скелет использует больше доступной tabular-ячейки.
    skeletonWidthRatio: 0.92 + 0.08 * t,
  };
}

const move = (x, y) => ({ kind: 'move', x, y });
const line = (x, y) => ({ kind: 'line', x, y });
const cubic = (x1, y1, x2, y2, x, y) => ({ kind: 'cubic', x1, y1, x2, y2, x, y });
const close = () => ({ kind: 'close' });

/** Rounded loop общий для 0; параметр detail меняет плечи, не команды. */
function zeroSkeleton(detail) {
  const side = 0.39 + 0.045 * detail;
  const shoulder = 0.23 + 0.055 * detail;
  return [
    move(0, -0.5),
    cubic(shoulder, -0.5, side, -0.34, side, 0),
    cubic(side, 0.34, shoulder, 0.5, 0, 0.5),
    cubic(-shoulder, 0.5, -side, 0.34, -side, 0),
    cubic(-side, -0.34, -shoulder, -0.5, 0, -0.5),
    close(),
  ];
}

function oneSkeleton(detail) {
  const flag = 0.12 + 0.16 * detail;
  const foot = 0.13 + 0.17 * detail;
  return [
    move(-flag, -0.31),
    cubic(-flag * 0.52, -0.37, -flag * 0.26, -0.46, 0, -0.5),
    line(0, 0.5),
    move(-foot, 0.5),
    line(foot, 0.5),
  ];
}

function twoSkeleton(detail) {
  const entry = -0.34 - 0.045 * detail;
  const shoulder = 0.37 + 0.055 * detail;
  const diagonal = 0.05 + 0.055 * detail;
  return [
    move(entry, -0.31),
    cubic(-0.25, -0.48, -0.07, -0.5, 0.08, -0.5),
    cubic(0.3, -0.5, shoulder, -0.35, shoulder, -0.18),
    cubic(shoulder, 0.02, 0.25, 0.14, diagonal, 0.29),
    line(-0.39, 0.5),
    line(0.42, 0.5),
  ];
}

function threeSkeleton(detail) {
  const side = 0.36 + 0.06 * detail;
  const waist = 0.05 + 0.08 * detail;
  return [
    move(-0.34 - 0.04 * detail, -0.38),
    cubic(-0.2, -0.5, 0.06, -0.5, 0.24, -0.42),
    cubic(side, -0.32, side, -0.1, waist, 0),
    cubic(side, 0.08, side + 0.02, 0.31, 0.25, 0.42),
    cubic(0.07, 0.5, -0.2, 0.5, -0.37 - 0.035 * detail, 0.37),
  ];
}

function fourSkeleton(detail) {
  const stem = 0.22 + 0.035 * detail;
  const joinY = 0.25 + 0.055 * detail;
  return [
    move(stem, 0.5),
    line(stem, -0.5),
    move(stem, -0.5),
    line(-0.42, 0.18),
    cubic(-0.46, 0.23, -0.42, joinY, -0.34, joinY),
    line(0.42, joinY),
  ];
}

function fiveSkeleton(detail) {
  const bowl = 0.34 + 0.07 * detail;
  return [
    move(0.39, -0.5),
    line(-0.34, -0.5),
    line(-0.39, -0.04 - 0.025 * detail),
    cubic(-0.19, -0.12, 0.06, -0.11, 0.23, -0.01),
    cubic(bowl + 0.06, 0.1, bowl + 0.07, 0.36, 0.23, 0.46),
    cubic(0.04, 0.5, -0.23, 0.49, -0.39, 0.36),
  ];
}

function sixSkeleton(detail) {
  const side = 0.35 + 0.055 * detail;
  const inner = 0.14 + 0.05 * detail;
  return [
    move(0.31 + 0.045 * detail, -0.4),
    cubic(0.12, -0.5, -0.17, -0.47, -0.31, -0.21),
    cubic(-side, 0.08, -side, 0.37, -0.17, 0.48),
    cubic(0.04, 0.5, 0.31, 0.45, 0.38, 0.22),
    cubic(0.43, 0.01, 0.25, -inner, 0.02, -inner),
    cubic(-0.2, -inner, -0.34, -0.04, -0.36, 0.13),
  ];
}

function sevenSkeleton(detail) {
  const bend = 0.16 + 0.07 * detail;
  return [
    move(-0.42, -0.5),
    line(0.42, -0.5),
    cubic(0.31, -0.34, bend, -0.1, 0.03, 0.2),
    line(-0.12 - 0.025 * detail, 0.5),
  ];
}

function eightSkeleton(detail) {
  const side = 0.32 + 0.065 * detail;
  return [
    move(0, 0),
    cubic(-side, -0.1, -side - 0.04, -0.31, -0.25, -0.43),
    cubic(-0.1, -0.5, 0.19, -0.5, 0.3, -0.38),
    cubic(0.42, -0.24, 0.3, -0.08, 0, 0),
    cubic(-side, 0.09, -side - 0.05, 0.3, -0.25, 0.43),
    cubic(-0.09, 0.5, 0.19, 0.5, 0.31, 0.38),
    cubic(0.43, 0.23, 0.3, 0.08, 0, 0),
    close(),
  ];
}

function rotateHalfTurn(primitives) {
  return primitives.map((primitive) => {
    if (primitive.kind === 'close') return primitive;
    if (primitive.kind === 'cubic') {
      return cubic(
        -primitive.x1,
        -primitive.y1,
        -primitive.x2,
        -primitive.y2,
        -primitive.x,
        -primitive.y,
      );
    }
    return primitive.kind === 'move'
      ? move(-primitive.x, -primitive.y)
      : line(-primitive.x, -primitive.y);
  });
}

const DIGIT_SKELETONS = Object.freeze([
  zeroSkeleton,
  oneSkeleton,
  twoSkeleton,
  threeSkeleton,
  fourSkeleton,
  fiveSkeleton,
  sixSkeleton,
  sevenSkeleton,
  eightSkeleton,
  // 9 — тот же анатомический закон, что 6, после поворота на пол-оборота.
  (detail) => rotateHalfTurn(sixSkeleton(detail)),
]);

function parseCell(value) {
  const cell = closedRecord(value, 'cell', ['centerX', 'centerY', 'width', 'height']);
  const parsed = {
    centerX: finiteNumber(cell.centerX, 'cell.centerX'),
    centerY: finiteNumber(cell.centerY, 'cell.centerY'),
    width: positiveNumber(cell.width, 'cell.width'),
    height: positiveNumber(cell.height, 'cell.height'),
  };
  if (
    parsed.centerX - parsed.width / 2 < 0 ||
    parsed.centerY - parsed.height / 2 < 0 ||
    parsed.centerX + parsed.width / 2 > CALENDAR_CANVAS_SIZE ||
    parsed.centerY + parsed.height / 2 > CALENDAR_CANVAS_SIZE
  ) {
    throw new RangeError(`cell: не внутри 0..${CALENDAR_CANVAS_SIZE}`);
  }
  return parsed;
}

function layoutTokens(aperture, profile, requiredGap = 0) {
  // Ratio задаёт авторский ритм мастера, а raster policy — физический floor.
  // max применяется до построения ячеек, поэтому реальный ink-gap выводится из
  // геометрии, а не подменяется записанным requested clearance.
  const gap = Math.max(aperture.width * profile.gapRatio, requiredGap);
  const cellWidth = (aperture.width - gap) / 2;
  if (cellWidth <= 0) throw new RangeError('aperture.width: no room');
  return {
    gap,
    cellWidth,
    centerX: aperture.x + aperture.width / 2,
    centerY: aperture.y + aperture.height / 2,
  };
}

function defaultCell(opsz) {
  const profile = opszProfile(opsz);
  const aperture = parseAperture(DEFAULT_CALENDAR_APERTURE);
  const requiredGap = opticalLimits({ opsz }).minClearance * CALENDAR_CANVAS_SIZE;
  const layout = layoutTokens(aperture, profile, requiredGap);
  return {
    centerX: layout.centerX,
    centerY: layout.centerY,
    width: layout.cellWidth,
    height: aperture.height,
  };
}

function cleanNumber(value) {
  // Девять знаков держат boundary error ниже 1e-9 на 24-unit канве, но не
  // протаскивают в артефакт двоичный шум IEEE-754.
  const rounded = Number(value.toFixed(9));
  return Object.is(rounded, -0) ? 0 : rounded;
}

function transformPrimitive(primitive, transform) {
  const point = (x, y) => ({
    x: cleanNumber(transform.centerX + x * transform.width),
    y: cleanNumber(transform.centerY + y * transform.height),
  });
  if (primitive.kind === 'close') return primitive;
  if (primitive.kind === 'cubic') {
    const c1 = point(primitive.x1, primitive.y1);
    const c2 = point(primitive.x2, primitive.y2);
    const end = point(primitive.x, primitive.y);
    return cubic(c1.x, c1.y, c2.x, c2.y, end.x, end.y);
  }
  const end = point(primitive.x, primitive.y);
  return primitive.kind === 'move' ? move(end.x, end.y) : line(end.x, end.y);
}

function serializePrimitive(primitive) {
  if (primitive.kind === 'move') return `M${primitive.x} ${primitive.y}`;
  if (primitive.kind === 'line') return `L${primitive.x} ${primitive.y}`;
  if (primitive.kind === 'cubic') {
    return `C${primitive.x1} ${primitive.y1} ${primitive.x2} ${primitive.y2} ${primitive.x} ${primitive.y}`;
  }
  return 'Z';
}

function topologySignature(primitives) {
  const commands = { move: 'M', line: 'L', cubic: 'C', close: 'Z' };
  return primitives.map(({ kind }) => commands[kind]).join('');
}

/** Control-hull bbox консервативен для cubic и поэтому годится как safety bound. */
function controlBounds(primitives, strokeWidth) {
  const xs = [];
  const ys = [];
  for (const primitive of primitives) {
    if ('x' in primitive) {
      xs.push(primitive.x);
      ys.push(primitive.y);
    }
    if (primitive.kind === 'cubic') {
      xs.push(primitive.x1, primitive.x2);
      ys.push(primitive.y1, primitive.y2);
    }
  }
  const radius = strokeWidth / 2;
  return {
    minX: Math.min(...xs) - radius,
    minY: Math.min(...ys) - radius,
    maxX: Math.max(...xs) + radius,
    maxY: Math.max(...ys) + radius,
  };
}

/**
 * Геометрия одной tabular-цифры. `cell` задаёт одинаковый advance для 0..9;
 * отсутствие cell использует одну ячейку канонического calendar aperture.
 */
export function roundedDigitGeometry(digit, options = {}) {
  if (!Number.isInteger(digit) || digit < 0 || digit > 9) {
    throw new RangeError(`digit: integer 0..9; got ${String(digit)}`);
  }
  const parsedOptions = closedRecord(options, 'options', ['opsz', 'cell']);
  const opsz = parseOpsz(parsedOptions.opsz === undefined ? CALENDAR_OPSZ_RANGE.default : parsedOptions.opsz);
  const profile = opszProfile(opsz);
  const cell = parsedOptions.cell === undefined ? defaultCell(opsz) : parseCell(parsedOptions.cell);
  if (
    cell.width * opsz / CALENDAR_CANVAS_SIZE < MIN_CELL_PIXELS ||
    cell.height * opsz / CALENDAR_CANVAS_SIZE < MIN_CELL_PIXELS
  ) {
    throw new RangeError(`cell: меньше ${MIN_CELL_PIXELS}px на заявленном opsz`);
  }
  const strokeWidth = cell.height * profile.strokeRatio;
  const availableWidth = cell.width - strokeWidth;
  const availableHeight = cell.height - strokeWidth;
  if (availableWidth <= 0 || availableHeight <= 0) {
    throw new RangeError('cell: strokeWidth overflow');
  }

  const transform = {
    centerX: cell.centerX,
    centerY: cell.centerY,
    width: availableWidth * profile.skeletonWidthRatio,
    height: availableHeight,
  };
  const primitives = DIGIT_SKELETONS[digit](profile.detail)
    .map((primitive) => transformPrimitive(primitive, transform));
  const d = primitives.map(serializePrimitive).join('');

  return deepFreeze({
    digit,
    d,
    primitives,
    topologySignature: topologySignature(primitives),
    advanceWidth: cell.width,
    cell,
    inkBounds: controlBounds(primitives, strokeWidth),
    paint: {
      fill: 'none',
      stroke: 'currentColor',
      strokeWidth,
      linecap: 'round',
      linejoin: 'round',
    },
    axis: {
      opsz,
      masterInterval: MASTER_INTERVAL,
      topologyStable: true,
      profile,
    },
  });
}

function parseInstant(date) {
  let epochMilliseconds;
  try {
    // Прямой вызов builtin не позволяет Date-subclass подменить getTime().
    epochMilliseconds = Date.prototype.getTime.call(date);
  } catch {
    throw new TypeError('date: Date required');
  }
  if (!Number.isFinite(epochMilliseconds)) throw new RangeError('date: invalid');
  return epochMilliseconds;
}

function dayFormatter(timeZone) {
  if (typeof timeZone !== 'string' || timeZone.length === 0 || timeZone.trim() !== timeZone) {
    throw new TypeError('timeZone: IANA identifier');
  }
  // ECMA-402 implementations may accept raw offset identifiers (например,
  // +01:00), но public contract требует именованную IANA zone. При этом
  // Intl.supportedValuesOf('timeZone') не является полным allowlist: он не
  // перечисляет валидные tzdb IDs семейства Etc/GMT±N, которые formatter
  // корректно принимает и канонизирует.
  if (/^[+-]\d{2}:\d{2}(?::\d{2})?$/.test(timeZone)) {
    throw new RangeError(`timeZone: unsupported "${timeZone}"`);
  }
  try {
    const formatter = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone,
      day: 'numeric',
    });
    const resolved = formatter.resolvedOptions();
    if (resolved.calendar !== 'gregory' || resolved.numberingSystem !== 'latn') {
      throw new Error('Intl: gregory/latn ignored');
    }
    if (typeof resolved.timeZone !== 'string' || resolved.timeZone.length === 0) {
      throw new Error('Intl: canonical time zone absent');
    }
    return { formatter, canonicalTimeZone: resolved.timeZone };
  } catch (error) {
    throw new RangeError(`timeZone: unsupported "${timeZone}"`, { cause: error });
  }
}

/** Разрешает day-of-month из явно переданных instant + time zone. */
export function resolveCalendarDay(input) {
  const parsedInput = closedRecord(input, 'input', ['date', 'timeZone']);
  const epochMilliseconds = parseInstant(parsedInput.date);
  const { formatter, canonicalTimeZone } = dayFormatter(parsedInput.timeZone);
  const dayParts = formatter
    .formatToParts(new Date(epochMilliseconds))
    .filter(({ type }) => type === 'day');
  if (dayParts.length !== 1 || !/^\d{1,2}$/.test(dayParts[0].value)) {
    throw new Error('calendar day: ambiguous Intl value');
  }
  const day = Number(dayParts[0].value);
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error(`calendar day: outside 1..31 (${String(day)})`);
  }
  return deepFreeze({ day, epochMilliseconds, timeZone: canonicalTimeZone });
}

function unionBounds(parts) {
  return {
    minX: Math.min(...parts.map(({ inkBounds }) => inkBounds.minX)),
    minY: Math.min(...parts.map(({ inkBounds }) => inkBounds.minY)),
    maxX: Math.max(...parts.map(({ inkBounds }) => inkBounds.maxX)),
    maxY: Math.max(...parts.map(({ inkBounds }) => inkBounds.maxY)),
  };
}

/**
 * Собирает номер дня 1..31 и размещает tabular-слоты по центру aperture.
 * semantic id принадлежит слоту, digit — его текущему содержимому.
 */
export function buildCalendarNumberGeometry(input) {
  const parsedInput = closedRecord(input, 'input', ['date', 'timeZone', 'opsz', 'aperture']);
  const resolved = resolveCalendarDay({
    date: parsedInput.date,
    timeZone: parsedInput.timeZone,
  });
  const opsz = parseOpsz(parsedInput.opsz === undefined ? CALENDAR_OPSZ_RANGE.default : parsedInput.opsz);
  const aperture = parseAperture(parsedInput.aperture === undefined ? DEFAULT_CALENDAR_APERTURE : parsedInput.aperture);
  const profile = opszProfile(opsz);
  const limits = opticalLimits({ opsz });
  const layout = layoutTokens(
    aperture,
    profile,
    limits.minClearance * CALENDAR_CANVAS_SIZE,
  );
  const digits = String(resolved.day).split('').map(Number);
  const slots = digits.length === 1 ? ['ones'] : ['tens', 'ones'];
  const displayWidth = digits.length === 1 ? layout.cellWidth : aperture.width;
  const startCenterX = layout.centerX - displayWidth / 2 + layout.cellWidth / 2;

  const parts = digits.map((digit, index) => {
    const geometry = roundedDigitGeometry(digit, {
      opsz,
      cell: {
        centerX: startCenterX + index * (layout.cellWidth + layout.gap),
        centerY: layout.centerY,
        width: layout.cellWidth,
        height: aperture.height,
      },
    });
    return {
      id: SLOT_IDS[slots[index]],
      role: 'calendar-date-digit',
      slot: slots[index],
      ...geometry,
    };
  });
  const inkBounds = unionBounds(parts);
  const constraints = [negativeSpaceConstraint({
    kind: 'exterior-margin',
    requiredMinimum: limits.minClearance,
    measured: Math.min(
      inkBounds.minX,
      inkBounds.minY,
      CALENDAR_CANVAS_SIZE - inkBounds.maxX,
      CALENDAR_CANVAS_SIZE - inkBounds.maxY,
    ) / CALENDAR_CANVAS_SIZE,
    measurementMethod: 'ink-bounds-to-canvas',
    participants: [...parts.map(({ id }) => id), 'canvas'],
    name: 'calendarNumber.exteriorMargin',
  })];
  if (parts.length === 2) {
    constraints.push(negativeSpaceConstraint({
      kind: 'gap',
      requiredMinimum: limits.minClearance,
      measured: (parts[1].inkBounds.minX - parts[0].inkBounds.maxX)
        / CALENDAR_CANVAS_SIZE,
      measurementMethod: 'horizontal-ink-bounds-separation',
      participants: [parts[0].id, parts[1].id],
      name: 'calendarNumber.digitGap',
    }));
  }

  return deepFreeze({
    day: resolved.day,
    timeZone: resolved.timeZone,
    epochMilliseconds: resolved.epochMilliseconds,
    parts,
    negativeSpace: { constraints },
    axis: {
      opsz,
      masterInterval: MASTER_INTERVAL,
      topologyStableWithinInterval: true,
      profile,
    },
    layout: {
      aperture,
      center: { x: layout.centerX, y: layout.centerY },
      cellWidth: layout.cellWidth,
      gap: layout.gap,
      displayAdvanceWidth: displayWidth,
      inkBounds,
    },
  });
}
