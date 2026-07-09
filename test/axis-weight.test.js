/**
 * test/axis-weight.test.js — ось ВЕСА (вариативность, север владельца).
 * buildGlyph(entry, grid, {weight}) — глобальный множитель штриховых
 * токенов: одна правка restyle-ит весь задекларированный корпус.
 * Классы: А (дефолт=идентичность — гейты держат), А (ось меняет штрих,
 * без NaN, монотонно), Д (мутант: ось≠1 обязана отличаться на штрихе).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { inkIoU } from '../scripts/check-anatomy-drift.js';

const grid = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'semantics', 'anatomy.json'), 'utf8'));
const G = (n) => anatomy.glyphs[n];

describe('ось веса — buildGlyph axes.weight', () => {
  it('А: дефолт ≡ weight:1 для ВСЕХ задекларированных (идентичность — гейты держат)', () => {
    for (const [name, g] of Object.entries(anatomy.glyphs)) {
      expect(JSON.stringify(buildGlyph(g, grid)), name).toBe(JSON.stringify(buildGlyph(g, grid, { weight: 1 })));
    }
  });

  it('А: штриховой глиф (chevron-down) — вес×1.35 толще, ×0.7 тоньше, оба валидны', () => {
    const base = buildGlyph(G('chevron-down'), grid).outline;
    const bold = buildGlyph(G('chevron-down'), grid, { weight: 1.35 }).outline;
    const thin = buildGlyph(G('chevron-down'), grid, { weight: 0.7 }).outline;
    expect(bold + thin).not.toMatch(/NaN|Infinity/);
    expect(inkIoU(base, bold, 24)).toBeLessThan(0.95); // заметно отличается
    expect(inkIoU(base, thin, 24)).toBeLessThan(0.95);
    // разные настройки дают разные формы (ось непрерывна)
    expect(inkIoU(bold, thin, 24)).toBeLessThan(0.9);
  });

  it('А: ось действует по всему штриховому корпусу (reload, container-glyph)', () => {
    for (const n of ['reload', 'chevron-down-circle']) {
      if (!G(n)) continue;
      const base = buildGlyph(G(n), grid);
      const bold = buildGlyph(G(n), grid, { weight: 1.3 });
      const vb = bold.outline || bold.filled;
      expect(vb, n).not.toMatch(/NaN|Infinity/);
      expect(inkIoU(base.outline || base.filled, vb, 24), n).toBeLessThan(0.98);
    }
  });

  it('Д: weight отсутствует ≡ weight:1 (?? дефолт не сдвигает)', () => {
    const a = buildGlyph(G('apps'), grid, {});
    const b = buildGlyph(G('apps'), grid, { weight: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
