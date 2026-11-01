import { compileSymbolEffect } from './package/motion/index.js';
import { renderGlyphSvg } from './package/ir/render.js';
let execution;
const motionExecutor = () => execution ??= import('./motion-execution.js');
let recordedModels;
const recordedCompiler = () => recordedModels ??= import('./recorded-model.js');
const displaySize = document.querySelector('#display-size');
const displayColor = document.querySelector('#display-color');

function displayStyle() {
  const svg = ui['symbol-stage'].querySelector('svg');
  if (svg) svg.style.width = svg.style.height = `${displaySize.value}px`;
  ui['symbol-stage'].style.color = displayColor.value;
  for (const svg of ui['size-samples'].querySelectorAll('svg')) svg.style.color = displayColor.value;
  document.querySelector('#display-size-value').textContent = `${displaySize.value} px`;
}

const $ = (selector) => document.querySelector(selector);
const ui = Object.fromEntries(['symbol-search', 'variant', 'symbol-grid', 'more-symbols', 'empty-search', 'corpus-count', 'visible-count', 'symbol-inspector', 'symbol-name', 'model-status', 'symbol-stage', 'size-samples', 'source-status', 'axis-controls', 'axis-status', 'parts', 'gesture', 'play', 'reverse', 'pause', 'progress', 'progress-label', 'reduce-motion', 'motion-status', 'consumer-import', 'export-format', 'export', 'export-status'].map((id) => [id, $(`#${id}`)]));
const reducedPreference = matchMedia('(prefers-reduced-motion: reduce)');
const loadStatus = document.querySelector('#load-status');
function loadMessage(message = '') {
  loadStatus.textContent = message;
  loadStatus.hidden = !message;
}
const state = { data: null, name: 'time', variant: 'outline', view: 'original', viewLoading: false, limit: 48, revision: 0, viewRevision: 0, motionRevision: 0, pendingMotion: null, loaded: false, legacy: false, modelModule: null, abort: null, module: null, capabilities: null, glyph: null, axes: {}, original: '', effect: null, animations: [], frame: null, playhead: null };

function progress() {
  const head = state.playhead;
  if (!head) return Number(ui.progress.value);
  // Только индикатор UI: новые цели не используют эти часы для вычисления позы.
  const elapsed = head.elapsed + (head.running ? performance.now() - head.startedAt : 0);
  const fraction = head.duration === 0 ? 1 : Math.min(1, elapsed / head.duration);
  return head.from + (head.to - head.from) * fraction;
}

function stop() {
  const value = progress();
  for (const animation of state.animations) animation.stop();
  state.animations = [];
  state.effect = null;
  state.playhead = null;
  state.pendingMotion = null;
  state.motionRevision++;
  cancelAnimationFrame(state.frame);
  state.frame = null;
  ui.progress.value = String(value);
  ui.pause.textContent = 'Пауза';
  ui.pause.disabled = true;
  return value;
}

function grid() {
  if (!state.data) return;
  const focused = ui['symbol-grid'].contains(document.activeElement) ? document.activeElement.dataset.symbol : null;
  const query = ui['symbol-search'].value.trim().toLowerCase();
  const rows = state.data.rows.filter((row) => row.variant === state.variant && row.name.includes(query));
  ui['visible-count'].textContent = `${rows.length} найдено`;
  ui['empty-search'].hidden = rows.length !== 0;
  ui['more-symbols'].hidden = rows.length <= state.limit;
  ui['symbol-grid'].replaceChildren(...rows.slice(0, state.limit).map((row) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'symbol-tile';
    button.dataset.symbol = row.name;
    button.setAttribute('aria-pressed', String(row.name === state.name));
    button.setAttribute('aria-label', row.name);
    const image = document.createElement('img');
    image.src = row.views.original;
    image.alt = '';
    image.loading = 'lazy';
    image.width = image.height = 30;
    const label = document.createElement('span');
    label.textContent = row.name;
    button.append(image, label);
    button.addEventListener('click', () => select(row.name, { reveal: true }));
    return button;
  }));
  if (focused) {
    [...ui['symbol-grid'].querySelectorAll('button')].find(button => button.dataset.symbol === focused)?.focus({ preventScroll: true });
  }
}

function selectedRow() {
  return state.data.rows.find((row) => row.name === state.name && row.variant === state.variant);
}

function motionAdmission(glyph = state.glyph, caps = state.capabilities, gesture = ui.gesture.value) {
  if (!glyph || !caps || !gesture) return null;
  return compileSymbolEffect(glyph, caps, gesture, { duration: 0 });
}

function motionView() {
  return (state.view === 'original' && !state.legacy) || (state.view === 'generated' && state.legacy);
}

function selectedGesture() {
  return state.capabilities?.motion.gestures.find(gesture => gesture.id === ui.gesture.value);
}

function cyclicGesture() {
  return selectedGesture()?.kind === 'cycle';
}

function updateMotionControls() {
  const admitted = state.loaded && motionAdmission()?.ok;
  const ready = admitted && !state.viewLoading && motionView();
  ui['progress-label'].textContent = selectedGesture()?.kind === 'state' ? 'Состояние' : 'Прогресс';
  for (const id of ['play', 'reverse', 'progress', 'gesture']) ui[id].disabled = !ready;
  ui.pause.disabled = !ready || (!state.playhead && !state.pendingMotion);
  ui.pause.textContent = (state.pendingMotion?.paused ?? (state.playhead && !state.playhead.running)) ? 'Продолжить' : 'Пауза';
  const identity = state.data.executionIdentity;
  ui['motion-status'].textContent = ready ? `${identity.package} ${identity.version}. ${cyclicGesture() ? 'Можно повторить, развернуть или прервать движение.' : 'Можно развернуть или прервать движение.'}${state.legacy ? ' Жест относится к прежней модели.' : ''}` : admitted ? 'Выберите авторский вид, чтобы управлять его жестом.' : 'Для этой авторской основы семантический жест пока не принят.';
}

function viewAvailable(view, row = selectedRow()) {
  if (!row) return false;
  if (view === 'original') return true;
  if (view === 'generated') return Boolean(row.views.generated && row.model?.catalogState === 'accepted');
  return ['overlay', 'difference'].includes(view) && Boolean(row.views[view]);
}

function updateViewControls() {
  for (const button of document.querySelectorAll('[data-view]')) {
    button.setAttribute('aria-pressed', String(button.dataset.view === state.view));
    button.disabled = !state.loaded || !viewAvailable(button.dataset.view);
  }
}

function inspectorBusy(busy) {
  ui['symbol-inspector'].setAttribute('aria-busy', String(busy));
  ui['symbol-stage'].setAttribute('aria-busy', String(busy));
  ui.export.disabled = busy || !state.loaded;
}

function clearInspector(message) {
  ui['model-status'].textContent = message;
  ui['consumer-import'].textContent = '';
  ui['size-samples'].replaceChildren();
  ui['parts'].replaceChildren();
  ui['axis-controls'].replaceChildren();
  ui['axis-status'].textContent = '';
  ui.gesture.replaceChildren(new Option('Нет загруженного жеста', ''));
  ui['motion-status'].textContent = '';
  ui.pause.textContent = 'Пауза';
  for (const id of ['play', 'reverse', 'pause', 'progress', 'gesture', 'export']) ui[id].disabled = true;
  updateViewControls();
}

async function renderView(view = state.view) {
  if (!state.loaded) return;
  const revision = state.revision;
  const row = selectedRow();
  if (!viewAvailable(view, row)) {
    ui['source-status'].textContent = view === 'generated' ? 'Для прежней основы нет принятой модели. Кандидат доступен только для сравнения.' : 'Для этого варианта нет изображения сравнения.';
    loadMessage(ui['source-status'].textContent);
    return;
  }
  const viewRevision = ++state.viewRevision;
  stop();
  state.viewLoading = true;
  loadMessage();
  inspectorBusy(true);
  updateMotionControls();
  try {
    let glyph = state.glyph, capabilities = state.capabilities, modelModule = state.modelModule;
    const legacy = view === 'generated';
    const axes = legacy ? state.axes : {};
    if (legacy && !state.legacy) {
      modelModule = await recordedCompiler();
      if (revision !== state.revision || viewRevision !== state.viewRevision) return;
      glyph = modelModule.glyph({ icon: state.name, variant: state.variant });
      if (glyph.provenance.kind !== 'model' || glyph.provenance.state !== 'accepted') throw new Error('Для прежней основы нет принятой модели. Кандидат доступен только для сравнения.');
      capabilities = modelModule.glyphCapabilities(state.name, state.variant);
    } else if (!legacy) {
      glyph = state.module.glyph({ variant: state.variant });
      capabilities = state.module.glyphCapabilities(state.variant);
    }
    const annotatedSource = !legacy && motionAdmission(glyph, capabilities, capabilities.motion.gestures[0]?.id)?.ok;
    const productionSvg = legacy || annotatedSource;
    let svg = productionSvg ? renderGlyphSvg(glyph, { instanceId: `stage-${revision}-${viewRevision}` }) : state.original;
    if (['overlay', 'difference'].includes(view)) {
      const response = await fetch(row.views[view], { signal: state.abort.signal });
      if (!response.ok) throw new Error(`Изображение недоступно: HTTP ${response.status}`);
      svg = await response.text();
    }
    if (revision !== state.revision || viewRevision !== state.viewRevision) return;
    const changedControls = capabilities !== state.capabilities || legacy !== state.legacy;
    Object.assign(state, { view, glyph, capabilities, modelModule, legacy, axes, viewLoading: false });
    ui['symbol-stage'].dataset.view = view;
    ui['symbol-stage'].innerHTML = svg;
    ui.pause.textContent = 'Пауза';
    if (changedControls) controls();
    // Значение неподвижного мастера задаёт семантика, а не имя иконки.
    ui.progress.value = String(motionAdmission()?.ok ? selectedGesture()?.restProgress ?? 0 : 0);
    ui['source-status'].textContent = `Lab UI v2.1. Версия ${row.original.version}. Узел ${row.original.nodeId}. ` +
      (legacy ? 'Прежняя модель: паритет с новой авторской основой не принят.' : ['overlay', 'difference'].includes(view) ? `Красным — текущая основа, синим — прежняя ${row.model?.catalogState === 'accepted' ? 'модель' : 'модель на проверке'} при исходных параметрах. Паритет не принят.` : 'Текущий авторский мастер. Возможности относятся к его закреплённой версии.');
    ui['size-samples'].replaceChildren(...[16, 24, 48].map((size) => {
      const element = document.createElement('div');
      element.className = 'size-sample';
      element.innerHTML = productionSvg ? renderGlyphSvg(glyph, { instanceId: `sample-${revision}-${viewRevision}-${size}` }) : state.original;
      const image = element.querySelector('svg');
      image.style.width = image.style.height = `${size}px`;
      image.setAttribute('aria-hidden', 'true');
      const label = document.createElement('span');
      label.textContent = `${size} px`;
      element.append(label);
      return element;
    }));
    updateViewControls();
    inspectorBusy(false);
    updateMotionControls();
    displayStyle();
  } catch (error) {
    if (error.name === 'AbortError' || revision !== state.revision || viewRevision !== state.viewRevision) return;
    state.viewLoading = false;
    inspectorBusy(false);
    updateViewControls();
    updateMotionControls();
    ui['source-status'].textContent = error.message;
    loadMessage(error.message);
  }
}

function controls() {
  const caps = state.capabilities;
  ui['model-status'].textContent = state.legacy ? 'Прежняя модель' : caps.modelState === 'accepted' ? 'Модель принята' : caps.modelState === 'candidate' ? 'Модель на проверке' : 'Авторский SVG';
  ui['axis-controls'].replaceChildren(...caps.supportedAxes.map((name) => {
    const contract = caps.axes[name];
    const label = document.createElement('label');
    label.className = 'axis-control';
    const title = document.createElement('span');
    title.textContent = name;
    const input = document.createElement('input');
    input.type = 'range';
    input.min = String(contract.min);
    input.max = String(contract.max);
    input.step = 'any';
    input.value = String(state.axes[name] ?? contract.default);
    input.disabled = !state.legacy || caps.modelState !== 'accepted';
    const value = document.createElement('output');
    value.textContent = input.value;
    input.addEventListener('input', async () => {
      const revision = state.revision;
      state.axes[name] = Number(input.value);
      value.textContent = input.value;
      try {
        state.glyph = state.legacy ? state.modelModule.glyph({ icon: state.name, variant: state.variant, axes: state.axes }) : state.module.glyph({ variant: state.variant, axes: state.axes });
        await renderView('generated');
      } catch (error) { if (revision === state.revision) ui['axis-status'].textContent = error.message; }
    });
    label.append(title, input, value);
    return label;
  }));
  ui['axis-status'].textContent = caps.supportedAxes.length ? '' : 'Для этого варианта оси пока не приняты.';
  ui.parts.replaceChildren(...state.glyph.parts.map((part) => {
    const item = document.createElement('li');
    item.textContent = part.role === 'unclassified' ? `Авторский контур ${part.zIndex + 1}; семантика пока не принята.` : `${part.id} — ${part.role}`;
    item.title = part.id;
    return item;
  }));
  const selectedGesture = ui.gesture.value;
  ui.gesture.replaceChildren(...caps.motion.gestures.map((gesture) => new Option(gesture.id, gesture.id)));
  if (!ui.gesture.options.length) ui.gesture.add(new Option('Нет принятого жеста', ''));
  else if (caps.motion.gestures.some(gesture => gesture.id === selectedGesture)) ui.gesture.value = selectedGesture;
  ui['consumer-import'].textContent = state.legacy ? `import { glyph } from '@labpics/icons/ir';\n// Прежняя основа; текущий master: ./symbols/${state.name}` : `import { glyph } from\n  '@labpics/icons/symbols/${state.name}';`;
}

async function select(name, { reveal = false } = {}) {
  stop();
  state.name = name;
  state.variant = ui.variant.value;
  state.axes = {};
  state.view = 'original';
  state.viewLoading = false;
  state.legacy = false;
  state.modelModule = null;
  state.loaded = false;
  state.module = state.capabilities = state.glyph = null;
  state.original = '';
  state.revision++;
  const revision = state.revision;
  state.abort?.abort();
  state.abort = new AbortController();
  const row = selectedRow();
  ui['symbol-name'].textContent = name;
  ui['symbol-stage'].setAttribute('aria-label', `Символ ${name}: ${state.variant === 'filled' ? 'заливка' : 'контурное начертание'}`);
  ui['export-status'].textContent = '';
  loadMessage();
  ui.progress.value = '0';
  clearInspector('Загрузка…');
  inspectorBusy(true);
  ui['source-status'].textContent = 'Загружается авторский SVG.';
  ui['symbol-stage'].textContent = 'Загрузка…';
  grid();
  try {
    const [module, response] = await Promise.all([
      import(`./package/symbols/${name}.js`),
      fetch(row.views.original, { signal: state.abort.signal }),
    ]);
    if (!response.ok) throw new Error(`Авторский SVG недоступен: HTTP ${response.status}`);
    const original = await response.text();
    if (revision !== state.revision) return;
    state.module = module;
    state.capabilities = module.glyphCapabilities(state.variant);
    state.glyph = module.glyph({ variant: state.variant });
    state.original = original;
    state.loaded = true;
    controls();
    await renderView();
    if (revision === state.revision && reveal && matchMedia('(max-width: 720px)').matches) {
      document.querySelector('.inspector').scrollIntoView({ block: 'start', behavior: reducedPreference.matches ? 'instant' : 'smooth' });
    }
  } catch (error) {
    if (error.name === 'AbortError' || revision !== state.revision) return;
    state.loaded = false;
    state.viewLoading = false;
    state.module = state.capabilities = state.glyph = null;
    state.original = '';
    clearInspector('Не загружен');
    inspectorBusy(false);
    ui['symbol-stage'].textContent = 'Не удалось загрузить символ.';
    ui['source-status'].textContent = error.message;
    loadMessage(error.message);
  }
}

function effect(from, to, { duration = 900 } = {}) {
  return compileSymbolEffect(state.glyph, state.capabilities, ui.gesture.value, { duration, from, to, reducedMotion: reducedPreference.matches || ui['reduce-motion'].checked });
}

async function advance(to, { repeatCycle = false } = {}) {
  if (!state.loaded || state.viewLoading || !motionView()) return;
  const revision = state.revision;
  const viewRevision = state.viewRevision;
  const motionRevision = ++state.motionRevision;
  const pending = { paused: false, to };
  state.pendingMotion = pending;
  updateMotionControls();
  // Новый полный оборот — отдельное намерение пользователя. Ретаргет
  // незавершённого движения задаёт конечное значение и подхватывает текущую позу.
  const initialize = repeatCycle && cyclicGesture() && !state.playhead && progress() === 1;
  try {
    const executor = await motionExecutor();
    if (revision !== state.revision || viewRevision !== state.viewRevision || motionRevision !== state.motionRevision) return;
    const from = initialize ? 0 : progress();
    const result = effect(from, to);
    if (!result.ok) { state.pendingMotion = null; updateMotionControls(); ui['motion-status'].textContent = result.reason.message; return; }
    const previous = state.animations;
    const controls = executor.executeSymbolEffect(ui['symbol-stage'], result.effect, { initialize });
    // Successor считывает текущую позу до освобождения предыдущего execution.
    for (const control of previous) control.stop();
    cancelAnimationFrame(state.frame);
    state.effect = result.effect;
    state.animations = controls;
    state.pendingMotion = null;
    state.playhead = { from, to, elapsed: 0, duration: result.effect.options.duration, startedAt: performance.now(), running: !pending.paused };
    if (pending.paused) for (const control of controls) control.pause();
    updateMotionControls();
    const update = () => {
      if (motionRevision !== state.motionRevision) return;
      ui.progress.value = String(progress());
      if (state.playhead?.running && controls.some((control) => control.state === 'running')) state.frame = requestAnimationFrame(update);
    };
    update();
    Promise.all(controls.map(control => control.finished)).then(results => {
      if (motionRevision !== state.motionRevision || results.some(result => result.status !== 'finished')) return;
      state.playhead = null;
      ui.progress.value = String(to);
      updateMotionControls();
    }).catch(error => { if (motionRevision === state.motionRevision) ui['motion-status'].textContent = error.message; });
  } catch (error) {
    if (revision === state.revision && viewRevision === state.viewRevision && motionRevision === state.motionRevision) {
      state.pendingMotion = null;
      updateMotionControls();
      ui['motion-status'].textContent = error.message;
    }
  }
}

ui['symbol-search'].addEventListener('input', () => { state.limit = 48; grid(); });
displaySize.addEventListener('input', displayStyle);
displayColor.addEventListener('input', displayStyle);
ui.variant.addEventListener('change', () => select(state.name));
ui['more-symbols'].addEventListener('click', () => { state.limit += 48; grid(); });
ui.gesture.addEventListener('change', updateMotionControls);
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => renderView(button.dataset.view));
ui.play.addEventListener('click', () => advance(1, { repeatCycle: true }));
ui.reverse.addEventListener('click', () => advance(0));
ui.pause.addEventListener('click', () => {
  const head = state.playhead;
  const pending = state.pendingMotion;
  if (!head && !pending) return;
  const pause = pending ? !pending.paused : head.running;
  if (pending) pending.paused = pause;
  if (head && head.running && pause) {
    head.elapsed += performance.now() - head.startedAt;
    head.running = false;
    for (const control of state.animations) control.pause();
    cancelAnimationFrame(state.frame);
    state.frame = null;
    ui.progress.value = String(progress());
  } else if (head && !head.running && !pause) {
    head.startedAt = performance.now();
    head.running = true;
    for (const control of state.animations) control.play();
    const motionRevision = state.motionRevision;
    const update = () => { if (motionRevision !== state.motionRevision) return; ui.progress.value = String(progress()); if (state.playhead?.running) state.frame = requestAnimationFrame(update); };
    update();
  }
  updateMotionControls();
});
ui.progress.addEventListener('input', async () => {
  const to = Number(ui.progress.value);
  stop();
  const motionRevision = state.motionRevision;
  const result = effect(to, to, { duration: 0 });
  if (result.ok) {
    try {
      const executor = await motionExecutor();
      if (motionRevision !== state.motionRevision) return;
      state.animations = executor.executeSymbolEffect(ui['symbol-stage'], result.effect, { initialize: true });
      ui.progress.value = String(to);
    } catch (error) { if (motionRevision === state.motionRevision) ui['motion-status'].textContent = error.message; }
  }
});
ui['reduce-motion'].checked = reducedPreference.matches;
function reduceCurrentMotion() {
  const target = state.pendingMotion?.to ?? state.effect?.to;
  if (target !== undefined) advance(target);
}
ui['reduce-motion'].addEventListener('change', () => { if (ui['reduce-motion'].checked) reduceCurrentMotion(); });
reducedPreference.addEventListener('change', () => { ui['reduce-motion'].checked = reducedPreference.matches; if (reducedPreference.matches) reduceCurrentMotion(); });
ui.export.addEventListener('click', () => {
  if (!state.loaded || state.viewLoading) return;
  const format = ui['export-format'].value;
  const legacyExport = state.view === 'generated' && state.legacy;
  let content;
  if (format === 'svg') content = legacyExport ? state.glyph.svg : state.original;
  else if (format === 'effect') {
    if (!motionView()) { ui['export-status'].textContent = 'Выберите авторский вид или прежнюю модель для экспорта её жеста.'; return; }
    const result = effect(0, 1);
    if (!result.ok) { ui['export-status'].textContent = result.reason.message; return; }
    content = JSON.stringify(result.effect, null, 2);
  } else { ui['export-status'].textContent = `${format === 'lottie' ? 'Lottie' : 'SF Symbols'}: для этого варианта нет проверенного адаптера.`; return; }
  const url = URL.createObjectURL(new Blob([content], { type: format === 'svg' ? 'image/svg+xml' : 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `${state.name}-${state.variant}${legacyExport ? '-recorded-model' : ''}.${format === 'svg' ? 'svg' : 'effect.json'}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  ui['export-status'].textContent = 'Файл подготовлен.';
});

try {
  const response = await fetch('explorer.json');
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  state.data = await response.json();
  ui['corpus-count'].textContent = `${state.data.summary.glyphs} семейств`;
  if (!state.data.rows.some((row) => row.name === state.name)) state.name = state.data.rows[0].name;
  await select(state.name);
} catch (error) {
  clearInspector('Не загружен');
  inspectorBusy(false);
  ui['symbol-grid'].textContent = `Библиотека недоступна: ${error.message}`;
  ui['symbol-stage'].textContent = 'Библиотека недоступна.';
  ui['source-status'].textContent = error.message;
  loadMessage(error.message);
}
