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
  it.each([
    'style="fill-rule:evenodd id=\'x\'"',
    'd="M2 2H22V22H2Z id=\'x\' M7 7H17V17H7Z"',
    'style="fill-rule:evenodd fill=\'#101012\'"',
  ])('не переписывает текст внутри значения атрибута %s', (attribute) => {
    const body = attribute.startsWith('d=')
      ? `<path ${attribute} fill="#101012"/>`
      : `<path d="M2 2H22V22H2ZM7 7H17V17H7Z" ${attribute}${attribute.includes(' fill=') ? '' : ' fill="#101012"'}/>`;
    expect(() => normalizeFigmaSvg(simpleFigmaSvg({ body, rootFill: '#101012' }))).toThrow();
  });

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

  it('сохраняет d, порядок и локальные fill-rule при удалении именованных экспортных групп', () => {
    const first = 'M11.9922 5.15234C12.4892 5.15244 12.8926 5.55574 12.8926 6.05273Z';
    const second = 'M12 1.5C17.7989 1.5 22.4998 6.20118 22.5 12Z';
    const exported = simpleFigmaSvg({ body:
      `<g id="time" data-node-id="6431:3963"><g id="Vector" data-node-id="6432:261">` +
      `<path id="hand" data-node-id="6432:262" d="${first}" fill="#101012"/>` +
      `<path d="${second}" fill-rule="evenodd" clip-rule="evenodd" fill="#101012"/>` +
      '</g></g>',
    });
    const normalized = normalizeFigmaSvg(exported, { source: 'time.svg' });
    expect(normalized).toBe(simpleFigmaSvg({ body:
      `<path d="${first}"/><path d="${second}" fill-rule="evenodd" clip-rule="evenodd"/>`,
    }).replace(' fill="none"', '') + '\n');
  });

  it.each([
    'transform="translate(1 0)"',
    'opacity="0.5"',
    'fill="#101012"',
    'fill-rule="evenodd"',
    'style="fill-rule:evenodd"',
    'clip-path="url(#unknown)"',
    'mask="url(#cut)"',
    'filter="url(#blur)"',
  ])('отвергает экспортную группу с влияющим на изображение %s', (attribute) => {
    const exported = simpleFigmaSvg({ body:
      `<g id="time" ${attribute}><path d="M2 2H22V22H2Z" fill="#101012"/></g>`,
    });
    expect(() => normalizeFigmaSvg(exported, { source: 'unsafe.svg' })).toThrow();
  });

  it.each([
    '<g id="time"><path d="M2 2H22V22H2Z" fill="#101012"/>',
    '<path d="M2 2H22V22H2Z" fill="#101012"/></g>',
    '<g id="time" id="again"><path d="M2 2H22V22H2Z" fill="#101012"/></g>',
    '<path id="time" id="again" d="M2 2H22V22H2Z" fill="#101012"/>',
  ])('отвергает повреждённую нейтральную обвязку', (body) => {
    expect(() => normalizeFigmaSvg(simpleFigmaSvg({ body }), { source: 'malformed.svg' })).toThrow();
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
