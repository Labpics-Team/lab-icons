import { describe, expect, it, vi } from 'vitest';
import { renderGlyphSvg } from '../src/ir/render.js';
import type { GlyphIR } from '../src/ir/compiler.js';

function glyph(svg: string): GlyphIR {
  return { icon: 'time', variant: 'filled', viewBox: [0, 0, 24, 24], parts: [], d: '', svg, composition: { kind: 'layers' }, provenance: { kind: 'source', file: 'fixture' } };
}

function renderWithoutParsing(original: GlyphIR, instanceId: string) {
  const matchAll = vi.spyOn(String.prototype, 'matchAll');
  const replace = vi.spyOn(String.prototype, 'replace');
  let svg = '';
  let scans = 0;
  try {
    svg = renderGlyphSvg(original, { instanceId });
    scans = matchAll.mock.calls.length + replace.mock.calls.length;
  } finally {
    matchAll.mockRestore();
    replace.mockRestore();
  }
  expect(scans).toBe(0);
  return svg;
}

function renderColdWork(original: GlyphIR, instanceId: string) {
  const replace = vi.spyOn(String.prototype, 'replace');
  const includes = vi.spyOn(String.prototype, 'includes');
  let svg = '';
  let maxIntermediate = 0;
  let sourceSearches = 0;
  try {
    svg = renderGlyphSvg(original, { instanceId });
    for (const result of replace.mock.results) {
      if (result.type === 'return' && typeof result.value === 'string') {
        maxIntermediate = Math.max(maxIntermediate, result.value.length);
      }
    }
    sourceSearches = includes.mock.contexts.filter(context => context === original.svg).length;
  } finally {
    replace.mockRestore();
    includes.mockRestore();
  }
  return { svg, maxIntermediate, sourceSearches };
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

  it('повторный mount frozen glyph собирает разные namespace без разбора SVG', () => {
    const original = Object.freeze(glyph('<svg><mask id="mask"/><path data-part="ink" mask="url(#mask)"/><use href="#mask"/></svg>'));
    renderGlyphSvg(original, { instanceId: 'cold' });
    expect(renderWithoutParsing(original, 'warm')).toBe('<svg><mask id="lab-symbol-warm-mask"/><path data-part="ink" mask="url(#lab-symbol-warm-mask)"/><use href="#lab-symbol-warm-mask"/></svg>');
    expect(renderWithoutParsing(original, 'other')).toBe('<svg><mask id="lab-symbol-other-mask"/><path data-part="ink" mask="url(#lab-symbol-other-mask)"/><use href="#lab-symbol-other-mask"/></svg>');
    expect(original.svg).toBe('<svg><mask id="mask"/><path data-part="ink" mask="url(#mask)"/><use href="#mask"/></svg>');
  });

  it('повторный SVG без ресурсов возвращается без разбора', () => {
    const original = glyph('<svg><path data-part="ink" d="M1 2"/></svg>');
    renderGlyphSvg(original, { instanceId: 'cold' });
    expect(renderWithoutParsing(original, 'warm')).toBe(original.svg);
  });

  it('сохраняет неизвестные ссылки, дубликаты и прежние границы атрибутов', () => {
    const original = glyph('<svg><mask id="mask"/><mask id="mask"/><path data-id="mask" mask="url(#unknown)"/><use href="#mask" xlink:href="#mask" data-href="#mask"/><use href="#unknown" xlink:href="#unknown"/><path id=\'single\' fill="url(#single)"/></svg>');
    const expected = '<svg><mask id="lab-symbol-warm-mask"/><mask id="lab-symbol-warm-mask"/><path data-id="mask" mask="url(#unknown)"/><use href="#lab-symbol-warm-mask" xlink:href="#lab-symbol-warm-mask" data-href="#lab-symbol-warm-mask"/><use href="#unknown" xlink:href="#unknown"/><path id=\'single\' fill="url(#single)"/></svg>';
    expect(renderGlyphSvg(original, { instanceId: 'warm' })).toBe(expected);
    expect(renderWithoutParsing(original, 'warm')).toBe(expected);
  });

  it('сохраняет последовательные url и href замены для legacy ID', () => {
    const original = glyph('<svg><mask id="x"/><mask id="url(#x)"/><mask id="url(#lab-symbol-stage-x)"/><use href="#url(#x)"/><use xlink:href="#url(#x)"/></svg>');
    const stage = '<svg><mask id="lab-symbol-stage-x"/><mask id="lab-symbol-stage-url(#lab-symbol-stage-x)"/><mask id="lab-symbol-stage-url(#lab-symbol-stage-x)"/><use href="#lab-symbol-stage-url(#lab-symbol-stage-x)"/><use xlink:href="#lab-symbol-stage-url(#lab-symbol-stage-x)"/></svg>';
    const other = '<svg><mask id="lab-symbol-other-x"/><mask id="lab-symbol-other-url(#lab-symbol-other-x)"/><mask id="lab-symbol-other-url(#lab-symbol-stage-x)"/><use href="#url(#lab-symbol-other-x)"/><use xlink:href="#url(#lab-symbol-other-x)"/></svg>';
    expect(renderGlyphSvg(original, { instanceId: 'stage' })).toBe(stage);
    expect(renderWithoutParsing(original, 'stage')).toBe(stage);
    expect(renderWithoutParsing(original, 'other')).toBe(other);
  });

  it('не принимает текст исходного SVG за служебную подстановку', () => {
    const original = glyph('<svg><desc>lab-symbol-template- lab-symbol-template--</desc><mask id="lab-symbol-template-mask"/><use href="#lab-symbol-template-mask"/></svg>');
    const expected = '<svg><desc>lab-symbol-template- lab-symbol-template--</desc><mask id="lab-symbol-warm-lab-symbol-template-mask"/><use href="#lab-symbol-warm-lab-symbol-template-mask"/></svg>';
    renderGlyphSvg(original, { instanceId: 'cold' });
    expect(renderWithoutParsing(original, 'warm')).toBe(expected);
  });

  it.each([
    ['длинные дефисы', `lab-symbol-template-${'-'.repeat(512)}`],
    ['плотные номера', Array.from({ length: 64 }, (_, index) => `lab-symbol-template-${index}-`).join(' ')],
  ])('marker не раздувает холодные строки и не запускает повторный поиск: %s', (_label, text) => {
    const names = Array.from({ length: 64 }, (_, index) => `r${index}`);
    const source = `<svg><desc>${text}</desc>${names.map(name => `<mask id="${name}"/>`).join('')}</svg>`;
    const instanceId = 's'.repeat(64);
    const expected = `<svg><desc>${text}</desc>${names.map(name => `<mask id="lab-symbol-${instanceId}-${name}"/>`).join('')}</svg>`;
    const original = glyph(source);
    const work = renderColdWork(original, instanceId);
    expect(work.svg).toBe(expected);
    // Даже самый длинный допустимый namespace ограничивает промежуточный объём.
    expect.soft(work.maxIntermediate).toBeLessThanOrEqual(expected.length);
    expect.soft(work.sourceSearches).toBeLessThanOrEqual(1);
    expect(renderWithoutParsing(original, instanceId)).toBe(expected);
  });

  it('сохраняет исходные числовые markers, пропуски и совпадающий mounted namespace', () => {
    const original = glyph('<svg><desc>lab-symbol-template-0- lab-symbol-template-1- lab-symbol-template-3- lab-symbol-template-00- lab-symbol-template-02- lab-symbol-template-9007199254740993-</desc><mask id="mask"/><use href="#mask" xlink:href="#unknown"/></svg>');
    const expected = '<svg><desc>lab-symbol-template-0- lab-symbol-template-1- lab-symbol-template-3- lab-symbol-template-00- lab-symbol-template-02- lab-symbol-template-9007199254740993-</desc><mask id="lab-symbol-template-2-mask"/><use href="#lab-symbol-template-2-mask" xlink:href="#unknown"/></svg>';
    expect(renderGlyphSvg(original, { instanceId: 'template-2' })).toBe(expected);
    expect(renderWithoutParsing(original, 'template-2')).toBe(expected);
  });

  it('пересоздаёт подготовку после изменения svg обычного JS объекта', () => {
    const original = glyph('<svg><mask id="old"/><use href="#old"/></svg>') as { -readonly [Key in keyof GlyphIR]: GlyphIR[Key] };
    renderGlyphSvg(original, { instanceId: 'cold' });
    original.svg = '<svg><clipPath id="new"/><path clip-path="url(#new)"/><use href="#old"/></svg>';
    const expected = '<svg><clipPath id="lab-symbol-fresh-new"/><path clip-path="url(#lab-symbol-fresh-new)"/><use href="#old"/></svg>';
    expect(renderGlyphSvg(original, { instanceId: 'fresh' })).toBe(expected);
    expect(renderWithoutParsing(original, 'fresh')).toBe(expected);
    original.svg = '<svg><path d="M1 2"/></svg>';
    expect(renderGlyphSvg(original, { instanceId: 'plain' })).toBe(original.svg);
    expect(renderWithoutParsing(original, 'plain')).toBe(original.svg);
    original.svg = '<svg><mask id="again"/><use href="#again"/></svg>';
    expect(renderGlyphSvg(original, { instanceId: 'final' })).toBe('<svg><mask id="lab-symbol-final-again"/><use href="#lab-symbol-final-again"/></svg>');
    expect(renderWithoutParsing(original, 'final')).toBe('<svg><mask id="lab-symbol-final-again"/><use href="#lab-symbol-final-again"/></svg>');
  });

  it('проверяет instanceId до использования прогретой подготовки', () => {
    const original = glyph('<svg/>');
    renderGlyphSvg(original, { instanceId: 'cold' });
    expect(() => renderGlyphSvg(original, undefined!)).toThrow(TypeError);
    expect(() => renderGlyphSvg(original, null!)).toThrow(TypeError);
    expect(() => renderGlyphSvg(original, { instanceId: 4 as unknown as string })).toThrow(TypeError);
    expect(() => renderGlyphSvg(original, { instanceId: 'unsafe space' })).toThrow(TypeError);
  });

  it.each(['', '4starts-with-number', 'has space', 'quote"', 'url(#x)', 'x'.repeat(65)])('не допускает невалидный instanceId %j', instanceId => {
    expect(() => renderGlyphSvg(glyph('<svg/>'), { instanceId })).toThrow(TypeError);
  });
});
