import { downloadFile } from './download.js';

const ui = Object.fromEntries(['form', 'name', 'spec', 'reset', 'build', 'stage', 'samples', 'size',
  'download', 'status', 'error', 'parts', 'digest'].map(name => [name, document.querySelector(`#authoring-${name}`)]));
const sizes = [16, 24, 48];
let runtime;
let starter;
let current = null;

function reveal(element) {
  const bounds = element.getBoundingClientRect();
  if (bounds.top < 0 || bounds.bottom > innerHeight) element.scrollIntoView({ block: 'start', behavior: 'instant' });
}

function revealPreview() {
  ui.stage.focus({ preventScroll: true });
  reveal(ui.stage);
}

function invalidate() {
  current = null;
  ui.download.disabled = true;
  for (const host of [ui.stage, ui.samples, ui.parts]) host.replaceChildren();
  ui.stage.setAttribute('aria-label', 'Предпросмотр кандидата');
  ui.digest.textContent = '';
  ui.error.hidden = true;
  ui.error.textContent = '';
  ui.spec.setAttribute('aria-invalid', 'false');
  ui.name.setAttribute('aria-invalid', 'false');
  ui.status.textContent = 'Есть изменения. Постройте превью.';
}

function showError(error) {
  invalidate();
  ui.error.hidden = false;
  ui.error.textContent = error instanceof runtime.DesignSpecError
    ? `${error.code}\n${error.at}\n${error.message}`
    : error instanceof SyntaxError ? `Ошибка JSON\n${error.message}` : `Превью не построено\n${error.message}`;
  const field = error instanceof runtime.DesignSpecError && error.at.startsWith('options.icon') ? ui.name : ui.spec;
  field.setAttribute('aria-invalid', 'true');
  ui.status.textContent = 'Исправьте ошибку и постройте превью.';
  field.focus({ preventScroll: true });
  reveal(ui.error);
}

function svgElement(glyph, instanceId) {
  const holder = document.createElement('div');
  // Вставляются только байты закрытого public renderer, а не пользовательская строка.
  holder.innerHTML = runtime.renderGlyphSvg(glyph, { instanceId });
  const svg = holder.querySelector('svg');
  svg.setAttribute('aria-hidden', 'true');
  return svg;
}

function present(spec, icon, prepared) {
  const glyphs = new Map(sizes.map(size => [size, size === 24 && prepared ? prepared : runtime.compileDesignSpec(spec, { icon, size })]));
  const exports = new Map(sizes.map(size => [size, runtime.renderGlyphSvg(glyphs.get(size), { instanceId: 'authoring-export' })]));
  const samples = document.createDocumentFragment();
  for (const size of sizes) {
    const sample = document.createElement('div');
    sample.className = 'size-sample';
    const label = document.createElement('span');
    label.textContent = `${size} px`;
    sample.append(svgElement(glyphs.get(size), `authoring-sample-${size}`), label);
    samples.append(sample);
  }
  const glyph = glyphs.get(24);
  ui.stage.replaceChildren(svgElement(glyph, 'authoring-stage'));
  ui.stage.setAttribute('aria-label', `Предпросмотр кандидата ${icon}`);
  ui.samples.replaceChildren(samples);
  ui.parts.replaceChildren(...glyph.parts.map(part => {
    const row = document.createElement('li');
    row.textContent = `${part.id}: ${part.role}`;
    return row;
  }));
  ui.digest.textContent = `DesignSpec SHA-256: ${glyph.provenance.specSha256}`;
  current = { icon, exports };
  ui.download.disabled = false;
  ui.status.textContent = 'Превью построено. Можно сохранить SVG.';
}

ui.spec.addEventListener('input', invalidate);
ui.name.addEventListener('input', invalidate);
ui.form.addEventListener('submit', event => {
  event.preventDefault();
  if (!runtime) return;
  invalidate();
  try { present(JSON.parse(ui.spec.value), ui.name.value); revealPreview(); }
  catch (error) { showError(error); }
});
ui.reset.addEventListener('click', () => {
  invalidate();
  ui.spec.value = JSON.stringify(starter.spec, null, 2);
  ui.name.value = starter.glyph.icon;
  try { present(starter.spec, starter.glyph.icon, starter.glyph); revealPreview(); }
  catch (error) { showError(error); }
});
ui.download.addEventListener('click', () => {
  if (!current) return;
  const size = Number(ui.size.value);
  downloadFile(current.exports.get(size), 'image/svg+xml', `${current.icon}-${size}.svg`);
  ui.status.textContent = `SVG ${size} px подготовлен.`;
});

try {
  [runtime, { starter }] = await Promise.all([import('./package/authoring/index.js'), import('./authoring-example.js')]);
  ui.spec.value = JSON.stringify(starter.spec, null, 2);
  ui.name.value = starter.glyph.icon;
  for (const control of [ui.spec, ui.name, ui.reset, ui.build]) control.disabled = false;
  present(starter.spec, starter.glyph.icon, starter.glyph);
} catch (error) {
  invalidate();
  ui.error.hidden = false;
  ui.error.textContent = `Не удалось загрузить авторский редактор\n${error.message}`;
  ui.status.textContent = 'Редактор недоступен. Обновите страницу.';
} finally {
  ui.form.setAttribute('aria-busy', 'false');
  ui.stage.setAttribute('aria-busy', 'false');
}
