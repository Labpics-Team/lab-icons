import { describe, expect, it } from 'vitest';
import { authoredVariationCapability, authoredVariationPresentation, renderVariationComparison } from '../observatory/variation-preview.js';

const source = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M1 1H3V3H1Z"/></svg>';
const modified = '<svg viewBox="0 0 24 24" width="24" height="24"><path fill="currentColor" d="M2 1H4V3H2Z"/></svg>';

describe('Observatory читает variation capability пакета', () => {
  it('ширина корпуса открывается по закону и поддержанному target', () => {
    const variation = { version: 1, law: 'capsule.width', defaults: { bodyWidth: 1 }, targets: { svg: 'supported' } };
    expect(authoredVariationCapability({ icon: 'future-capsule', variation })).toBe(variation);
    const presentation = authoredVariationPresentation(variation);
    expect(presentation.controls).toEqual([['bodyWidth', 'Ширина корпуса']]);
    expect(presentation.summary({ bodyWidth: .85 })).toContain('×0.85');
    expect(presentation.hint).toContain('Высота, подставка и обрамление сохраняются');
    expect(authoredVariationCapability({ variation: { ...variation, targets: { svg: 'not-exported' } } })).toBeNull();
  });
  it('показывает только известный SVG-контракт без списка имён', () => {
    const variation = { version: 1, law: 'dots.affine', targets: { svg: 'supported' } };
    expect(authoredVariationCapability({ icon: 'future-family', variation })).toBe(variation);
    for (const capabilities of [null, {}, { variation: { ...variation, version: 2 } },
      { variation: { ...variation, law: 'unknown' } }, { variation: { ...variation, targets: { svg: 'not-exported' } } }]) {
      expect(authoredVariationCapability(capabilities)).toBeNull();
    }
  });
  it('обрамление имеет собственный смысл и не получает controls многоточия', () => {
    const variation = { version: 1, law: 'annulus.counter-scale', defaults: { enclosureEmphasis: 1 }, targets: { svg: 'supported' } };
    expect(authoredVariationCapability({ variation })).toBe(variation);
    const presentation = authoredVariationPresentation(variation);
    expect(presentation.controls).toEqual([['enclosureEmphasis', 'Толщина обрамления']]);
    expect(presentation.summary({ enclosureEmphasis: 1.2 })).toContain('×1.2');
    expect(presentation.summary({ enclosureEmphasis: 1.2 })).not.toContain('undefined');
    expect(presentation.hint).toContain('Наружный контур и знак сохраняются');
    expect(authoredVariationCapability({ variation: { ...variation, targets: { svg: 'not-exported' } } })).toBeNull();
  });
});

describe('сравнение готовых SVG', () => {
  it('сохраняет source и modified как полные неизменённые viewport', () => {
    const svg = renderVariationComparison(source, modified, [0, 0, 24, 24], 'overlay', 'example');
    expect(svg).toContain(`data-comparison="source">${source}</g>`);
    expect(svg).toContain(`data-comparison="modified">${modified}</g>`);
    expect(svg.match(/<svg\b/g)).toHaveLength(3);
  });

  it('вычитает противоположный силуэт с явной luminance-семантикой', () => {
    const svg = renderVariationComparison(source, modified, [0, 0, 24, 24], 'difference', 'example');
    const masks = [...svg.matchAll(/<mask id="([^"]+)"([^>]+)>(.*?)<\/mask>/g)];
    expect(masks).toHaveLength(2);
    for (const mask of masks) {
      expect(mask[2]).toContain('mask-type="luminance"');
      expect(mask[2]).toContain('maskUnits="userSpaceOnUse"');
      expect(mask[3]).toContain('fill="#fff"');
      expect(mask[3]).toContain('color="#000"');
    }
    expect(masks[0][3]).toContain(modified);
    expect(masks[1][3]).toContain(source);
    expect(svg).toContain(`mask="url(#${masks[0][1]})">${source}`);
    expect(svg).toContain(`mask="url(#${masks[1][1]})">${modified}`);
  });

  it('два сравнения не связывают ресурсы друг друга', () => {
    const svg = ['first', 'second'].map(id => renderVariationComparison(source, modified, [0, 0, 24, 24], 'difference', id)).join('');
    const ids = [...svg.matchAll(/\bid="([^"]+)"/g)].map(match => match[1]);
    expect(ids).toHaveLength(4);
    expect(new Set(ids).size).toBe(ids.length);
    for (const match of svg.matchAll(/url\(#([^)]*)\)/g)) expect(ids).toContain(match[1]);
  });

  it('сохраняет положение смещённого авторского viewport', () => {
    const svg = renderVariationComparison(source, modified, [4, 5, 24, 24], 'difference', 'offset');
    expect(svg.match(/transform="translate\(4 5\)"/g)).toHaveLength(4);
    expect(svg).toContain('x="4" y="5" width="24" height="24"');
  });

  it('не принимает произвольный XML identifier или повреждённый viewport', () => {
    for (const [viewBox, view, id] of [[[0, 0, 24, 24], 'original', 'example'],
      [[0, 0, 24, 24], 'overlay', 'bad" id="bad'], [[0, 0, Infinity, 24], 'overlay', 'example'],
      [[0, 0, 0, 24], 'difference', 'example']]) {
      expect(() => renderVariationComparison(source, modified, viewBox, view, id)).toThrow(TypeError);
    }
  });
});
