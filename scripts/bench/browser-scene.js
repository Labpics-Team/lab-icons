import { coldRenderSpan } from './measurement.js';

/** Native FCP наблюдается только на пустом документе; rAF его не подменяет. */
export async function measureColdScene(load, count) {
  if (!PerformanceObserver.supportedEntryTypes.includes('paint')) throw new Error('benchmark: native paint timing недоступен');
  if (performance.getEntriesByName('first-contentful-paint').length || document.getElementById('stage').childElementCount) {
    throw new Error('benchmark: cold render требует пустой документ без прежнего FCP');
  }
  let observer, timer;
  const painted = new Promise((resolve, reject) => {
    observer = new PerformanceObserver(list => {
      const entry = list.getEntries().find(entry => entry.name === 'first-contentful-paint');
      if (entry) resolve({ name: entry.name, startTime: entry.startTime, duration: entry.duration,
        paintTime: Number.isFinite(entry.paintTime) ? entry.paintTime : null,
        presentationTime: Number.isFinite(entry.presentationTime) ? entry.presentationTime : null });
    });
    observer.observe({ type: 'paint', buffered: true });
    timer = setTimeout(() => reject(new Error('benchmark: native FCP не наступил за 30 секунд')), 30_000);
  });
  // При отказе import callback таймер всё равно принадлежит этому scope.
  painted.catch(() => {});
  try {
    const importStartedAt = performance.now();
    const create = await load();
    const importResolvedAt = performance.now();
    return await measureScene(create, count, { importStartedAt, importResolvedAt, painted });
  } finally { observer.disconnect(); clearTimeout(timer); }
}

/** Внешний consumer: одинаковый DOM и полезный результат для двух пакетов. */
export async function measureScene(create, count, cold) {
  const stage = document.getElementById('stage');
  const mutations = { records: 0, addedNodes: 0, removedNodes: 0, attributes: 0 };
  const observer = new MutationObserver(records => {
    for (const record of records) {
      mutations.records++;
      mutations.addedNodes += record.addedNodes.length;
      mutations.removedNodes += record.removedNodes.length;
      if (record.type === 'attributes') mutations.attributes++;
    }
  });
  observer.observe(stage, { attributes: true, childList: true, subtree: true });
  const firstStarted = performance.now();
  const first = create();
  const firstCreatedAt = performance.now();
  const firstCreateMs = firstCreatedAt - firstStarted;
  const fragment = document.createDocumentFragment();
  let completedBytes = 0;
  const started = performance.now();
  for (let index = 0; index < count; index++) {
    const svg = index === 0 ? first : create();
    if (typeof svg !== 'string' || !svg.startsWith('<svg')) throw new Error('consumer: неверный SVG');
    completedBytes += svg.length;
    const button = document.createElement('button');
    button.type = 'button';
    button.setAttribute('aria-label', 'Открыть действие');
    button.innerHTML = svg;
    button.querySelector('svg').setAttribute('aria-hidden', 'true');
    fragment.append(button);
  }
  const createDomMs = performance.now() - started;
  const mountStarted = performance.now();
  stage.append(fragment);
  // Layout один раз входит в полный mount, а не скрывается за концом таймера.
  const layout = stage.getBoundingClientRect();
  const mountedAt = performance.now();
  const mountLayoutMs = mountedAt - mountStarted;
  await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const firstPaintOpportunityMs = performance.now() - started;
  let coldTiming;
  if (cold) {
    const paint = await cold.painted;
    const timing = { importStartedAt: cold.importStartedAt, importResolvedAt: cold.importResolvedAt,
      firstCreateStartedAt: firstStarted, firstCreateEndedAt: firstCreatedAt,
      mountStartedAt: mountStarted, mountEndedAt: mountedAt, contentfulPaintAt: paint.startTime };
    coldTiming = { ...coldRenderSpan(timing), milestones: timing, paint };
    const button = stage.querySelector('button'), svg = button.querySelector('svg');
    const bounds = svg.getBoundingClientRect(), ink = svg.getBBox(), style = getComputedStyle(svg);
    if (bounds.width !== 24 || bounds.height !== 24 || ink.width <= 0 || ink.height <= 0 ||
        style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) <= 0 ||
        !button.getAttribute('aria-label') || svg.getAttribute('aria-hidden') !== 'true') {
      throw new Error('benchmark: FCP не подтверждает видимый доступный SVG consumer');
    }
    coldTiming.visible = { width: bounds.width, height: bounds.height, inkWidth: ink.width, inkHeight: ink.height,
      buttonLabel: button.getAttribute('aria-label'), decorativeSvg: true };
  }
  const mountedCDPMetrics = await window.sampleMountedMetrics();
  const frames = [];
  let previous = performance.now();
  for (let index = 0; index < 24; index++) {
    const now = await new Promise(resolve => requestAnimationFrame(resolve));
    frames.push(now - previous);
    previous = now;
  }
  if (stage.querySelectorAll('button').length !== count || stage.querySelectorAll('svg').length !== count) throw new Error('consumer: потерян mounted symbol');
  if ([...stage.querySelectorAll('button')].some(button => !button.getAttribute('aria-label') || button.getBoundingClientRect().width < 44)) throw new Error('consumer: нарушен accessible hit target');
  const domElements = stage.querySelectorAll('*').length;
  const cleanupStarted = performance.now();
  stage.replaceChildren();
  stage.getBoundingClientRect();
  await Promise.resolve();
  const cleanupMs = performance.now() - cleanupStarted;
  observer.disconnect();
  return { count, completed: count, completedBytes, firstSvg: first, firstCreateMs, createDomMs, mountLayoutMs, firstPaintOpportunityMs, cleanupMs, lifecycleMs: performance.now() - firstStarted, mountedCDPMetrics, domElements, mutations, frames, stageWidth: layout.width, stageHeight: layout.height,
    ...(coldTiming ? { coldImportMs: coldTiming.coldImportMs, coldImportToUsefulRenderMs: coldTiming.coldImportToUsefulRenderMs, coldTiming } : {}) };
}

/** Обычный WAAPI исполняет данные Lab Icons; движение не сравнивается с отсутствующим baseline API. */
export async function measureMotion({ glyph, glyphCapabilities, renderGlyphSvg, compileSymbolEffect, executeLabMotion }, count, executor) {
  const stage = document.getElementById('stage');
  const source = glyph({ variant: 'filled' });
  const capabilities = glyphCapabilities('filled');
  const fragment = document.createDocumentFragment();
  for (let index = 0; index < count; index++) {
    const element = document.createElement('div');
    element.innerHTML = renderGlyphSvg(source, { instanceId: `motion-${index}` });
    fragment.append(element.firstElementChild);
  }
  stage.append(fragment);
  const ids = [...stage.querySelectorAll('[id]')].map(element => element.id);
  if (new Set(ids).size !== ids.length) throw new Error('consumer: mask IDs пересекаются между экземплярами');
  const compile = request => {
    const result = compileSymbolEffect(source, capabilities, 'time.advance', request);
    if (!result.ok) throw new Error(`consumer: ${result.reason.code}`);
    return result.effect;
  };
  const effect = compile({ duration: 360, from: 0, to: 1 });
  const mountedCDPMetrics = await window.sampleMountedMetrics();
  const roots = [...stage.querySelectorAll(':scope > svg')];
  const motionTargets = effect.targets.map(target => roots[0].querySelector(`[data-part="${target.partId}"]`));
  if (motionTargets.some(target => !target)) throw new Error('consumer: не найден semantic part');
  const unchanged = effect.unchangedPartIds.map(id => roots[0].querySelector(`[data-part="${id}"]`)).filter(Boolean);
  const enclosureBefore = unchanged.map(element => element.outerHTML);
  const observerCounts = { attributes: 0, childList: 0 };
  const observer = new MutationObserver(records => records.forEach(record => observerCounts[record.type]++));
  observer.observe(stage, { childList: true, attributes: true, subtree: true });
  const execute = data => roots.flatMap(root => {
    if (executor === 'lab-motion') return executeLabMotion(root, data);
    return data.targets.map(target => {
      const element = root.querySelector(`[data-part="${target.partId}"]`);
      Object.assign(element.style, target.style);
      return element.animate(target.keyframes, data.options);
    });
  });
  const scheduled = performance.now();
  let controls = execute(effect);
  const startMs = performance.now() - scheduled;
  const frames = [];
  let previous = performance.now();
  // Независимо заданное время прерывания сохраняет задержку scheduling в результате.
  const interruptDue = scheduled + 140;
  while (performance.now() < interruptDue) {
    const now = await new Promise(resolve => requestAnimationFrame(resolve));
    frames.push(now - previous);
    previous = now;
  }
  const before = motionTargets.map(element => getComputedStyle(element).transform);
  const interruptStarted = performance.now();
  let progress;
  if (executor === 'waapi') {
    const timing = controls[0].effect.getComputedTiming();
    progress = timing.progress ?? 1;
    for (const control of controls) control.cancel();
    const reverse = compile({ duration: 220, from: progress, to: 0 });
    controls = execute(reverse);
    for (const control of controls) control.pause();
    const after = motionTargets.map(element => getComputedStyle(element).transform);
    const matrixDelta = (left, right) => {
      const a = new DOMMatrix(left), b = new DOMMatrix(right);
      return Math.max(...['a', 'b', 'c', 'd', 'e', 'f'].map(key => Math.abs(a[key] - b[key])));
    };
    if (before.some((value, index) => matrixDelta(value, after[index]) > 0.002)) throw new Error('consumer: discontinuity при interruption');
    for (const control of controls) control.play();
  } else {
    // Публичный stop сохраняет видимый transform; новая команда идёт от него.
    const hour = effect.targets.findIndex(target => target.partId === 'hand-hour');
    const visible = new DOMMatrix(before[hour]);
    const angle = Math.atan2(visible.b, visible.a) * 180 / Math.PI;
    progress = Math.max(0, Math.min(1, angle / effect.targets[hour].rotation.to));
    for (const control of controls) control.stop();
    controls = execute(compile({ duration: 220, from: progress, to: 0 }));
    const after = motionTargets.map(element => getComputedStyle(element).transform);
    if (before.some((value, index) => {
      const a = new DOMMatrix(value), b = new DOMMatrix(after[index]);
      return Math.max(...['a', 'b', 'c', 'd', 'e', 'f'].map(key => Math.abs(a[key] - b[key]))) > 0.002;
    })) throw new Error('consumer: Lab Motion discontinuity при interruption');
  }
  const interruptMs = performance.now() - interruptStarted;
  const interruptArrivalDelayMs = interruptStarted - interruptDue;
  const settleDue = performance.now() + 300;
  while (performance.now() < settleDue) {
    const now = await new Promise(resolve => requestAnimationFrame(resolve));
    frames.push(now - previous);
    previous = now;
  }
  for (const control of controls) executor === 'waapi' ? control.cancel() : control.stop();
  if (unchanged.some((element, index) => element.outerHTML !== enclosureBefore[index])) throw new Error('consumer: изменилось неподвижное enclosure');
  const reduced = compile({ duration: 500, from: 0.35, to: 1, reducedMotion: true });
  if (reduced.options.duration !== 0) throw new Error('consumer: reduced motion не немедленный');
  const reducedControls = execute(reduced);
  await new Promise(resolve => requestAnimationFrame(resolve));
  for (let index = 0; index < motionTargets.length; index++) {
    const target = effect.targets[index];
    const expected = new DOMMatrix().rotate(target.rotation.to);
    const actual = new DOMMatrix(getComputedStyle(motionTargets[index]).transform);
    if (Math.max(Math.abs(expected.a - actual.a), Math.abs(expected.b - actual.b), Math.abs(expected.c - actual.c), Math.abs(expected.d - actual.d)) > 0.002) throw new Error('consumer: reduced motion не достиг последнего состояния');
  }
  for (const control of reducedControls) executor === 'waapi' ? control.cancel() : control.stop();
  await Promise.resolve();
  observer.disconnect();
  const cleanupStarted = performance.now();
  stage.replaceChildren();
  stage.getBoundingClientRect();
  return { count, completed: count, executor, animatedTargets: count * effect.targets.length, startMs, interruptMs, interruptArrivalDelayMs, interruptedProgress: progress, cleanupMs: performance.now() - cleanupStarted, mountedCDPMetrics, frames, mutations: observerCounts, maskIds: ids.length, enclosurePreserved: true, reducedMotionVerified: true, continuityVerified: true, continuityScope: 'первый экземпляр, обе стрелки' };
}
