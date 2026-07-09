/**
 * test/axis-corner.test.js — ось УГЛА (вариативность, парадигма Roboto Flex).
 * buildGlyph(entry, grid, {corner}) — множитель ζ (cornerSmoothing) на все
 * задекларированные скругления; вторая ось кастомизации после weight.
 * Классы: Б (голден-фикстура: без axes d-строки БИТ-В-БИТ прежние — фикстура
 * снята с генератора ДО введения оси), А (дефолт=идентичность; ось действует
 * на ζ-носителях; ζ-без-носителей инвариантны; кламп [0,1]), Д (мутант:
 * corner≠1 обязан отличаться на скруглении).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';

const grid = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'semantics', 'anatomy.json'), 'utf8'));
const baseline = JSON.parse(readFileSync(join(import.meta.dirname, 'fixtures', 'axes-baseline-d.json'), 'utf8'));
const G = (n) => anatomy.glyphs[n];

describe('ось угла — buildGlyph axes.corner', () => {
  it('Б: без axes d-строки БИТ-В-БИТ равны до-осевому базлайну (весь корпус)', () => {
    // фикстура снята с anatomy-gen.js ДО введения zTok (commit-база ветки):
    // обратная совместимость 100% — не «похоже», а побайтово
    const names = Object.keys(anatomy.glyphs);
    expect(names.length).toBe(Object.keys(baseline).length);
    for (const name of names) {
      const built = buildGlyph(G(name), grid, {}, anatomy.glyphs);
      expect(built.outline, `${name}/outline`).toBe(baseline[name].outline);
      expect(built.filled, `${name}/filled`).toBe(baseline[name].filled);
    }
  });

  it('А: дефолт ≡ corner:1 для ВСЕХ задекларированных (идентичность — гейты держат)', () => {
    for (const [name, g] of Object.entries(anatomy.glyphs)) {
      expect(JSON.stringify(buildGlyph(g, grid, {}, anatomy.glyphs)), name).toBe(
        JSON.stringify(buildGlyph(g, grid, { corner: 1 }, anatomy.glyphs)),
      );
    }
  });

  it('А: ось действует на ζ-носителях (rounded-rect / rounded-polygon)', () => {
    for (const n of ['tablet-portrait', 'square', 'play-circle']) {
      if (!G(n)) continue;
      const base = buildGlyph(G(n), grid).outline;
      const sharp = buildGlyph(G(n), grid, { corner: 0 }).outline;   // ζ=0: чистые дуги
      const half = buildGlyph(G(n), grid, { corner: 0.5 }).outline;
      expect(sharp + half, n).not.toMatch(/NaN|Infinity/);
      expect(sharp, n).not.toBe(base);  // ось меняет профиль угла
      expect(half, n).not.toBe(base);   // ось непрерывна (промежуточное ζ)
      expect(half, n).not.toBe(sharp);
    }
  });

  it('А: глиф без ζ-носителей (stroke-v) инвариантен оси corner', () => {
    const g = G('chevron-down');
    expect(JSON.stringify(buildGlyph(g, grid, { corner: 0 }))).toBe(JSON.stringify(buildGlyph(g, grid)));
  });

  it('А: кламп — corner<0 ≡ corner:0, corner-переполнение не рождает NaN', () => {
    const g = G('tablet-portrait');
    expect(JSON.stringify(buildGlyph(g, grid, { corner: -2 }))).toBe(JSON.stringify(buildGlyph(g, grid, { corner: 0 })));
    const over = buildGlyph(g, grid, { corner: 5 }).outline; // ζ→кламп 1
    expect(over).not.toMatch(/NaN|Infinity/);
    expect(JSON.stringify(buildGlyph(g, grid, { corner: 5 }))).toBe(
      JSON.stringify(buildGlyph(g, grid, { corner: 1 / grid.ratios.cornerSmoothing })), // оба = потолок ζ=1
    );
  });

  it('А: оси weight и corner независимы и комбинируются', () => {
    const g = G('tablet-portrait');
    const combo = buildGlyph(g, grid, { weight: 1.3, corner: 0 }).outline;
    expect(combo).not.toMatch(/NaN|Infinity/);
    expect(combo).not.toBe(buildGlyph(g, grid, { weight: 1.3 }).outline); // corner добавляет своё
    expect(combo).not.toBe(buildGlyph(g, grid, { corner: 0 }).outline);   // weight добавляет своё
  });

  it('Д: corner отсутствует ≡ corner:1 (?? дефолт не сдвигает)', () => {
    const a = buildGlyph(G('square'), grid, {});
    const b = buildGlyph(G('square'), grid, { corner: 1 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
