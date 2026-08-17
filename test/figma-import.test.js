import { describe, expect, it } from 'vitest';
import {
  canonicalIconName,
  normalizeFigmaSvg,
} from '../scripts/lib/figma-import.js';

const simpleFigmaSvg = ({ rootFill = 'none', pathFill = '#101012', body } = {}) =>
  `<svg width="24" height="24" viewBox="0 0 24 24" fill="${rootFill}" xmlns="http://www.w3.org/2000/svg">` +
  (body ?? `<path d="M2 2H22V22H2Z" fill="${pathFill}"/>`) +
  '</svg>';

describe('Figma intake — каноническая граница source SVG', () => {
  it('сохраняет корневой svg, удаляя только нейтральную paint-семантику Figma', () => {
    const normalized = normalizeFigmaSvg(simpleFigmaSvg(), { source: 'square.svg' });

    expect(normalized).toBe(
      '<svg width="24" height="24" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg">' +
      '<path d="M2 2H22V22H2Z"/></svg>\n',
    );
  });

  it('lower-ит только доказанный viewport identity clip и сохраняет rendered path', () => {
    const clipped = simpleFigmaSvg({
      body:
        '<g clip-path="url(#frame)"><path d="M4 4H20V20H4Z" fill="#101012"/></g>' +
        '<defs><clipPath id="frame"><rect width="24" height="24" fill="white"/></clipPath></defs>',
    });

    expect(normalizeFigmaSvg(clipped, { source: 'clipped.svg' })).toContain(
      '<path d="M4 4H20V20H4Z"/>',
    );
  });

  it('fail-closed отвергает мусор до root и цвет, меняющий смысл иконки', () => {
    expect(() => normalizeFigmaSvg(`\\n${simpleFigmaSvg()}`, { source: 'broken.svg' }))
      .toThrow(/ровно один корневой <svg>/);
    expect(() => normalizeFigmaSvg(simpleFigmaSvg({ pathFill: '#ff0000' }), { source: 'red.svg' }))
      .toThrow(/вне монохромного контракта/);
  });

  it('fail-closed rejects duplicate root paint and inline CSS paint', () => {
    expect(() => normalizeFigmaSvg(
      simpleFigmaSvg().replace('fill="none"', 'fill="none" fill="currentColor"'),
      { source: 'duplicate-root-fill.svg' },
    )).toThrow(/повторяет root fill/);
    expect(() => normalizeFigmaSvg(
      simpleFigmaSvg({ body: '<path d="M2 2H22V22H2Z" style="fill:#ff0000"/>' }),
      { source: 'inline-style-fill.svg' },
    )).toThrow(/style.*fill|paint/i);
  });

  it.each([
    ['pull request', 'pull-request'],
    ['  Musical   Notes  ', 'musical-notes'],
    ['MCP', 'mcp'],
  ])('нормализует имя %j в канонический ID %j', (input, expected) => {
    expect(canonicalIconName(input)).toBe(expected);
  });

  it.each(['../escape', 'two--dashes', 'name.svg', '', 'тег'])('не допускает неканонический ID %j', (input) => {
    expect(() => canonicalIconName(input)).toThrow(/канонический icon id/);
  });
});
