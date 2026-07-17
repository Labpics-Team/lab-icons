import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph, buildGlyphParts, topologySignature } from '../scripts/lib/anatomy-gen.js';

const root = join(import.meta.dirname, '..');
const anatomy = JSON.parse(readFileSync(join(root, 'semantics/anatomy.json'), 'utf8'));
const grid = JSON.parse(readFileSync(join(root, 'semantics/grid.json'), 'utf8'));

describe('явные anatomy parts', () => {
  it('каждый моделируемый вариант собирается из частей byte-identical', () => {
    for (const [name, entry] of Object.entries(anatomy.glyphs)) {
      const glyph = buildGlyph(entry, grid, {}, anatomy.glyphs);
      const parts = buildGlyphParts(entry, grid, {}, anatomy.glyphs);
      for (const variant of ['outline', 'filled']) {
        if (!glyph[variant]) continue;
        expect(parts[variant]?.map((part) => part.d).join(''), `${name}/${variant}`).toBe(glyph[variant]);
        expect(new Set(parts[variant].map((part) => part.id)).size, `${name}/${variant}`).toBe(parts[variant].length);
      }
    }
  });

  it('reload сохраняет отдельные orbit и terminal для смыслового вращения', () => {
    const parts = buildGlyphParts(anatomy.glyphs.reload, grid, {}, anatomy.glyphs);
    expect(parts.filled.map((part) => [part.id, part.role])).toEqual([
      ['orbit', 'ink'],
      ['terminal', 'control'],
    ]);
  });

  it('container-glyph не склеивает рамку с внутренним знаком', () => {
    const parts = buildGlyphParts(anatomy.glyphs['chevron-down-circle'], grid, {}, anatomy.glyphs);
    expect(parts.outline.map((part) => part.id)).toEqual(['container', 'mark']);
    expect(parts.filled.map((part) => part.id)).toEqual(['container', 'mark']);
  });

  it('топология различает несовместимое число сегментов и субпутей', () => {
    expect(topologySignature('M0 0L1 0Z')).toBe('MLZ');
    expect(topologySignature('M0 0L1 0ZM2 2C2 3 3 3 3 2Z')).toBe('MLZ|MCZ');
    expect(topologySignature('M0 0L1 0Z')).not.toBe(topologySignature('M0 0Q.5 1 1 0Z'));
  });

  it('не меняет command topology частей на непрерывной оси corner', () => {
    const samples = [0, 1e-7, 1e-5, 0.1, 1, 1 / grid.ratios.cornerSmoothing];
    for (const [name, entry] of Object.entries(anatomy.glyphs)) {
      const variants = samples.map((corner) => (
        buildGlyphParts(entry, grid, { corner }, anatomy.glyphs)
      ));
      for (const variant of ['outline', 'filled']) {
        const signatures = variants
          .map((parts) => parts[variant])
          .filter(Boolean)
          .map((parts) => parts.map(({ id, topologySignature }) => `${id}:${topologySignature}`));
        if (signatures.length === 0) continue;
        expect(new Set(signatures.map(JSON.stringify)).size, `${name}/${variant}`).toBe(1);
      }
    }
  });

  it('fail-closed отвергает безымянную и дублированную identity', () => {
    const base = {
      archetype: 'composite',
      status: { outline: 'hand' },
      parts: [{ primitive: 'circle-dot', role: 'ink', params: { cx: 0.5, cy: 0.5, r: 0.1 } }],
    };
    expect(() => buildGlyphParts(base, grid)).toThrow(/явный непустой id/);
    const repeated = {
      ...base,
      parts: [
        { ...base.parts[0], id: 'dot' },
        { ...base.parts[0], id: 'dot', params: { cx: 0.7, cy: 0.5, r: 0.1 } },
      ],
    };
    expect(() => buildGlyphParts(repeated, grid)).toThrow(/повторный part\.id/);
  });
});
