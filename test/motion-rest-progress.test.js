import { describe, expect, it } from 'vitest';
import { validateMotionGesture, sampleMotionGesture } from '../src/core/motion-sampler.js';

const gesture = {
  id: 'signal.level', kind: 'state', meaning: 'Уровень сигнала',
  partIds: ['band'], progress: 'normalized-0-to-1', restProgress: 1,
  tracks: [{ partId: 'band', kind: 'opacity', unit: 'fraction', interpolation: 'linear',
    stops: [{ at: 0, value: 0 }, { at: 1, value: 1 }] }],
};

describe('Семантическая поза неподвижного мастера', () => {
  it('объявляет конечную авторскую позу без изменения шкалы и поддерживает прежний контракт', () => {
    expect(validateMotionGesture(gesture)).toBe(gesture);
    expect(sampleMotionGesture(gesture, gesture.restProgress)).toEqual([{ partId: 'band', kind: 'opacity', opacity: 1 }]);
    const { restProgress, ...legacy } = gesture;
    expect(validateMotionGesture(legacy)).toBe(legacy);
    expect(sampleMotionGesture(legacy, 0)).toEqual([{ partId: 'band', kind: 'opacity', opacity: 0 }]);
  });

  it.each([NaN, Infinity, -0.001, 1.001, null, '1'])('отказывает невалидной restProgress %s', restProgress => {
    expect(() => validateMotionGesture({ ...gesture, restProgress })).toThrow(/progress/);
  });
});
