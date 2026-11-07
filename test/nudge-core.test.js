import { describe, expect, it } from 'vitest';
import { sampleMotionGesture, validateMotionGesture } from '../src/core/motion-sampler.js';
import { compileSymbolEffect } from '../src/motion/index.js';
import { lottieSymbols } from './helpers/lottie-symbols.js';
import { motionEntriesAt, proveMotionTrajectory } from '../scripts/lib/motion-trajectory.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import grid from '../semantics/grid.json';

const gesture = { id: 'chevron-forward.nudge', kind: 'cycle', partIds: ['direction-body'],
  progress: 'normalized-0-to-1', restProgress: 0, tracks: [{ partId: 'direction-body', kind: 'translate',
    axis: 'x', unit: 'viewBox', interpolation: 'linear', stops: [{ at: 0, value: 0 }, { at: 0.5, value: 3 }, { at: 1, value: 0 }] }] };

describe('направленное движение в единицах viewBox', () => {
  it('разные жесты одной части сохраняют оба translation канала', () => {
    const gestures = ['x', 'y'].map(axis => ({ ...gesture, id: `direction.${axis}`, tracks: [{ ...gesture.tracks[0], axis }] }));
    const source = { parts: [{ id: 'direction-body' }], anatomy: {}, gestures };
    const compiler = createGlyphCompiler({ catalog: { axes: {}, icons: { 'arrow-forward': { model: null, source: { outline: source, filled: source } } } },
      anatomy: { glyphs: {} }, grid, staticIcons: {} });
    expect(compiler.glyphCapabilities('arrow-forward', 'outline').motion.tracks).toEqual([
      { id: 'translate.x.direction-body', kind: 'translate', partIds: ['direction-body'], axis: 'x', unit: 'viewBox' },
      { id: 'translate.y.direction-body', kind: 'translate', partIds: ['direction-body'], axis: 'y', unit: 'viewBox' },
    ]);
  });

  it('старый fixed-canvas proof явно отказывает translation вместо неподвижного ложного PASS', () => {
    const parts = [{ id: 'direction-body', d: 'M1 1L3 1L3 3L1 3Z' }];
    const composition = { kind: 'layers', order: ['direction-body'] };
    for (const progress of [0, 0.5]) {
      expect(() => motionEntriesAt(parts, composition, gesture, progress)).toThrowError(
        expect.objectContaining({ code: 'MOTION_PROOF_UNSUPPORTED', partId: 'direction-body', trackKind: 'translate' }),
      );
    }
    expect(() => proveMotionTrajectory({ parts, composition, gesture, progressSamples: [0, 0.5], rasterSizes: [8], phases: [[0.5, 0.5]] })).toThrowError(
      expect.objectContaining({ code: 'MOTION_PROOF_UNSUPPORTED' }),
    );
    const rotation = { ...gesture, tracks: [{ partId: 'direction-body', kind: 'rotate', unit: 'degrees', interpolation: 'linear', anchor: [0.5, 0.5], from: 0, to: 0 }] };
    expect(motionEntriesAt(parts, composition, rotation, 0.5)[0].d).toBe(parts[0].d);
  });

  it('сохраняет разные фазы одинаковой позы и неподвижные endpoints', () => {
    for (const [progress, translation] of [[0, 0], [0.25, 1.5], [0.5, 3], [0.75, 1.5], [1, 0]]) {
      expect(sampleMotionGesture(gesture, progress)).toEqual([{ partId: 'direction-body', kind: 'translate', axis: 'x', unit: 'viewBox', translation }]);
    }
    expect(sampleMotionGesture(gesture, 0.25 - 0.01)[0].translation).toBeLessThan(1.5);
    expect(sampleMotionGesture(gesture, 0.75 - 0.01)[0].translation).toBeGreaterThan(1.5);
  });

  it('не допускает неявные единицы, неизвестную ось, нечисловые значения и двойное владение частью', () => {
    for (const patch of [{ axis: 'z' }, { unit: 'px' }, { interpolation: 'spring' }, { hidden: true },
      { stops: [{ at: 0, value: 0 }, { at: 1, value: Infinity }] },
      { stops: [{ at: 0, value: 0 }, { at: 0, value: 3 }, { at: 1, value: 0 }] }]) {
      expect(() => validateMotionGesture({ ...gesture, tracks: [{ ...gesture.tracks[0], ...patch }] })).toThrow();
    }
    expect(() => validateMotionGesture({ ...gesture, tracks: [gesture.tracks[0], { ...gesture.tracks[0], axis: 'y' }] })).toThrow('два track');
  });

  it('интерполирует большие противоположные координаты без переполнения', () => {
    const large = { ...gesture, tracks: [{ ...gesture.tracks[0], stops: [{ at: 0, value: -Number.MAX_VALUE }, { at: 1, value: Number.MAX_VALUE }] }] };
    expect(sampleMotionGesture(large, 0.5)[0].translation).toBe(0);
  });

  it('компилирует разные продолжения одинаковой позы по принятой фазе, сохраняя авторский path', () => {
    const symbols = lottieSymbols();
    for (const name of ['chevron-forward', 'arrow-forward']) for (const variant of ['outline', 'filled']) {
      const symbol = symbols[name].symbol, glyph = symbol.glyph({ variant }), caps = symbol.glyphCapabilities(variant);
      const d = glyph.parts.map(part => part.d);
      const outbound = compileSymbolEffect(glyph, caps, `${name}.nudge`, { duration: 800, from: 0.25, to: 0 });
      const inbound = compileSymbolEffect(glyph, caps, `${name}.nudge`, { duration: 800, from: 0.75, to: 0 });
      expect(outbound).toMatchObject({ ok: true, effect: { version: 3, targets: [{ partId: 'direction-body', property: 'x', unit: 'viewBox', from: 1.5, to: 0 }] } });
      expect(inbound).toMatchObject({ ok: true, effect: { version: 3, targets: [{ from: 1.5, to: 0 }] } });
      expect(outbound.effect.stages[0].to).toBe(0);
      expect(inbound.effect.stages[0].to).toBe(3);
      expect(outbound.effect.stages.at(-1).at + outbound.effect.stages.at(-1).duration).toBe(800);
      expect(inbound.effect.stages.at(-1).at + inbound.effect.stages.at(-1).duration).toBe(800);
      expect(glyph.parts.map(part => part.d)).toEqual(d);
      expect(Object.isFrozen(inbound.effect.stages[0])).toBe(true);
      const reduced = compileSymbolEffect(glyph, caps, `${name}.nudge`, { duration: 800, from: 0.37, to: 1, reducedMotion: true });
      expect(reduced).toMatchObject({ ok: true, effect: { version: 3, options: { duration: 0 }, stages: [{ at: 0, duration: 0, to: 0 }] } });
    }
  });
});
