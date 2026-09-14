import { describe, expect, it } from 'vitest';
import { sampleMotionGesture, validateMotionGesture } from '../src/core/motion-sampler.js';

describe('MO-03 opacity/reveal track kinds', () => {
  const baseGesture = {
    id: 'test.reveal',
    kind: 'reveal',
    progress: 'normalized-0-to-1',
    partIds: ['mark'],
    tracks: [
      {
        partId: 'mark',
        kind: 'reveal',
        unit: 'normalized',
        from: 0,
        to: 1,
        interpolation: 'linear',
      },
    ],
    reducedMotion: 'static',
  };

  it('accepts valid reveal track with normalized unit', () => {
    expect(() => validateMotionGesture(baseGesture)).not.toThrow();
  });

  it('accepts valid opacity track with normalized unit', () => {
    const opacityGesture = {
      ...baseGesture,
      id: 'test.opacity',
      tracks: [{ ...baseGesture.tracks[0], kind: 'opacity' }],
    };
    expect(() => validateMotionGesture(opacityGesture)).not.toThrow();
  });

  it('samples reveal track as opacity value in [0,1]', () => {
    const result = sampleMotionGesture(baseGesture, 0.5);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ partId: 'mark', kind: 'reveal', opacity: 0.5 });
    expect(result[0].rotation).toBeUndefined();
  });

  it('samples opacity track at boundaries correctly', () => {
    const opacityGesture = {
      ...baseGesture,
      tracks: [{ ...baseGesture.tracks[0], kind: 'opacity', from: 1, to: 0 }],
    };
    expect(sampleMotionGesture(opacityGesture, 0)[0].opacity).toBe(1);
    expect(sampleMotionGesture(opacityGesture, 1)[0].opacity).toBe(0);
    expect(sampleMotionGesture(opacityGesture, 0.25)[0].opacity).toBeCloseTo(0.75);
  });

  it('rejects reveal track without normalized unit', () => {
    const badUnit = {
      ...baseGesture,
      tracks: [{ ...baseGesture.tracks[0], unit: 'degrees' }],
    };
    expect(() => validateMotionGesture(badUnit)).toThrow(/unit=normalized/);
  });

  it('rejects opacity track with values outside [0,1]', () => {
    const outOfRange = {
      ...baseGesture,
      tracks: [{ ...baseGesture.tracks[0], kind: 'opacity', from: 0, to: 1.5 }],
    };
    expect(() => validateMotionGesture(outOfRange)).toThrow(/\[0,1\]/);
  });

  it('rejects reveal track with negative from value', () => {
    const negative = {
      ...baseGesture,
      tracks: [{ ...baseGesture.tracks[0], from: -0.1, to: 1 }],
    };
    expect(() => validateMotionGesture(negative)).toThrow(/\[0,1\]/);
  });

  it('validates mixed rotate + opacity tracks in same gesture', () => {
    const mixed = {
      id: 'test.mixed',
      kind: 'clock-with-fade',
      progress: 'normalized-0-to-1',
      partIds: ['hand-minute', 'dial'],
      tracks: [
        {
          partId: 'hand-minute',
          kind: 'rotate',
          unit: 'degrees',
          from: 0,
          to: 360,
          interpolation: 'linear',
          anchor: [0.5, 0.5],
        },
        {
          partId: 'dial',
          kind: 'opacity',
          unit: 'normalized',
          from: 1,
          to: 0.5,
          interpolation: 'linear',
        },
      ],
      reducedMotion: 'fade-only',
    };
    expect(() => validateMotionGesture(mixed)).not.toThrow();
    const sampled = sampleMotionGesture(mixed, 0.5);
    expect(sampled).toHaveLength(2);
    expect(sampled[0]).toMatchObject({ partId: 'hand-minute', kind: 'rotate', rotation: 180 });
    expect(sampled[1]).toMatchObject({ partId: 'dial', kind: 'opacity', opacity: 0.75 });
  });

  it('translate and scale tracks produce correct sample fields', () => {
    const multiKind = {
      id: 'test.multi',
      kind: 'multi',
      progress: 'normalized-0-to-1',
      partIds: ['a', 'b'],
      tracks: [
        { partId: 'a', kind: 'translate', unit: 'px', from: 0, to: 10, interpolation: 'linear' },
        { partId: 'b', kind: 'scale', unit: 'factor', from: 1, to: 2, interpolation: 'linear' },
      ],
      reducedMotion: 'none',
    };
    expect(() => validateMotionGesture(multiKind)).not.toThrow();
    const sampled = sampleMotionGesture(multiKind, 0.5);
    expect(sampled[0]).toMatchObject({ partId: 'a', kind: 'translate', translation: 5 });
    expect(sampled[1]).toMatchObject({ partId: 'b', kind: 'scale', scale: 1.5 });
  });
});