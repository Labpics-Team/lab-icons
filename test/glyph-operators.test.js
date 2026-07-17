import { describe, expect, it } from 'vitest';
import { parsePathData, pathBBox, samplePath } from '../scripts/lib/path-data.js';
import {
  GLYPH_OPSZ_RANGE,
  GLYPH_OPERATOR_TOKENS,
  GLYPH_RASTER_POLICY,
  buildDirectionalArrow,
  buildDirectionalChevron,
  buildMusicalNote,
  buildMusicalNotes,
  decorateCircleEnclosure,
  decorateStrike,
  generateRadialRays,
  opticalLimits,
  placeNotificationBadge,
} from '../scripts/lib/glyph-operators.js';

const NEGATIVE_SPACE_KEYS = [
  'kind',
  'measured',
  'measurementMethod',
  'participants',
  'requiredMinimum',
  'unit',
];

function constraintByMethod(result, measurementMethod) {
  const matches = result.negativeSpace.constraints.filter((constraint) => (
    constraint.measurementMethod === measurementMethod
  ));
  expect(matches, measurementMethod).toHaveLength(1);
  return matches[0];
}

function expectNegativeSpaceContract(result) {
  expect(Object.isFrozen(result.negativeSpace)).toBe(true);
  expect(Object.isFrozen(result.negativeSpace.constraints)).toBe(true);
  expect(result.negativeSpace.constraints.length).toBeGreaterThan(0);
  for (const constraint of result.negativeSpace.constraints) {
    expect(Object.keys(constraint).sort()).toEqual(NEGATIVE_SPACE_KEYS);
    expect(constraint.unit).toBe('normalized-canvas');
    expect(Number.isFinite(constraint.requiredMinimum)).toBe(true);
    expect(Number.isFinite(constraint.measured)).toBe(true);
    expect(constraint.measured + 1e-9).toBeGreaterThanOrEqual(constraint.requiredMinimum);
    expect(constraint.participants.length).toBeGreaterThanOrEqual(2);
    expect(Object.isFrozen(constraint)).toBe(true);
    expect(Object.isFrozen(constraint.participants)).toBe(true);
    expect(constraint).not.toHaveProperty('pass');
    expect(constraint).not.toHaveProperty('status');
  }
}

function expectFiniteGeometry(result) {
  expect(JSON.stringify(result).toLowerCase()).not.toMatch(/nan|infinity|null/);
  for (const part of result.parts) {
    expect(part.geometry.d).toMatch(/^M/);
    expect(parsePathData(part.geometry.d).map(({ cmd }) => cmd).join('')).toBe(part.topologySignature);
    expect(part.bbox.minX).toBeGreaterThanOrEqual(-1e-9);
    expect(part.bbox.minY).toBeGreaterThanOrEqual(-1e-9);
    expect(part.bbox.maxX).toBeLessThanOrEqual(1 + 1e-9);
    expect(part.bbox.maxY).toBeLessThanOrEqual(1 + 1e-9);
  }
  expectNegativeSpaceContract(result);
}

function serializedInkBounds(part) {
  const bounds = pathBBox(part.geometry.d);
  const halfStroke = part.paint.kind === 'stroke' ? part.paint.strokeWidth / 2 : 0;
  return {
    minX: bounds.minX - halfStroke,
    minY: bounds.minY - halfStroke,
    maxX: bounds.maxX + halfStroke,
    maxY: bounds.maxY + halfStroke,
  };
}

function expectCanonicalPartBounds(result) {
  for (const part of result.parts) {
    const oracle = serializedInkBounds(part);
    for (const key of ['minX', 'minY', 'maxX', 'maxY']) {
      expect(Math.abs(part.bbox[key] - oracle[key])).toBeLessThanOrEqual(1e-8);
    }
  }
}

describe('оптический профиль', () => {
  it('задаёт реальный raster minimum, а не масштабирует всю иконку', () => {
    expect(GLYPH_OPSZ_RANGE).toEqual({ min: 16, default: 24, max: 48 });
    expect(Object.isFrozen(GLYPH_RASTER_POLICY)).toBe(true);
    expect(Object.isFrozen(GLYPH_OPERATOR_TOKENS.note)).toBe(true);
    const small = opticalLimits({ opsz: 16 });
    const display = opticalLimits({ opsz: 48 });
    expect(small.minStroke).toBeGreaterThan(display.minStroke);
    expect(small.minClearance).toBeGreaterThan(display.minClearance);
    expect(display.raster.strokePixels).toBeGreaterThan(small.raster.strokePixels);
  });

  it.each([15.99, 48.01, Number.NaN, '24'])('не clamp-ит hostile opsz %s', (opsz) => {
    expect(() => opticalLimits({ opsz })).toThrow('opsz');
  });

  it('отличает отсутствующий optional input от явного null', () => {
    expect(() => opticalLimits({ opsz: null })).toThrow('opsz');
    expect(() => buildDirectionalArrow(null)).toThrow('ожидается объект');
  });
});

describe('единый negative-space contract', () => {
  it('присутствует у каждого публичного geometry builder без boolean verdict', () => {
    const results = [
      buildDirectionalChevron(),
      buildDirectionalArrow(),
      decorateCircleEnclosure({
        contentKeyline: { x: 0.38, y: 0.4, width: 0.24, height: 0.2 },
        margin: 0.02,
      }),
      decorateStrike({
        targetBBox: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
        margin: 0.04,
      }),
      placeNotificationBadge({
        targetBBox: { x: 0.25, y: 0.3, width: 0.4, height: 0.4 },
        margin: 0.02,
      }),
      generateRadialRays(),
      buildMusicalNote(),
      buildMusicalNotes({
        notes: [
          { id: 'left', headCenter: { x: 0.33, y: 0.68 } },
          { id: 'right', headCenter: { x: 0.62, y: 0.58 } },
        ],
      }),
    ];

    for (const result of results) expectNegativeSpaceContract(result);
  });

  it('property-ish: measured выводится из изменившейся геометрии', () => {
    const headApertures = [0.24, 0.3, 0.36].map((headSpan) => constraintByMethod(
      buildDirectionalChevron({ headSpan }),
      'polyline-endpoint-distance-minus-stroke',
    ).measured);
    expect(headApertures).toEqual([...headApertures].sort((a, b) => a - b));

    const noteMargins = [0.42, 0.5, 0.58].map((x) => constraintByMethod(
      buildMusicalNote({ headCenter: { x, y: 0.67 } }),
      'ink-bounds-to-canvas',
    ).measured);
    expect(new Set(noteMargins).size).toBeGreaterThan(1);

    const noteGaps = [0.62, 0.66, 0.7].map((rightX) => constraintByMethod(
      buildMusicalNotes({
        notes: [
          { id: 'left', headCenter: { x: 0.33, y: 0.68 } },
          { id: 'right', headCenter: { x: rightX, y: 0.58 } },
        ],
      }),
      'axis-aligned-group-bounds-separation',
    ).measured);
    expect(noteGaps).toEqual([...noteGaps].sort((a, b) => a - b));
  });

  it('не представляет recipe, если построенные bounds не сохраняют minimum', () => {
    expect(() => buildMusicalNotes({
      notes: [
        { id: 'left', headCenter: { x: 0.42, y: 0.68 } },
        { id: 'right', headCenter: { x: 0.5, y: 0.58 } },
      ],
    })).toThrow(/negative-space measured .* requiredMinimum/);
    expect(() => buildDirectionalChevron({
      center: { x: 0.95, y: 0.5 },
    })).toThrow('bounds');
  });
});

describe('directional head + shaft', () => {
  it('arrow вырастает из того же head и получает стабильный shaft', () => {
    const chevron = buildDirectionalChevron({ orientation: 'forward' });
    const arrow = buildDirectionalArrow({ orientation: 'forward' });
    expect(chevron.parts.map(({ id }) => id)).toEqual(['head']);
    expect(arrow.parts.map(({ id }) => id)).toEqual(['head', 'shaft']);
    expect(arrow.parts.map(({ topologySignature }) => topologySignature)).toEqual(['MLL', 'ML']);
    expect(arrow.joins).toEqual([{
      id: 'arrow.tip',
      at: arrow.parts[1].weld.at,
      members: ['head', 'shaft'],
      lowering: 'expand-strokes-then-union',
    }]);
    expectFiniteGeometry(chevron);
    expectFiniteGeometry(arrow);
  });

  it('orientation является точным поворотом, а не четырьмя рисунками', () => {
    const arrows = ['forward', 'down', 'back', 'up'].map((orientation) =>
      buildDirectionalArrow({ orientation, center: { x: 0.5, y: 0.5 } }));
    const [forward, down, back, up] = arrows;
    expect(forward.parts[1].weld.at.x).toBeCloseTo(0.76, 12);
    expect(down.parts[1].weld.at.y).toBeCloseTo(0.76, 12);
    expect(back.parts[1].weld.at.x).toBeCloseTo(0.24, 12);
    expect(up.parts[1].weld.at.y).toBeCloseTo(0.24, 12);
    for (const arrow of arrows) expectFiniteGeometry(arrow);
  });

  it('property-ish: допустимые opsz/веса/повороты всегда конечны и в canvas', () => {
    for (const opsz of [16, 20, 24, 32, 48]) {
      for (const orientation of ['forward', 'down', 'back', 'up']) {
        for (const shaftLength of [0.38, 0.52, 0.64]) {
          expectFiniteGeometry(buildDirectionalArrow({ opsz, orientation, shaftLength, margin: 0.04 }));
        }
      }
    }
  });

  it('длина shaft гибкая и не меняет identity/topology частей', () => {
    const lengths = [0.35, 0.42, 0.52, 0.64];
    const samples = lengths.map((shaftLength) => buildDirectionalArrow({ shaftLength, margin: 0.04 }));
    expect(samples.map(({ parts }) => parts.map(({ id }) => id))).toEqual(
      lengths.map(() => ['head', 'shaft']),
    );
    expect(samples.map(({ metrics }) => metrics.shaftLength)).toEqual(lengths);
  });

  it('join и weld указывают на общий endpoint сериализованных head/shaft', () => {
    const arrow = buildDirectionalArrow({
      center: { x: 0.5000000049, y: 0.5000000049 },
    });
    const head = parsePathData(arrow.parts[0].geometry.d);
    const shaft = parsePathData(arrow.parts[1].geometry.d);
    const serializedTip = { x: head[1].x, y: head[1].y };
    expect(serializedTip).toEqual({ x: shaft[1].x, y: shaft[1].y });
    expect(arrow.joins[0].at).toEqual(serializedTip);
    expect(arrow.parts[1].weld.at).toEqual(serializedTip);
    expect(serializedTip).toEqual({ x: 0.76, y: 0.5 });
    expectCanonicalPartBounds(arrow);
  });

  it.each([
    [{ orientation: 'north' }, 'orientation'],
    [{ weight: 0.001 }, 'weight'],
    [{ headSpan: 0.1, weight: 0.08, clearance: 0.06 }, 'headSpan'],
    [{ shaftLength: 0.2 }, 'shaftLength'],
    [{ center: { x: 0.95, y: 0.5 } }, 'bounds'],
    [{ headLength: null }, 'headLength'],
    [{ shaftLenght: 0.4 }, 'неизвестный параметр'],
  ])('fail-closed для hostile arrow %#', (options, fragment) => {
    expect(() => buildDirectionalArrow(options)).toThrow(fragment);
  });
});

describe('композиционные decorators', () => {
  it('circle enclosure выводит радиус из keyline и измеримого просвета', () => {
    const clearances = [0.06, 0.08, 0.1];
    const samples = clearances.map((value) => decorateCircleEnclosure({
      contentKeyline: { x: 0.38, y: 0.4, width: 0.24, height: 0.2 },
      clearance: value,
      margin: 0.02,
    }));
    expect(samples.map(({ parts }) => parts[0].id)).toEqual(['enclosure', 'enclosure', 'enclosure']);
    expect(samples.map(({ metrics }) => metrics.radius)).toEqual([...samples.map(({ metrics }) => metrics.radius)].sort((a, b) => a - b));
    samples.forEach((sample, index) => {
      const aperture = constraintByMethod(
        sample,
        'radial-farthest-corner-to-inner-stroke',
      );
      expect(Math.abs(
        aperture.measured - clearances[index],
      )).toBeLessThanOrEqual(2e-8);
      expect(sample).not.toHaveProperty('content');
      expectFiniteGeometry(sample);
    });
  });

  it('strike возвращает subtract corridor без opacity', () => {
    const strike = decorateStrike({
      targetBBox: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
      angle: -45,
      margin: 0.04,
    });
    expect(strike.parts[0].id).toBe('strike');
    expect(strike.masks[0]).toMatchObject({ id: 'strike.knockout', operation: 'subtract' });
    expect(strike.metrics.corridorWidth).toBeCloseTo(
      strike.metrics.weight + 2 * strike.metrics.clearance,
      12,
    );
    expect(JSON.stringify(strike)).not.toContain('opacity');
    expectFiniteGeometry(strike);
  });

  it('strike metrics выводятся из сериализованного centerline', () => {
    const targetBBox = { x: 0.3, y: 0.3, width: 0.4, height: 0.4 };
    const strike = decorateStrike({
      targetBBox,
      angle: 89.999999,
      overshoot: 0.0300000049,
      margin: 0,
    });
    const [from, to] = parsePathData(strike.parts[0].geometry.d);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const direction = { x: dx / length, y: dy / length };
    expect(strike.metrics.angle).toBe(Math.atan2(dy, dx) * 180 / Math.PI);
    expect(strike.metrics.overshoot).toBe(length / 2 - (
      Math.abs(direction.x) * targetBBox.width / 2
      + Math.abs(direction.y) * targetBBox.height / 2
    ));
  });

  it('badge стоит на top-right нормали с точным зазором', () => {
    const badge = placeNotificationBadge({
      targetBBox: { x: 0.25, y: 0.3, width: 0.4, height: 0.4 },
      radius: 0.07,
      clearance: 0.06,
      margin: 0.04,
    });
    expect(badge.parts[0].id).toBe('badge');
    expect(badge.tangency.clearance).toBeGreaterThanOrEqual(0.06);
    expect(badge.tangency.clearance - 0.06).toBeLessThanOrEqual(2e-8);
    expect(badge.metrics.center.x).toBeGreaterThan(0.65);
    expect(badge.metrics.center.y).toBeLessThan(0.3);
    expectFiniteGeometry(badge);
  });

  it('badge считает bbox и clearance от канонического сериализованного круга', () => {
    const targetBBox = { x: 0.25, y: 0.3, width: 0.4, height: 0.4 };
    const badge = placeNotificationBadge({
      targetBBox,
      radius: 0.071234567,
      clearance: 0.04,
      opsz: 48,
      margin: 0,
    });
    const actualBounds = pathBBox(badge.parts[0].geometry.d);
    expect(badge.parts[0].bbox).toEqual(actualBounds);
    const corner = { x: targetBBox.x + targetBBox.width, y: targetBBox.y };
    const actualClearance = Math.hypot(
      badge.metrics.center.x - corner.x,
      badge.metrics.center.y - corner.y,
    ) - badge.metrics.radius;
    expect(badge.tangency.clearance).toBe(actualClearance);
    const sampledClearance = Math.min(...samplePath(badge.parts[0].geometry.d, 128)
      .map(([x, y]) => Math.hypot(x - corner.x, y - corner.y)));
    expect(sampledClearance).toBeCloseTo(badge.tangency.clearance, 14);
    expect(actualClearance).toBeGreaterThanOrEqual(badge.tangency.requestedClearance);
    expect(actualClearance - badge.tangency.requestedClearance).toBeLessThanOrEqual(2e-8);
    expect(badge.metrics.clearance).toBe(actualClearance);
  });

  it.each([
    [() => decorateCircleEnclosure({ contentKeyline: { x: 0.05, y: 0.05, width: 0.9, height: 0.9 } }), 'bounds'],
    [() => decorateStrike({
      targetBBox: { x: 0.1, y: 0.1, width: 0.8, height: 0.8 },
      clearance: 0.2,
    }), 'strike.knockout.bounds: ink выходит за canvas с margin=0.05'],
    [() => placeNotificationBadge({ targetBBox: { x: 0.75, y: 0.1, width: 0.2, height: 0.2 } }), 'bounds'],
  ])('не выпускает decorator за canvas %#', (call, fragment) => {
    expect(call).toThrow(fragment);
  });

  it.each([
    [() => decorateStrike({
      targetBBox: { x: 0.3, y: 0.3, width: 0.4, height: 0.4 },
      angle: null,
    }), 'angle'],
    [() => decorateStrike({
      targetBBox: { x: 0.5, y: 0.5, width: 2e-9, height: 2e-9 },
      angle: 0,
      overshoot: 0,
      margin: 0,
    }), 'оптического минимума'],
    [() => placeNotificationBadge({
      targetBBox: { x: 0.25, y: 0.3, width: 0.4, height: 0.4 },
      radius: null,
    }), 'radius'],
  ])('не превращает null decorator-поля в default %#', (call, fragment) => {
    expect(call).toThrow(fragment);
  });
});

describe('каноническая lattice-граница публичных операторов', () => {
  const phase = 0.5000000049;
  const cases = [
    ['chevron', () => buildDirectionalChevron({ center: { x: phase, y: phase } })],
    ['arrow', () => buildDirectionalArrow({ center: { x: phase, y: phase } })],
    ['enclosure', () => decorateCircleEnclosure({
      contentKeyline: { x: 0.3500000049, y: 0.3600000049, width: 0.3, height: 0.28 },
      margin: 0.02,
    })],
    ['strike', () => decorateStrike({
      targetBBox: { x: 0.3000000049, y: 0.3000000049, width: 0.4, height: 0.4 },
      margin: 0.02,
    })],
    ['badge', () => placeNotificationBadge({
      targetBBox: { x: 0.2500000049, y: 0.3000000049, width: 0.4, height: 0.4 },
      clearance: 0.06,
      margin: 0.02,
    })],
    ['rays', () => generateRadialRays({ center: { x: phase, y: phase } })],
    ['note', () => buildMusicalNote({
      id: 'phase-note',
      headCenter: { x: 0.4200000049, y: 0.6700000049 },
    })],
    ['notes', () => buildMusicalNotes({
      beam: true,
      notes: [
        { id: 'left', headCenter: { x: 0.3300000049, y: 0.6800000049 } },
        { id: 'right', headCenter: { x: 0.6200000049, y: 0.5800000049 } },
      ],
    })],
  ];

  it.each(cases)('%s: bbox выводится только из сериализованного path', (_name, build) => {
    expectCanonicalPartBounds(build());
  });

  it('strike mask использует тот же path и канонический corridor bbox', () => {
    const strike = decorateStrike({
      targetBBox: { x: 0.3000000049, y: 0.3000000049, width: 0.4, height: 0.4 },
      margin: 0.02,
    });
    const corridor = strike.masks[0].corridor;
    expect(corridor.geometry.d).toBe(strike.parts[0].geometry.d);
    expect(corridor.bbox).toEqual(serializedInkBounds(corridor));
  });

  it('note anchors являются точными endpoints сериализованного stem', () => {
    const note = buildMusicalNote({
      id: 'phase-note',
      headCenter: { x: 0.4200000049, y: 0.6700000049 },
    });
    const stem = parsePathData(note.parts.find(({ role }) => role === 'note-stem').geometry.d);
    expect(note.anchors.stemBottom).toEqual({ x: stem[0].x, y: stem[0].y });
    expect(note.anchors.stemTop).toEqual({ x: stem[1].x, y: stem[1].y });
  });
});

describe('radial rays', () => {
  it('length непрерывно ведёт sun-low к sun, не меняя ids/topology', () => {
    const lengths = [0, 0.1, 0.5, 0.9, 1];
    const samples = lengths.map((length) => generateRadialRays({ length, count: 8 }));
    const ids = samples[0].parts.map(({ id }) => id);
    expect(ids).toEqual(['ray.n', 'ray.ne', 'ray.e', 'ray.se', 'ray.s', 'ray.sw', 'ray.w', 'ray.nw']);
    for (const sample of samples) {
      expect(sample.parts.map(({ id }) => id)).toEqual(ids);
      expect(sample.parts.every(({ topologySignature }) => topologySignature === 'ML')).toBe(true);
      expectFiniteGeometry(sample);
    }
    const radii = samples.map(({ metrics }) => metrics.outerRadius);
    expect(radii).toEqual([...radii].sort((a, b) => a - b));
  });

  it('count дискретен, произвольное число лучей получает детерминированные slot ids', () => {
    const rays = generateRadialRays({ count: 6, rotation: -75, opsz: 48, weight: 0.06 });
    expect(rays.topologyKey).toBe('rays:6');
    expect(new Set(rays.parts.map(({ id }) => id)).size).toBe(6);
    expect(rays.parts.some(({ id }) => id.startsWith('ray.slot-'))).toBe(true);
  });

  it('rotation двигает лучи, не меняя topology-slot identity', () => {
    const rotations = [-90, -89.999, -45, 0, 89.5];
    const samples = rotations.map((rotation) => generateRadialRays({ rotation, count: 8 }));
    const ids = samples[0].parts.map(({ id }) => id);
    expect(ids).toEqual(['ray.n', 'ray.ne', 'ray.e', 'ray.se', 'ray.s', 'ray.sw', 'ray.w', 'ray.nw']);
    expect(samples.every((sample) => (
      JSON.stringify(sample.parts.map(({ id }) => id)) === JSON.stringify(ids)
    ))).toBe(true);
    expect(new Set(samples.map((sample) => sample.parts[0].angle)).size).toBe(rotations.length);
  });

  it('контрформы вычислены от края body и соседнего stroke', () => {
    const rays = generateRadialRays({ bodyRadius: 0.2, count: 8, clearance: 0.06 });
    const bodyGap = constraintByMethod(
      rays,
      'radial-centerline-to-body-minus-half-stroke',
    );
    const adjacentGap = constraintByMethod(
      rays,
      'adjacent-inner-endpoint-chord-minus-stroke',
    );
    expect(bodyGap.measured).toBeGreaterThanOrEqual(0.06);
    expect(bodyGap.measured - 0.06).toBeLessThanOrEqual(3e-8);
    expect(adjacentGap.measured).toBeGreaterThanOrEqual(0.06);
  });

  it('radial metrics и negative space измеряются по сериализованным endpoints', () => {
    const rays = generateRadialRays({
      center: { x: 0.5000000049, y: 0.5000000049 },
      rotation: 12.3456789,
      count: 7,
      opsz: 48,
      weight: 0.0500000049,
      clearance: 0.0400000049,
      bodyRadius: 0.1800000049,
      length: 0.4321000049,
    });
    const endpoints = rays.parts.map(({ geometry }) => parsePathData(geometry.d));
    const distances = endpoints.map(([from, to]) => ({
      inner: Math.hypot(from.x - rays.metrics.center.x, from.y - rays.metrics.center.y),
      outer: Math.hypot(to.x - rays.metrics.center.x, to.y - rays.metrics.center.y),
      length: Math.hypot(to.x - from.x, to.y - from.y),
    }));
    expect(rays.metrics.innerRadius).toBe(Math.min(...distances.map(({ inner }) => inner)));
    expect(rays.metrics.outerRadius).toBe(Math.max(...distances.map(({ outer }) => outer)));
    expect(rays.metrics.rayLength).toBe(Math.min(...distances.map(({ length }) => length)));
    expect(constraintByMethod(
      rays,
      'radial-centerline-to-body-minus-half-stroke',
    ).measured).toBe(
      rays.metrics.innerRadius - rays.metrics.weight / 2 - rays.metrics.bodyRadius,
    );
  });

  it('fail-closed после lattice, если фактический adjacent clearance ниже requested', () => {
    expect(() => generateRadialRays({
      center: { x: 0.5000000049, y: 0.5000000049 },
      rotation: 0.123456789,
      count: 16,
      opsz: 48,
      weight: 0.05,
      clearance: 0.04,
      bodyRadius: 0.16566239029673557,
      length: 0,
      margin: 0,
    })).toThrow('post-lattice');
  });

  it('opsz задаёт доказуемый предел count для удаления деталей на малом кегле', () => {
    const small = generateRadialRays({ opsz: 16, count: 8 });
    const display = generateRadialRays({ opsz: 48, count: 8, weight: 0.05 });
    expect(small.metrics.maxCountForClearance).toBeLessThan(display.metrics.maxCountForClearance);
    expect(() => generateRadialRays({
      opsz: 16,
      count: small.metrics.maxCountForClearance + 1,
    })).toThrow('clearance');
  });

  it('property-ish: длина и поворот не выпускают легальные лучи из canvas', () => {
    for (const opsz of [16, 24, 48]) {
      for (const length of [0, 0.25, 0.5, 0.75, 1]) {
        for (const rotation of [-90, -75, -45, 0, 30]) {
          expectFiniteGeometry(generateRadialRays({ opsz, length, rotation, count: 8 }));
        }
      }
    }
  });

  it.each([
    [{ count: 7.5 }, 'count'],
    [{ count: 17 }, 'count'],
    [{ length: -0.01 }, 'length'],
    [{ length: null }, 'length'],
    [{ bodyRadius: 0.38 }, 'rays'],
    [{ count: 16, bodyRadius: 0.1 }, 'clearance'],
  ])('hostile rays %#', (options, fragment) => {
    expect(() => generateRadialRays(options)).toThrow(fragment);
  });
});

describe('musical note family', () => {
  it('строит head ellipse, stem и опциональный flag со стабильной анатомией', () => {
    const flagged = buildMusicalNote({ id: 'melody', flag: true });
    const plain = buildMusicalNote({ id: 'melody', flag: false });
    expect(flagged.parts.map(({ id }) => id)).toEqual(['melody.head', 'melody.stem', 'melody.flag']);
    expect(plain.parts.map(({ id }) => id)).toEqual(['melody.head', 'melody.stem']);
    expect(flagged.topologyKey).toBe('note:flag');
    expect(plain.topologyKey).toBe('note:plain');
    expect(flagged.parts[0].topologySignature).toBe('MAAZ');
    expectFiniteGeometry(flagged);
    expectFiniteGeometry(buildMusicalNote({ id: 'downbeat', stemDirection: 'down' }));
  });

  it('head radius metrics учитывают SVG radius correction сериализованной ellipse', () => {
    const note = buildMusicalNote({ id: 'corrected' });
    const [start, arc] = parsePathData(note.parts[0].geometry.d);
    const phi = arc.rotation * Math.PI / 180;
    const dx = (start.x - arc.x) / 2;
    const dy = (start.y - arc.y) / 2;
    const localX = Math.cos(phi) * dx + Math.sin(phi) * dy;
    const localY = -Math.sin(phi) * dx + Math.cos(phi) * dy;
    const scale = Math.max(1, Math.hypot(localX / arc.rx, localY / arc.ry));
    expect(note.metrics.headRadiusX).toBeCloseTo(arc.rx * scale, 14);
    expect(note.metrics.headRadiusY).toBeCloseTo(arc.ry * scale, 14);
  });

  it('musical-notes композиционно переиспользует note recipe и добавляет beam', () => {
    const notes = [
      { id: 'left', headCenter: { x: 0.33, y: 0.68 }, stemLength: 0.31 },
      { id: 'right', headCenter: { x: 0.62, y: 0.58 }, stemLength: 0.31 },
    ];
    const snapshot = structuredClone(notes);
    const result = buildMusicalNotes({ notes, beam: true });
    expect(notes).toEqual(snapshot);
    expect(result.parts.map(({ id }) => id)).toEqual([
      'left.head',
      'left.stem',
      'right.head',
      'right.stem',
      'beam',
    ]);
    expect(result.topologyKey).toBe('notes:2:beam');
    expectFiniteGeometry(result);
  });

  it('beam отвергает stems, схлопывающиеся в одну точку после сериализации', () => {
    expect(() => buildMusicalNotes({
      beam: true,
      notes: [
        { id: 'left', headCenter: { x: 0.3, y: 0.68 } },
        { id: 'right', headCenter: { x: 0.300000002, y: 0.68 } },
      ],
    })).toThrow('serialized');
  });

  it('без beam каждая нота получает flag из того же recipe', () => {
    const result = buildMusicalNotes({
      beam: false,
      notes: [
        { id: 'low', headCenter: { x: 0.33, y: 0.68 } },
        { id: 'high', headCenter: { x: 0.7, y: 0.55 } },
      ],
    });
    expect(result.parts.filter(({ role }) => role === 'note-flag').map(({ id }) => id)).toEqual([
      'low.flag',
      'high.flag',
    ]);
    expect(result.topologyKey).toBe('notes:2:flags-11');
  });

  it('topologyKey кодирует ordered presence-mask флагов', () => {
    const common = [
      { id: 'left', headCenter: { x: 0.33, y: 0.68 }, flag: true },
      { id: 'right', headCenter: { x: 0.7, y: 0.55 }, flag: false },
    ];
    expect(buildMusicalNotes({ beam: false, notes: common }).topologyKey).toBe('notes:2:flags-10');
    expect(buildMusicalNotes({
      beam: false,
      notes: common.map((note) => ({ ...note, flag: !note.flag })),
    }).topologyKey).toBe('notes:2:flags-01');
  });

  it('результат рекурсивно frozen и вызовы не делят mutable state', () => {
    const first = buildDirectionalArrow();
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.parts)).toBe(true);
    expect(Object.isFrozen(first.parts[0].geometry)).toBe(true);
    expect(() => { first.parts[0].id = 'broken'; }).toThrow();
    expect(buildDirectionalArrow().parts[0].id).toBe('head');
  });

  it.each([
    [() => buildMusicalNote({ id: 'Bad id' }), 'id'],
    [() => buildMusicalNote({ headRadiusY: 0 }), 'headRadiusY'],
    [() => buildMusicalNote({ opsz: null }), 'opsz'],
    [() => buildMusicalNote({ flag: 'yes' }), 'flag'],
    [() => buildMusicalNotes({
      beam: true,
      notes: [{ id: 'left', flag: 'yes' }, { id: 'right', headCenter: { x: 0.65, y: 0.55 } }],
    }), 'notes[0].flag'],
    [() => buildMusicalNotes({ notes: [{ id: 'same' }, { id: 'same' }] }), 'повторный id'],
    [() => buildMusicalNotes({ notes: [
      { id: 'up' },
      { id: 'down', headCenter: { x: 0.65, y: 0.3 }, stemDirection: 'down' },
    ] }), 'направление'],
  ])('fail-closed для hostile note %#', (call, fragment) => {
    expect(call).toThrow(fragment);
  });
});
