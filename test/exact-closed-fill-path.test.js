import { describe, expect, it } from 'vitest';
import { exactClosedFillPathKey as key } from '../scripts/lib/exact-closed-fill-path.js';

const outer = 'M0 0L10 0L10 10L0 10Z';
const outerReverse = 'M0 0L0 10L10 10L10 0Z';
const inner = 'M2 2L8 2L8 8L2 8Z';
const innerReverse = 'M2 2L2 8L8 8L8 2Z';

describe('build-only exact closed fill key', () => {
  it.each(['evenodd', 'nonzero'])('%s: cyclic start, Z edge и общий reversal сохраняют геометрию', rule => {
    const expected = key(outer, rule);
    expect(expected).not.toBeNull();
    expect(key('M10 0L10 10L0 10L0 0Z', rule)).toBe(expected);
    expect(key(outerReverse, rule)).toBe(expected);
    // Последнее ребро обеих треугольных paths выражено именно через Z.
    expect(key('M0 0L10 0L10 10Z', rule)).toBe(key('M10 0L10 10L0 0Z', rule));
    expect(key('M0 0L10 0L10 10Z', rule)).not.toBe(expected);
  });

  it('lexical decimal spelling не меняет значение; geometry Number не участвует', () => {
    expect(key('M+00.00 -0e999L+001e1 -.000L1.0e1 +10.00L.00 0.1e2Z', 'nonzero'))
      .toBe(key(outer, 'nonzero'));
    expect(key('M0,0 10,0 10,10 0,10Z', 'nonzero')).toBe(key(outer, 'nonzero'));
    expect(key('M-1.2e-3 +2.00L3.0 4e0L5 -6Z', 'nonzero'))
      .toBe(key('M-.001200 2L3 4L5.000 -6.000Z', 'nonzero'));
    expect(key('M0 0L10e999999999999999999999999 0L0 1Z', 'nonzero'))
      .toBe(key('M0 0L1e1000000000000000000000000 0L0 1Z', 'nonzero'));
  });

  it.each([
    ['9007199254740992', '9007199254740993'],
    ['1', '1.00000000000000000000000000001'],
    ['0.1', '0.10000000000000000000000000001'],
    ['1e1000000000000000000000000', '1e1000000000000000000000001'],
  ])('разные decimal coordinates %s/%s не сливаются', (a, b) => {
    expect(key(`M0 0L${a} 0L0 1Z`, 'evenodd')).not.toBe(key(`M0 0L${b} 0L0 1Z`, 'evenodd'));
  });

  it('C reversal меняет endpoints и порядок обоих controls', () => {
    const original = key('M0 0C1 2 3 4 5 6L7 8Z', 'nonzero');
    expect(original).not.toBeNull();
    expect(key('M5 6C3 4 1 2 0 0L7 8Z', 'nonzero')).toBe(original);
    expect(key('M5 6C1 2 3 4 0 0L7 8Z', 'nonzero')).not.toBe(original);
    expect(key('M0 0C1 2 3.0000000000000000001 4 5 6L7 8Z', 'nonzero')).not.toBe(original);
  });

  it('nonzero сохраняет взаимную ориентацию и отверстие вложенных контуров', () => {
    const solid = outer + inner, hole = outer + innerReverse;
    // В центре winding 2 для solid и 0 для hole; общий разворот даёт -2.
    expect(key(solid, 'nonzero')).not.toBe(key(hole, 'nonzero'));
    expect(key(solid, 'nonzero')).toBe(key(outerReverse + innerReverse, 'nonzero'));
    expect(key(hole, 'nonzero')).toBe(key(outerReverse + inner, 'nonzero'));
    expect(key(solid, 'nonzero')).toBe(key(inner + outer, 'nonzero'));
    expect(key(solid, 'evenodd')).toBe(key(hole, 'evenodd'));
    expect(key(solid, 'evenodd')).toBe(key(innerReverse + outerReverse, 'evenodd'));
  });

  it.each(['evenodd', 'nonzero'])('%s: contour count и multiplicity рёбер сохраняются', rule => {
    expect(key(outer + outer, rule)).not.toBe(key(outer, rule));
    expect(key('M0 0L10 0L10 10L0 10L0 0L10 0L10 10L0 10Z', rule)).not.toBe(key(outer, rule));
    expect(key('M0 0L0 0L10 0L10 10L0 10Z', rule)).not.toBe(key(outer, rule));
    expect(key('M0 0Z', rule)).not.toBe(key('M1 0Z', rule));
    expect(key('M0 0Z', rule)).not.toBe(key('M0 0L0 0Z', rule));
    expect(key('M0 0L10 0L10 10Z', rule)).not.toBe(key('M0 0C0 0 10 0 10 0L10 10Z', rule));
  });

  it('повторяющиеся последовательности сохраняют canonical rotation на всех стартах', () => {
    // Малая исчерпывающая область проверяет цикл с повторяющимися рёбрами.
    // Oracle задаёт равенство всех авторских rotations без вызова private алгоритма.
    for (let bits = 0; bits < 64; bits++) {
      const points = Array.from({ length: 6 }, (_, index) => `${(bits >> index) & 1} 0`);
      const paths = points.map((_, start) => {
        const ordered = [...points.slice(start), ...points.slice(0, start)];
        return `M${ordered[0]}${[...ordered.slice(1), ordered[0]].map(point => `L${point}`).join('')}Z`;
      });
      const expected = key(paths[0], 'nonzero');
      expect(expected).not.toBeNull();
      for (const path of paths) expect(key(path, 'nonzero')).toBe(expected);
    }
  });

  it.each([
    '', 'M0 0', 'L0 0Z', 'M0 0L1Z', 'M0 0C1 2 3 4 5Z',
    'M0 0M1 1Z', 'M0 0ZL1 1Z', 'M0 0ZZ', 'M0 0,',
    'M,0 0Z', 'M0,,0Z', 'M0 0L1 1,Z', 'M0 0L1e 1Z', 'M0 0LNaN 1Z',
    'm0 0l1 1z', 'M0 0L1 1z', 'M0 0H1V1Z',
    'M0 0Q1 1 2 2Z', 'M0 0C1 1 2 2 3 3S4 4 5 5Z',
    'M0 0A1 1 0 0 0 1 1Z', 'M0 0L1 1Z transform="scale(2)"',
  ])('неподдержанный/незамкнутый/malformed d %j даёт unproved', d => {
    expect(key(d, 'evenodd')).toBeNull();
  });

  it('неизвестные input/rule дают unproved', () => {
    expect(key(null, 'evenodd')).toBeNull();
    expect(key(outer, 'inherit')).toBeNull();
  });
});
