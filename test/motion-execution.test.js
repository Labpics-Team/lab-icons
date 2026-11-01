import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animate, sequence } from '@labpics/motion';

vi.mock('@labpics/motion', () => ({ animate: vi.fn(), sequence: vi.fn() }));
vi.stubGlobal('__MOTION_IDENTITY__', { package: '@labpics/motion', version: '0.5.0' });
const { executeSymbolEffect } = await import('../observatory/motion-execution.js');

class SvgViewport {
  style = {};
  parts = [{ dataset: { part: 'direction-body' }, style: {}, d: 'authored' }];
  querySelectorAll() { return this.parts; }
}
const control = () => ({ stop: vi.fn() });
const effect = () => ({
  version: 3, viewport: { overflow: 'visible' }, options: { duration: 800, easing: 'linear' },
  targets: [{ partId: 'direction-body', property: 'x', unit: 'viewBox', from: 1.5, to: 0 }],
  stages: [
    { partId: 'direction-body', property: 'x', unit: 'viewBox', to: 3, at: 0, duration: 400 },
    { partId: 'direction-body', property: 'x', unit: 'viewBox', to: 0, at: 400, duration: 400 },
  ],
});

beforeEach(() => {
  vi.stubGlobal('SVGElement', SvgViewport);
  sequence.mockReturnValue(control()); animate.mockReturnValue(control());
});
afterEach(() => { vi.clearAllMocks(); });

describe('публичное исполнение semantic translation', () => {
  it('передаёт новый interval скалярным stages, сохраняя pickup текущей позы', () => {
    const svg = new SvgViewport();
    const controls = executeSymbolEffect(svg, effect());
    expect(sequence).toHaveBeenCalledWith([
      [svg.parts[0], { x: 3 }, { at: 0, duration: 400, ease: 'linear' }],
      [svg.parts[0], { x: 0 }, { at: 400, duration: 400, ease: 'linear' }],
    ], { reducedMotion: 'user' });
    expect(controls).toEqual([sequence.mock.results[0].value]);
    expect(animate).not.toHaveBeenCalled();
    expect(svg.parts[0].d).toBe('authored');
    expect(svg.style.overflow).toBe('visible');
  });

  it('инициализирует первую позу отдельно от последующих scalar stages', () => {
    const svg = new SvgViewport();
    executeSymbolEffect(svg, effect(), { initialize: true });
    expect(sequence.mock.calls[0][0].map(stage => stage[1])).toEqual([{ x: [1.5, 3] }, { x: 0 }]);
    const vertical = effect();
    vertical.targets[0].property = 'y';
    vertical.stages = vertical.stages.map(stage => ({ ...stage, property: 'y' }));
    executeSymbolEffect(svg, vertical, { initialize: true });
    expect(sequence.mock.calls[1][0].map(stage => stage[1])).toEqual([{ y: [1.5, 3] }, { y: 0 }]);
  });

  it.each(['unit', 'property', 'partId'])('отказывает незаявленной %s до записи и исполнения', key => {
    const svg = new SvgViewport(), value = effect();
    value.stages[0][key] = key === 'property' ? 'opacity' : 'other';
    expect(() => executeSymbolEffect(svg, value)).toThrow(/объявленной x\/y цели/);
    expect(svg.style).toEqual({});
    expect(sequence).not.toHaveBeenCalled(); expect(animate).not.toHaveBeenCalled();
  });

  it('reduced motion передаётся штатному исполнителю и сохраняет прежнюю opacity ветку', () => {
    const svg = new SvgViewport(), value = effect();
    value.options.duration = 0;
    value.stages = [{ ...value.stages[1], at: 0, duration: 0 }];
    executeSymbolEffect(svg, value);
    expect(sequence.mock.calls[0][1]).toEqual({ reducedMotion: 'always' });
    const opacity = { ...value, version: 2, targets: [{ partId: 'direction-body' }],
      stages: [{ partId: 'direction-body', property: 'opacity', to: 0.35, at: 0, duration: 0 }] };
    executeSymbolEffect(svg, opacity);
    expect(sequence.mock.calls[1][0]).toEqual([[svg.parts[0], { opacity: 0.35 }, { at: 0, duration: 0, ease: 'linear' }]]);
  });
});
