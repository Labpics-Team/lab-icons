/** Runs inside an empty browser document. Instrumentation is outside shipped bundles. */
export function installPublicSymbolProbe() {
  const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const nativeRaf = window.requestAnimationFrame.bind(window), nativeCancel = window.cancelAnimationFrame.bind(window);
  const pending = new Set();
  let rafRequested = 0, rafExecuted = 0, writes = 0, callbackMs = 0, notifications = 0;
  let liveValues = 0, subscriptions = 0, valuesCreated = 0, resizeObserversCreated = 0;
  window.ResizeObserver = new Proxy(window.ResizeObserver, { construct(target, arguments_) {
    resizeObserversCreated++; return Reflect.construct(target, arguments_);
  } });
  const frames = [];
  window.requestAnimationFrame = callback => {
    rafRequested++;
    const id = nativeRaf(timestamp => {
      pending.delete(id); rafExecuted++;
      const start = performance.now();
      try { callback(timestamp); }
      finally { frames.push({ timestamp, callbackMs: performance.now() - start }); }
    });
    pending.add(id); return id;
  };
  window.cancelAnimationFrame = id => { pending.delete(id); nativeCancel(id); };
  const originalAttribute = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (...args) {
    if (this instanceof SVGElement) writes++;
    return originalAttribute.apply(this, args);
  };
  const snapshot = () => ({ rafRequested, rafExecuted, pendingRaf: pending.size, writes,
    callbackMs, notifications, liveValues, subscriptions, valuesCreated, resizeObserversCreated });
  const difference = (before, after) => Object.fromEntries(Object.keys(before).map(key => [key, after[key] - before[key]]));
  let api, mounted = [], controls = [], stage;
  const options = { size: 20, weight: 500, opsz: 'auto', variant: 'outline' };
  const runtimeWithCounters = runtime => ({ ...runtime, value(initial) {
    const clock = runtime.value(initial); liveValues++; valuesCreated++;
    let disposed = false;
    const listeners = new Set();
    return { ...clock, subscribe(listener) {
      subscriptions++;
      const unsubscribe = clock.subscribe(value => {
        const start = performance.now(); notifications++;
        try { listener(value); } finally { callbackMs += performance.now() - start; }
      });
      let subscribed = true;
      const release = () => {
        if (!subscribed) return;
        subscribed = false; subscriptions--; listeners.delete(release); unsubscribe();
      };
      listeners.add(release); return release;
    }, dispose() {
      if (disposed) return;
      disposed = true; liveValues--;
      clock.dispose();
    } };
  } });
  async function quiet(milliseconds) {
    const before = snapshot(), startedAt = performance.now();
    await delay(milliseconds);
    const after = snapshot(), work = difference(before, after);
    check(work.rafRequested === 0 && work.rafExecuted === 0 && work.writes === 0 && work.notifications === 0,
      `Inactive icon performed work: ${JSON.stringify(work)}`);
    check(after.pendingRaf === 0 && after.liveValues === 0 && after.subscriptions === 0,
      `Inactive icon retained work: ${JSON.stringify(after)}`);
    return { elapsedMs: performance.now() - startedAt, work, retained: after };
  }
  async function load(url, kind, count) {
    check(PerformanceObserver.supportedEntryTypes.includes('paint'), 'Native Paint Timing is unavailable');
    check(!performance.getEntriesByName('first-contentful-paint').length, 'Document already painted content');
    let observer, timeout;
    const paint = new Promise((resolve, reject) => {
      timeout = setTimeout(() => reject(new Error('No native FCP after mounting icons')), 10000);
      observer = new PerformanceObserver(list => {
        const entry = list.getEntries().find(entry => entry.name === 'first-contentful-paint');
        if (entry) resolve(entry.startTime);
      });
      observer.observe({ type: 'paint', buffered: true });
    });
    const importStartedAt = performance.now();
    api = await import(url);
    const importResolvedAt = performance.now();
    const runtime = kind === 'motion' ? api.createSymbolMotion(runtimeWithCounters(api.motion)) : undefined;
    stage = document.createElement('main'); stage.id = 'stage';
    const createStartedAt = performance.now();
    for (let index = 0; index < count; index++) {
      const slot = document.createElement('span'); stage.append(slot);
      if (kind === 'motion') mounted.push(runtime.mount(slot, api.symbol, options));
      else { slot.innerHTML = api.renderIcon(api.symbol, options); slot.firstElementChild.setAttribute('aria-hidden', 'true'); }
    }
    const createEndedAt = performance.now();
    document.body.append(stage);
    const bounds = stage.getBoundingClientRect();
    const mountedAt = performance.now();
    let contentfulPaintAt;
    try { contentfulPaintAt = await paint; }
    finally { observer.disconnect(); clearTimeout(timeout); }
    check(contentfulPaintAt >= mountedAt, 'FCP preceded the useful scene');
    const svgs = [...stage.querySelectorAll('svg')];
    check(svgs.length === count && svgs.every(svg => svg.getBoundingClientRect().width === 20), 'Incomplete scene');
    check(bounds.bottom <= innerHeight && bounds.right <= innerWidth, 'Scene extends outside viewport');
    check(svgs.every(svg => svg.querySelector('path[d]')?.getAttribute('d').length > 0), 'Missing visible geometry');
    check(valuesCreated === 0 && resizeObserversCreated === 0 && rafRequested === 0,
      'Static rendering or idle mount created clocks or observers');
    return { importStartedAt, importResolvedAt, createStartedAt, createEndedAt, mountedAt, contentfulPaintAt,
      importMs: importResolvedAt - importStartedAt, importToFcpMs: contentfulPaintAt - importStartedAt,
      createMs: createEndedAt - createStartedAt, mountLayoutMs: mountedAt - createEndedAt,
      svgCount: svgs.length, domElements: stage.querySelectorAll('*').length,
      visibleScene: { width: bounds.width, height: bounds.height }, idle: await quiet(200) };
  }
  async function active(kind, milliseconds) {
    const before = snapshot(), firstFrame = frames.length, startedAt = performance.now();
    controls = mounted.map(icon => kind === 'effect' ? icon.effect('cycle', { duration: 2000 })
      : icon.set({ ...options, weight: 600 }, { duration: 2000 }));
    const admissionMs = performance.now() - startedAt;
    await delay(milliseconds);
    const measuredAt = performance.now(), after = snapshot();
    const samples = frames.slice(firstFrame);
    check(after.rafExecuted > before.rafExecuted && after.notifications > before.notifications && after.writes > before.writes,
      'Active icons did not update');
    check(after.liveValues === mounted.length && after.subscriptions === mounted.length, 'Missing active controls');
    return { elapsedMs: measuredAt - startedAt, admissionMs, work: difference(before, after), retained: after,
      frames: samples, frameIntervalsMs: samples.slice(1).map((frame, index) => frame.timestamp - samples[index].timestamp) };
  }
  async function stop() {
    const startedAt = performance.now();
    for (const control of controls) control.stop();
    const elapsedMs = performance.now() - startedAt;
    check((await Promise.all(controls.map(control => control.finished))).every(result => result.status === 'stopped'), 'Stop did not settle');
    controls = [];
    return { elapsedMs, quiet: await quiet(200) };
  }
  async function dispose() {
    const startedAt = performance.now();
    for (const icon of mounted) icon.dispose();
    mounted = [];
    stage.remove(); stage = undefined;
    const elapsedMs = performance.now() - startedAt;
    check((await Promise.all(controls.map(control => control.finished))).every(result => result.status === 'stopped'), 'Dispose did not stop active controls');
    controls = [];
    check(document.querySelectorAll('svg').length === 0, 'Dispose left SVG DOM');
    return { elapsedMs, quiet: await quiet(200) };
  }
  globalThis.symbolProbe = { load, active, stop, dispose };
}
