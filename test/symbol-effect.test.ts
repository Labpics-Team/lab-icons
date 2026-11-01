import { describe, expect, it } from 'vitest';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import catalog from '../semantics/catalog.json';
import anatomy from '../semantics/anatomy.runtime.json';
import grid from '../semantics/grid.json';
import { compileSymbolEffect } from '../src/motion/index.js';

const { glyph, glyphCapabilities: capabilities } = createGlyphCompiler({
  catalog: { ...catalog, icons: { time: catalog.icons.time } }, anatomy, grid,
  staticIcons: {},
});

describe('объявленный эффект time.advance', () => {
  it('отказывает возможностям другой версии anchor при том же icon/variant', () => {
    const time = glyph({ icon: 'time' });
    const drifted = { ...time, parts: time.parts.map(part => part.id === 'hand-minute' ? { ...part, anchor: [0.6, 0.5] as const } : part) };
    expect(compileSymbolEffect(drifted, capabilities('time'), 'time.advance', { duration: 800 })).toMatchObject({ ok: false, reason: { code: 'CAPABILITY_MISMATCH' } });
  });

  it.each(['outline', 'filled'] as const)('сохраняет циферблат и независимые законы стрелок: %s', (variant) => {
    const result = compileSymbolEffect(glyph({ icon: 'time', variant }), capabilities('time', variant), 'time.advance', { duration: 800 });
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ ok: true, effect: { version: 1 } });
    if (!result.ok || result.effect.version !== 1) return;
    expect(result.effect.unchangedPartIds).toEqual(['dial']);
    expect(result.effect.targets.map((target) => [target.partId, target.keyframes[1].transform])).toEqual([
      ['hand-minute', 'rotate(360deg)'], ['hand-hour', 'rotate(30deg)'],
    ]);
    expect(result.effect.targets.every((target) => target.style.transformOrigin === '50% 50%')).toBe(true);
  });

  it('разворачивает движение из видимого промежуточного состояния', () => {
    const result = compileSymbolEffect(glyph({ icon: 'time' }), capabilities('time'), 'time.advance', { duration: 800, from: 0.4, to: 0 });
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ ok: true, effect: { version: 1 } });
    if (!result.ok || result.effect.version !== 1) return;
    expect(result.effect.targets[0]?.keyframes).toEqual([
      { offset: 0, transform: 'rotate(144deg)' }, { offset: 1, transform: 'rotate(0deg)' },
    ]);
    expect(result.effect.targets[1]?.keyframes[0].transform).toBe('rotate(12deg)');
  });

  it('reduced motion сохраняет конечное состояние без длительности', () => {
    const result = compileSymbolEffect(glyph({ icon: 'time' }), capabilities('time'), 'time.advance', { duration: 800, reducedMotion: true });
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ ok: true, effect: { version: 1 } });
    if (!result.ok || result.effect.version !== 1) return;
    expect(result.effect.options.duration).toBe(0);
    expect(result.effect.targets[1]?.keyframes[1].transform).toBe('rotate(30deg)');
  });

  it('отказывает неподдержанному жесту и чужому варианту', () => {
    const time = glyph({ icon: 'time' });
    expect(compileSymbolEffect(time, capabilities('time'), 'time.morph', { duration: 800 })).toMatchObject({ ok: false, reason: { code: 'GESTURE_UNSUPPORTED' } });
    expect(compileSymbolEffect(time, capabilities('time', 'filled'), 'time.advance', { duration: 800 })).toMatchObject({ ok: false, reason: { code: 'CAPABILITY_MISMATCH' } });
  });

  it('не назначает движение сырому SVG и не разделяет compound по догадке', () => {
    const time = glyph({ icon: 'time' });
    expect(compileSymbolEffect({ ...time, provenance: { kind: 'source', file: 'svg/Outline/time.svg' } }, capabilities('time'), 'time.advance', { duration: 800 })).toMatchObject({ ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' } });
    expect(compileSymbolEffect({ ...time, composition: { kind: 'compound', fillRule: 'nonzero' } }, capabilities('time'), 'time.advance', { duration: 800 })).toMatchObject({ ok: false, reason: { code: 'COMPOSITION_NOT_ADDRESSABLE' } });
  });

  it.each([NaN, Infinity, -1, 1.01])('отказывает невалидному прогрессу %s', (from) => {
    expect(compileSymbolEffect(glyph({ icon: 'time' }), capabilities('time'), 'time.advance', { duration: 800, from })).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
  });

  it('выдаёт неизменяемые данные без ссылок на изменяемые массивы capabilities', () => {
    const result = compileSymbolEffect(glyph({ icon: 'time' }), capabilities('time'), 'time.advance', { duration: 800 });
    expect(result.ok).toBe(true);
    expect(result).toMatchObject({ ok: true, effect: { version: 1 } });
    if (!result.ok || result.effect.version !== 1) return;
    expect(Object.isFrozen(result.effect)).toBe(true);
    expect(Object.isFrozen(result.effect.targets[0]?.keyframes[0])).toBe(true);
    expect(Object.isFrozen(result.effect.unchangedPartIds)).toBe(true);
  });
});
