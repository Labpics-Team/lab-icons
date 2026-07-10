import { describe, expect, it } from 'vitest';
import { labelMaskFeatures } from '../scripts/lib/ink-raster.js';
import {
  analyzePartAdjacency,
  analyzePartAdjacencyAcrossPhases,
} from '../scripts/lib/part-adjacency.js';

const rect = (id, x0, y0, x1, y1) => ({
  id,
  d: `M${x0} ${y0}H${x1}V${y1}H${x0}Z`,
});

const entry = (x0, y0, x1, y1) => ({
  d: `M${x0} ${y0}H${x1}V${y1}H${x0}Z`,
  fillRule: 'nonzero',
});

function analyze(options) {
  return analyzePartAdjacency({
    width: 24,
    height: 12,
    step: 0.25,
    phaseX: 0.5,
    phaseY: 0.5,
    eps: 0.05,
    assignmentRadius: 0,
    ...options,
  });
}

describe('labelMaskFeatures', () => {
  it('возвращает labels и соблюдает выбранную цифровую связность', () => {
    const mask = new Uint8Array([
      1, 0, 0,
      0, 1, 0,
      0, 0, 0,
    ]);

    const eight = labelMaskFeatures(mask, 3, 3, { eightConnected: true });
    const four = labelMaskFeatures(mask, 3, 3, { eightConnected: false });

    expect(eight.features).toHaveLength(1);
    expect(eight.labels[0]).toBe(eight.labels[4]);
    expect(eight.features[0]).toMatchObject({
      cells: 2,
      touchesFrame: true,
      bbox: { minRow: 0, minCol: 0, maxRow: 1, maxCol: 1 },
    });
    expect(four.features).toHaveLength(2);
    expect(four.labels[0]).not.toBe(four.labels[4]);
  });
});

describe('part adjacency graph', () => {
  it('принимает цепь частей, связанную транзитивно внутри одной baseline-компоненты', () => {
    const result = analyze({
      baselineEntries: [entry(1, 1, 20, 5)],
      parts: [
        rect('a', 1, 1, 5, 5),
        rect('b', 5, 1, 10, 5),
        rect('c', 10, 1, 15, 5),
        rect('d', 15, 1, 20, 5),
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.defects).toEqual([]);
    expect(new Set(result.assignments.map((item) => item.component))).toEqual(new Set([0]));
    expect(result.pairGaps.get('a~b')).toBe(0);
    expect(result.pairGaps.get('b~c')).toBe(0);
  });

  it('ловит две локально связанные группы без обязательного моста', () => {
    const result = analyze({
      baselineEntries: [entry(1, 1, 20, 5)],
      parts: [
        rect('a', 1, 1, 5, 5),
        rect('b', 5, 1, 9, 5),
        rect('c', 12, 1, 16, 5),
        rect('d', 16, 1, 20, 5),
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.defects).toHaveLength(1);
    expect(result.defects[0].groups).toEqual([['a', 'b'], ['c', 'd']]);
    expect(result.defects[0].bridge).toMatchObject({ a: 'b', b: 'c' });
    expect(result.defects[0].bridge.gap).toBeCloseTo(3, 8);
  });

  it('не требует моста между независимыми компонентами baseline', () => {
    const result = analyze({
      baselineEntries: [entry(1, 1, 9, 5), entry(12, 1, 20, 5)],
      parts: [
        rect('a', 1, 1, 5, 5),
        rect('b', 5, 1, 9, 5),
        rect('c', 12, 1, 16, 5),
        rect('d', 16, 1, 20, 5),
      ],
    });

    expect(result.errors).toEqual([]);
    expect(result.defects).toEqual([]);
    expect(result.partitionSignature).toBe('a,b|c,d');
  });

  it('не назначает чернила внутри counter компоненте кольца', () => {
    const donut = {
      d: 'M1 1H20V10H1Z M6 3V8H15V3Z',
      fillRule: 'evenodd',
    };
    const result = analyze({
      baselineEntries: [donut],
      parts: [rect('inside-hole', 8, 4, 13, 7)],
    });

    expect(result.assignments[0].component).toBeNull();
    expect(result.errors[0]).toMatch(/не примыкает ни к одной компоненте/);
  });

  it('делает равное назначение двум baseline-компонентам явной ошибкой', () => {
    const result = analyze({
      baselineEntries: [entry(1, 1, 5, 5), entry(7, 1, 11, 5)],
      parts: [rect('bridge', 5.5, 2, 6.5, 4)],
      assignmentRadius: 1,
    });

    expect(result.assignments[0].component).toBeNull();
    expect(result.errors[0]).toMatch(/неоднозначное назначение/);
  });

  it('красит зависимость component partition от raster phase', () => {
    const report = analyzePartAdjacencyAcrossPhases({
      baselineEntries: [entry(1, 1, 5, 5), entry(5.2, 1, 9.2, 5)],
      parts: [rect('left', 1, 1, 5, 5), rect('right', 5.2, 1, 9.2, 5)],
      width: 12,
      height: 8,
      step: 0.5,
      eps: 0.05,
      assignmentRadius: 0,
    });

    expect(report.stableAssignments).toBe(false);
    expect(report.errors.some((message) => message.includes('raster phase'))).toBe(true);
  });

  it('запрещает дублированные part id', () => {
    expect(() => analyze({
      baselineEntries: [entry(1, 1, 10, 5)],
      parts: [rect('same', 1, 1, 5, 5), rect('same', 5, 1, 10, 5)],
    })).toThrow(/дублирован id/);
  });
});
