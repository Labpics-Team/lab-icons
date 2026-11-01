import { describe, expect, it } from 'vitest';
import { renderGlyphSvg } from '../src/ir/render.js';
import type { GlyphIR } from '../src/ir/index.js';

function glyph(svg: string): GlyphIR {
  return { icon: 'time', variant: 'filled', viewBox: [0, 0, 24, 24], parts: [], d: '', svg, composition: { kind: 'layers' }, provenance: { kind: 'source', file: 'fixture' } };
}

describe('изолированные SVG ресурсы mounted instance', () => {
  it('два одинаковых mask получают разные id и сохранившиеся data-part', () => {
    const original = glyph('<svg><defs><mask id="mask-123"><path data-part="hour-hand" data-id="author-tag" d="M1 2"/></mask></defs><path mask="url(#mask-123)" d="M3 4"/><use href="#mask-123"/></svg>');
    const first = renderGlyphSvg(original, { instanceId: 'stage' });
    const second = renderGlyphSvg(original, { instanceId: 'sample16' });
    expect(first).toContain('id="lab-symbol-stage-mask-123"');
    expect(first).toContain('mask="url(#lab-symbol-stage-mask-123)"');
    expect(first).toContain('href="#lab-symbol-stage-mask-123"');
    expect(second).toContain('url(#lab-symbol-sample16-mask-123)');
    expect(first).toContain('data-part="hour-hand" data-id="author-tag" d="M1 2"');
    expect(first).not.toContain('sample16');
    expect(original.svg).toContain('id="mask-123"');
  });

  it('обычный source SVG возвращается byte-identical', () => {
    const original = glyph('<svg><path d="M1 2L3 4"/></svg>');
    expect(renderGlyphSvg(original, { instanceId: 'source' })).toBe(original.svg);
  });

  it.each(['', '4starts-with-number', 'has space', 'quote"', 'url(#x)', 'x'.repeat(65)])('не допускает невалидный instanceId %j', instanceId => {
    expect(() => renderGlyphSvg(glyph('<svg/>'), { instanceId })).toThrow(TypeError);
  });
});
