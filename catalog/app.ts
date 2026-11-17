import * as motion from '@labpics/motion';
import { createSymbolMotion, type MountedIcon, type SymbolPlayback } from '@labpics/icons/motion';
import { renderIcon, type IconSymbol, type IconVariant, type RenderIconOptions } from '@labpics/icons/render';
import { entries, families, loaders, nativeFiles, version } from '#catalog';

const byId = new Map(entries.map(entry => [entry.id, entry]));
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
const icons = createSymbolMotion(motion);
const preference = matchMedia('(prefers-reduced-motion: reduce)');
const narrow = matchMedia('(max-width: 760px)');
let variant: IconVariant = 'outline';
let selectedId = 'time';
let familyId = '';
let symbol: IconSymbol | undefined;
let mounted: MountedIcon | undefined;
let options: RenderIconOptions = { size: 24, weight: 400, opsz: 'auto', variant };
let previous: RenderIconOptions | undefined;
let revision = 0;
let clip: SymbolPlayback | undefined;
let stopDriver: (() => void) | undefined;
let colorChanged = false;
let detailOpener: HTMLElement | undefined;
const modules = new Map<string, Promise<IconSymbol>>();
const duration = 1000;
const labels: Record<string, string> = {
  left: 'Влево', right: 'Вправо', up: 'Вверх', down: 'Вниз', normal: 'Обычное', unread: 'Новое', off: 'Выключено', on: 'Включено',
  high: 'Высокая', middle: 'Средняя', low: 'Низкая', quiet: 'Тихо', mute: 'Без звука', date: 'Дата', today: 'Сегодня', clear: 'Пустой', grid: 'Сетка',
  confirmed: 'Готово', dismissed: 'Отмена', question: 'Вопрос', attention: 'Внимание', increase: 'Добавить', decrease: 'Убрать',
  play: 'Воспроизведение', pause: 'Пауза', stop: 'Стоп', cycle: 'Вращение', draw: 'Рисование', presence: 'Появление',
  nudge: 'Направление', ring: 'Звонок', advance: 'Ход часов', level: 'Громкость',
};
const label = (id: string) => labels[id] ?? id.replaceAll('-', ' ');

function message(id: string, text = '') { $(id).textContent = text; $(id).hidden = !text; }
function load(id: string) {
  if (!modules.has(id)) modules.set(id, loaders[id]().catch(error => { modules.delete(id); throw error; }));
  return modules.get(id)!;
}
function progress(value: number) { input('progress').value = String(value); $('progress-value').textContent = `${Math.round(value * 100)}%`; }
function stop() {
  stopDriver?.(); stopDriver = undefined;
  $('play-label').textContent = 'Воспроизвести';
}
function clearClip() { stop(); clip?.stop(); clip = undefined; progress(0); }
function currentEffects() {
  const selected = options.state && symbol?.semantics?.states?.[options.state];
  return (selected && selected.semantics || symbol?.semantics)?.variants[variant].effects ?? {};
}
function updateAnimationChoices(preferred = select('animation').value) {
  const animation = select('animation');
  const choices = [new Option('Без движения', ''), ...Object.keys(currentEffects()).map(id => new Option(label(id), id))];
  if (previous) choices.push(new Option('Переход', 'transition'));
  animation.replaceChildren(...choices);
  animation.value = choices.some(option => option.value === preferred) ? preferred : choices[1]?.value ?? '';
  const disabled = !animation.value;
  for (const id of ['play', 'reverse', 'progress']) ($<HTMLButtonElement>(id)).disabled = disabled;
}
function apply(next: RenderIconOptions, animate = true) {
  if (!mounted) return;
  clearClip(); previous = { ...options }; options = { ...next };
  mounted.set(options, { duration: animate ? 180 : 0, reducedMotion: input('reduce-motion').checked });
  updateAnimationChoices(animate ? 'transition' : '');
  updateDetail();
}
function renderGrid() {
  const query = input('search').value.trim().toLowerCase().replaceAll(/[_\s]+/g, '-');
  const filter = select('filter').value;
  const filtered = entries.filter(entry => entry.id.includes(query) && (filter === 'all' || filter === 'motion' && entry.animated || filter === 'states' && entry.families.length));
  const fragment = document.createDocumentFragment();
  for (const entry of filtered) {
    const tile = document.createElement('button'); tile.className = 'symbol-tile'; tile.type = 'button';
    tile.dataset.id = entry.id; tile.title = entry.id; tile.setAttribute('aria-label', entry.id);
    tile.setAttribute('aria-pressed', String(entry.id === selectedId));
    const image = document.createElement('img'); image.src = `icons/${entry.id}-${variant}.svg`; image.alt = ''; image.width = image.height = 28; image.loading = 'lazy';
    const name = document.createElement('span'); name.textContent = entry.id;
    tile.append(image, name); fragment.append(tile);
  }
  $('grid').replaceChildren(fragment); $('empty').hidden = !!filtered.length;
  $('visible-count').textContent = `${filtered.length} из ${entries.length}`;
}
function highlight() {
  for (const tile of document.querySelectorAll<HTMLElement>('.symbol-tile')) tile.setAttribute('aria-pressed', String(tile.dataset.id === selectedId));
}
function serializedOptions(value: RenderIconOptions) {
  const fields = [`size: ${value.size}`, `weight: ${value.weight}`, `opsz: ${JSON.stringify(value.opsz)}`, `variant: '${value.variant}'`];
  if (value.state) fields.push(`state: '${value.state}'`);
  if (value.date) fields.push(`date: new Date('${value.date.toISOString()}')`, `timeZone: '${value.timeZone}'`);
  return `{ ${fields.join(', ')} }`;
}
function code() {
  const path = familyId ? `states/${familyId}` : `symbols/${selectedId}`;
  const animation = select('animation').value;
  const target = `const element = document.querySelector('#icon');\nelement.style.color = '${input('color').value}';\n`;
  if (animation) return `import icon from '@labpics/icons/${path}';\nimport { createSymbolMotion } from '@labpics/icons/motion';\nimport * as motion from '@labpics/motion';\n\n${target}const view = createSymbolMotion(motion).mount(element, icon, ${serializedOptions(animation === 'transition' && previous ? previous : options)});\n` +
    (animation === 'transition' ? `view.set(${serializedOptions(options)}, { duration: ${duration} });` : `view.effect('${animation}', { duration: ${duration} });`) + '\n// При удалении элемента: view.dispose();';
  return `import icon from '@labpics/icons/${path}';\nimport { renderIcon } from '@labpics/icons/render';\n\n${target}element.innerHTML = renderIcon(icon, ${serializedOptions(options)});`;
}
function updateDetail() {
  if (!symbol) return;
  $('symbol-name').textContent = selectedId;
  $('stage').style.color = input('color').value;
  $('stage').setAttribute('aria-label', `${selectedId}, ${variant === 'outline' ? 'контур' : 'заливка'}`);
  $('stage').style.setProperty('--preview-size', `${Math.min(192, Number(options.size) * 5)}px`);
  $('samples').replaceChildren(...[16, 24, 48].map(size => {
    const sample = document.createElement('div'); sample.className = 'size-sample';
    const art = document.createElement('span'); art.innerHTML = renderIcon(symbol!, { ...options, size }); art.style.color = input('color').value;
    art.setAttribute('aria-hidden', 'true');
    const caption = document.createElement('span'); caption.textContent = `${size} px`; sample.append(art, caption); return sample;
  }));
  $('import-code').textContent = code(); $('size-value').textContent = `${options.size} px`;
  $('weight-value').textContent = String(options.weight); $('opsz-value').textContent = input('opsz').value;
  $('color-value').textContent = input('color').value.toUpperCase();
  for (const choice of document.querySelectorAll<HTMLElement>('[data-state]')) choice.setAttribute('aria-pressed', String(choice.dataset.state === options.state));
  highlight(); message('export-status');
  const url = new URL(location.href); url.searchParams.set('icon', selectedId); url.searchParams.set('variant', variant);
  if (familyId) url.searchParams.set('family', familyId); else url.searchParams.delete('family');
  history.replaceState(null, '', url);
}
async function choose(id: string, requestedFamily?: string, present = true) {
  const entry = byId.get(id); if (!entry) return;
  const ownRevision = ++revision; clearClip();
  const membership = entry.families.find(value => value.family === requestedFamily) ?? entry.families[0];
  const key = membership ? `states/${membership.family}` : id;
  $('inspector').setAttribute('aria-busy', 'true'); $<HTMLFieldSetElement>('settings').disabled = true;
  $('retry').hidden = true; message('load-status', 'Загрузка символа…');
  if (present) {
    if (document.activeElement instanceof HTMLElement && !$('inspector').contains(document.activeElement)) detailOpener = document.activeElement;
    document.body.classList.add('detail-open');
    if (narrow.matches) $('close-detail').focus();
  }
  syncModal();
  try {
    const next = await load(key); if (ownRevision !== revision) return;
    mounted?.dispose(); symbol = next; selectedId = id; familyId = membership?.family ?? ''; previous = undefined;
    options = { size: Number(input('size').value), weight: Number(input('weight').value),
      opsz: input('auto-optics').checked ? 'auto' : Number(input('opsz').value), variant,
      ...(membership ? { state: membership.state } : {}),
      ...(next.semantics?.calendar ? { date: new Date(`${input('date').value}T12:00:00Z`), timeZone: 'UTC' } : {}) };
    mounted = icons.mount($('stage'), next, options);
    input('weight').min = String(next.data.axes.weight[0]); input('weight').max = String(next.data.axes.weight[2]);
    input('opsz').min = String(next.data.axes.opsz[0]); input('opsz').max = String(next.data.axes.opsz[2]);
    $('states-section').hidden = !membership;
    $('states').replaceChildren(...Object.keys(next.semantics?.states ?? {}).map(state => {
      const button = document.createElement('button'); button.type = 'button'; button.dataset.state = state; button.textContent = label(state); return button;
    }));
    $('family-control').hidden = entry.families.length < 2;
    select('family').replaceChildren(...entry.families.map(value => new Option(value.family, value.family)));
    select('family').value = familyId;
    $('date-section').hidden = !next.semantics?.calendar;
    updateAnimationChoices(); updateDetail(); message('load-status');
    $<HTMLFieldSetElement>('settings').disabled = false; $('inspector').setAttribute('aria-busy', 'false');
  } catch {
    if (ownRevision !== revision) return;
    message('load-status', 'Не удалось загрузить символ. Проверьте соединение и повторите.');
    $('retry').hidden = false; $('retry').onclick = () => void choose(id, requestedFamily, document.body.classList.contains('detail-open'));
    $('inspector').setAttribute('aria-busy', 'false');
  }
}
function prepareClip() {
  if (!mounted) return;
  const animation = select('animation').value;
  const reducedMotion = input('reduce-motion').checked || preference.matches;
  mounted.set(animation === 'transition' && previous ? previous : options, { duration: 0 });
  clip = animation === 'transition' ? mounted.set(options, { duration, reducedMotion }) : mounted.effect(animation, { duration, reducedMotion });
  clip.pause();
}
function play(reverse = false) {
  if (!mounted || !select('animation').value) return;
  if (stopDriver && !reverse) { stop(); return; }
  stop();
  let start = Number(input('progress').value), end = reverse ? 0 : 1;
  if (!clip || start === end) { clip?.stop(); prepareClip(); start = reverse ? 1 : 0; }
  if (!clip) return;
  if (clip.duration === 0) { progress(end); return; }
  clip.seek(start * duration); progress(start);
  const clock = motion.value(start);
  const unsubscribe = clock.subscribe(value => { clip?.seek(value * duration); progress(value); });
  const controls = clock.animate(end, { duration: Math.abs(end - start) * duration, ease: 'linear', reducedMotion: 'user' });
  const release = () => { unsubscribe(); clock.dispose(); if (stopDriver === release) { stopDriver = undefined; $('play-label').textContent = 'Воспроизвести'; } };
  stopDriver = release; $('play-label').textContent = 'Пауза';
  void controls.finished.then(result => {
    if (stopDriver === release && result.status === 'finished') { progress(end); clip?.seek(end * duration); clip?.stop(); clip = undefined; }
  }).finally(release);
}
function download(content: string | Uint8Array, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([content as BlobPart], { type }));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
async function exportFile() {
  if (!symbol) return;
  const captured = { symbol, options: { ...options }, previous, animation: select('animation').value,
    format: select('format').value, id: selectedId, family: familyId, color: input('color').value as `#${string}`,
    frame: mounted?.element.outerHTML };
  message('export-status');
  try {
    if (captured.format === 'svg') {
      download((captured.frame ?? renderIcon(captured.symbol, captured.options)).replaceAll('currentColor', captured.color), 'image/svg+xml', `${captured.id}.svg`); return;
    }
    if (captured.format === 'kotlin') {
      const filename = nativeFiles[captured.family ? `states/${captured.family}` : captured.id];
      const response = await fetch(`kotlin/${filename}`); if (!response.ok) throw Error('load');
      download(await response.text(), 'text/plain', filename); return;
    }
    const { exportLottie, packDotLottie } = await import('@labpics/icons/lottie');
    const result = exportLottie(captured.symbol, { ...captured.options, color: captured.color, duration,
      ...(captured.animation === 'transition' && captured.previous ? { transition: { from: captured.previous, to: captured.options } } : captured.animation ? { gesture: captured.animation } : {}) });
    if (!result.ok) { message('export-status', 'Это движение пока нельзя сохранить в выбранном формате. SVG текущего состояния доступен.'); return; }
    if (captured.format === 'dotlottie') download(packDotLottie(result.animation), 'application/zip', `${captured.id}.lottie`);
    else download(JSON.stringify(result.animation), 'application/json', `${captured.id}.json`);
  } catch { message('export-status', 'Не удалось сохранить файл. Попробуйте ещё раз.'); }
}

$('grid').addEventListener('click', event => { const tile = (event.target as HTMLElement).closest<HTMLElement>('[data-id]'); if (tile) void choose(tile.dataset.id!); });
$('grid').addEventListener('keydown', event => {
  if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
  const tiles = [...document.querySelectorAll<HTMLButtonElement>('.symbol-tile')]; const index = tiles.indexOf(document.activeElement as HTMLButtonElement); if (index < 0) return;
  const columns = getComputedStyle($('grid')).gridTemplateColumns.split(' ').length;
  const destination = event.key === 'Home' ? 0 : event.key === 'End' ? tiles.length - 1 : index + ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -columns, ArrowDown: columns }[event.key] ?? 0);
  tiles[Math.max(0, Math.min(tiles.length - 1, destination))]?.focus(); event.preventDefault();
});
input('search').addEventListener('input', renderGrid); select('filter').addEventListener('change', renderGrid);
$('clear-search').onclick = () => { input('search').value = ''; select('filter').value = 'all'; renderGrid(); input('search').focus(); };
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-variant]')) button.onclick = () => {
  variant = button.dataset.variant as IconVariant;
  for (const item of document.querySelectorAll('[data-variant]')) item.setAttribute('aria-pressed', String(item === button));
  renderGrid(); apply({ ...options, variant });
};
for (const name of ['size', 'weight', 'opsz']) input(name).addEventListener('input', () => apply({ ...options,
  size: Number(input('size').value), weight: Number(input('weight').value), opsz: input('auto-optics').checked ? 'auto' : Number(input('opsz').value) }));
input('auto-optics').onchange = () => { $('optics-control').hidden = input('auto-optics').checked; apply({ ...options, opsz: input('auto-optics').checked ? 'auto' : Number(input('opsz').value) }); };
input('color').oninput = () => { colorChanged = true; updateDetail(); };
$('states').onclick = event => { const state = (event.target as HTMLElement).closest<HTMLElement>('[data-state]')?.dataset.state; if (state) { selectedId = families[familyId][state]; apply({ ...options, state }); } };
select('family').onchange = () => void choose(selectedId, select('family').value);
input('date').onchange = () => { if (input('date').value && input('date').validity.valid) apply({ ...options, date: new Date(`${input('date').value}T12:00:00Z`), timeZone: 'UTC' }); };
select('animation').onchange = () => { clearClip(); if (mounted) mounted.set(options, { duration: 0 }); updateAnimationChoices(); updateDetail(); };
input('reduce-motion').onchange = () => { if (input('reduce-motion').checked) { stop(); clip?.finish(); progress(1); } };
$('play').onclick = () => play(); $('reverse').onclick = () => play(true);
input('progress').oninput = () => { stop(); if (!clip) prepareClip(); const value = Number(input('progress').value); clip?.seek(value * duration); progress(value); };
$('reset').onclick = () => { input('size').value = '24'; input('weight').value = '400'; input('opsz').value = '24'; input('auto-optics').checked = true; $('optics-control').hidden = true; colorChanged = false; setTheme(document.documentElement.dataset.theme === 'dark'); apply({ ...options, size: 24, weight: 400, opsz: 'auto' }); };
$('copy').onclick = async () => { try { await navigator.clipboard.writeText(code()); $('copy-status').textContent = 'Скопировано'; } catch { const selection = getSelection(), range = document.createRange(); range.selectNodeContents($('import-code')); selection?.removeAllRanges(); selection?.addRange(range); $('copy-status').textContent = 'Нажмите Ctrl+C'; } };
$('download').onclick = () => void exportFile();
function syncModal() {
  const open = narrow.matches && document.body.classList.contains('detail-open');
  $('library').inert = open; document.querySelector<HTMLElement>('.topbar')!.inert = open;
  if (open) { $('inspector').setAttribute('role', 'dialog'); $('inspector').setAttribute('aria-modal', 'true'); }
  else { $('inspector').removeAttribute('role'); $('inspector').removeAttribute('aria-modal'); }
}
narrow.addEventListener('change', syncModal);
function closeDetail() {
  if (!document.body.classList.contains('detail-open')) return;
  document.body.classList.remove('detail-open'); syncModal();
  const opener = detailOpener?.isConnected && detailOpener.getClientRects().length ? detailOpener : input('search');
  opener.focus();
}
$('close-detail').onclick = closeDetail;
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && narrow.matches) closeDetail();
  if (event.key === 'Tab' && narrow.matches && document.body.classList.contains('detail-open')) {
    const focusable = [...$('inspector').querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled)')].filter(node => node.getClientRects().length && !node.closest('fieldset:disabled'));
    const first = focusable[0], last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }
  if (event.key === '/' && !/INPUT|SELECT|TEXTAREA/.test((event.target as HTMLElement).tagName) && !$('library').inert) { event.preventDefault(); input('search').focus(); }
});
function setTheme(dark: boolean) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('theme').setAttribute('aria-label', dark ? 'Светлая тема' : 'Тёмная тема');
  $('theme').title = dark ? 'Светлая тема' : 'Тёмная тема';
  if (!colorChanged) input('color').value = dark ? '#ffffff' : '#101012';
  updateDetail();
}
$('theme').onclick = () => setTheme(document.documentElement.dataset.theme !== 'dark');
window.addEventListener('pagehide', () => { clearClip(); mounted?.dispose(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); });
const query = new URLSearchParams(location.search);
variant = query.get('variant') === 'filled' ? 'filled' : 'outline';
for (const button of document.querySelectorAll('[data-variant]')) button.setAttribute('aria-pressed', String((button as HTMLElement).dataset.variant === variant));
input('date').value = new Date().toISOString().slice(0, 10); input('reduce-motion').checked = preference.matches;
$('corpus-count').textContent = `${entries.length} символов. Два начертания. Оптика и движение.`;
$('version').textContent = `v${version}`;
for (const host of document.querySelectorAll<HTMLElement>('[data-icon]')) {
  const image = document.createElement('img'); image.src = `icons/${host.dataset.icon}-outline.svg`; image.alt = ''; image.width = image.height = 18; host.append(image);
}
setTheme(matchMedia('(prefers-color-scheme: dark)').matches); renderGrid();
const linkedIcon = query.get('icon');
void choose(byId.has(linkedIcon ?? '') ? linkedIcon! : 'time', query.get('family') ?? undefined, !!linkedIcon && byId.has(linkedIcon));
