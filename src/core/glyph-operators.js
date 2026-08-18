/**
 * Чистые операторы геометрических семейств Lab Icons.
 *
 * Координаты нормализованы в canvas 0..1. Операторы возвращают только данные:
 * path-геометрию, paint-контракт, стабильные part id и измеримые контрформы.
 * Здесь намеренно нет SVG DOM, текущего времени, IO и скрытого clamp: если
 * конфигурация нарушает оптический минимум или выходит из canvas, она не
 * становится «почти правильной», а отвергается.
 */

export const GLYPH_OPSZ_RANGE = Object.freeze({ min: 16, default: 24, max: 48 });

const UNIT_CANVAS = Object.freeze({ x: 0, y: 0, width: 1, height: 1 });
const NEGATIVE_SPACE_UNIT = 'normalized-canvas';
const EPSILON = 1e-9;
const SERIALIZATION_SCALE = 100_000_000;
const SQRT_HALF = Math.SQRT1_2;

function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

/**
 * Raster policy v1 — явное проектное допущение, не «физическая константа».
 * 1.5/1.25 px выбраны как консервативная нижняя граница устойчивого
 * antialias-пятна и counter при разных pixel phase; display-мастер допускает
 * больше физических пикселей при меньшей относительной толщине. Менять эти
 * числа можно только вместе с фазовым raster-ратчетом 16/20/24/32/48 px.
 */
export const GLYPH_RASTER_POLICY = deepFreeze({
  small: { strokePixels: 1.5, clearancePixels: 1.25, detailPixels: 1.25 },
  display: { strokePixels: 2, clearancePixels: 1.75, detailPixels: 1.5 },
});

/**
 * Авторский master v1 в одном SSOT. Это стартовые координаты рецептов, а не
 * запреты вариативности: каждый конструктивный параметр остаётся явным входом.
 * Изменять master следует по corpus-fit/observatory, не локальной подгонкой
 * одной иконки — так у констант сохраняется биография.
 */
export const GLYPH_OPERATOR_TOKENS = deepFreeze({
  shared: { weight: 0.075, margin: 0.05 },
  directional: { margin: 0.08, headLength: 0.22, headSpan: 0.3, shaftLength: 0.52 },
  strike: { angle: -45, overshoot: 0.03 },
  badge: { radius: 0.07 },
  rays: {
    bodyRadius: 0.18,
    count: 8,
    countMin: 4,
    countMax: 16,
    length: 0.5,
    rotation: -90,
    minimumLengthToWeight: 1,
  },
  note: {
    weight: 0.07,
    headCenterUp: { x: 0.42, y: 0.67 },
    headCenterDown: { x: 0.58, y: 0.33 },
    headRadiusX: 0.09,
    headRadiusY: 0.065,
    headAngle: -18,
    stemLength: 0.3,
    attachmentInset: 0.82,
    flagWidthToHead: 1.25,
    flagMinWidthToWeight: 1.5,
    flagDropToHead: 1.9,
    flagMinDropToWeight: 2,
    flagWeightRatio: 0.85,
    flagControl1Y: 0.12,
    flagControl2Y: 0.72,
    flagEndX: 0.2,
    beamThicknessRatio: 1.3,
  },
});

function record(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name}: ожидается объект`);
  }
  return value;
}

function closedRecord(value, name, allowedKeys) {
  const source = record(value, name);
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(source)) {
    if (!allowed.has(key)) throw new TypeError(`${name}.${key}: неизвестный параметр`);
  }
  return source;
}

function closedOptions(value, name, allowedKeys) {
  return closedRecord(value === undefined ? {} : value, name, allowedKeys);
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

function finite(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new TypeError(`${name}: number`);
  }
  return value;
}

function positive(value, name) {
  const result = finite(value, name);
  if (result <= 0) throw new RangeError(`${name}: > 0`);
  return result;
}

export {
  closedRecord as _closedRecord,
  deepFreeze as _deepFreeze,
  finite as _finite,
  negativeSpaceConstraint as _negativeSpaceConstraint,
  positive as _positive,
};

function nonNegative(value, name) {
  const result = finite(value, name);
  if (result < 0) throw new RangeError(`${name}: >= 0`);
  return result;
}

function interval(value, min, max, name) {
  const result = finite(value, name);
  if (result < min || result > max) {
    throw new RangeError(`${name}: ${min}..${max}; got ${result}`);
  }
  return result;
}

function integer(value, min, max, name) {
  const result = interval(value, min, max, name);
  if (!Number.isInteger(result)) throw new TypeError(`${name}: integer`);
  return result;
}

function oneOf(value, values, name) {
  if (!values.includes(value)) {
    throw new RangeError(`${name}: ${values.join('|')}; got ${String(value)}`);
  }
  return value;
}

function stableId(value, name = 'id') {
  if (typeof value !== 'string' || !/^[a-z][a-z0-9.-]*$/.test(value)) {
    throw new TypeError(`${name}: stable id`);
  }
  return value;
}

function point(value = { x: 0.5, y: 0.5 }, name = 'point') {
  const source = closedRecord(value, name, ['x', 'y']);
  return canonicalPoint({
    x: interval(source.x, 0, 1, `${name}.x`),
    y: interval(source.y, 0, 1, `${name}.y`),
  });
}

function bbox(value, name) {
  const source = closedRecord(value, name, ['x', 'y', 'width', 'height']);
  const x = interval(source.x, 0, 1, `${name}.x`);
  const y = interval(source.y, 0, 1, `${name}.y`);
  const width = positive(source.width, `${name}.width`);
  const height = positive(source.height, `${name}.height`);
  if (x + width > 1 + EPSILON) throw new RangeError(`${name}: canvas x`);
  if (y + height > 1 + EPSILON) throw new RangeError(`${name}: canvas y`);
  const minX = canonicalNumber(x);
  const minY = canonicalNumber(y);
  const maxX = canonicalNumber(x + width);
  const maxY = canonicalNumber(y + height);
  return {
    x: minX,
    y: minY,
    width: canonicalNumber(maxX - minX),
    height: canonicalNumber(maxY - minY),
    minX,
    minY,
    maxX,
    maxY,
  };
}

function parseOpsz(value = GLYPH_OPSZ_RANGE.default) {
  return interval(value, GLYPH_OPSZ_RANGE.min, GLYPH_OPSZ_RANGE.max, 'opsz');
}

/**
 * Не «масштаб» рисунка, а нижняя граница различимости на целевом кегле.
 * Число требуемых пикселей слегка растёт к display, но в нормализованных
 * координатах минимум закономерно уменьшается: большой растр выдерживает
 * более деликатный штрих и меньшую относительную контрформу.
 */
export function opticalLimits(options = {}) {
  const source = closedOptions(options, 'opticalLimits', ['opsz']);
  const resolvedOpsz = parseOpsz(source.opsz);
  const linear = (resolvedOpsz - GLYPH_OPSZ_RANGE.min)
    / (GLYPH_OPSZ_RANGE.max - GLYPH_OPSZ_RANGE.min);
  const t = linear * linear * (3 - 2 * linear);
  const strokePixels = GLYPH_RASTER_POLICY.small.strokePixels
    + (GLYPH_RASTER_POLICY.display.strokePixels - GLYPH_RASTER_POLICY.small.strokePixels) * t;
  const clearancePixels = GLYPH_RASTER_POLICY.small.clearancePixels
    + (GLYPH_RASTER_POLICY.display.clearancePixels - GLYPH_RASTER_POLICY.small.clearancePixels) * t;
  const detailPixels = GLYPH_RASTER_POLICY.small.detailPixels
    + (GLYPH_RASTER_POLICY.display.detailPixels - GLYPH_RASTER_POLICY.small.detailPixels) * t;
  return deepFreeze({
    opsz: resolvedOpsz,
    minStroke: strokePixels / resolvedOpsz,
    minClearance: clearancePixels / resolvedOpsz,
    minDetail: detailPixels / resolvedOpsz,
    raster: { strokePixels, clearancePixels, detailPixels },
  });
}

function weight(value, limits, nominal = GLYPH_OPERATOR_TOKENS.shared.weight, name = 'weight') {
  const resolved = value === undefined ? Math.max(nominal, limits.minStroke) : positive(value, name);
  if (resolved + EPSILON < limits.minStroke) {
    throw new RangeError(`${name}: ${resolved} < minStroke ${limits.minStroke}`);
  }
  return resolved;
}

function clearance(value, limits, name = 'clearance') {
  const resolved = value === undefined ? limits.minClearance : nonNegative(value, name);
  if (resolved + EPSILON < limits.minClearance) {
    throw new RangeError(`${name}: ${resolved} < minClearance ${limits.minClearance}`);
  }
  return resolved;
}

function margin(value = GLYPH_OPERATOR_TOKENS.shared.margin) {
  return interval(value, 0, 0.49, 'margin');
}

function serializationTick(value) {
  return Math.round(value * SERIALIZATION_SCALE);
}

function numberFromTick(value) {
  return value / SERIALIZATION_SCALE || 0;
}

function canonicalNumber(value) {
  return numberFromTick(serializationTick(value));
}

function canonicalPoint(value) {
  return { x: canonicalNumber(value.x), y: canonicalNumber(value.y) };
}

function pointDistance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function canonicalEllipse(cx, cy, rxInput, ryInput, rotationInput) {
  const centerXTick = serializationTick(cx);
  const centerYTick = serializationTick(cy);
  const center = { x: numberFromTick(centerXTick), y: numberFromTick(centerYTick) };
  const rx = canonicalNumber(rxInput);
  const ry = canonicalNumber(ryInput);
  const rotation = canonicalNumber(rotationInput);
  const radians = rotation * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  let dxTick = serializationTick(rx * cos);
  let dyTick = serializationTick(rx * sin);
  // λ≥1 заставляет SVG F.6.6 применить только равномерную radius correction:
  // две симметричные A-команды остаются точными полуэллипсами общего центра.
  if (rotation !== 0) {
    dxTick += Math.sign(dxTick);
    dyTick += Math.sign(dyTick);
  }
  const dx = numberFromTick(dxTick);
  const dy = numberFromTick(dyTick);
  const localX = cos * dx + sin * dy;
  const localY = -sin * dx + cos * dy;
  const scale = Math.hypot(localX / rx, localY / ry);
  const first = {
    x: numberFromTick(centerXTick + dxTick),
    y: numberFromTick(centerYTick + dyTick),
  };
  const opposite = {
    x: numberFromTick(centerXTick - dxTick),
    y: numberFromTick(centerYTick - dyTick),
  };
  const effectiveRx = rx * scale;
  const effectiveRy = ry * scale;
  const halfWidth = Math.hypot(effectiveRx * cos, effectiveRy * sin);
  const halfHeight = Math.hypot(effectiveRx * sin, effectiveRy * cos);
  const d = `M${first.x} ${first.y}`
    + `A${rx} ${ry} ${rotation} 1 0 ${opposite.x} ${opposite.y}`
    + `A${rx} ${ry} ${rotation} 1 0 ${first.x} ${first.y}Z`;
  return {
    d,
    center,
    rx: effectiveRx,
    ry: effectiveRy,
    bounds: {
      minX: center.x - halfWidth,
      minY: center.y - halfHeight,
      maxX: center.x + halfWidth,
      maxY: center.y + halfHeight,
    },
  };
}

function pathGeometry(d) {
  return { kind: 'path', d };
}

function canonicalPolyline(points, name) {
  const canonicalPoints = points.map(canonicalPoint);
  for (let index = 1; index < canonicalPoints.length; index++) {
    const previous = canonicalPoints[index - 1];
    const current = canonicalPoints[index];
    if (previous.x === current.x && previous.y === current.y) {
      throw new RangeError(`${name}: serialized zero`);
    }
  }
  return {
    d: canonicalPoints.map((value, index) => (
      `${index === 0 ? 'M' : 'L'}${value.x} ${value.y}`
    )).join(''),
    points: canonicalPoints,
    bounds: {
      minX: Math.min(...canonicalPoints.map(({ x }) => x)),
      minY: Math.min(...canonicalPoints.map(({ y }) => y)),
      maxX: Math.max(...canonicalPoints.map(({ x }) => x)),
      maxY: Math.max(...canonicalPoints.map(({ y }) => y)),
    },
  };
}

function serializedInkBounds(geometry, strokeWidth = 0) {
  const { minX, minY, maxX, maxY } = geometry.bounds;
  const half = strokeWidth / 2;
  return { minX: minX - half, minY: minY - half, maxX: maxX + half, maxY: maxY + half };
}

function assertBounds(value, requestedMargin, name) {
  if (
    value.minX < requestedMargin - EPSILON
    || value.minY < requestedMargin - EPSILON
    || value.maxX > 1 - requestedMargin + EPSILON
    || value.maxY > 1 - requestedMargin + EPSILON
  ) {
    throw new RangeError(`${name}: ink выходит за canvas с margin=${requestedMargin}`);
  }
  return value;
}

/**
 * Единственная граница negative-space proof. Возвращаемый объект не содержит
 * boolean verdict: провал не является допустимым состоянием результата и
 * останавливает построение recipe до публикации геометрии.
 */
function negativeSpaceConstraint({
  kind,
  requiredMinimum,
  measured,
  measurementMethod,
  participants,
  name = kind,
}) {
  if (typeof kind !== 'string' || kind.length === 0) {
    throw new TypeError(`${name}: negative-space kind`);
  }
  if (typeof measurementMethod !== 'string' || measurementMethod.length === 0) {
    throw new TypeError(`${name}: negative-space measurementMethod`);
  }
  if (!Array.isArray(participants) || participants.length < 2) {
    throw new TypeError(`${name}: negative-space participants`);
  }
  const namedParticipants = participants.map((participant, index) => (
    stableId(participant, `${name}.participants[${index}]`)
  ));
  const required = nonNegative(requiredMinimum, `${name}.requiredMinimum`);
  const actualInput = finite(measured, `${name}.measured`);
  const actual = Math.abs(actualInput) <= EPSILON ? 0 : actualInput;
  if (actual + EPSILON < required) {
    throw new RangeError(
      `${name}: negative-space measured ${actual} < requiredMinimum ${required}`,
    );
  }
  return {
    unit: NEGATIVE_SPACE_UNIT,
    kind,
    requiredMinimum: required,
    measured: actual,
    measurementMethod,
    participants: namedParticipants,
  };
}

function exteriorMargin(bounds) {
  if (!Array.isArray(bounds) || bounds.length === 0) {
    throw new TypeError('exteriorMargin: bounds');
  }
  return Math.min(...bounds.flatMap((value) => [
    value.minX,
    value.minY,
    1 - value.maxX,
    1 - value.maxY,
  ]));
}

function unionInkBounds(bounds) {
  if (!Array.isArray(bounds) || bounds.length === 0) {
    throw new TypeError('unionInkBounds: bounds');
  }
  return {
    minX: Math.min(...bounds.map(({ minX }) => minX)),
    minY: Math.min(...bounds.map(({ minY }) => minY)),
    maxX: Math.max(...bounds.map(({ maxX }) => maxX)),
    maxY: Math.max(...bounds.map(({ maxY }) => maxY)),
  };
}

/** Консервативная аналитическая дистанция между двумя ink AABB. */
function boundsSeparation(first, second) {
  const dx = Math.max(0, first.minX - second.maxX, second.minX - first.maxX);
  const dy = Math.max(0, first.minY - second.maxY, second.minY - first.maxY);
  return Math.hypot(dx, dy);
}

function strokePaint(strokeWidth, { linecap = 'round', linejoin = 'round' } = {}) {
  return { kind: 'stroke', fill: 'none', stroke: 'currentColor', strokeWidth, linecap, linejoin };
}

const DIRECTIONS = Object.freeze({
  forward: Object.freeze({ x: 1, y: 0 }),
  down: Object.freeze({ x: 0, y: 1 }),
  back: Object.freeze({ x: -1, y: 0 }),
  up: Object.freeze({ x: 0, y: -1 }),
});

function directionalParameters(source, { arrow }) {
  const opsz = parseOpsz(source.opsz);
  const limits = opticalLimits({ opsz });
  const resolvedWeight = weight(source.weight, limits);
  const resolvedClearance = clearance(source.clearance, limits);
  const headLength = canonicalNumber(positive(
    firstDefined(source.headLength, GLYPH_OPERATOR_TOKENS.directional.headLength),
    'headLength',
  ));
  const headSpan = canonicalNumber(positive(
    firstDefined(source.headSpan, GLYPH_OPERATOR_TOKENS.directional.headSpan),
    'headSpan',
  ));
  if (headSpan - resolvedWeight + EPSILON < resolvedClearance) {
    throw new RangeError('headSpan: clearance');
  }
  if (headLength + EPSILON < resolvedWeight + resolvedClearance) {
    throw new RangeError('headLength: minDetail');
  }
  const shaftLength = arrow
    ? canonicalNumber(positive(
      firstDefined(source.shaftLength, GLYPH_OPERATOR_TOKENS.directional.shaftLength),
      'shaftLength',
    ))
    : null;
  if (arrow && shaftLength + EPSILON < headLength + resolvedClearance) {
    throw new RangeError('shaftLength: head overlap');
  }
  return {
    orientation: oneOf(firstDefined(source.orientation, 'forward'), Object.keys(DIRECTIONS), 'orientation'),
    center: point(source.center, 'center'),
    margin: margin(firstDefined(source.margin, GLYPH_OPERATOR_TOKENS.directional.margin)),
    opsz,
    limits,
    weight: resolvedWeight,
    clearance: resolvedClearance,
    headLength,
    headSpan,
    shaftLength,
  };
}

function directionalHead(parameters, totalLength) {
  const direction = DIRECTIONS[parameters.orientation];
  const perpendicular = { x: -direction.y, y: direction.x };
  const tip = {
    x: parameters.center.x + direction.x * totalLength / 2,
    y: parameters.center.y + direction.y * totalLength / 2,
  };
  const base = {
    x: tip.x - direction.x * parameters.headLength,
    y: tip.y - direction.y * parameters.headLength,
  };
  const halfSpan = parameters.headSpan / 2;
  const first = {
    x: base.x - perpendicular.x * halfSpan,
    y: base.y - perpendicular.y * halfSpan,
  };
  const second = {
    x: base.x + perpendicular.x * halfSpan,
    y: base.y + perpendicular.y * halfSpan,
  };
  const headGeometry = canonicalPolyline([first, tip, second], 'head');
  const bounds = assertBounds(
    serializedInkBounds(headGeometry, parameters.weight),
    parameters.margin,
    'head.bounds',
  );
  return {
    part: {
      id: 'head',
      role: 'direction-head',
      geometry: pathGeometry(headGeometry.d),
      paint: strokePaint(parameters.weight),
      bbox: bounds,
      topologySignature: 'MLL',
    },
    tip: headGeometry.points[1],
    apertureEndpoints: [headGeometry.points[0], headGeometry.points[2]],
  };
}

/** Канонический chevron; ориентация — только поворот одной геометрии. */
export function buildDirectionalChevron(options = {}) {
  const source = closedOptions(options, 'directionalChevron', [
    'orientation', 'center', 'margin', 'opsz', 'weight', 'clearance', 'headLength', 'headSpan',
  ]);
  const parameters = directionalParameters(source, { arrow: false });
  const { part, apertureEndpoints } = directionalHead(parameters, parameters.headLength);
  const constraints = [
    negativeSpaceConstraint({
      kind: 'aperture',
      requiredMinimum: parameters.clearance,
      measured: pointDistance(apertureEndpoints[0], apertureEndpoints[1]) - parameters.weight,
      measurementMethod: 'polyline-endpoint-distance-minus-stroke',
      participants: ['head.start', 'head.end'],
      name: 'directionalChevron.headAperture',
    }),
    negativeSpaceConstraint({
      kind: 'exterior-margin',
      requiredMinimum: parameters.margin,
      measured: exteriorMargin([part.bbox]),
      measurementMethod: 'ink-bounds-to-canvas',
      participants: ['head', 'canvas'],
      name: 'directionalChevron.exteriorMargin',
    }),
  ];
  return deepFreeze({
    kind: 'directional-chevron',
    canvas: UNIT_CANVAS,
    orientation: parameters.orientation,
    parts: [part],
    negativeSpace: { constraints },
    metrics: {
      weight: parameters.weight,
      clearance: parameters.clearance,
      headLength: parameters.headLength,
      headSpan: parameters.headSpan,
      opsz: parameters.opsz,
    },
  });
}

/** Arrow буквально добавляет shaft к тому же head-рецепту. */
export function buildDirectionalArrow(options = {}) {
  const source = closedOptions(options, 'directionalArrow', [
    'orientation', 'center', 'margin', 'opsz', 'weight', 'clearance', 'headLength', 'headSpan', 'shaftLength',
  ]);
  const parameters = directionalParameters(source, { arrow: true });
  const direction = DIRECTIONS[parameters.orientation];
  const { part: head, tip, apertureEndpoints } = directionalHead(parameters, parameters.shaftLength);
  const tail = {
    x: parameters.center.x - direction.x * parameters.shaftLength / 2,
    y: parameters.center.y - direction.y * parameters.shaftLength / 2,
  };
  const shaftGeometry = canonicalPolyline([tail, tip], 'shaft');
  const canonicalTip = shaftGeometry.points[1];
  const shaftBounds = assertBounds(
    serializedInkBounds(shaftGeometry, parameters.weight),
    parameters.margin,
    'shaft.bounds',
  );
  const shaft = {
    id: 'shaft',
    role: 'direction-shaft',
    geometry: pathGeometry(shaftGeometry.d),
    paint: strokePaint(parameters.weight),
    bbox: shaftBounds,
    topologySignature: 'ML',
    weld: { to: 'head', at: canonicalTip },
  };
  const constraints = [
    negativeSpaceConstraint({
      kind: 'aperture',
      requiredMinimum: parameters.clearance,
      measured: pointDistance(apertureEndpoints[0], apertureEndpoints[1]) - parameters.weight,
      measurementMethod: 'polyline-endpoint-distance-minus-stroke',
      participants: ['head.start', 'head.end'],
      name: 'directionalArrow.headAperture',
    }),
    negativeSpaceConstraint({
      kind: 'exterior-margin',
      requiredMinimum: parameters.margin,
      measured: exteriorMargin([head.bbox, shaft.bbox]),
      measurementMethod: 'ink-bounds-to-canvas',
      participants: ['head', 'shaft', 'canvas'],
      name: 'directionalArrow.exteriorMargin',
    }),
  ];
  return deepFreeze({
    kind: 'directional-arrow',
    canvas: UNIT_CANVAS,
    orientation: parameters.orientation,
    parts: [head, shaft],
    negativeSpace: { constraints },
    joins: [{
      id: 'arrow.tip',
      at: canonicalTip,
      members: ['head', 'shaft'],
      // Centerline paths сами по себе не являются font-ready контурами.
      // Union после stroke expansion убирает зависимость результата от
      // порядка отрисовки, round-cap shaft и будущего target-компилятора.
      lowering: 'expand-strokes-then-union',
    }],
    metrics: {
      weight: parameters.weight,
      clearance: parameters.clearance,
      headLength: parameters.headLength,
      headSpan: parameters.headSpan,
      shaftLength: parameters.shaftLength,
      opsz: parameters.opsz,
    },
  });
}

/**
 * Окружность выводится из content keyline и гарантированного просвета до её
 * самого дальнего угла. Сам content оператор принципиально не рисует.
 */
export function decorateCircleEnclosure(options) {
  const source = closedOptions(options, 'circleEnclosure', [
    'contentKeyline', 'opsz', 'weight', 'clearance', 'margin',
  ]);
  const keyline = bbox(source.contentKeyline, 'contentKeyline');
  const opsz = parseOpsz(source.opsz);
  const limits = opticalLimits({ opsz });
  const resolvedWeight = weight(source.weight, limits);
  const resolvedClearance = clearance(source.clearance, limits);
  const resolvedMargin = margin(source.margin);
  const center = canonicalPoint({
    x: keyline.minX + (keyline.maxX - keyline.minX) / 2,
    y: keyline.minY + (keyline.maxY - keyline.minY) / 2,
  });
  const contentRadius = Math.hypot(keyline.width / 2, keyline.height / 2);
  const radius = contentRadius + resolvedClearance + resolvedWeight / 2;
  const safeRadius = radius + 1 / SERIALIZATION_SCALE;
  const circle = canonicalEllipse(center.x, center.y, safeRadius, safeRadius, 0);
  const bounds = assertBounds(
    serializedInkBounds(circle, resolvedWeight),
    resolvedMargin,
    'enclosure.bounds',
  );
  const part = {
    id: 'enclosure',
    role: 'container',
    geometry: pathGeometry(circle.d),
    paint: strokePaint(resolvedWeight),
    bbox: bounds,
    topologySignature: 'MAAZ',
  };
  const constraints = [
    negativeSpaceConstraint({
      kind: 'aperture',
      requiredMinimum: resolvedClearance,
      measured: circle.rx - resolvedWeight / 2 - contentRadius,
      measurementMethod: 'radial-farthest-corner-to-inner-stroke',
      participants: ['content-keyline', 'enclosure'],
      name: 'circleEnclosure.contentAperture',
    }),
    negativeSpaceConstraint({
      kind: 'exterior-margin',
      requiredMinimum: resolvedMargin,
      measured: exteriorMargin([part.bbox]),
      measurementMethod: 'ink-bounds-to-canvas',
      participants: ['enclosure', 'canvas'],
      name: 'circleEnclosure.exteriorMargin',
    }),
  ];
  return deepFreeze({
    kind: 'circle-enclosure',
    canvas: UNIT_CANVAS,
    contentKeyline: {
      x: keyline.x,
      y: keyline.y,
      width: keyline.width,
      height: keyline.height,
    },
    parts: [part],
    negativeSpace: { constraints },
    metrics: { center: circle.center, radius: circle.rx, weight: resolvedWeight, opsz },
  });
}

/**
 * Перечёркивание состоит из видимого штриха и явного subtract-коридора.
 * Это геометрическая операция композиции, а не opacity-трюк.
 */
export function decorateStrike(options) {
  const source = closedOptions(options, 'strike', [
    'targetBBox', 'opsz', 'weight', 'clearance', 'margin', 'overshoot', 'angle',
  ]);
  const target = bbox(source.targetBBox, 'targetBBox');
  const opsz = parseOpsz(source.opsz);
  const limits = opticalLimits({ opsz });
  if (Math.min(target.width, target.height) + EPSILON < limits.minDetail) {
    throw new RangeError(`targetBBox: меньше оптического минимума ${limits.minDetail}`);
  }
  const resolvedWeight = weight(source.weight, limits);
  const resolvedClearance = clearance(source.clearance, limits);
  const resolvedMargin = margin(source.margin);
  const overshoot = nonNegative(firstDefined(source.overshoot, GLYPH_OPERATOR_TOKENS.strike.overshoot), 'overshoot');
  const angle = interval(firstDefined(source.angle, GLYPH_OPERATOR_TOKENS.strike.angle), -180, 180, 'angle');
  const radians = angle * Math.PI / 180;
  const direction = { x: Math.cos(radians), y: Math.sin(radians) };
  const center = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  const projectedHalfExtent = Math.abs(direction.x) * target.width / 2
    + Math.abs(direction.y) * target.height / 2;
  const halfLength = projectedHalfExtent + overshoot;
  const from = {
    x: center.x - direction.x * halfLength,
    y: center.y - direction.y * halfLength,
  };
  const to = {
    x: center.x + direction.x * halfLength,
    y: center.y + direction.y * halfLength,
  };
  const serializedLine = canonicalPolyline([from, to], 'strike');
  const [canonicalFrom, canonicalTo] = serializedLine.points;
  const actualLength = pointDistance(canonicalFrom, canonicalTo);
  if (actualLength + EPSILON < limits.minDetail) {
    throw new RangeError('strike: minDetail');
  }
  const corridorWidth = resolvedWeight + 2 * resolvedClearance;
  const actualDirection = {
    x: (canonicalTo.x - canonicalFrom.x) / actualLength,
    y: (canonicalTo.y - canonicalFrom.y) / actualLength,
  };
  const corridorBounds = assertBounds(
    serializedInkBounds(serializedLine, corridorWidth),
    resolvedMargin,
    'strike.knockout.bounds',
  );
  const d = serializedLine.d;
  const part = {
    id: 'strike',
    role: 'modifier',
    geometry: pathGeometry(d),
    paint: strokePaint(resolvedWeight),
    bbox: serializedInkBounds(serializedLine, resolvedWeight),
    topologySignature: 'ML',
  };
  const knockout = {
    id: 'strike.knockout',
    operation: 'subtract',
    corridor: {
      geometry: pathGeometry(d),
      paint: strokePaint(corridorWidth),
      bbox: corridorBounds,
    },
  };
  const constraints = [
    negativeSpaceConstraint({
      kind: 'knockout',
      requiredMinimum: resolvedClearance,
      measured: (knockout.corridor.paint.strokeWidth - part.paint.strokeWidth) / 2,
      measurementMethod: 'concentric-stroke-half-width-difference',
      participants: ['strike', 'strike.knockout'],
      name: 'strike.knockoutClearance',
    }),
    negativeSpaceConstraint({
      kind: 'exterior-margin',
      requiredMinimum: resolvedMargin,
      measured: exteriorMargin([knockout.corridor.bbox]),
      measurementMethod: 'ink-bounds-to-canvas',
      participants: ['strike.knockout', 'canvas'],
      name: 'strike.exteriorMargin',
    }),
  ];
  return deepFreeze({
    kind: 'strike-decorator',
    canvas: UNIT_CANVAS,
    targetBBox: { x: target.x, y: target.y, width: target.width, height: target.height },
    parts: [part],
    negativeSpace: { constraints },
    masks: [knockout],
    compositionOrder: ['strike.knockout', 'strike'],
    metrics: {
      angle: Math.atan2(actualDirection.y, actualDirection.x) * 180 / Math.PI,
      overshoot: actualLength / 2 - (
        Math.abs(actualDirection.x) * target.width / 2
        + Math.abs(actualDirection.y) * target.height / 2
      ),
      weight: resolvedWeight,
      clearance: resolvedClearance,
      corridorWidth,
      opsz,
    },
  });
}

/** Badge лежит на внешней нормали top-right; зазор до угла keyline точен. */
export function placeNotificationBadge(options) {
  const source = closedOptions(options, 'notificationBadge', [
    'targetBBox', 'opsz', 'clearance', 'radius', 'margin',
  ]);
  const target = bbox(source.targetBBox, 'targetBBox');
  const opsz = parseOpsz(source.opsz);
  const limits = opticalLimits({ opsz });
  const resolvedClearance = clearance(source.clearance, limits);
  const radius = positive(firstDefined(source.radius, GLYPH_OPERATOR_TOKENS.badge.radius), 'radius');
  if (2 * radius + EPSILON < limits.minDetail) {
    throw new RangeError('radius: minDetail');
  }
  const resolvedMargin = margin(source.margin);
  const corner = { x: target.maxX, y: target.minY };
  const offset = radius + resolvedClearance + 1 / SERIALIZATION_SCALE;
  const center = {
    x: corner.x + SQRT_HALF * offset,
    y: corner.y - SQRT_HALF * offset,
  };
  const circle = canonicalEllipse(center.x, center.y, radius, radius, 0);
  const bounds = assertBounds(serializedInkBounds(circle), resolvedMargin, 'badge.bounds');
  const cornerToCenter = {
    x: circle.center.x - corner.x,
    y: circle.center.y - corner.y,
  };
  const centerDistance = Math.hypot(cornerToCenter.x, cornerToCenter.y);
  const actualClearance = centerDistance - circle.rx;
  const normal = {
    x: cornerToCenter.x / centerDistance,
    y: cornerToCenter.y / centerDistance,
  };
  const nearestBadgePoint = {
    x: circle.center.x - normal.x * circle.rx,
    y: circle.center.y - normal.y * circle.rx,
  };
  const part = {
    id: 'badge',
    role: 'notification',
    geometry: pathGeometry(circle.d),
    paint: { kind: 'fill', fill: 'currentColor' },
    bbox: bounds,
    topologySignature: 'MAAZ',
  };
  const constraints = [
    negativeSpaceConstraint({
      kind: 'gap',
      requiredMinimum: resolvedClearance,
      measured: actualClearance,
      measurementMethod: 'corner-to-ellipse-radial-distance',
      participants: ['target-bbox', 'badge'],
      name: 'notificationBadge.targetGap',
    }),
    negativeSpaceConstraint({
      kind: 'exterior-margin',
      requiredMinimum: resolvedMargin,
      measured: exteriorMargin([part.bbox]),
      measurementMethod: 'ink-bounds-to-canvas',
      participants: ['badge', 'canvas'],
      name: 'notificationBadge.exteriorMargin',
    }),
  ];
  return deepFreeze({
    kind: 'notification-badge',
    canvas: UNIT_CANVAS,
    targetBBox: { x: target.x, y: target.y, width: target.width, height: target.height },
    parts: [part],
    negativeSpace: { constraints },
    tangency: {
      normal,
      nearestTargetPoint: corner,
      nearestBadgePoint,
      clearance: actualClearance,
      requestedClearance: resolvedClearance,
    },
    metrics: { center: circle.center, radius: circle.rx, clearance: actualClearance, opsz },
  });
}

function normalizeDegrees(value) {
  const normalized = ((value % 360) + 360) % 360;
  return Math.abs(normalized - 360) < EPSILON ? 0 : normalized;
}

const COMPASS = Object.freeze([
  [0, 'e'],
  [45, 'se'],
  [90, 's'],
  [135, 'sw'],
  [180, 'w'],
  [225, 'nw'],
  [270, 'n'],
  [315, 'ne'],
]);

function rayId(index, count) {
  // Identity принадлежит topology slot, а не текущему world-angle: rotation
  // двигает тот же луч и не должна переименовывать part на каждом float tick.
  const canonicalAngle = GLYPH_OPERATOR_TOKENS.rays.rotation + index * 360 / count;
  const normalized = normalizeDegrees(canonicalAngle);
  for (const [degrees, label] of COMPASS) {
    if (Math.abs(normalized - degrees) < 1e-7) return `ray.${label}`;
  }
  return `ray.slot-${String(index).padStart(2, '0')}-of-${String(count).padStart(2, '0')}`;
}

/**
 * count меняет дискретную топологию, length — только длину тех же лучей.
 * Начало луча выводится из края sun body и контрформы; максимум — из margin.
 */
export function generateRadialRays(options = {}) {
  const source = closedOptions(options, 'radialRays', [
    'opsz', 'weight', 'clearance', 'margin', 'center', 'bodyRadius', 'count', 'length', 'rotation',
  ]);
  const opsz = parseOpsz(source.opsz);
  const limits = opticalLimits({ opsz });
  const resolvedWeight = weight(source.weight, limits);
  const resolvedClearance = clearance(source.clearance, limits);
  const resolvedMargin = margin(source.margin);
  const center = point(source.center, 'center');
  // 0.18 оставляет место различимому лучу даже у opsz=16 при честном
  // пиксельном минимуме; больший диск на этом кегле обязан уменьшить count.
  const bodyRadius = canonicalNumber(positive(
    firstDefined(source.bodyRadius, GLYPH_OPERATOR_TOKENS.rays.bodyRadius),
    'bodyRadius',
  ));
  const count = integer(
    firstDefined(source.count, GLYPH_OPERATOR_TOKENS.rays.count),
    GLYPH_OPERATOR_TOKENS.rays.countMin,
    GLYPH_OPERATOR_TOKENS.rays.countMax,
    'count',
  );
  const length = interval(firstDefined(source.length, GLYPH_OPERATOR_TOKENS.rays.length), 0, 1, 'length');
  const rotation = interval(firstDefined(source.rotation, GLYPH_OPERATOR_TOKENS.rays.rotation), -360, 360, 'rotation');
  const innerRadius = canonicalNumber(
    bodyRadius + resolvedClearance + resolvedWeight / 2 + 2 / SERIALIZATION_SCALE,
  );
  const outerCenterLimit = Math.min(
    center.x - resolvedMargin,
    1 - center.x - resolvedMargin,
    center.y - resolvedMargin,
    1 - center.y - resolvedMargin,
  ) - resolvedWeight / 2;
  const minimumRayLength = Math.max(
    limits.minDetail,
    resolvedWeight * GLYPH_OPERATOR_TOKENS.rays.minimumLengthToWeight,
  );
  const available = outerCenterLimit - innerRadius;
  if (available + EPSILON < minimumRayLength) {
    throw new RangeError('rays: minLength');
  }
  const countRatio = (resolvedWeight + resolvedClearance) / (2 * innerRadius);
  const maxCountForClearance = countRatio >= 1
    ? 0
    : Math.floor(Math.PI / Math.asin(countRatio) + EPSILON);
  const adjacentGap = 2 * innerRadius * Math.sin(Math.PI / count) - resolvedWeight;
  if (adjacentGap + EPSILON < resolvedClearance) {
    throw new RangeError('count: clearance');
  }
  const rayLength = canonicalNumber(
    minimumRayLength + length * (available - minimumRayLength)
      + (1 - length) * 2 / SERIALIZATION_SCALE,
  );
  const outerRadius = canonicalNumber(innerRadius + rayLength);
  const parts = [];
  const rayPoints = [];
  for (let index = 0; index < count; index++) {
    const angle = rotation + index * 360 / count;
    const radians = angle * Math.PI / 180;
    const direction = { x: Math.cos(radians), y: Math.sin(radians) };
    const from = {
      x: center.x + direction.x * innerRadius,
      y: center.y + direction.y * innerRadius,
    };
    const to = {
      x: center.x + direction.x * outerRadius,
      y: center.y + direction.y * outerRadius,
    };
    const id = rayId(index, count);
    const rayGeometry = canonicalPolyline([from, to], id);
    const [canonicalFrom, canonicalTo] = rayGeometry.points;
    rayPoints.push(rayGeometry.points);
    parts.push({
      id,
      role: 'ray',
      angle: normalizeDegrees(Math.atan2(
        canonicalTo.y - canonicalFrom.y,
        canonicalTo.x - canonicalFrom.x,
      ) * 180 / Math.PI),
      geometry: pathGeometry(rayGeometry.d),
      paint: strokePaint(resolvedWeight),
      bbox: assertBounds(
        serializedInkBounds(rayGeometry, resolvedWeight),
        resolvedMargin,
        `${id}.bounds`,
      ),
      topologySignature: 'ML',
    });
  }
  const innerRadii = rayPoints.map(([from]) => pointDistance(center, from));
  const actualInnerRadius = Math.min(...innerRadii);
  const actualOuterRadius = Math.max(...rayPoints.map(([, to]) => pointDistance(center, to)));
  const actualRayLength = Math.min(...rayPoints.map(([from, to]) => pointDistance(from, to)));
  const adjacentGaps = rayPoints.map(([from], index) => (
    pointDistance(from, rayPoints[(index + 1) % count][0]) - resolvedWeight
  ));
  const actualAdjacentGap = Math.min(...adjacentGaps);
  const actualBodyGap = actualInnerRadius - resolvedWeight / 2 - bodyRadius;
  if (
    actualBodyGap + EPSILON < resolvedClearance
    || actualAdjacentGap + EPSILON < resolvedClearance
    || actualRayLength + EPSILON < minimumRayLength
  ) throw new RangeError('rays: post-lattice minimum');
  const bodyGapIndex = innerRadii.indexOf(actualInnerRadius);
  const adjacentGapIndex = adjacentGaps.indexOf(actualAdjacentGap);
  const constraints = [
    negativeSpaceConstraint({
      kind: 'gap',
      requiredMinimum: resolvedClearance,
      measured: actualBodyGap,
      measurementMethod: 'radial-centerline-to-body-minus-half-stroke',
      participants: ['sun-body', parts[bodyGapIndex].id],
      name: 'radialRays.bodyGap',
    }),
    negativeSpaceConstraint({
      kind: 'gap',
      requiredMinimum: resolvedClearance,
      measured: actualAdjacentGap,
      measurementMethod: 'adjacent-inner-endpoint-chord-minus-stroke',
      participants: [
        parts[adjacentGapIndex].id,
        parts[(adjacentGapIndex + 1) % count].id,
      ],
      name: 'radialRays.adjacentGap',
    }),
    negativeSpaceConstraint({
      kind: 'exterior-margin',
      requiredMinimum: resolvedMargin,
      measured: exteriorMargin(parts.map(({ bbox: partBounds }) => partBounds)),
      measurementMethod: 'ink-bounds-to-canvas',
      participants: [...parts.map(({ id }) => id), 'canvas'],
      name: 'radialRays.exteriorMargin',
    }),
  ];
  return deepFreeze({
    kind: 'radial-rays',
    canvas: UNIT_CANVAS,
    topologyKey: `rays:${count}`,
    parts,
    negativeSpace: { constraints },
    metrics: {
      center,
      bodyRadius,
      innerRadius: actualInnerRadius,
      outerRadius: actualOuterRadius,
      rayLength: actualRayLength,
      length,
      count,
      maxCountForClearance,
      rotation,
      weight: resolvedWeight,
      clearance: resolvedClearance,
      opsz,
    },
  });
}

function noteRecipe(source, common = {}) {
  const id = stableId(firstDefined(source.id, common.id, 'note'), 'note.id');
  const opsz = parseOpsz(firstDefined(source.opsz, common.opsz));
  const limits = opticalLimits({ opsz });
  const resolvedWeight = weight(firstDefined(source.weight, common.weight), limits, GLYPH_OPERATOR_TOKENS.note.weight);
  const resolvedMargin = margin(firstDefined(source.margin, common.margin));
  const stemDirection = oneOf(firstDefined(source.stemDirection, common.stemDirection, 'up'), ['up', 'down'], `${id}.stemDirection`);
  const defaultHeadCenter = stemDirection === 'up'
    ? GLYPH_OPERATOR_TOKENS.note.headCenterUp
    : GLYPH_OPERATOR_TOKENS.note.headCenterDown;
  const headCenter = point(
    firstDefined(source.headCenter, common.headCenter, defaultHeadCenter),
    `${id}.headCenter`,
  );
  const rx = canonicalNumber(positive(
    firstDefined(source.headRadiusX, common.headRadiusX, GLYPH_OPERATOR_TOKENS.note.headRadiusX),
    `${id}.headRadiusX`,
  ));
  const ry = canonicalNumber(positive(
    firstDefined(source.headRadiusY, common.headRadiusY, GLYPH_OPERATOR_TOKENS.note.headRadiusY),
    `${id}.headRadiusY`,
  ));
  if (2 * Math.min(rx, ry) + EPSILON < limits.minDetail) {
    throw new RangeError(`${id}.head: minDetail`);
  }
  const headAngle = canonicalNumber(interval(
    firstDefined(source.headAngle, common.headAngle, GLYPH_OPERATOR_TOKENS.note.headAngle),
    -90,
    90,
    `${id}.headAngle`,
  ));
  const stemLength = canonicalNumber(positive(
    firstDefined(source.stemLength, common.stemLength, GLYPH_OPERATOR_TOKENS.note.stemLength),
    `${id}.stemLength`,
  ));
  if (stemLength + EPSILON < Math.max(limits.minDetail * 2, ry * 2)) {
    throw new RangeError(`${id}.stemLength: head overlap`);
  }
  const hasFlag = firstDefined(source.flag, common.flag, true);
  if (typeof hasFlag !== 'boolean') throw new TypeError(`${id}.flag: boolean`);

  const attachment = (stemDirection === 'up' ? 1 : -1)
    * rx * GLYPH_OPERATOR_TOKENS.note.attachmentInset;
  const headRadians = headAngle * Math.PI / 180;
  const requestedStemBottom = {
    x: headCenter.x + attachment * Math.cos(headRadians),
    y: headCenter.y + attachment * Math.sin(headRadians),
  };
  const stemSign = stemDirection === 'up' ? -1 : 1;
  const stemGeometry = canonicalPolyline([
    requestedStemBottom,
    { x: requestedStemBottom.x, y: requestedStemBottom.y + stemSign * stemLength },
  ], `${id}.stem`);
  const [stemBottom, stemTop] = stemGeometry.points;
  const headGeometry = canonicalEllipse(headCenter.x, headCenter.y, rx, ry, headAngle);
  const headBounds = assertBounds(
    serializedInkBounds(headGeometry),
    resolvedMargin,
    `${id}.head.bounds`,
  );
  const stemBounds = assertBounds(
    serializedInkBounds(stemGeometry, resolvedWeight),
    resolvedMargin,
    `${id}.stem.bounds`,
  );
  const parts = [
    {
      id: `${id}.head`,
      role: 'note-head',
      geometry: pathGeometry(headGeometry.d),
      paint: { kind: 'fill', fill: 'currentColor' },
      bbox: headBounds,
      topologySignature: 'MAAZ',
    },
    {
      id: `${id}.stem`,
      role: 'note-stem',
      geometry: pathGeometry(stemGeometry.d),
      paint: strokePaint(resolvedWeight),
      bbox: stemBounds,
      topologySignature: 'ML',
    },
  ];
  if (hasFlag) {
    const curlY = -stemSign;
    const curlX = stemDirection === 'up' ? 1 : -1;
    const flagWidth = Math.max(
      rx * GLYPH_OPERATOR_TOKENS.note.flagWidthToHead,
      resolvedWeight * GLYPH_OPERATOR_TOKENS.note.flagMinWidthToWeight,
    );
    const flagDrop = Math.max(
      ry * GLYPH_OPERATOR_TOKENS.note.flagDropToHead,
      resolvedWeight * GLYPH_OPERATOR_TOKENS.note.flagMinDropToWeight,
    );
    const control1 = canonicalPoint({
      x: stemTop.x + curlX * flagWidth,
      y: stemTop.y + curlY * flagDrop * GLYPH_OPERATOR_TOKENS.note.flagControl1Y,
    });
    const control2 = canonicalPoint({
      x: stemTop.x + curlX * flagWidth,
      y: stemTop.y + curlY * flagDrop * GLYPH_OPERATOR_TOKENS.note.flagControl2Y,
    });
    const flagEnd = canonicalPoint({
      x: stemTop.x + curlX * resolvedWeight * GLYPH_OPERATOR_TOKENS.note.flagEndX,
      y: stemTop.y + curlY * flagDrop,
    });
    const flagWeight = Math.max(
      limits.minStroke,
      resolvedWeight * GLYPH_OPERATOR_TOKENS.note.flagWeightRatio,
    );
    const firstLeg = Math.sqrt(Math.abs(control1.x - stemTop.x));
    const secondLeg = Math.sqrt(Math.abs(control1.x - flagEnd.x));
    const t = firstLeg / (firstLeg + secondLeg);
    const inverse = 1 - t;
    const extremeX = inverse ** 3 * stemTop.x
      + 3 * inverse * t * control1.x
      + t ** 3 * flagEnd.x;
    const flagGeometry = {
      d: `M${stemTop.x} ${stemTop.y}C${control1.x} ${control1.y} `
        + `${control2.x} ${control2.y} ${flagEnd.x} ${flagEnd.y}`,
      bounds: {
        minX: Math.min(stemTop.x, flagEnd.x, extremeX),
        minY: Math.min(stemTop.y, flagEnd.y),
        maxX: Math.max(stemTop.x, flagEnd.x, extremeX),
        maxY: Math.max(stemTop.y, flagEnd.y),
      },
    };
    const flagBounds = assertBounds(
      serializedInkBounds(flagGeometry, flagWeight),
      resolvedMargin,
      `${id}.flag.bounds`,
    );
    parts.push({
      id: `${id}.flag`,
      role: 'note-flag',
      geometry: pathGeometry(flagGeometry.d),
      paint: strokePaint(flagWeight),
      bbox: flagBounds,
      topologySignature: 'MC',
    });
  }
  const constraints = [negativeSpaceConstraint({
    kind: 'exterior-margin',
    requiredMinimum: resolvedMargin,
    measured: exteriorMargin(parts.map(({ bbox: partBounds }) => partBounds)),
    measurementMethod: 'ink-bounds-to-canvas',
    participants: [...parts.map(({ id: partId }) => partId), 'canvas'],
    name: `${id}.exteriorMargin`,
  })];
  return {
    id,
    parts,
    constraints,
    anchors: { headCenter, stemBottom, stemTop },
    metrics: {
      opsz,
      weight: resolvedWeight,
      headRadiusX: headGeometry.rx,
      headRadiusY: headGeometry.ry,
      headAngle,
      stemDirection,
      stemLength: Math.abs(stemTop.y - stemBottom.y),
      flag: hasFlag,
      margin: resolvedMargin,
    },
  };
}

/** Одна нота и композиция ниже используют один и тот же noteRecipe. */
export function buildMusicalNote(options = {}) {
  const source = closedOptions(options, 'musicalNote', [
    'id', 'opsz', 'weight', 'margin', 'headCenter', 'headRadiusX', 'headRadiusY',
    'headAngle', 'stemDirection', 'stemLength', 'flag',
  ]);
  const recipe = noteRecipe(source);
  return deepFreeze({
    kind: 'musical-note',
    canvas: UNIT_CANVAS,
    topologyKey: `note:${recipe.metrics.flag ? 'flag' : 'plain'}`,
    parts: recipe.parts,
    negativeSpace: { constraints: recipe.constraints },
    anchors: recipe.anchors,
    metrics: recipe.metrics,
  });
}

/**
 * Несколько нот получают собственные semantic id, но ту же анатомию head/stem.
 * Beam дискретен: его наличие меняет topologyKey, а не маскируется нулевой
 * толщиной. Порядок входа не мутируется; beam строится слева направо по копии.
 */
export function buildMusicalNotes(options) {
  const source = closedOptions(options, 'musicalNotes', [
    'notes', 'beam', 'opsz', 'weight', 'margin', 'headRadiusX', 'headRadiusY',
    'headAngle', 'stemLength', 'stemDirection', 'beamThickness',
  ]);
  if (!Array.isArray(source.notes) || source.notes.length < 2 || source.notes.length > 4) {
    throw new RangeError('notes: 2..4 recipes');
  }
  const beam = firstDefined(source.beam, true);
  if (typeof beam !== 'boolean') throw new TypeError('beam: boolean');
  const common = {
    opsz: source.opsz,
    weight: source.weight,
    margin: source.margin,
    headRadiusX: source.headRadiusX,
    headRadiusY: source.headRadiusY,
    headAngle: source.headAngle,
    stemLength: source.stemLength,
    stemDirection: source.stemDirection,
  };
  const ids = new Set();
  const recipes = source.notes.map((value, index) => {
    const note = closedRecord(value, `notes[${index}]`, [
      'id', 'opsz', 'weight', 'margin', 'headCenter', 'headRadiusX', 'headRadiusY',
      'headAngle', 'stemDirection', 'stemLength', 'flag',
    ]);
    if (note.flag !== undefined && typeof note.flag !== 'boolean') {
      throw new TypeError(`notes[${index}].flag: boolean`);
    }
    const id = stableId(note.id, `notes[${index}].id`);
    if (ids.has(id)) throw new Error(`notes: повторный id ${id}`);
    ids.add(id);
    return noteRecipe({ ...note, id, flag: beam ? false : firstDefined(note.flag, true) }, common);
  });
  if (beam && new Set(recipes.map(({ metrics }) => metrics.stemDirection)).size !== 1) {
    throw new RangeError('beam: направление');
  }
  const parts = recipes.flatMap((recipe) => recipe.parts);
  let beamPart = null;
  if (beam) {
    const ordered = [...recipes].sort((left, right) => left.anchors.stemTop.x - right.anchors.stemTop.x);
    const beamGeometry = canonicalPolyline(
      ordered.map(({ anchors }) => anchors.stemTop),
      'beam',
    );
    for (let index = 1; index < ordered.length; index++) {
      if (beamGeometry.points[index].x === beamGeometry.points[index - 1].x) {
        throw new RangeError('beam: serialized x');
      }
    }
    const opsz = recipes[0].metrics.opsz;
    if (recipes.some((recipe) => Math.abs(recipe.metrics.opsz - opsz) > EPSILON)) {
      throw new RangeError('notes: mixed opsz');
    }
    const limits = opticalLimits({ opsz });
    const beamThickness = weight(
      source.beamThickness,
      limits,
      Math.max(...recipes.map((recipe) => recipe.metrics.weight))
        * GLYPH_OPERATOR_TOKENS.note.beamThicknessRatio,
      'beamThickness',
    );
    const beamPoints = beamGeometry.points;
    const beamBounds = assertBounds(
      serializedInkBounds(beamGeometry, beamThickness),
      Math.max(...recipes.map((recipe) => recipe.metrics.margin)),
      'beam.bounds',
    );
    beamPart = {
      id: 'beam',
      role: 'note-beam',
      geometry: pathGeometry(beamGeometry.d),
      paint: strokePaint(beamThickness, { linecap: 'butt' }),
      bbox: beamBounds,
      topologySignature: `M${'L'.repeat(beamPoints.length - 1)}`,
    };
    parts.push(beamPart);
  }
  const partIds = parts.map(({ id }) => id);
  if (new Set(partIds).size !== partIds.length) throw new Error('notes: duplicate part id');
  const recipeBounds = recipes.map((recipe) => unionInkBounds(
    recipe.parts.map(({ bbox: partBounds }) => partBounds),
  ));
  const constraints = recipes.flatMap((recipe) => recipe.constraints);
  for (let firstIndex = 0; firstIndex < recipes.length; firstIndex++) {
    for (let secondIndex = firstIndex + 1; secondIndex < recipes.length; secondIndex++) {
      const first = recipes[firstIndex];
      const second = recipes[secondIndex];
      constraints.push(negativeSpaceConstraint({
        kind: 'gap',
        requiredMinimum: Math.max(
          opticalLimits({ opsz: first.metrics.opsz }).minClearance,
          opticalLimits({ opsz: second.metrics.opsz }).minClearance,
        ),
        measured: boundsSeparation(recipeBounds[firstIndex], recipeBounds[secondIndex]),
        measurementMethod: 'axis-aligned-group-bounds-separation',
        participants: [first.id, second.id],
        name: `musicalNotes.${first.id}.${second.id}Gap`,
      }));
    }
  }
  if (beamPart) {
    const requiredMargin = Math.max(...recipes.map((recipe) => recipe.metrics.margin));
    constraints.push(negativeSpaceConstraint({
      kind: 'exterior-margin',
      requiredMinimum: requiredMargin,
      measured: exteriorMargin([beamPart.bbox]),
      measurementMethod: 'ink-bounds-to-canvas',
      participants: ['beam', 'canvas'],
      name: 'musicalNotes.beamExteriorMargin',
    }));
  }
  return deepFreeze({
    kind: 'musical-notes',
    canvas: UNIT_CANVAS,
    topologyKey: `notes:${recipes.length}:${beam ? 'beam' : `flags-${recipes.map(({ metrics }) => (
      metrics.flag ? '1' : '0'
    )).join('')}`}`,
    parts,
    negativeSpace: { constraints },
    notes: recipes.map(({ id, anchors, metrics }) => ({ id, anchors, metrics })),
  });
}
