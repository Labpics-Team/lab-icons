import { describe, expect, it } from 'vitest';
import { canonicalCubicPath, diagnosticAlpha, diagnosticPath } from '../scripts/bench/lottie-render.js';

describe('различающие native raster interventions', () => {
  it('native author сохраняет исходные verbs и literals побайтово, binary32 меняет только числа', () => {
    const path = 'M.5.25 L8.65352,-2e0 H10 V-3 Z';
    expect(diagnosticPath(path)).toBe(path);
    const quantized = diagnosticPath(path, { numbers: 'binary32' });
    expect(quantized.match(/[MLHVZ]/g)).toEqual(path.match(/[MLHVZ]/g));
    expect(quantized).toContain(String(Math.fround(8.65352)));
    expect(canonicalCubicPath(quantized)).toBe(canonicalCubicPath(path));
  });
  it('zero-tangent+binary32 соответствует существующей canonical cell, включая закрытие', () => {
    for (const path of ['M1 2L3 4H5V6Z', 'M.5.25L8.65352 4C1.25 2.125 3.3 -4 2 2Z M9 9L12 12Z']) {
      expect(diagnosticPath(path, { lines: 'zero-tangent', numbers: 'binary32' })).toBe(canonicalCubicPath(path));
    }
    expect(diagnosticPath('M1.00 2L4 5C1.50 2e0 3.125 4 1.00 2Z', { lines: 'zero-tangent' }))
      .toBe('M1.00 2C1.00 2 4 5 4 5C1.50 2e0 3.125 4 1.00 2Z');
  });
  it('parameter-linear controls сохраняют native line locus и исходные C', () => {
    expect(diagnosticPath('M3 15L12 6L18 12C19 13 20 14 18 15L12 9Z', { lines: 'parameter-linear' }))
      .toBe('M3 15C6 12 9 9 12 6C14 8 16 10 18 12C19 13 20 14 18 15C16 13 14 11 12 9C9 11 6 13 3 15Z');
    const controls = [[3, 15], [6, 12], [9, 9], [12, 6]];
    for (const t of [0, 0.1, 0.25, 0.5, 0.9, 1]) for (const axis of [0, 1]) {
      const cubic = controls[0][axis] * (1 - t) ** 3 + 3 * controls[1][axis] * (1 - t) ** 2 * t +
        3 * controls[2][axis] * (1 - t) * t ** 2 + controls[3][axis] * t ** 3;
      expect(cubic).toBeCloseTo(controls[0][axis] + t * (controls[3][axis] - controls[0][axis]), 12);
    }
  });
  it('реальные curves не превращаются в lines; неизвестные interventions и grammar получают отказ', () => {
    const curve = 'M1.00 2C1.50 2e0 3.125 4 1.00 2Z';
    expect(diagnosticPath(curve, { lines: 'parameter-linear' })).toBe(curve);
    expect(() => diagnosticPath(curve, { lines: 'approximate' })).toThrow('line intervention');
    expect(() => diagnosticPath(curve, { numbers: 'rounded' })).toThrow('number intervention');
    for (const path of ['M0 0L1Z', 'M0 0A1 1 0 0 0 1 1Z', 'm0 0l1 1z', 'M0 0Z#']) {
      expect(() => diagnosticPath(path, { lines: 'parameter-linear' })).toThrow();
    }
  });
  it('signed ink bias отличает потерю и прибавку веса от L1 ошибки', () => {
    const pixels = alpha => Uint8ClampedArray.from(alpha.flatMap(value => [0, 0, 0, value]));
    const expected = pixels([100, 100]);
    expect(diagnosticAlpha(pixels([90, 90]), expected)).toMatchObject({ actualInk: 180, signedInkBias: -0.1, alphaDifference: [-10, -10] });
    expect(diagnosticAlpha(pixels([110, 110]), expected)).toMatchObject({ actualInk: 220, signedInkBias: 0.1, alphaDifference: [10, 10] });
    expect(diagnosticAlpha(pixels([90, 110]), expected)).toMatchObject({ alphaError: 20, signedInkBias: 0, alphaDifference: [-10, 10] });
    expect(() => diagnosticAlpha(new Uint8ClampedArray(3), expected)).toThrow('неверную длину');
  });
});
