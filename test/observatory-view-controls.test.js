import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(new URL('../observatory/explorer.js', import.meta.url), 'utf8');
const functionSource = source.match(/^function updateViewControls\(\) \{[\s\S]*?^\}/m)?.[0];
const views = ['original', 'generated', 'overlay', 'difference'];
const svg = '<svg viewBox="0 0 24 24"><path data-part="body" d="M2 2H22V22H2Z"/></svg>';

function element(tagName, view, content) {
  const attributes = new Map();
  const listeners = new Map();
  let innerHTML = content;
  return {
    tagName,
    dataset: { view },
    attributes,
    listeners,
    get innerHTML() { return innerHTML; },
    get textContent() { return innerHTML; },
    // Как у DOM Element, запись текста заменяет дочерние SVG-узлы.
    set textContent(value) { innerHTML = String(value); },
    getAttribute(name) { return attributes.get(name) ?? null; },
    setAttribute(name, value) { attributes.set(name, value); },
    addEventListener(name, listener) { listeners.set(name, listener); },
  };
}

function fixture({ view = 'generated', loaded = true, variation = true, unavailable = [] } = {}) {
  const buttons = views.map(name => element('BUTTON', name, name === 'generated' ? 'Модель' : name));
  const stage = element('DIV', view, svg);
  const sample = element('FIGURE', view, svg);
  const nodes = [stage, ...buttons, sample];
  const document = {
    querySelectorAll(selector) {
      const match = selector.match(/^(\w+)?\[data-view\]$/);
      if (!match) throw new Error(`Неподдержанный selector test boundary: ${selector}`);
      return nodes.filter(node => !match[1] || node.tagName === match[1].toUpperCase());
    },
  };
  if (!functionSource) throw new Error('updateViewControls не найдена в реальном Observatory');
  const update = new Function('document', 'variationAvailable', 'viewAvailable', 'state',
    `${functionSource}\nreturn updateViewControls;`)(
    document, () => variation, name => !unavailable.includes(name), { view, loaded },
  );
  return { update, document, stage, sample, buttons };
}

describe('presentation data-view не делает SVG-поверхность кнопкой', () => {
  it.each(views)('обновление %s сохраняет SVG и семантику поверхностей', view => {
    const { update, stage, sample, buttons } = fixture({ view });
    update();
    for (const surface of [stage, sample]) {
      expect(surface.innerHTML).toBe(svg);
      expect(surface.attributes.has('aria-pressed')).toBe(false);
      expect(Object.hasOwn(surface, 'disabled')).toBe(false);
    }
    for (const button of buttons) {
      expect(button.attributes.get('aria-pressed')).toBe(String(button.dataset.view === view));
      expect(button.disabled).toBe(false);
    }
    expect(buttons.find(button => button.dataset.view === 'generated').textContent).toBe('Вариация');
  });

  it.each([true, false])('пока loaded=%s сохраняет доступность и название принятого режима', loaded => {
    const { update, stage, buttons } = fixture({ loaded, variation: false, unavailable: ['generated', 'difference'] });
    update();
    expect(stage.innerHTML).toBe(svg);
    for (const button of buttons) {
      expect(button.disabled).toBe(!loaded || ['generated', 'difference'].includes(button.dataset.view));
    }
    expect(buttons.find(button => button.dataset.view === 'generated').textContent).toBe('Модель');
  });

  it.each(['overlay', 'difference'])('journey проверяет выбор %s только у кнопок и замечает неверный aria-pressed', view => {
    const journey = readFileSync(new URL('../scripts/bench/explorer-journey.js', import.meta.url), 'utf8');
    const condition = journey.match(/\[\.\.\.document\.querySelectorAll\('[^']+'\)\]\.every\(button => button\.getAttribute\('aria-pressed'\) === String\(button\.dataset\.view === view\)\)/)?.[0];
    if (!condition) throw new Error('Проверка выбора вида в реальном journey не найдена');
    const selected = new Function('document', 'view', `return ${condition};`);
    const { update, document, stage, sample, buttons } = fixture({ view });
    update();
    expect(selected(document, view)).toBe(true);
    expect(stage.getAttribute('aria-pressed')).toBeNull();
    expect(sample.getAttribute('aria-pressed')).toBeNull();
    buttons.find(button => button.dataset.view === view).setAttribute('aria-pressed', 'false');
    expect(selected(document, view)).toBe(false);
  });

  it('только кнопки переключают вид, сохраняя progress по поддержке вариации', () => {
    const binding = source.split('\n').find(line => line.includes("addEventListener('click', () => renderView(button.dataset.view"));
    if (!binding) throw new Error('Привязка переключения вида не найдена в реальном Observatory');
    for (const variation of [true, false]) {
      const { document, stage, sample, buttons } = fixture({ variation });
      const changes = [];
      new Function('document', 'renderView', 'variationAvailable', binding)(
        document, (view, options) => changes.push({ view, options }), () => variation,
      );
      expect(stage.listeners.size).toBe(0);
      expect(sample.listeners.size).toBe(0);
      for (const button of buttons) {
        const click = button.listeners.get('click');
        expect(click).toBeTypeOf('function');
        click();
      }
      expect(changes).toEqual(views.map(view => ({ view, options: { preserveProgress: variation } })));
      expect(stage.innerHTML).toBe(svg);
      expect(sample.innerHTML).toBe(svg);
    }
  });
});
