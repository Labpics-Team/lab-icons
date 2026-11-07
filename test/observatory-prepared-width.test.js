import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../observatory/motion-execution.js', import.meta.url), 'utf8');
const functionSource = source.slice(source.indexOf('function executePreparedScalar'), source.indexOf('\nfunction contourEffect')).replace(/^export /gm, '');

function fixture({ compound = false, reducedMotion = false } = {}) {
  const selector = compound ? '[data-parts="enclosure support body"]' : '[data-part="body"]';
  const prepared = { version: 1, law: 'capsule.width', renderTarget: { selector, attribute: 'd' },
    sample(width) {
      if (!Number.isFinite(width)) return { ok: false, reason: { code: 'INVALID_REQUEST', message: 'Finite width required.' } };
      if (width < .8 || width > 1) return { ok: false, reason: { code: 'VARIATION_OUTSIDE_DOMAIN', message: 'Outside optical domain.' } };
      return { ok: true, bodyWidth: width, d: `${compound ? 'M0 0H24V24Z' : ''}M${width} 1L${width} 2Z` };
    } };
  const writes = [], clocks = [];
  class Viewport {
    constructor() { this.path = { tagName: 'path', d: prepared.sample(1).d,
      getAttribute(name) { return name === 'd' ? this.d : null; },
      setAttribute(name, d) { expect(name).toBe('d'); this.d = d; writes.push(d); } }; }
    querySelectorAll(requested) { expect(requested).toBe(selector); return [this.path]; }
  }
  const viewports = [new Viewport(), new Viewport(), new Viewport(), new Viewport()];
  const value = initial => {
    let resolve, reject;
    const clock = { current: initial, disposed: false, listener: null,
      subscribe(listener) { this.listener = listener; this.saved = listener; return () => { this.listener = null; }; },
      dispose() {
        if (this.disposed) return;
        this.disposed = true;
        this.listener = null;
        if (['running', 'paused'].includes(this.playback?.state)) this.playback.stop();
      },
      emit(width) { this.current = width; this.listener?.(width); },
      animate(to, options) {
        this.options = options;
        const playback = { state: 'running', duration: options.duration,
          finished: new Promise((yes, no) => { resolve = yes; reject = no; }),
          pause() { this.state = 'paused'; }, play() { this.state = 'running'; },
          seek: width => clock.emit(width),
          finish() { clock.emit(to); this.state = 'finished'; resolve({ status: 'finished' }); },
          stop() { this.state = 'stopped'; resolve({ status: 'stopped' }); },
          fail: error => reject(error) };
        this.playback = playback;
        if (options.duration === 0) playback.finish();
        return playback;
      } };
    clocks.push(clock); return clock;
  };
  const execute = new Function('value', 'SVGElement', `${functionSource}\nreturn executePreparedWidth;`)(value, Viewport);
  const request = { from: 1, to: .8, duration: 900, reducedMotion };
  return { execute, prepared, request, viewports, writes, clocks };
}

describe('prepared width consumer исполняет физический d через публичный scalar', () => {
  it.each([false, true])('один sample обновляет четыре viewport, compound=%s, без изменения кадра/других paths', async compound => {
    const f = fixture({ compound }), observed = [];
    const [control] = f.execute(f.viewports, f.prepared, f.request, { onProgress: width => observed.push(width) });
    expect(f.clocks).toHaveLength(1);
    f.clocks[0].emit(.92);
    expect(f.viewports.map(svg => svg.path.d)).toEqual(Array(4).fill(f.prepared.sample(.92).d));
    expect(observed.at(-1)).toBe(.92);
    expect(f.writes).toHaveLength(4);
    f.clocks[0].emit(.92);
    expect(f.writes).toHaveLength(4);
    control.pause(); expect(control.state).toBe('paused');
    control.play(); expect(control.state).toBe('running');
    control.finish(); await expect(control.finished).resolves.toEqual({ status: 'finished' });
    expect(f.clocks[0].disposed).toBe(true);
    expect(f.viewports.every(svg => svg.path.d === f.prepared.sample(.8).d)).toBe(true);
  });

  it('прерывание подхватывает последнюю записанную ширину и закрывает сохранённый callback', async () => {
    const f = fixture(), observed = [];
    const [old] = f.execute(f.viewports, f.prepared, f.request, { onProgress: width => observed.push(width) });
    f.clocks[0].emit(.93);
    const saved = f.clocks[0].saved, before = f.viewports[0].path.d;
    const [next] = f.execute(f.viewports, f.prepared, { ...f.request, from: observed.at(-1), to: 1 });
    old.stop();
    expect(f.viewports[0].path.d).toBe(before);
    saved(.8);
    expect(f.viewports[0].path.d).toBe(before);
    next.finish();
    await expect(next.finished).resolves.toEqual({ status: 'finished' });
    await expect(old.finished).resolves.toEqual({ status: 'stopped' });
    expect(f.viewports[0].path.d).toBe(f.prepared.sample(1).d);
  });

  it('reduced motion сразу записывает endpoint и не оставляет подписку', async () => {
    const f = fixture({ reducedMotion: true });
    const [control] = f.execute(f.viewports, f.prepared, f.request);
    expect(f.viewports.every(svg => svg.path.d === f.prepared.sample(.8).d)).toBe(true);
    expect(f.clocks[0].options).toEqual({ duration: 0, ease: 'linear', reducedMotion: 'always' });
    await control.finished;
    expect(f.clocks[0].listener).toBeNull(); expect(f.clocks[0].disposed).toBe(true);
  });

  it.each([NaN, .79, 1.01])('отказ ширины %s не меняет DOM и не порождает clock', width => {
    const f = fixture();
    expect(() => f.execute(f.viewports, f.prepared, { ...f.request, to: width })).toThrow(/INVALID_REQUEST|VARIATION_OUTSIDE_DOMAIN/);
    expect(f.clocks).toHaveLength(0); expect(f.writes).toHaveLength(0);
  });

  it('отказывается при чужом physical d до animation', () => {
    const f = fixture(); f.viewports[0].path.d = 'different';
    expect(() => f.execute(f.viewports, f.prepared, f.request)).toThrow(/RENDER_CORRESPONDENCE_MISMATCH/);
    expect(f.clocks).toHaveLength(0); expect(f.writes).toHaveLength(0);
  });

  it('конкурирующая запись и неверный sample останавливают канал с наблюдаемой ошибкой', async () => {
    const f = fixture();
    const [control] = f.execute(f.viewports, f.prepared, f.request);
    f.viewports[0].path.d = 'other writer'; f.clocks[0].emit(.9);
    await expect(control.finished).rejects.toThrow(/RENDER_CORRESPONDENCE_MISMATCH/);
    expect(f.writes).toHaveLength(0); expect(f.clocks[0].disposed).toBe(true);
  });
});

it.each(['pendingMotion', 'widthHead'])('reduced motion сохраняет точную requested width из %s', key => {
  const source = readFileSync(new URL('../observatory/explorer.js', import.meta.url), 'utf8');
  const reduce = source.match(/^function reduceCurrentMotion\(\) \{[\s\S]*?^\}/m)?.[0];
  if (!reduce) throw new Error('Нет реального reduceCurrentMotion.');
  const minimum = .1, width = .10018, to = (1 - width) / (1 - minimum), calls = [];
  // Нормализованный progress не является lossless кодированием requested width.
  expect(1 + (minimum - 1) * to).not.toBe(width);
  const state = { [key]: { to, width } };
  new Function('state', 'replacementMode', 'widthGesture', 'advanceWidth', 'advance',
    `${reduce}\nreduceCurrentMotion();`)(state, () => false, () => true,
    (to, options) => calls.push({ to, width: options.width }), () => { throw new Error('Запрос ширины потерял prepared contract.'); });
  expect(calls).toEqual([{ to, width }]);
});
