import { compileSymbolEffect } from './package/motion/index.js';
import { renderGlyphSvg } from './package/ir/render.js';
import { downloadFile } from './download.js';
import { authoredVariationCapability, renderVariationComparison } from './variation-preview.js';
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
const ui = Object.fromEntries(['symbol-search', 'variant', 'symbol-grid', 'more-symbols', 'empty-search', 'corpus-count', 'visible-count', 'symbol-inspector', 'symbol-name', 'model-status', 'symbol-stage', 'size-samples', 'source-status', 'axis-controls', 'axis-status', 'parts', 'gesture', 'play', 'reverse', 'pause', 'progress', 'progress-label', 'gesture-progress-control', 'state-group-controls', 'state-choices', 'state-choice-label', 'reduce-motion', 'motion-status', 'consumer-import', 'export-format', 'export', 'export-status'].map((id) => [id, $(`#${id}`)]));
const reducedPreference = matchMedia('(prefers-reduced-motion: reduce)');
const loadStatus = document.querySelector('#load-status');
function loadMessage(message = '') {
  loadStatus.textContent = message;
  loadStatus.hidden = !message;
}
const state = { data: null, name: 'time', variant: 'outline', view: 'original', viewLoading: false, limit: 48, revision: 0, viewRevision: 0, motionRevision: 0, pendingMotion: null, loaded: false, legacy: false, modelModule: null, abort: null, module: null, capabilities: null, glyph: null, axes: {}, variation: {}, original: '', effect: null, animations: [], frame: null, playhead: null, replacement: null };
const variationAvailable = () => authoredVariationCapability(state.module?.glyphCapabilities(state.variant));
const variationView = () => Boolean(variationAvailable() && state.view !== 'original' && !state.legacy);
function updateVariationStatus() {
  if (!variationAvailable()) return;
  const refused = ui['axis-controls'].querySelector('[data-variation-error]');
  ui['axis-status'].textContent = refused?.dataset.variationError ?? (['overlay', 'difference'].includes(state.view)
    ? 'Красным — исходная форма, синим — изменённая.'
    : 'Множители меняют размер точек и расстояние между ними.');
}
const REPLACEMENT_GESTURE = 'enclosure.replace';
const stateLabels = Object.freeze({ confirmation: 'Подтверждение', dismissal: 'Закрыть',
  question: 'Вопрос', attention: 'Внимание', increase: 'Добавить', decrease: 'Убрать',
  play: 'Воспроизвести', pause: 'Приостановить',
  aloof: 'Сдержанное выражение', sad: 'Грустное выражение', smile: 'Улыбка' });
const stateLabel = id => stateLabels[id] ?? id;
const replacementMode = () => Boolean(state.replacement && ui.gesture.value === REPLACEMENT_GESTURE &&
  state.view === 'original' && !state.legacy);
const replacementMember = () => state.replacement?.capabilities.states.find(member => member.id === state.replacement.target);

function stateSamples(svg) {
  ui['size-samples'].replaceChildren(...[16, 24, 48].map(size => {
    const element = document.createElement('div');
    element.className = 'size-sample';
    element.innerHTML = typeof svg === 'function' ? svg(size) : svg;
    const image = element.querySelector('svg');
    image.style.width = image.style.height = `${size}px`;
    image.setAttribute('aria-hidden', 'true');
    const label = document.createElement('span');
    label.textContent = `${size} px`;
    element.append(label);
    return element;
  }));
}

function inspectorPresentation() {
  const active = replacementMode();
  const group = active ? state.replacement : null;
  const member = active ? replacementMember() : null;
  const row = selectedRow(), caps = state.capabilities;
  const comparison = ['overlay', 'difference'].includes(state.view);
  const variation = variationView();
  const name = member?.icon ?? state.name;
  const variant = state.variant === 'filled' ? 'заливка' : 'контурное начертание';
  const viewLabel = state.legacy ? 'Прежняя модель' : variation ? comparison
    ? `${state.view === 'overlay' ? 'Наложение' : 'Разница'} с авторской формой` : 'Вариация авторской формы'
    : comparison ? `${state.view === 'overlay' ? 'Наложение' : 'Разница'} с прежней моделью` : '';
  ui['symbol-name'].textContent = name;
  ui['model-status'].textContent = active ? 'Авторские состояния' : variation
    ? comparison ? state.view === 'overlay' ? 'Наложение' : 'Разница' : 'Авторская вариация'
    : viewLabel || (caps.modelState === 'accepted' ? 'Модель принята' : caps.modelState === 'candidate' ? 'Модель на проверке' : 'Авторский SVG');
  ui['symbol-stage'].setAttribute('aria-label', active ? `Символ ${name}: ${stateLabel(member.id)}` : `Символ ${name}: ${variant}${viewLabel ? `. ${viewLabel}` : ''}`);
  ui['state-choice-label'].textContent = active ? stateLabel(member.id) : '';
  for (const button of ui['state-choices'].querySelectorAll('button')) {
    button.setAttribute('aria-pressed', String(active && button.dataset.stateTarget === member.id));
  }
  const author = member?.author ?? row.original;
  ui['source-status'].textContent = `Lab UI v2.1. Версия ${author.version}. Узел ${author.nodeId}. ` +
    (active ? 'Авторский знак; общая оболочка сохраняется при замене.' : state.legacy ? 'Прежняя модель: паритет с новой авторской основой не принят.' : variation
      ? `${comparison ? 'Красным — исходная форма, синим — изменённая. ' : ''}Размер точки ×${state.variation.dotScale}; расстояние ×${state.variation.spacingScale}. Образцы размеров и SVG относятся к этой форме.`
      : comparison ? `Красным — текущая основа, синим — прежняя ${row.model?.catalogState === 'accepted' ? 'модель' : 'модель на проверке'} при исходных параметрах. Части и образцы размеров относятся к текущему авторскому мастеру. Паритет не принят.` : 'Текущий авторский мастер. Возможности относятся к его закреплённой версии.');
  ui['consumer-import'].textContent = active ? `import { renderStateSvg, compileStateEffect } from\n  '@labpics/icons/states/${group.capabilities.group}';` : state.legacy ? `import { glyph } from '@labpics/icons/ir';\n// Прежняя основа; текущий master: ./symbols/${state.name}` : `import { glyph } from\n  '@labpics/icons/symbols/${state.name}';`;
  const parts = active ? [...member.contentPartIds, ...group.capabilities.sharedPartIds].map(id => ({ id, role: id === group.capabilities.enclosurePartId ? 'container' : 'content' })) : state.glyph.parts;
  ui.parts.replaceChildren(...parts.map(part => {
    const item = document.createElement('li');
    item.textContent = part.role === 'unclassified' ? `Авторский контур ${part.zIndex + 1}; семантика пока не принята.` : `${comparison ? 'Авторский ' : ''}${part.id} — ${part.role}`;
    item.title = part.id;
    return item;
  }));
  if (active) {
    const result = group.module.render(member.id, { variant: state.variant });
    if (!result.ok) throw new Error(`${result.reason.code}: ${result.reason.message}`);
    stateSamples(result.svg);
  } else {
    const productionSvg = state.legacy || variation || motionAdmission(state.glyph, caps, caps.motion.gestures[0]?.id)?.ok;
    stateSamples(size => productionSvg ? renderGlyphSvg(state.glyph, { instanceId: `sample-${state.revision}-${state.viewRevision}-${size}` }) : state.original);
  }
  updateVariationStatus();
}

function replacementChoices() {
  const group = state.replacement;
  ui['state-choices'].replaceChildren();
  if (!group || state.legacy) return;
  for (const member of group.capabilities.states) {
    const result = group.module.render(member.id, { variant: state.variant });
    if (!result.ok) throw new Error(`${result.reason.code}: ${result.reason.message}`);
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.stateTarget = member.id;
    button.setAttribute('aria-label', stateLabel(member.id));
    button.setAttribute('aria-pressed', String(member.id === group.target));
    button.title = stateLabel(member.id);
    button.innerHTML = result.svg;
    button.querySelector('svg').setAttribute('aria-hidden', 'true');
    button.addEventListener('click', () => replaceState(member.id));
    ui['state-choices'].append(button);
  }
}

function progress() {
  const head = state.playhead;
  if (!head) return Number(ui.progress.value);
  // Фаза нужна для выбора обратного участка: одинаковый сдвиг бывает на
  // исходящей и возвратной ветви. Видимую позу подхватывает исполнитель.
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
  if (state.replacement) state.replacement.paused = false;
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
  return (state.view === 'original' && !state.legacy) || state.view === 'generated';
}

function selectedGesture() {
  return state.capabilities?.motion.gestures.find(gesture => gesture.id === ui.gesture.value);
}

function cyclicGesture() {
  return selectedGesture()?.kind === 'cycle';
}

function updateMotionControls() {
  ui['state-group-controls'].hidden = !replacementMode();
  ui['gesture-progress-control'].hidden = replacementMode();
  if (replacementMode()) {
    const ready = state.loaded && !state.viewLoading;
    for (const id of ['play', 'gesture']) ui[id].disabled = !ready;
    ui.reverse.disabled = !ready || state.replacement.previous === state.replacement.target;
    ui.progress.disabled = true;
    const moving = state.animations.some(control => ['running', 'paused'].includes(control.state));
    ui.pause.disabled = !ready || (!moving && !state.pendingMotion);
    ui.pause.textContent = (state.pendingMotion?.paused ?? state.replacement.paused) ? 'Продолжить' : 'Пауза';
    ui['motion-status'].textContent = ready ? 'Оболочка остаётся на месте. Выберите другой знак, разверните или прервите замену.' : 'Подготавливаем авторские состояния.';
    for (const button of ui['state-choices'].querySelectorAll('button')) button.disabled = !ready;
    return;
  }
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
  if (variationAvailable()) return ['generated', 'overlay', 'difference'].includes(view);
  if (view === 'generated') return Boolean(row.views.generated && row.model?.catalogState === 'accepted');
  return ['overlay', 'difference'].includes(view) && Boolean(row.views[view]);
}

function updateViewControls() {
  for (const button of document.querySelectorAll('[data-view]')) {
    if (button.dataset.view === 'generated') button.textContent = variationAvailable() ? 'Вариация' : 'Модель';
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
  ui['state-group-controls'].hidden = true;
  ui['gesture-progress-control'].hidden = false;
  ui['state-choices'].replaceChildren();
  ui.pause.textContent = 'Пауза';
  for (const id of ['play', 'reverse', 'pause', 'progress', 'gesture', 'export']) ui[id].disabled = true;
  updateViewControls();
}

async function renderView(view = state.view, { preserveProgress = false, variation: requestedVariation = state.variation, resetVariation = false, onVariationAccepted = null } = {}) {
  if (!state.loaded) return;
  const revision = state.revision;
  const row = selectedRow();
  if (!viewAvailable(view, row)) {
    ui['source-status'].textContent = view === 'generated' ? 'Для прежней основы нет принятой модели. Кандидат доступен только для сравнения.' : 'Для этого варианта нет изображения сравнения.';
    loadMessage(ui['source-status'].textContent);
    return;
  }
  const viewRevision = ++state.viewRevision;
  const previousProgress = stop();
  state.viewLoading = true;
  loadMessage();
  inspectorBusy(true);
  updateMotionControls();
  try {
    let glyph = state.glyph, capabilities = state.capabilities, modelModule = state.modelModule;
    const variation = variationAvailable();
    const modified = variation && view !== 'original';
    const legacy = view === 'generated' && !variation;
    const axes = legacy ? state.axes : {};
    if (legacy && !state.legacy) {
      modelModule = await recordedCompiler();
      if (revision !== state.revision || viewRevision !== state.viewRevision) return;
      glyph = modelModule.glyph({ icon: state.name, variant: state.variant });
      if (glyph.provenance.kind !== 'model' || glyph.provenance.state !== 'accepted') throw new Error('Для прежней основы нет принятой модели. Кандидат доступен только для сравнения.');
      capabilities = modelModule.glyphCapabilities(state.name, state.variant);
    } else if (!legacy) {
      glyph = state.module.glyph({ variant: state.variant, ...(modified && { variation: requestedVariation }) });
      capabilities = state.module.glyphCapabilities(state.variant);
    }
    const annotatedSource = !legacy && motionAdmission(glyph, capabilities, capabilities.motion.gestures[0]?.id)?.ok;
    const productionSvg = legacy || modified || annotatedSource;
    let svg = productionSvg ? renderGlyphSvg(glyph, { instanceId: `stage-${revision}-${viewRevision}` }) : state.original;
    if (modified && ['overlay', 'difference'].includes(view)) {
      const source = state.module.glyph({ variant: state.variant, modelMode: 'source-only' });
      svg = renderVariationComparison(renderGlyphSvg(source, { instanceId: `source-${revision}-${viewRevision}` }),
        renderGlyphSvg(glyph, { instanceId: `modified-${revision}-${viewRevision}` }), glyph.viewBox, view, `compare-${revision}-${viewRevision}`);
    } else if (['overlay', 'difference'].includes(view)) {
      const response = await fetch(row.views[view], { signal: state.abort.signal });
      if (!response.ok) throw new Error(`Изображение недоступно: HTTP ${response.status}`);
      svg = await response.text();
    }
    if (revision !== state.revision || viewRevision !== state.viewRevision) return;
    const changedControls = capabilities !== state.capabilities || legacy !== state.legacy;
    Object.assign(state, { view, glyph, capabilities, modelModule, legacy, axes, variation: requestedVariation, viewLoading: false });
    ui['symbol-stage'].dataset.view = view;
    ui.pause.textContent = 'Пауза';
    if (changedControls) controls();
    if (replacementMode()) {
      const result = state.replacement.module.renderStateSvg(state.replacement.target, { variant: state.variant });
      if (!result.ok) throw new Error(`${result.reason.code}: ${result.reason.message}`);
      svg = result.svg;
    }
    ui['symbol-stage'].innerHTML = svg;
    for (const image of ui['symbol-stage'].querySelectorAll('svg')) image.setAttribute('aria-hidden', 'true');
    // Сброс полей подтверждается вместе с формой, до ожидания её motion-позы.
    if (resetVariation) {
      for (const input of ui['axis-controls'].querySelectorAll('[data-variation]')) {
        input.value = String(state.variation[input.dataset.variation]);
        input.setCustomValidity(''); input.removeAttribute('aria-invalid');
        delete input.dataset.variationError;
      }
      updateVariationStatus();
    }
    onVariationAccepted?.();
    // Значение неподвижного мастера задаёт семантика, а не имя иконки.
    ui.progress.value = String(motionAdmission()?.ok ? preserveProgress ? previousProgress : selectedGesture()?.restProgress ?? 0 : 0);
    if (preserveProgress && motionAdmission()?.ok && motionView()) await seekProgress(previousProgress);
    if (revision !== state.revision || viewRevision !== state.viewRevision) return;
    inspectorPresentation();
    updateViewControls();
    inspectorBusy(false);
    updateMotionControls();
    displayStyle();
    return { ok: true };
  } catch (error) {
    if (error.name === 'AbortError' || revision !== state.revision || viewRevision !== state.viewRevision) return;
    state.viewLoading = false;
    inspectorBusy(false);
    updateViewControls();
    updateMotionControls();
    ui['source-status'].textContent = error.message;
    loadMessage(error.message);
    return { ok: false, error };
  }
}

function controls() {
  const caps = state.capabilities;
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
  const variation = variationAvailable();
  if (variation) {
    state.variation = { ...variation.defaults, ...state.variation };
    for (const [name, text] of [['dotScale', 'Размер точки'], ['spacingScale', 'Расстояние между точками']]) {
      const label = document.createElement('label');
      label.className = 'variation-control';
      const title = document.createElement('span');
      title.textContent = text;
      const input = document.createElement('input');
      input.type = 'number'; input.step = 'any'; input.min = '0';
      input.dataset.variation = name;
      input.value = String(state.variation[name]);
      input.setAttribute('aria-describedby', 'axis-status');
      let inputRevision = 0;
      input.addEventListener('input', async () => {
        const revision = state.revision;
        const requestRevision = ++inputRevision;
        try {
          const requested = { ...state.variation, [name]: input.valueAsNumber };
          state.module.glyph({ variant: state.variant, variation: requested });
          const result = await renderView('generated', { preserveProgress: true, variation: requested,
            onVariationAccepted() {
              if (revision !== state.revision || requestRevision !== inputRevision) return;
              input.setCustomValidity(''); input.removeAttribute('aria-invalid');
              delete input.dataset.variationError;
              updateVariationStatus();
            },
          });
          if (revision !== state.revision || requestRevision !== inputRevision || !result) return;
          if (!result.ok) throw result.error;
        } catch (error) {
          if (revision !== state.revision || requestRevision !== inputRevision) return;
          input.setCustomValidity(error.message); input.setAttribute('aria-invalid', 'true');
          input.dataset.variationError = `${error.code ?? 'INVALID_VARIATION'}: ${error.message}`;
          ui['axis-status'].textContent = input.dataset.variationError;
        }
      });
      const unit = document.createElement('span'); unit.textContent = '×';
      label.append(title, input, unit);
      ui['axis-controls'].append(label);
    }
    const reset = document.createElement('button');
    reset.type = 'button'; reset.className = 'variation-reset'; reset.dataset.variationReset = '';
    reset.textContent = 'Вернуть авторскую форму';
    reset.addEventListener('click', () => renderView('original', {
      preserveProgress: true, variation: { ...variation.defaults }, resetVariation: true,
    }));
    ui['axis-controls'].append(reset);
  }
  ui['axis-status'].textContent = variation ? 'Положительные множители изменяют форму точек и расстояние между ними.'
    : caps.supportedAxes.length ? '' : 'Для этого варианта оси пока не приняты.';
  const selectedGesture = ui.gesture.value;
  ui.gesture.replaceChildren(...(state.replacement && !state.legacy ? [new Option('Смена знака', REPLACEMENT_GESTURE)] : []),
    ...caps.motion.gestures.map((gesture) => new Option(gesture.id, gesture.id)));
  if (!ui.gesture.options.length) ui.gesture.add(new Option('Нет принятого жеста', ''));
  else if ([...ui.gesture.options].some(option => option.value === selectedGesture)) ui.gesture.value = selectedGesture;
  replacementChoices();
}

async function select(name, { reveal = false } = {}) {
  stop();
  state.name = name;
  state.variant = ui.variant.value;
  state.axes = {};
  state.variation = {};
  state.view = 'original';
  state.viewLoading = false;
  state.legacy = false;
  state.modelModule = null;
  state.loaded = false;
  state.module = state.capabilities = state.glyph = null;
  state.replacement = null;
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
    const membership = state.data.stateGroups?.find(group => group.members.some(member => member.icon === name && member.variant === state.variant));
    const [module, response, replacementModule] = await Promise.all([
      import(`./package/symbols/${name}.js`),
      fetch(row.views.original, { signal: state.abort.signal }),
      membership ? import(`./package/states/${membership.group}.js`) : null,
    ]);
    if (!response.ok) throw new Error(`Авторский SVG недоступен: HTTP ${response.status}`);
    const original = await response.text();
    if (revision !== state.revision) return;
    state.module = module;
    state.capabilities = module.glyphCapabilities(state.variant);
    state.glyph = module.glyph({ variant: state.variant });
    state.original = original;
    if (replacementModule) {
      const capabilities = replacementModule.stateCapabilities();
      const member = capabilities.states.find(member => member.icon === name);
      if (capabilities.group !== membership.group || capabilities.variant !== state.variant || !member ||
          capabilities.proof.source.fileKey !== state.data.source.fileKey || capabilities.proof.source.version !== state.data.source.version) {
        throw new Error('Группа не относится к выбранной авторской основе.');
      }
      state.replacement = { module: replacementModule, capabilities, target: member.id, previous: member.id, paused: false };
    }
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
    state.replacement = null;
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

async function replaceState(target) {
  if (!replacementMode() || !state.loaded || state.viewLoading) return;
  const group = state.replacement;
  const revision = state.revision, viewRevision = state.viewRevision;
  const motionRevision = ++state.motionRevision;
  const pending = { paused: false, target };
  state.pendingMotion = pending;
  updateMotionControls();
  try {
    const executor = await motionExecutor();
    if (revision !== state.revision || viewRevision !== state.viewRevision ||
        motionRevision !== state.motionRevision || state.replacement !== group || !replacementMode()) return;
    const result = group.module.compileStateEffect(target, { duration: 900, variant: state.variant,
      reducedMotion: reducedPreference.matches || ui['reduce-motion'].checked });
    if (!result.ok) throw new Error(`${result.reason.code}: ${result.reason.message}`);
    const previous = state.animations;
    const controls = executor.executeSymbolEffect(ui['symbol-stage'], result.effect);
    // Все группы остаются mounted; successor считывает их видимость до stop прежнего.
    for (const control of previous) control.stop();
    if (target !== group.target) group.previous = group.target;
    group.target = target;
    group.paused = pending.paused;
    state.effect = result.effect;
    state.animations = controls;
    state.pendingMotion = null;
    if (pending.paused) for (const control of controls) control.pause();
    inspectorPresentation();
    displayStyle();
    updateMotionControls();
    Promise.all(controls.map(control => control.finished)).then(results => {
      if (motionRevision !== state.motionRevision || results.some(result => result.status !== 'finished')) return;
      state.animations = [];
      group.paused = false;
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
ui.gesture.addEventListener('change', () => state.replacement ? renderView(state.view) : updateMotionControls());
for (const button of document.querySelectorAll('[data-view]')) button.addEventListener('click', () => renderView(button.dataset.view, { preserveProgress: Boolean(variationAvailable()) }));
ui.play.addEventListener('click', () => replacementMode() ? replaceState(state.replacement.target) : advance(1, { repeatCycle: true }));
ui.reverse.addEventListener('click', () => replacementMode() ? replaceState(state.replacement.previous) : advance(0));
ui.pause.addEventListener('click', () => {
  if (replacementMode()) {
    const pending = state.pendingMotion;
    const pause = pending ? !pending.paused : !state.replacement.paused;
    if (pending) pending.paused = pause;
    state.replacement.paused = pause;
    for (const control of state.animations) pause ? control.pause() : control.play();
    updateMotionControls();
    return;
  }
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
async function seekProgress(to) {
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
}
ui.progress.addEventListener('input', () => seekProgress(Number(ui.progress.value)));
ui['reduce-motion'].checked = reducedPreference.matches;
function reduceCurrentMotion() {
  if (replacementMode()) {
    replaceState(state.pendingMotion?.target ?? state.replacement.target);
    return;
  }
  const target = state.pendingMotion?.to ?? state.effect?.to;
  if (target !== undefined) advance(target);
}
ui['reduce-motion'].addEventListener('change', () => { if (ui['reduce-motion'].checked) reduceCurrentMotion(); });
reducedPreference.addEventListener('change', () => { ui['reduce-motion'].checked = reducedPreference.matches; if (reducedPreference.matches) reduceCurrentMotion(); });
ui.export.addEventListener('click', async () => {
  if (!state.loaded || state.viewLoading) return;
  const format = ui['export-format'].value;
  const legacyExport = state.view === 'generated' && state.legacy;
  const revision = state.revision;
  const viewRevision = state.viewRevision;
  let content;
  const group = replacementMode() ? state.replacement : null;
  if (group) {
    const result = format === 'svg' ? group.module.render(group.target, { variant: state.variant }) :
      group.module.exportStateTransition(group.target, { format: format === 'effect' ? 'web-effect' : format,
        duration: 900, variant: state.variant, reducedMotion: reducedPreference.matches || ui['reduce-motion'].checked });
    if (!result.ok) { ui['export-status'].textContent = `${result.reason.code}: ${result.reason.message}`; return; }
    content = format === 'svg' ? result.svg : JSON.stringify(result.effect, null, 2);
  }
  else if (format === 'svg') content = legacyExport ? state.glyph.svg : variationView()
    ? renderGlyphSvg(state.glyph, { instanceId: 'export' }) : state.original;
  else if (format === 'effect') {
    if (!motionView()) { ui['export-status'].textContent = 'Выберите авторский вид или прежнюю модель для экспорта её жеста.'; return; }
    const result = effect(0, 1);
    if (!result.ok) { ui['export-status'].textContent = result.reason.message; return; }
    content = JSON.stringify(result.effect, null, 2);
  } else if (format === 'lottie') {
    if (state.legacy || state.view !== 'original' && !variationView()) { ui['export-status'].textContent = 'Lottie экспортирует текущий авторский вид.'; return; }
    ui.export.disabled = true;
    ui['export-status'].textContent = 'Подготавливаем Lottie…';
    try {
      const target = await import(`./package/lottie/${state.name}.js`);
      if (state.revision !== revision || state.viewRevision !== viewRevision || state.viewLoading || state.legacy) return;
      const gesture = ui.gesture.value;
      const result = target.exportLottie({ variant: state.variant, color: displayColor.value,
        ...(variationView() ? { variation: state.variation } : {}),
        ...(gesture ? { gesture, duration: 1000, from: 0, to: 1, reducedMotion: ui['reduce-motion'].checked } : {}) });
      if (!result.ok) { ui['export-status'].textContent = `Lottie: ${result.reason.code}: ${result.reason.message}`; return; }
      content = JSON.stringify(result.animation);
    } catch (error) {
      if (state.revision === revision) ui['export-status'].textContent = `Lottie не подготовлен: ${error.message}`;
      return;
    } finally {
      if (state.revision === revision) ui.export.disabled = !state.loaded || state.viewLoading;
    }
  } else { ui['export-status'].textContent = 'SF Symbols: для этого варианта нет проверенного адаптера.'; return; }
  downloadFile(content, format === 'svg' ? 'image/svg+xml' : 'application/json',
    `${group ? `${group.capabilities.group}-${group.target}` : state.name}-${state.variant}${legacyExport ? '-recorded-model' : variationView() ? '-variation' : ''}.${format === 'svg' ? 'svg' : format === 'lottie' ? 'lottie.json' : 'effect.json'}`);
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
