/**
 * test/anatomy-gen-variant-activation.test.js — per-variant активация части
 * в composite: `params[variant] === null` исключает часть ИЗ ЭТОГО варианта.
 *
 * Мотив: структурная разница outline↔filled. Открытый лоток (download/upload/…)
 * = сплошной контейнер + вырез-полость ТОЛЬКО в outline (даёт ⊔-рамку), а в
 * filled контейнер остаётся сплошным (стрелка вычитается негативом evenodd).
 * Раньше формат допускал лишь per-variant params/mode/weight — не отсутствие
 * части. Гейт: null-часть невидима в своём варианте и не трогает другой.
 */
import { describe, expect, it } from 'vitest';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';

const grid = { canvas: { width: 24, height: 24 }, ratios: { cornerSmoothing: 0 } };

const container = {
  primitive: 'rounded-rect', mode: 'solid',
  params: {
    outline: { cx: 0.5, cy: 0.5, w: 0.6, h: 0.6, rOuter: 0.15 },
    filled: { cx: 0.5, cy: 0.5, w: 0.6, h: 0.6, rOuter: 0.15 },
  },
  name: 'container', role: 'ink',
};
const hollowOutlineOnly = {
  primitive: 'rounded-rect-cutout',
  params: {
    outline: { cx: 0.5, cy: 0.55, w: 0.4, h: 0.45, rOuter: 0.08 },
    filled: null, // ← исключить из filled
  },
  name: 'hollow', role: 'counter',
};

describe('composite: per-variant активация части (params[variant]===null)', () => {
  it('null-часть исключается ТОЛЬКО из своего варианта', () => {
    const withHollow = { archetype: 'composite', status: { outline: 'hand', filled: 'hand' }, parts: [container, hollowOutlineOnly] };
    const containerOnly = { archetype: 'composite', status: { outline: 'hand', filled: 'hand' }, parts: [container] };

    const bh = buildGlyph(withHollow, grid);
    const bc = buildGlyph(containerOnly, grid);

    // filled: hollow занулён → результат ИДЕНТИЧЕН «только контейнер»
    expect(bh.filled).toBe(bc.filled);
    // outline: hollow активен → результат ОТЛИЧАЕТСЯ (добавлен вырез) и длиннее
    expect(bh.outline).not.toBe(bc.outline);
    expect(bh.outline.length).toBeGreaterThan(bc.outline.length);
  });

  it('НЕ регресс: часть с обоими вариантами присутствует в обоих', () => {
    const both = { archetype: 'composite', status: { outline: 'hand', filled: 'hand' }, parts: [container, { ...hollowOutlineOnly, params: { outline: hollowOutlineOnly.params.outline, filled: hollowOutlineOnly.params.outline } }] };
    const b = buildGlyph(both, grid);
    const containerOnly = buildGlyph({ archetype: 'composite', status: { outline: 'hand', filled: 'hand' }, parts: [container] }, grid);
    // обе стороны длиннее «только контейнера» — часть рисуется всюду
    expect(b.outline.length).toBeGreaterThan(containerOnly.outline.length);
    expect(b.filled.length).toBeGreaterThan(containerOnly.filled.length);
  });

  it('НЕ регресс: обычная 2-вариантная часть без null не затронута', () => {
    const plain = { archetype: 'composite', status: { outline: 'hand', filled: 'hand' }, parts: [container] };
    const b = buildGlyph(plain, grid);
    expect(b.outline).toBeTruthy();
    expect(b.filled).toBeTruthy();
    expect(b.outline).toBe(b.filled); // симметричный контейнер
  });
});
