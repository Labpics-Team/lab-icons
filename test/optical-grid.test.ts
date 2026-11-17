import { expect, it } from 'vitest';
// @ts-expect-error The offline compiler is JavaScript and is never imported by runtime.
import { compileOpticalGrid } from '../scripts/lib/optical-grid.js';
import { opticalPathData, opticalPosition, sampleOpticalPath, type OpticalAxes, type OpticalPath } from '../src/render/optical-grid.js';

const axes: OpticalAxes = { weight: [300, 400, 600], opsz: [16, 24, 48] };
const rectangle = (right: number) => ({ d: `M0 0L${right} 0L${right} 8L0 8Z`, fillRule: 'evenodd' });
// Deliberately asymmetric values prevent swapping axes or either side unnoticed.
const widths = [[3, 5, 8], [6, 10, 13], [9, 15, 21]];
const input = () => ({ axes, source: [rectangle(10)], masters: axes.weight.flatMap((weight, wi) =>
  axes.opsz.map((opsz, oi) => ({ weight, opsz, paths: [rectangle(widths[wi]![oi]!)] }))) });

it('reproduces all nine supports and the independent four-corner means between them', () => {
  const path: OpticalPath = compileOpticalGrid(input()).paths[0];
  for (let wi = 0; wi < 3; wi++) for (let oi = 0; oi < 3; oi++) {
    const sampled = sampleOpticalPath(path, opticalPosition(axes, axes.weight[wi]!, axes.opsz[oi]!));
    expect(sampled[2]).toBe(widths[wi]![oi]);
    expect(opticalPathData(path, sampled)).toBe(rectangle(widths[wi]![oi]!).d);
  }
  for (let wi = 0; wi < 2; wi++) for (let oi = 0; oi < 2; oi++) {
    const weight = (axes.weight[wi]! + axes.weight[wi + 1]!) / 2;
    const opsz = (axes.opsz[oi]! + axes.opsz[oi + 1]!) / 2;
    const expected = (widths[wi]![oi]! + widths[wi + 1]![oi]! + widths[wi]![oi + 1]! + widths[wi + 1]![oi + 1]!) / 4;
    expect(sampleOpticalPath(path, opticalPosition(axes, weight, opsz))[2]).toBe(expected);
  }
});

it('reuses a buffer without accumulating frame error and drops identically zero terms', () => {
  const data = input();
  for (const master of data.masters) master.paths = data.source;
  const path: OpticalPath = compileOpticalGrid(data).paths[0];
  expect(path.terms).toEqual([]);
  const target = new Float64Array(path.coordinates.length);
  for (const [weight, opsz] of [[600, 16], [300, 48], [400, 24]]) {
    target.fill(1e10);
    expect(sampleOpticalPath(path, opticalPosition(axes, weight!, opsz!), target)).toBe(target);
    expect([...target]).toEqual(path.coordinates);
  }
});

it.each([NaN, Infinity, -Infinity, 299, 601])('rejects weight %s outside the authored domain', weight => {
  expect(() => opticalPosition(axes, weight, 24)).toThrow(RangeError);
});
it.each([NaN, Infinity, -Infinity, 15, 49])('rejects opsz %s outside the authored domain', opsz => {
  expect(() => opticalPosition(axes, 400, opsz)).toThrow(RangeError);
});

it('rejects incomplete grids, changed source centers and incompatible contour commands', () => {
  const missing = input(); missing.masters.pop();
  expect(() => compileOpticalGrid(missing)).toThrow('all nine');
  const moved = input(); moved.source = [rectangle(11)];
  expect(() => compileOpticalGrid(moved)).toThrow('preserve the source');
  const changed = input(); changed.masters[0]!.paths[0]!.d = 'M0 0C1 0 2 0 3 0L3 8L0 8Z';
  expect(() => compileOpticalGrid(changed)).toThrow('correspondence');
  const reversed = input(); reversed.masters[0]!.paths[0]!.d = 'M0 0L0 8L3 8L3 0Z';
  expect(() => compileOpticalGrid(reversed)).toThrow('winding');
});
