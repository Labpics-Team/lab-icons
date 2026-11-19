import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { preparedPoseSvg, visiblePreparedSvg } from '../observatory/authored-gesture.js';

const source = readFileSync(new URL('../observatory/explorer.js', import.meta.url), 'utf8');
const advanceSource = source.match(/^async function advanceClock\([\s\S]*?^\}/m)?.[0];
if (!advanceSource) throw new Error('Нет реального advanceClock.');

function fixture() {
  const prepared = { law: 'joint.authored-elbow', svg: '<svg><path data-part="hands" d="hands-0"/></svg>',
    renderTarget: { selector: '[data-part="hands"]', attribute: 'd' },
    sample: hours => Number.isFinite(hours) ? { ok: true, elapsedHours: hours, d: `hands-${hours}` }
      : { ok: false, reason: { code: 'INVALID_REQUEST', message: 'Finite hours required.' } } };
  const admission = { ok: true, prepared, capabilities: { gesture: { from: 0, to: 1 } } };
  const state = { loaded: true, viewLoading: false, revision: 1, viewRevision: 1, motionRevision: 0,
    preparedClock: admission, clockValue: .37, animations: [], module: { glyph: () => { throw new Error('В кадре нет static compiler.'); } } };
  const ui = { 'symbol-stage': {}, 'size-samples': {}, progress: {}, 'motion-status': {}, 'reduce-motion': { checked: false } };
  const calls = [], executePreparedClock = (roots, program, request, observers) => {
    let resolve;
    const control = { finished: new Promise(done => { resolve = done; }), state: 'running',
      stop: vi.fn(() => { control.state = 'stopped'; resolve({ status: 'stopped' }); }),
      pause: vi.fn(() => { control.state = 'paused'; }),
      finish() { observers.onProgress(request.to); control.state = 'finished'; resolve({ status: 'finished' }); } };
    calls.push({ roots, program, request, observers, control });
    observers.onProgress(request.from);
    return [control];
  };
  let importExecutor = async () => ({ executePreparedClock });
  const presentation = vi.fn();
  const advance = new Function('state', 'ui', 'clockGesture', 'clockAt', 'clockProgress', 'motionExecutor',
    'reducedPreference', 'updateMotionControls', 'inspectorPresentation', 'displayStyle',
    `${advanceSource}\nreturn advanceClock;`)(state, ui, () => true, progress => progress, hours => hours,
    () => importExecutor(), { matches: false }, vi.fn(), presentation, vi.fn());
  return { state, ui, prepared, calls, presentation, advance, setImport: callback => { importExecutor = callback; }, executePreparedClock };
}

afterEach(() => vi.unstubAllGlobals());

describe('Observatory подхватывает именно видимую позу стрелок', () => {
  it('обратный successor начинает с последнего callback и не компилирует static glyph', async () => {
    const f = fixture();
    await f.advance(1);
    f.calls[0].observers.onProgress(.63);
    await f.advance(0);
    expect(f.calls.map(call => call.request.from)).toEqual([.37, .63]);
    expect(f.calls[1].roots).toEqual([f.ui['symbol-stage'], f.ui['size-samples']]);
    expect(f.calls[0].control.stop).toHaveBeenCalledOnce();
    f.calls[1].control.finish();
    await f.calls[1].control.finished;
    await Promise.resolve();
    expect(f.state.clockValue).toBe(0); expect(f.ui.progress.value).toBe('0');
    expect(f.presentation).toHaveBeenCalledOnce();
  });

  it('последний target побеждает delayed import, а пауза сохраняется до admission', async () => {
    const f = fixture();
    let resolve;
    f.setImport(() => new Promise(done => { resolve = done; }));
    const first = f.advance(1), firstResolve = resolve;
    const second = f.advance(0), secondResolve = resolve;
    f.state.pendingMotion.paused = true;
    firstResolve({ executePreparedClock: f.executePreparedClock });
    await first;
    expect(f.calls).toHaveLength(0);
    secondResolve({ executePreparedClock: f.executePreparedClock });
    await second;
    expect(f.calls).toHaveLength(1); expect(f.calls[0].request.to).toBe(0);
    expect(f.calls[0].control.pause).toHaveBeenCalledOnce();
    expect(f.state.clockHead.running).toBe(false);
    f.calls[0].control.stop(); await f.calls[0].control.finished;
  });

  it('смена символа отменяет pending admission без записи в новую сцену', async () => {
    const f = fixture();
    let resolve;
    f.setImport(() => new Promise(done => { resolve = done; }));
    const pending = f.advance(1);
    f.state.revision++;
    resolve({ executePreparedClock: f.executePreparedClock });
    await pending;
    expect(f.calls).toHaveLength(0);
  });
});

function svgFixture(d = 'hands-0') {
  const attrs = { d }, properties = { width: '128px', height: '128px', opacity: '1' }, removed = [];
  const path = { tagName: 'path', getAttribute: name => attrs[name], setAttribute: (name, value) => { attrs[name] = value; } };
  const svg = {
    querySelectorAll: selector => selector === '[data-part="hands"]' ? [path] : [],
    cloneNode: () => svgFixture(attrs.d).svg,
    style: { removeProperty: name => { removed.push(name); delete properties[name]; } },
    setAttribute: (name, value) => { attrs[name] = value; },
    get outerHTML() { return JSON.stringify({ d: attrs.d, color: attrs.color, properties }); },
  };
  return { svg, path, removed, root: { querySelector: selector => selector === 'svg' ? svg : null } };
}

describe('presentation и export подготовленной позы сохраняют видимый scalar', () => {
  it('повторная presentation не возвращает стрелки к authored rest', () => {
    const f = fixture(), scene = svgFixture();
    vi.stubGlobal('document', { createElement: () => ({ innerHTML: '', querySelector: selector => selector === 'svg' ? scene.svg : null }) });
    expect(JSON.parse(preparedPoseSvg(f.prepared, .63)).d).toBe('hands-0.63');
  });

  it('SVG export клонирует текущую позу, оставляет источник живым и снимает display size', () => {
    const f = fixture(), scene = svgFixture('hands-0.63');
    const exported = JSON.parse(visiblePreparedSvg(scene.root, f.prepared, .63, '#112233'));
    expect(exported).toEqual({ d: 'hands-0.63', color: '#112233', properties: { opacity: '1' } });
    expect(scene.path.getAttribute('d')).toBe('hands-0.63');
    expect(scene.removed).toEqual([]);
  });

  it('export отказывает несовпадающему видимому d вместо другого computed кадра', () => {
    const f = fixture(), scene = svgFixture('hands-0.7');
    expect(() => visiblePreparedSvg(scene.root, f.prepared, .63, '#112233')).toThrow(/RENDER_CORRESPONDENCE_MISMATCH/);
    expect(scene.path.getAttribute('d')).toBe('hands-0.7');
  });
});

it.each(['pendingMotion', 'clockHead'])('reduced motion сохраняет requested hours из %s', key => {
  const reduce = source.match(/^function reduceCurrentMotion\(\) \{[\s\S]*?^\}/m)?.[0];
  const calls = [], state = { [key]: { to: .37, hours: .37000000000000005 } };
  new Function('state', 'replacementMode', 'widthGesture', 'clockGesture', 'advanceClock', 'advance',
    `${reduce}\nreduceCurrentMotion();`)(state, () => false, () => false, () => true,
    (to, options) => calls.push({ to, hours: options.hours }), () => { throw new Error('Потеряны часы.'); });
  expect(calls).toEqual([{ to: .37, hours: .37000000000000005 }]);
});
