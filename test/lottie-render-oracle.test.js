import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalCubicPath, compareLottiePixels, referenceLottieTiming, referenceLottieOpacity, referenceLottieGestures, referenceNudgeTranslation } from '../scripts/bench/lottie-render.js';

describe('независимый raw author oracle Lottie', () => {
  it('каждая принятая raw law имеет точный consumer gesture, неизвестная получает отказ', () => {
    const annotations = JSON.parse(readFileSync(new URL('../semantics/author-anatomy.json', import.meta.url), 'utf8'));
    for (const [name, variants] of Object.entries(annotations.icons)) {
      for (const declaration of Object.values(variants)) {
        expect(referenceLottieGestures(name, declaration).length).toBeGreaterThan(0);
      }
    }
    expect(() => referenceLottieGestures('future', { gesture: { law: 'unknown' } })).toThrow('не имеет независимого oracle');
    expect(referenceLottieGestures('source-only', undefined)).toEqual([]);
  });
  it('presence изменяет только confirmation mark в прямой, обратной и reduced конечной позе', () => {
    const annotations = JSON.parse(readFileSync(new URL('../semantics/author-anatomy.json', import.meta.url), 'utf8'));
    let variants = 0;
    for (const [name, declarations] of Object.entries(annotations.icons)) {
      for (const declaration of Object.values(declarations)) {
        if (declaration.gesture.law !== 'confirmation.presence') continue;
        variants++;
        expect(referenceLottieGestures(name, declaration)).toEqual([`${name}.presence`]);
        for (const progress of [0, 0.25, 0.5, 0.75, 1]) {
          expect(referenceLottieOpacity(declaration, declaration.gesture.partId, `${name}.presence`, progress)).toBe(progress);
          expect(referenceLottieOpacity(declaration, 'unchanged-enclosure', `${name}.presence`, progress)).toBe(1);
          expect(referenceLottieOpacity(declaration, declaration.gesture.partId, undefined, progress)).toBe(1);
        }
      }
    }
    expect(variants).toBe(5);
  });
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
    for (const frameRate of [24, 30, 60, 120]) {
      expect(referenceLottieTiming({ gesture: 'reload.cycle', duration: 1000 / frameRate, frameRate }))
        .toEqual({ from: 0, to: 1, terminalFrame: 1 });
    }
    expect(referenceLottieTiming({ gesture: 'reload.cycle', from: 0.37, to: 0.37, duration: 1000 }))
      .toEqual({ from: 0.37, to: 0.37, terminalFrame: 0 });
  });
  it('принимает одинаковые nonempty pixels и отвергает blank producer', () => {
    const source = new Uint8ClampedArray([18, 52, 86, 255]);
    expect(compareLottiePixels(source, source).pass).toBe(true);
    expect(compareLottiePixels(new Uint8ClampedArray(4), source).pass).toBe(false);
  });
  it('direction.nudge выводится из physical direction и actual raw axis span', () => {
    const annotation = direction => ({ gesture: { law: 'direction.nudge', partId: 'body', direction } });
    const viewport = [11, -3, 32, 16];
    for (const [direction, peak] of [['left', [-4, 0]], ['right', [4, 0]], ['up', [0, -2]], ['down', [0, 2]]]) {
      expect(referenceNudgeTranslation(annotation(direction), 'body', 'test.nudge', 0, viewport)).toEqual([0, 0]);
      expect(referenceNudgeTranslation(annotation(direction), 'body', 'test.nudge', 0.5, viewport)).toEqual(peak);
      expect(referenceNudgeTranslation(annotation(direction), 'body', 'test.nudge', 0.25, viewport)).toEqual(peak.map(value => value / 2));
      expect(referenceNudgeTranslation(annotation(direction), 'body', 'test.nudge', 0.75, viewport)).toEqual(peak.map(value => value / 2));
      expect(referenceNudgeTranslation(annotation(direction), 'body', 'test.nudge', 1, viewport)).toEqual([0, 0]);
    }
    expect(referenceNudgeTranslation(annotation('right'), 'other-part', 'test.nudge', 0.5, viewport)).toEqual([0, 0]);
    expect(referenceNudgeTranslation(annotation('right'), 'body', undefined, 0.5, viewport)).toEqual([0, 0]);
    expect(() => referenceNudgeTranslation(annotation('logical-start'), 'body', 'test.nudge', 0.5, viewport)).toThrow('неизвестное направление');
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
