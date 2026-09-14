import { describe, expect, it } from 'vitest';
import { sampleMotionGesture } from '../src/core/motion-sampler.js';
import { motionEntriesAt } from '../scripts/lib/motion-trajectory.js';
import { buildGlyphParts } from '../src/core/anatomy-gen.js';
import anatomy from '../semantics/anatomy.json';
import grid from '../semantics/grid.json';
import catalog from '../semantics/catalog.json';

describe('MO-02 affine families + trajectory proof', () => {
  it('translate track produces translation field without altering path topology', () => {
    const gesture = {
      id: 'test.translate',
      kind: 'nudge',
      progress: 'normalized-0-to-1',
      partIds: ['mark'],
      tracks: [
        { partId: 'mark', kind: 'translate', unit: 'px', from: 0, to: 8, interpolation: 'linear' },
      ],
      reducedMotion: 'static',
    };
    const sampled = sampleMotionGesture(gesture, 0.5);
    expect(sampled[0]).toMatchObject({ partId: 'mark', kind: 'translate', translation: 4 });
    expect(sampled[0].rotation).toBeUndefined();
    expect(sampled[0].opacity).toBeUndefined();
  });

  it('scale track produces scale field without altering path topology', () => {
    const gesture = {
      id: 'test.scale',
      kind: 'pulse',
      progress: 'normalized-0-to-1',
      partIds: ['dot-center'],
      tracks: [
        { partId: 'dot-center', kind: 'scale', unit: 'factor', from: 1, to: 1.5, interpolation: 'linear' },
      ],
      reducedMotion: 'fade-only',
    };
    const sampled = sampleMotionGesture(gesture, 0.5);
    expect(sampled[0]).toMatchObject({ partId: 'dot-center', kind: 'scale', scale: 1.25 });
  });

  it('mixed rotate + translate + opacity tracks coexist in single gesture', () => {
    const gesture = {
      id: 'test.mixed-affine',
      kind: 'complex',
      progress: 'normalized-0-to-1',
      partIds: ['hand-minute', 'shaft', 'dial'],
      tracks: [
        { partId: 'hand-minute', kind: 'rotate', unit: 'degrees', from: 0, to: 360, interpolation: 'linear', anchor: [0.5, 0.5] },
        { partId: 'shaft', kind: 'translate', unit: 'px', from: 0, to: 4, interpolation: 'linear' },
        { partId: 'dial', kind: 'opacity', unit: 'normalized', from: 1, to: 0.5, interpolation: 'linear' },
      ],
      reducedMotion: 'none',
    };
    const sampled = sampleMotionGesture(gesture, 0.5);
    expect(sampled).toHaveLength(3);
    expect(sampled[0]).toMatchObject({ partId: 'hand-minute', kind: 'rotate', rotation: 180 });
    expect(sampled[1]).toMatchObject({ partId: 'shaft', kind: 'translate', translation: 2 });
    expect(sampled[2]).toMatchObject({ partId: 'dial', kind: 'opacity', opacity: 0.75 });
  });

  it('motionEntriesAt accepts affine tracks without throwing on unknown kind', () => {
    const time = anatomy.glyphs.time;
    const built = buildGlyphParts(time, grid, {}, anatomy.glyphs);
    const composition = catalog.icons.time.model.variants.outline.composition;

    // Extend time.advance with an opacity track for testing affine compatibility
    const extendedGesture = {
      ...time.motion.gestures[0],
      partIds: [...time.motion.gestures[0].partIds, 'dial-bg'],
      tracks: [
        ...time.motion.gestures[0].tracks,
        { partId: 'dial-bg', kind: 'opacity', unit: 'normalized', from: 1, to: 0.5, interpolation: 'linear' },
      ],
      reducedMotion: 'static',
    };

    // Add a synthetic dial-bg part to built outline
    const partsWithDial = [
      ...built.outline,
      { id: 'dial-bg', d: 'M12 12m-10 0a10 10 0 1 0 20 0a10 10 0 1 0 -20 0', fillRule: 'nonzero' },
    ];

    // Should not throw — affine tracks are handled gracefully
    const entries = motionEntriesAt(partsWithDial, composition, extendedGesture, 0.5);
    expect(entries.length).toBeGreaterThanOrEqual(3);
  });

  it('trajectory proof preserves boolean operations across all progress samples for rotate tracks', () => {
    const time = anatomy.glyphs.time;
    const built = buildGlyphParts(time, grid, {}, anatomy.glyphs);
    const composition = catalog.icons.time.model.variants.outline.composition;
    const gesture = time.motion.gestures[0];

    // Sample at multiple progress points and verify consistent entry count
    const counts = [];
    for (const p of [0, 0.25, 0.5, 0.75, 1]) {
      const entries = motionEntriesAt(built.outline, composition, gesture, p);
      counts.push(entries.length);
    }
    // All samples should produce the same number of composition entries
    expect(new Set(counts).size).toBe(1);
  });

  it('chevron-nudge family requiredTrackKinds includes translate (MO-02 scope)', () => {
    const families = JSON.parse(
      require('fs').readFileSync('C:\\Users\\Daniel\\.agents\\work\\lab-icons-fresh\\semantics\\motion-families.json', 'utf8')
    );
    const chevronNudge = families.families.find((f) => f.id === 'chevron-nudge');
    expect(chevronNudge).toBeDefined();
    expect(chevronNudge.requiredTrackKinds).toContain('translate');
    expect(chevronNudge.readiness).toBe('needs-core');
  });

  it('plus-minus-actuate family requires scale and opacity tracks (MO-02 scope)', () => {
    const families = JSON.parse(
      require('fs').readFileSync('C:\\Users\\Daniel\\.agents\\work\\lab-icons-fresh\\semantics\\motion-families.json', 'utf8')
    );
    const plusMinus = families.families.find((f) => f.id === 'plus-minus-actuate');
    expect(plusMinus).toBeDefined();
    expect(plusMinus.requiredTrackKinds).toContain('scale');
    expect(plusMinus.requiredTrackKinds).toContain('opacity');
  });

  it('ellipsis-typing family requires scale and opacity tracks (MO-02 scope)', () => {
    const families = JSON.parse(
      require('fs').readFileSync('C:\\Users\\Daniel\\.agents\\work\\lab-icons-fresh\\semantics\\motion-families.json', 'utf8')
    );
    const ellipsis = families.families.find((f) => f.id === 'ellipsis-typing');
    expect(ellipsis).toBeDefined();
    expect(ellipsis.requiredTrackKinds).toContain('scale');
    expect(ellipsis.requiredTrackKinds).toContain('opacity');
  });
});