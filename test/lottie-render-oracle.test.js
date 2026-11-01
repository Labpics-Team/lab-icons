import { describe, expect, it } from 'vitest';
import { canonicalCubicPath, compareLottiePixels, referenceLottieTiming } from '../scripts/bench/lottie-render.js';

describe('независимый raw author oracle Lottie', () => {
  it('переиспользует только доказанную эквивалентность L/H/V и zero-tangent C', () => {
    expect(canonicalCubicPath('M1 2L3 4H5V6Z')).toBe('M1 2C1 2 3 4 3 4C3 4 5 4 5 4C5 4 5 6 5 6C5 6 1 2 1 2Z');
  });
  it('сохраняет cubic controls, closing curve и countershape', () => {
    expect(canonicalCubicPath('M0 0C0 1 1 1 1 0C1 -1 0 -1 0 0Z M2 2L3 2L3 3Z'))
      .toBe('M0 0C0 1 1 1 1 0C1 -1 0 -1 0 0ZM2 2C2 2 3 2 3 2C3 2 3 3 3 3C3 3 2 2 2 2Z');
  });
  it('не угадывает unsupported raw grammar', () => {
    expect(() => canonicalCubicPath('M0 0A1 1 0 0 0 1 1Z')).toThrow('неподдержанная команда A');
    expect(() => canonicalCubicPath('m0 0l1 1z')).toThrow('absolute author commands');
  });
  it('получает ожидаемый прогресс и terminal из request, без producer metadata', () => {
    expect(referenceLottieTiming({ gesture: 'reload.cycle', from: 0.17, to: 0.73, duration: 1000 })).toEqual({ from: 0.17, to: 0.73, terminalFrame: 60 });
    expect(referenceLottieTiming({ gesture: 'reload.cycle', from: 1, to: 0.3, reducedMotion: true })).toEqual({ from: 1, to: 0.3, terminalFrame: 0 });
    expect(referenceLottieTiming({})).toEqual({ from: 0, to: 0, terminalFrame: 0 });
  });
  it('принимает одинаковые nonempty pixels и отвергает blank producer', () => {
    const source = new Uint8ClampedArray([18, 52, 86, 255]);
    expect(compareLottiePixels(source, source).pass).toBe(true);
    expect(compareLottiePixels(new Uint8ClampedArray(4), source).pass).toBe(false);
  });
  it('отвергает иной RGB при сохранённой форме', () => {
    expect(compareLottiePixels(new Uint8ClampedArray([18, 52, 0, 255]), new Uint8ClampedArray([18, 52, 86, 255])).pass).toBe(false);
  });
  it('отвергает заполненный hole и смещение фрагмента', () => {
    const source = new Uint8ClampedArray([18, 52, 86, 255, 0, 0, 0, 0]);
    expect(compareLottiePixels(new Uint8ClampedArray([18, 52, 86, 255, 18, 52, 86, 255]), source).pass).toBe(false);
    expect(compareLottiePixels(new Uint8ClampedArray([0, 0, 0, 0, 18, 52, 86, 255]), source).pass).toBe(false);
  });
});
