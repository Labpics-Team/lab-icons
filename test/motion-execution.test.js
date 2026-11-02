import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { animate, sequence, value } from '@labpics/motion';

vi.mock('@labpics/motion', () => ({ animate: vi.fn(), sequence: vi.fn(), value: vi.fn() }));
vi.stubGlobal('__MOTION_IDENTITY__', { package: '@labpics/motion', version: '0.5.0' });
const { executeSymbolEffect } = await import('../observatory/motion-execution.js');

class SvgViewport {
  style = {};
  parts = [{ dataset: { part: 'direction-body' }, style: {}, d: 'authored' }];
  querySelectorAll() { return this.parts; }
}
const control = () => ({ stop: vi.fn() });
function scalarClock(initial) {
  let current = initial, target = initial, elapsed = 0, resolve;
  const listeners = new Set();
  const publish = progress => {
    current = progress;
    if (target !== initial) elapsed = (progress - initial) / (target - initial) * playback.duration;
    for (const listener of listeners) listener(progress);
  };
  const sample = () => publish(playback.duration ? initial + (target - initial) * Math.min(elapsed / playback.duration, 1) : target);
  const playback = {
    state: 'running', duration: 0, finished: new Promise(done => { resolve = done; }),
    pause: vi.fn(() => { if (playback.state === 'running') { sample(); playback.state = 'paused'; } }),
    play: vi.fn(() => { playback.state = 'running'; }),
    seek: vi.fn(time => publish(initial + (target - initial) * time / playback.duration)),
    stop: vi.fn(() => {
      if (!['finished', 'stopped'].includes(playback.state)) { playback.state = 'stopped'; resolve({ status: 'stopped' }); }
    }),
    finish: vi.fn(() => { publish(target); playback.state = 'finished'; resolve({ status: 'finished' }); }),
  };
  const unsubscribe = vi.fn(() => listeners.clear());
  return {
    playback, publish, unsubscribe, advanceTime: milliseconds => { elapsed += milliseconds; }, get: vi.fn(() => current),
    subscribe: vi.fn(listener => { listeners.add(listener); return unsubscribe; }),
    animate: vi.fn((next, options) => {
      target = next; playback.duration = options.duration;
      if (!options.duration) playback.finish();
      return playback;
    }),
    dispose: vi.fn(() => { listeners.clear(); playback.stop(); }),
  };
}
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
  value.mockImplementation(scalarClock);
});
afterEach(() => { vi.clearAllMocks(); });

describe('публичное исполнение подготовленного contour-перехода', () => {
  const transition = () => ({
    contract: 'labpics.symbol-state-effect/1', version: 1, kind: 'contour-interpolation', from: 0.37, to: 1,
    targets: ['first-dot', 'third-dot'].map(partId => ({ partId, property: 'd' })),
    unchangedPartIds: ['middle-dot'], options: { duration: 900, easing: 'linear', fill: 'both' },
  });
  const viewport = () => {
    const svg = new SvgViewport();
    svg.parts = ['first-dot', 'middle-dot', 'third-dot'].map(part => ({
      tagName: 'path', dataset: { part }, d: `${part}-author`,
      setAttribute: vi.fn(function (key, value) { this[key] = value; }),
    }));
    svg.querySelectorAll = vi.fn(() => svg.parts);
    return svg;
  };
  const prepared = () => ({ ok: true, sample: vi.fn(progress => ({ ok: true,
    parts: ['first-dot', 'third-dot'].map(partId => ({ partId, d: `${partId}-pose-${progress}` })),
  })) });

  it('один раз связывает path-узлы и сообщает именно записанный кадр', () => {
    const svg = viewport(), effect = transition(), sampler = prepared();
    const frames = [];
    const controls = executeSymbolEffect(svg, effect, { preparedContour: sampler,
      onProgress: progress => frames.push({ progress, paths: svg.parts.map(part => part.d) }) });
    const clock = value.mock.results[0].value;
    expect(value).toHaveBeenCalledWith(0.37);
    expect(clock.animate).toHaveBeenCalledWith(1, { duration: 900, ease: 'linear', reducedMotion: 'user' });
    for (const progress of [0.4, 0.7, 0.9]) clock.publish(progress);
    expect(frames).toEqual([0.37, 0.4, 0.7, 0.9].map(progress => ({ progress,
      paths: [`first-dot-pose-${progress}`, 'middle-dot-author', `third-dot-pose-${progress}`] })));
    expect(svg.querySelectorAll).toHaveBeenCalledTimes(1);
    expect(svg.parts[1].setAttribute).not.toHaveBeenCalled();
    expect(animate).not.toHaveBeenCalled(); expect(sequence).not.toHaveBeenCalled();
    controls[0].stop();
  });

  it('делегирует playback и освобождает подписку один раз, сохраняя остановленную позу', async () => {
    const svg = viewport();
    const [control] = executeSymbolEffect(svg, transition(), { preparedContour: prepared() });
    const clock = value.mock.results[0].value;
    expect(control.duration).toBe(900);
    control.pause(); expect(control.state).toBe('paused');
    control.seek(450); expect(clock.playback.seek).toHaveBeenCalledWith(450);
    expect(svg.parts[0].d).toBe('first-dot-pose-0.685');
    control.play(); expect(control.state).toBe('running');
    control.stop(); control.stop();
    expect(await control.finished).toEqual({ status: 'stopped' });
    expect(control.state).toBe('stopped');
    expect(clock.unsubscribe).toHaveBeenCalledTimes(1); expect(clock.dispose).toHaveBeenCalledTimes(1);
    clock.publish(1);
    expect(svg.parts[0].d).toBe('first-dot-pose-0.685');
    expect(svg.parts[1].d).toBe('middle-dot-author');
  });

  it('различает точный admission и более позднюю позу pause публичного Motion 0.5', async () => {
    const { value: publicValue } = await vi.importActual('@labpics/motion');
    const svg = viewport(), effect = transition(), sampler = prepared(), frames = [];
    effect.to = 0;
    let now = 100;
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => now);
    value.mockImplementation(publicValue);
    let control;
    try {
      [control] = executeSymbolEffect(svg, effect, { preparedContour: sampler,
        onProgress: progress => frames.push({ progress, paths: svg.parts.map(part => part.d) }) });
      expect(frames).toEqual([{ progress: 0.37, paths: ['first-dot-pose-0.37', 'middle-dot-author', 'third-dot-pose-0.37'] }]);
      now += 5;
      control.pause();
      const paused = 0.37 + (0 - 0.37) * 5 / 900;
      expect(control.state).toBe('paused');
      expect(frames.at(-1).progress).toBeCloseTo(paused, 15);
      expect(frames.at(-1).progress).not.toBe(0.37);
      expect(frames.at(-1).paths).toEqual([`first-dot-pose-${frames.at(-1).progress}`, 'middle-dot-author', `third-dot-pose-${frames.at(-1).progress}`]);
      const snapshot = svg.parts.map(part => part.d), count = frames.length;
      now += 50;
      control.pause();
      expect(frames).toHaveLength(count); expect(svg.parts.map(part => part.d)).toEqual(snapshot);
      control.stop(); expect(await control.finished).toEqual({ status: 'stopped' });
      expect(svg.parts[1].setAttribute).not.toHaveBeenCalled();
    } finally { control?.stop(); clock.mockRestore(); }
  });

  it.each([0, 900])('завершает и освобождает clock при duration=%s', async duration => {
    const svg = viewport(), effect = transition(); effect.options.duration = duration;
    const [control] = executeSymbolEffect(svg, effect, { preparedContour: prepared() });
    const clock = value.mock.results[0].value;
    expect(clock.animate.mock.calls[0][1].reducedMotion).toBe(duration ? 'user' : 'always');
    if (duration) control.finish();
    expect(await control.finished).toEqual({ status: 'finished' });
    expect(svg.parts[0].d).toBe('first-dot-pose-1');
    expect(clock.unsubscribe).toHaveBeenCalledTimes(1); expect(clock.dispose).toHaveBeenCalledTimes(1);
    expect(svg.parts[1].setAttribute).not.toHaveBeenCalled();
  });

  it.each(['admission', 'playback'])('освобождает подписку при отказе Motion на границе %s', async boundary => {
    const clock = scalarClock(0.37), failure = new Error('Motion отказал');
    value.mockReturnValue(clock);
    if (boundary === 'admission') {
      clock.animate.mockImplementation(() => { throw failure; });
      expect(() => executeSymbolEffect(viewport(), transition(), { preparedContour: prepared() })).toThrow(failure);
    } else {
      clock.playback.state = 'failed'; clock.playback.finished = Promise.reject(failure);
      const [control] = executeSymbolEffect(viewport(), transition(), { preparedContour: prepared() });
      await expect(control.finished).rejects.toThrow(failure);
    }
    expect(clock.unsubscribe).toHaveBeenCalledTimes(1); expect(clock.dispose).toHaveBeenCalledTimes(1);
  });

  it.each(['missing-path', 'group-target', 'wrong-property', 'moving-middle'])('отказывает %s до clock и записей', witness => {
    const svg = viewport(), effect = transition();
    if (witness === 'missing-path') effect.targets[0].partId = 'absent';
    if (witness === 'group-target') svg.parts[0].tagName = 'g';
    if (witness === 'wrong-property') effect.targets[0].property = 'opacity';
    if (witness === 'moving-middle') effect.unchangedPartIds.push('first-dot');
    expect(() => executeSymbolEffect(svg, effect, { preparedContour: prepared() })).toThrow(/подготовленных контуров/);
    expect(value).not.toHaveBeenCalled();
    expect(svg.parts.every(part => !part.setAttribute.mock.calls.length)).toBe(true);
  });

  it.each(['refusal', 'wrong-part', 'missing-data'])('отказывает начальной pose %s без частичных записей', witness => {
    const svg = viewport(), sampler = prepared();
    sampler.sample.mockImplementation(() => witness === 'refusal' ? { ok: false,
      reason: { code: 'POSE_UNREPRESENTABLE', message: 'не представима' } } : { ok: true, parts: [
      { partId: 'first-dot', d: 'valid-first' },
      { partId: witness === 'wrong-part' ? 'other' : 'third-dot', ...(witness !== 'missing-data' && { d: 'valid-third' }) },
    ] });
    expect(() => executeSymbolEffect(svg, transition(), { preparedContour: sampler })).toThrow();
    expect(value).not.toHaveBeenCalled();
    expect(svg.parts.every(part => !part.setAttribute.mock.calls.length)).toBe(true);
  });
});
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

  it.each([900, 0])('исполняет source replacement без выдуманной оболочки, duration=%s', duration => {
    const svg = viewport(), effect = replacement();
    effect.kind = 'source-replacement';
    effect.unchangedPartIds = [];
    effect.options.duration = duration;
    effect.stages = effect.stages.slice(0, 2).map((stage, index) => ({ ...stage, to: index, duration }));
    svg.parts = svg.parts.slice(0, 2);
    const before = svg.parts.map(part => ({ ...part.style }));
    const controls = executeSymbolEffect(svg, effect);
    expect(sequence).toHaveBeenCalledWith([
      [svg.parts[0], { opacity: [0.3, 0] }, { at: 0, duration, ease: 'linear' }],
      [svg.parts[1], { opacity: [0.7, 1] }, { at: 0, duration, ease: 'linear' }],
    ], { reducedMotion: duration ? 'user' : 'always' });
    expect(controls).toEqual([sequence.mock.results[0].value]);
    expect(svg.parts.map(part => part.style)).toEqual(before);
    expect(animate).not.toHaveBeenCalled();
  });

  it.each(['unknown-kind', 'source-shared-part', 'source-path-target', 'source-missing-group'])('отказывает %s до допуска Lab Motion', witness => {
    const svg = viewport(), effect = replacement();
    effect.kind = 'source-replacement';
    effect.unchangedPartIds = [];
    if (witness === 'unknown-kind') effect.kind = 'unknown-replacement';
    if (witness === 'source-shared-part') effect.unchangedPartIds = ['status-enclosure'];
    if (witness === 'source-path-target') svg.parts[0].tagName = 'path';
    if (witness === 'source-missing-group') effect.stages[0].partId = 'not-mounted';
    expect(() => executeSymbolEffect(svg, effect)).toThrow(/отдельных групп/);
    expect(sequence).not.toHaveBeenCalled();
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

