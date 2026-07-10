import { describe, expect, it } from 'vitest';
import { iconGeometry, renderedPathEntries } from '../scripts/lib/icon-geometry.js';
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
});
