import { describe, expect, it } from 'vitest';
import { comparisonMasksMatch, comparisonViewportMatches } from '../scripts/bench/explorer-journey.js';

const reference = () => ({ viewBox: [0, 0, 24, 24], screen: [112 / 24, 0, 0, 112 / 24, 1194.5, 269.5] });
const viewport = () => ({ ...reference(), intrinsicWidth: 24, intrinsicHeight: 24,
  computedWidth: 'auto', computedHeight: 'auto' });
const observed = () => [viewport(), viewport()];
const matches = (nested, outer, viewBox = [0, 0, 24, 24]) => comparisonViewportMatches(nested, outer, viewBox);

describe('экранная система координат авторского сравнения', () => {
  it('принимает реальный Chromium CSSOM auto при сохранённом масштабе', () => {
    const nested = observed();
    expect(nested.every(svg => Math.abs(parseFloat(svg.computedWidth) - 24) < .001)).toBe(false);
    expect(matches(nested, reference())).toBe(true);
  });

  it.each([[0, 1.01], [1, .01], [2, .01], [3, 1.01], [4, 1], [5, 1]])(
    'обнаруживает искажение коэффициента %i даже при неизменных intrinsic dimensions', (index, difference) => {
      const nested = observed();
      nested[1].screen[index] += difference;
      expect(matches(nested, reference())).toBe(false);
    });

  it('отвергает неверные dimensions, viewBox и отсутствие физического наблюдения', () => {
    for (const change of [item => { item.intrinsicWidth = 25; }, item => { item.intrinsicHeight = 25; },
      item => { item.viewBox[0] = 1; }, item => { item.viewBox[2] = 48; },
      item => { item.screen = null; }, item => { item.screen[0] = NaN; },
      item => { item.screen[0] = item.screen[3] = 0; }]) {
      const nested = observed(); change(nested[1]);
      expect(matches(nested, reference())).toBe(false);
    }
    expect(matches([], reference())).toBe(false);
    expect(matches([viewport()], reference())).toBe(false);
    expect(matches(observed(), null)).toBe(false);
    expect(matches(observed(), reference(), [0, 0, 48, 48])).toBe(false);
  });

  it('сохраняет смещённый viewBox, поворот и неравномерный внешний масштаб', () => {
    const expected = { viewBox: [4, 5, 24, 32], screen: [0, 3, -2, 0, 107, 209] };
    const nested = [0, 1].map(() => ({ ...expected, intrinsicWidth: 24, intrinsicHeight: 32 }));
    expect(matches(nested, expected, expected.viewBox)).toBe(true);
  });
});

describe('система координат направленных масок', () => {
  const mask = () => ({ maskType: 'luminance', maskUnits: 'userSpaceOnUse',
    maskContentUnits: 'userSpaceOnUse', bounds: [0, 0, 24, 24] });

  it('проверяет painting units отдельно от неизменной DOM-матрицы', () => {
    const masks = [mask(), mask()];
    expect(comparisonMasksMatch(masks, [0, 0, 24, 24])).toBe(true);
    masks[1].maskContentUnits = 'objectBoundingBox';
    expect(matches(observed(), reference())).toBe(true);
    expect(comparisonMasksMatch(masks, [0, 0, 24, 24])).toBe(false);
  });

  it('не принимает другой fill basis, отсутствующие units и обрезанный viewport', () => {
    for (const change of [item => { item.maskType = 'alpha'; }, item => { item.maskUnits = 'objectBoundingBox'; },
      item => { delete item.maskContentUnits; }, item => { item.bounds[0] = 1; },
      item => { item.bounds[1] = 1; }, item => { item.bounds[2] = 23; },
      item => { item.bounds[3] = 23; }, item => { item.bounds[0] = NaN; }]) {
      const masks = [mask(), mask()]; change(masks[1]);
      expect(comparisonMasksMatch(masks, [0, 0, 24, 24])).toBe(false);
    }
    expect(comparisonMasksMatch([], [0, 0, 24, 24])).toBe(false);
    expect(comparisonMasksMatch([mask()], [0, 0, 24, 24])).toBe(false);
  });
});
