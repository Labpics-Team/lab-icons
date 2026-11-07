import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { canonicalCubicPath, compareLottiePixels, referenceLottieTiming, referenceLottieOpacity, referenceLottieGestures, referenceLottieEmptyPose, referenceNudgeTranslation, referenceNotificationTranslation, measureRawNotificationWidth } from '../scripts/bench/lottie-render.js';

describe('независимый raw author oracle Lottie', () => {
  it('каждая принятая raw law имеет точный consumer gesture, неизвестная получает отказ', () => {
    const annotations = JSON.parse(readFileSync(new URL('../semantics/author-anatomy.json', import.meta.url), 'utf8'));
    for (const [name, variants] of Object.entries(annotations.icons)) {
      for (const declaration of Object.values(variants)) {
        if (declaration.gesture === null) expect(referenceLottieGestures(name, declaration)).toEqual([]);
        else expect(referenceLottieGestures(name, declaration).length).toBeGreaterThan(0);
      }
    }
    expect(() => referenceLottieGestures('future', { gesture: { law: 'unknown' } })).toThrow('не имеет независимого oracle');
    expect(referenceLottieGestures('source-only', undefined)).toEqual([]);
    expect(referenceLottieGestures('anatomy-only', { gesture: null })).toEqual([]);
    expect(() => referenceLottieGestures('malformed', {})).toThrow('не имеет независимого oracle');
  });
  it('presence изменяет только confirmation mark в прямой, обратной и reduced конечной позе', () => {
    const annotations = JSON.parse(readFileSync(new URL('../semantics/author-anatomy.json', import.meta.url), 'utf8'));
    let variants = 0;
    for (const [name, declarations] of Object.entries(annotations.icons)) {
      for (const declaration of Object.values(declarations)) {
        if (declaration.gesture?.law !== 'confirmation.presence') continue;
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
  it('raw grammar читает весь path и отвергает junk, неверные separators и arity', () => {
    for (const d of [
      'M0 0L8 0L8 8L0 8Z#M20 20L28 20L28 28L20 28Z',
      '#M0 0L1 1Z', 'M0 0L1 1Z#', 'M,0 0L1 1Z', 'M0,,0L1 1Z',
      'M0 0,L1 1Z', 'M0 0L1 1,Z', 'M0 0L1 1Z,', 'M0\u00a00L1 1Z',
      'L1 1', 'M0 0C1 2 3 4 5Z', 'M0 0L1Z',
    ]) expect(() => canonicalCubicPath(d), d).toThrow();
  });
  it('raw grammar сохраняет допустимые comma_wsp, compact signs, decimal и exponent', () => {
    expect(canonicalCubicPath('M.5.25 L1e1,-2e0 0,-2Z'))
      .toBe('M0.5 0.25C0.5 0.25 10 -2 10 -2C10 -2 0 -2 0 -2C0 -2 0.5 0.25 0.5 0.25Z');
    expect(canonicalCubicPath('\fM1,2\tL3-4\r\nH5V6Z\f'))
      .toBe('M1 2C1 2 3 -4 3 -4C3 -4 5 -4 5 -4C5 -4 5 6 5 6C5 6 1 2 1 2Z');
  });
  it('canonical materialization отвергает binary32 overflow без порога координат', () => {
    for (const d of ['M0 0L1e39 2Z', 'M0 0L-1e39 2Z', 'M1e39 0L1 2Z',
      'M0 0C1 2 -1e39 4 5 6Z']) expect(() => canonicalCubicPath(d), d).toThrow('binary32');
    for (const value of [3.4028234663852886e38, -3.4028234663852886e38, 1e38, -1e38]) {
      const canonical = canonicalCubicPath(`M0 0L${value} 2Z`);
      expect(canonical).toContain(`${Math.fround(value)} 2`);
      expect(canonical).not.toMatch(/Infinity|NaN/);
    }
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
  it('разрешает только точную прозрачную позу, независимо заданную raw law', () => {
    const declaration = { gesture: { law: 'confirmation.presence', partId: 'mark' } };
    expect(referenceLottieEmptyPose(declaration, ['mark'], 'checkmark.presence', 0)).toBe(true);
    expect(referenceLottieEmptyPose(declaration, ['mark', 'shell'], 'checkmark.presence', 0)).toBe(false);
    expect(referenceLottieEmptyPose(declaration, ['mark'], 'checkmark.presence', 0.5)).toBe(false);
    expect(referenceLottieEmptyPose(declaration, ['mark'], undefined, 0)).toBe(false);
    expect(referenceLottieEmptyPose(declaration, [], 'checkmark.presence', 0)).toBe(false);
    const blank = new Uint8ClampedArray(4);
    const ink = new Uint8ClampedArray([18, 52, 86, 255]);
    expect(compareLottiePixels(blank, blank).pass).toBe(false);
    expect(compareLottiePixels(blank, blank, { expectedEmpty: true }).pass).toBe(true);
    expect(compareLottiePixels(new Uint8ClampedArray([18, 52, 86, 1]), blank, { expectedEmpty: true }).pass).toBe(false);
    expect(compareLottiePixels(blank, ink, { expectedEmpty: true }).pass).toBe(false);
    expect(compareLottiePixels(ink, ink, { expectedEmpty: true }).pass).toBe(false);
    expect(compareLottiePixels(new Uint8ClampedArray(0), blank, { expectedEmpty: true }).pass).toBe(false);
    expect(compareLottiePixels(new Uint8ClampedArray(0), new Uint8ClampedArray(0), { expectedEmpty: true }).pass).toBe(false);
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
  it('ring получает независимую ширину raw clapper и проверяет каждую пятую и интерполяцию', () => {
    const declaration = { gesture: { law: 'notification.ring', purpose: 'incoming-notification', partId: 'clapper' } };
    const rawWidth = 8;
    expect(referenceLottieGestures('notifications', declaration)).toEqual(['notifications.ring']);
    for (const [progress, displacement] of [[0, 0], [0.1, 1], [0.2, 2], [0.3, 0], [0.4, -2],
      [0.5, -0.5], [0.6, 1], [0.7, 0], [0.8, -1], [0.9, -0.5], [1, 0]]) {
      expect(referenceNotificationTranslation(declaration, 'clapper', 'notifications.ring', progress, rawWidth)[0]).toBeCloseTo(displacement, 12);
    }
    expect(referenceNotificationTranslation(declaration, 'bell', 'notifications.ring', 0.2, null)).toEqual([0, 0]);
    expect(referenceNotificationTranslation(declaration, 'clapper', undefined, 0.2, null)).toEqual([0, 0]);
    expect(referenceNotificationTranslation({ gesture: null }, 'clapper', undefined, 0.2, null)).toEqual([0, 0]);
    expect(referenceNotificationTranslation(declaration, 'clapper', 'notifications.ring', 0.2, 4)).toEqual([1, 0]);
    for (const width of [0, -1, NaN, Infinity]) {
      expect(() => referenceNotificationTranslation(declaration, 'clapper', 'notifications.ring', 0.2, width)).toThrow('невалидную ширину');
    }
    expect(() => referenceNotificationTranslation({ gesture: { ...declaration.gesture, purpose: 'generic-spin' } },
      'clapper', 'notifications.ring', 0.2, rawWidth)).toThrow('неизвестный смысл');
  });
  it('raw bbox измеряется на connected clone и surface удаляется при успехе и отказе', () => {
    const declaration = { gesture: { law: 'notification.ring', partId: 'clapper' }, parts: [{ id: 'clapper', pathIndex: 1 }] };
    const source = { documentElement: { identity: 'author-master' } };
    for (const outcome of [8, 0, NaN, new Error('bbox unavailable'), 'append failure']) {
      const events = []; let connected = false;
      const path = { getBBox: () => {
        events.push('bbox');
        if (!connected) return { width: 0 };
        if (outcome instanceof Error) throw outcome;
        return { width: outcome };
      } };
      const surface = { style: {}, setAttribute: () => {}, querySelectorAll: () => [null, path],
        remove: () => { events.push('remove'); connected = false; } };
      const documentOwner = { importNode: (node, deep) => {
        expect(node).toBe(source.documentElement); expect(deep).toBe(true); return surface;
      }, body: { append: node => {
        expect(node).toBe(surface); events.push('append');
        if (outcome === 'append failure') throw new Error(outcome);
        connected = true;
      } } };
      expect(path.getBBox().width).toBe(0); events.length = 0;
      if (outcome === 8) expect(measureRawNotificationWidth(declaration, source, documentOwner)).toBe(8);
      else expect(() => measureRawNotificationWidth(declaration, source, documentOwner)).toThrow(
        outcome instanceof Error ? 'bbox unavailable' : outcome === 'append failure' ? outcome : 'невалидную ширину');
      expect(events).toEqual(outcome === 'append failure' ? ['append', 'remove'] : ['append', 'bbox', 'remove']);
      expect(connected).toBe(false);
      expect(surface.style.cssText).toContain('visibility:hidden');
      expect(surface.style.cssText).not.toContain('display:none');
      expect(source.documentElement).toEqual({ identity: 'author-master' });
    }
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
