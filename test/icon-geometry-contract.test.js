import { describe, expect, it } from 'vitest';
import {
  authorPathEntries,
  iconGeometry,
  renderedPathEntries,
  sourcePathEntries,
} from '../src/core/icon-geometry.js';
import { topologyOfSvg } from '../scripts/lib/ink-raster.js';

const svg = (attrs, body) => `<svg ${attrs}>${body}</svg>`;

describe('icon-geometry SVG contract', () => {
  it('не принимает data-fill-rule за presentation attribute', () => {
    const content = svg(
      `viewBox='0 0 24 24'`,
      `<path data-fill-rule='evenodd' d='M2 2H18V18H2Z M6 6H14V14H6Z'/>`,
    );

    expect(renderedPathEntries(content)[0].fillRule).toBe('nonzero');
    expect(topologyOfSvg(content, { width: 24, height: 24, step: 0.25 }).holes).toHaveLength(0);
  });

  it('читает comma-separated viewBox с signed/exponent числами и игнорирует data-viewBox', () => {
    const content = svg(
      `data-viewBox='9 9 9 9' viewBox='+0,+0,24e0,24'`,
      `<path d='M2 2H18V18H2Z'/>`,
    );

    expect(iconGeometry(content).viewBox).toEqual({ x: 0, y: 0, width: 24, height: 24 });
  });

  it('fail-closed на CSS-wide fill-rule, который требует внешней cascade', () => {
    const content = svg(
      `viewBox='0 0 24 24'`,
      `<path style='fill-rule: inherit' d='M2 2H18V18H2Z'/>`,
    );

    expect(() => renderedPathEntries(content)).toThrow(/inherited fill-rule/);
  });

  it('source contract запрещает nested SVG viewport при неизменном path-data', () => {
    const d = 'M0 0H24V24H0Z';
    const content = svg(
      `viewBox='0 0 24 24'`,
      `<svg viewBox='0 0 48 48' width='24' height='24'><path d='${d}'/></svg>`,
    );

    expect(content.match(new RegExp(d, 'g'))).toHaveLength(1);
    expect(() => sourcePathEntries(content)).toThrow(/ровно один корневой <svg>/);
  });
  it.each([['source', sourcePathEntries], ['author', authorPathEntries]])('%s сохраняет raw attribute grammar и duplicate guard', (_lane, read) => {
    const content = svg(
      'xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 24 24"',
      '<path fill="currentColor" d="M2 2H18V18H2Z"/>',
    );
    expect(read(content)).toEqual(read(content.replaceAll('"', "'")));
    for (const changed of [
      content.replace('<path ', '<path fill="#000" '),
      content.replace('fill="currentColor" d=', 'fill="currentColor" fill="#000" d='),
      content.replace('<svg ', '<svg fill="#000" '),
      content.replace('fill="currentColor" viewBox=', 'fill="currentColor" fill="#000" viewBox='),
      content.replace('d="M2 2H18V18H2Z"', 'd="M0 0Z" d="M2 2H18V18H2Z"'),
      content.replace('d="M2 2H18V18H2Z"', 'd="M2 2H18V18H2Z" d="M0 0Z"'),
    ]) expect(() => read(changed)).toThrow(/повторён атрибут/);
    expect(() => read(content.replace('" d=', '"d='))).toThrow(/невалидные атрибуты/);
  });
});
