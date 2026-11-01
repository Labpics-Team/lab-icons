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
  vi.stubGlobal('getComputedStyle', element => ({ opacity: String(element.style.opacity ?? 1) }));
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
    expect(sequence.mock.calls[1][0]).toEqual([[svg.parts[0], { opacity: [1, 0.35] }, { at: 0, duration: 0, ease: 'linear' }]]);
  });
});

describe('публичное исполнение смены знака в общей оболочке', () => {
  const replacement = () => ({
    contract: 'labpics.symbol-state-effect/1', version: 1, kind: 'enclosure-replacement',
    stages: ['question', 'confirmation', 'attention'].map((state, index) => ({
      partId: `state-${state}`, property: 'opacity', to: index === 2 ? 1 : 0, at: 0, duration: 900,
    })),
    unchangedPartIds: ['status-enclosure'], options: { duration: 900, easing: 'linear', fill: 'both' },
  });
  const viewport = () => {
    const svg = new SvgViewport();
    svg.parts = [
      ...['question', 'confirmation', 'attention'].map((state, index) => ({
        tagName: 'g', dataset: { part: `state-${state}` }, style: { opacity: index === 0 ? '0.3' : '0.7' },
      })),
      { tagName: 'path', dataset: { part: 'status-enclosure' }, style: {}, d: 'exact-author-enclosure' },
    ];
    return svg;
  };

  it('сохраняет видимую смешанную позу явными начальными значениями', () => {
    const svg = viewport(), before = svg.parts.map(part => ({ ...part.style }));
    const controls = executeSymbolEffect(svg, replacement());
    expect(sequence).toHaveBeenCalledWith([
      [svg.parts[0], { opacity: [0.3, 0] }, { at: 0, duration: 900, ease: 'linear' }],
      [svg.parts[1], { opacity: [0.7, 0] }, { at: 0, duration: 900, ease: 'linear' }],
      [svg.parts[2], { opacity: [0.7, 1] }, { at: 0, duration: 900, ease: 'linear' }],
    ], { reducedMotion: 'user' });
    expect(controls).toEqual([sequence.mock.results[0].value]);
    expect(svg.parts.map(part => part.style)).toEqual(before);
    expect(svg.parts[3].d).toBe('exact-author-enclosure');
    expect(animate).not.toHaveBeenCalled();
  });

  it.each(['path-opacity', 'enclosure-animation', 'missing-group'])('отвергает %s до исполнения', witness => {
    const svg = viewport(), effect = replacement();
    if (witness === 'path-opacity') svg.parts[0].tagName = 'path';
    if (witness === 'enclosure-animation') effect.unchangedPartIds = ['state-question'];
    if (witness === 'missing-group') effect.stages[0].partId = 'state-not-mounted';
    expect(() => executeSymbolEffect(svg, effect)).toThrow(/отдельных групп/);
    expect(sequence).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled();
  });

  it('нулевую длительность передаёт публичному reduced-motion исполнителю', () => {
    const svg = viewport(), effect = replacement();
    effect.options.duration = 0;
    effect.stages = effect.stages.map(stage => ({ ...stage, duration: 0 }));
    executeSymbolEffect(svg, effect);
    expect(sequence.mock.calls[0][1]).toEqual({ reducedMotion: 'always' });
    expect(sequence.mock.calls[0][0].every(([, properties]) => properties.opacity.length === 2)).toBe(true);
  });

  it('читает каждый видимый кадр один раз до записи и связывает только первую opacity-стадию', () => {
    const svg = viewport();
    const read = vi.fn(element => ({ opacity: element === svg.parts[0] ? '0.005' : '0.995' }));
    vi.stubGlobal('getComputedStyle', read);
    const value = { version: 2, viewport: {}, targets: [{ partId: 'state-question' }],
      options: { duration: 600, easing: 'linear' }, stages: [
        { partId: 'state-question', property: 'opacity', to: 0.35, at: 0, duration: 300 },
        { partId: 'state-question', property: 'opacity', to: 1, at: 300, duration: 300 },
      ] };
    sequence.mockImplementation(() => {
      expect(read).toHaveBeenCalledTimes(1);
      svg.parts[0].style.opacity = '0.0263333';
      return control();
    });
    executeSymbolEffect(svg, value);
    expect(sequence.mock.calls[0][0].map(([, properties]) => properties.opacity)).toEqual([[0.005, 0.35], 1]);
  });

  it.each(['', 'not-opacity'])('отказывает неопределённому видимому началу %s до admission', opacity => {
    const svg = viewport();
    vi.stubGlobal('getComputedStyle', () => ({ opacity }));
    expect(() => executeSymbolEffect(svg, replacement())).toThrow(/Не определена видимая opacity/);
    expect(sequence).not.toHaveBeenCalled();
  });
});
