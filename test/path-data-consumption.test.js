import { describe, expect, it } from 'vitest';
import { parsePathData } from '../src/core/path-data.js';

describe('полное потребление грамматики SVG path', () => {
  it.each(['M2 2H22V22H2Z!', 'M2 2H22V22H2Z!M7 7H17V17H7Z', 'M,2 2', 'M2,,2', 'M2 2,', 'M2 2,L3 3'])('не принимает корректный префикс %s', (d) => {
    expect(() => parsePathData(d)).toThrow();
  });

  it('сохраняет законные сжатые числа, разделители и неявное продолжение', () => {
    expect(parsePathData('M.5-.5 1e-2.3L2,3Z')).toEqual([
      { cmd: 'M', x: .5, y: -.5 }, { cmd: 'L', x: .01, y: .3 },
      { cmd: 'L', x: 2, y: 3 }, { cmd: 'Z' },
    ]);
    expect(parsePathData('M0 0A2 2 0 011 2Z')).toHaveLength(3);
  });
});
