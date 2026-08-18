import { describe, expect, it } from 'vitest';
import { lowerModelComposition } from '../scripts/lib/model-composition.js';
import { rasterizePathEntries } from '../scripts/lib/ink-raster.js';

const parts = [
  { id: 'a', role: 'ink', d: 'M2 2H14V14H2Z' },
  { id: 'b', role: 'ink', d: 'M10 10H22V22H10Z' },
];

const at = (raster, x, y) => {
  const col = Math.floor(x / raster.step);
  const row = Math.floor(y / raster.step);
  return raster.mask[row * raster.cols + col];
};

describe('model composition lowering', () => {
  it('keeps layers as independent union operands instead of even-odd XOR', () => {
    const entries = lowerModelComposition({ parts, composition: { kind: 'layers' } });
    expect(entries.map(({ partId, operation }) => [partId, operation])).toEqual([
      ['a', 'union'],
      ['b', 'union'],
    ]);
    const raster = rasterizePathEntries(entries, { step: 0.25 });
    expect(at(raster, 12, 12)).toBe(1);
  });

  it('lowers mask-subtract as base minus union(subtractors)', () => {
    const base = { id: 'base', d: 'M1 1H23V23H1Z' };
    const subtractors = [
      { id: 'cut-a', d: 'M5 5H15V15H5Z' },
      { id: 'cut-b', d: 'M10 10H20V20H10Z' },
    ];
    const entries = lowerModelComposition({
      parts: [base, ...subtractors],
      composition: {
        kind: 'mask-subtract',
        basePartIds: ['base'],
        subtractPartIds: ['cut-a', 'cut-b'],
      },
    });
    expect(entries.map(({ operation }) => operation)).toEqual(['union', 'subtract', 'subtract']);
    const raster = rasterizePathEntries(entries, { step: 0.25 });
    expect(at(raster, 12, 12)).toBe(0);
  });

  it('keeps compound as one path with its declared fill rule', () => {
    const built = parts.map((part) => part.d).join('');
    expect(lowerModelComposition({
      built,
      parts,
      composition: { kind: 'compound', fillRule: 'evenodd' },
    })).toEqual([{ d: built, fillRule: 'evenodd', operation: 'union' }]);
  });

  it('fails closed when mask classification is incomplete or duplicated', () => {
    expect(() => lowerModelComposition({
      parts,
      composition: { kind: 'mask-subtract', basePartIds: ['a'], subtractPartIds: ['a'] },
    })).toThrow(/every part exactly once/);
    expect(() => lowerModelComposition({
      parts,
      composition: { kind: 'mask-subtract', basePartIds: ['a'], subtractPartIds: ['missing'] },
    })).toThrow(/every part exactly once/);
  });
});
