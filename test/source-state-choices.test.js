import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';

describe('доступный смысл выбора авторского состояния', () => {
  it.each([
    ['source-replacement', 'Состояние символа'],
    ['enclosure-replacement', 'Знак в общей оболочке'],
    ['contour-interpolation', 'Ориентация многоточия'],
  ])('%s сохраняет свой label', (transition, label) => {
    const source = readFileSync(new URL('../observatory/explorer.js', import.meta.url), 'utf8');
    const start = source.indexOf('function replacementChoices()');
    const end = source.indexOf('\nfunction progress()', start);
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const choices = { dataset: {}, replaceChildren: vi.fn(), setAttribute: vi.fn() };
    const group = { capabilities: { transition, states: [] } };
    const choose = new Function('state', 'ui', 'sourceGroup', 'contourGroup',
      `${source.slice(start, end)}\nreplacementChoices();`);
    choose({ replacement: group, legacy: false }, { 'state-choices': choices },
      group => group.capabilities.transition === 'source-replacement',
      group => group.capabilities.transition === 'contour-interpolation');
    expect(choices.dataset.transition).toBe(transition);
    expect(choices.setAttribute.mock.calls.at(-1)).toEqual(['aria-label', label]);
  });
});
