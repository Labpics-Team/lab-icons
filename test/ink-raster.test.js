import { describe, expect, it } from 'vitest';
import { renderedPathEntries } from '../scripts/lib/icon-geometry.js';
import {
  topologyAcrossPhases,
  topologyOfSvg,
} from '../scripts/lib/ink-raster.js';

const svg = (body, width = 24, height = 24) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>`;

const topology = (content, options = {}) =>
  topologyOfSvg(content, { width: 24, height: 24, step: 0.25, ...options });

describe('path-aware ink raster', () => {
  it('объединяет перекрывающиеся самостоятельные path, не вырезая overlap по evenodd', () => {
    const content = svg(
      '<path d="M2 2H12V12H2Z"/><path d="M8 2H18V12H8Z"/>',
    );
    const result = topology(content);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toBeCloseTo(160, 8);
    expect(result.holes).toHaveLength(0);
  });

  it('сохраняет counter внутри одного compound path с own evenodd', () => {
    const content = svg(
      '<path fill-rule="evenodd" d="M2 2H18V18H2Z M6 6H14V14H6Z"/>',
    );
    const result = topology(content);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toBeCloseTo(192, 8);
    expect(result.holes).toHaveLength(1);
    expect(result.holes[0]).toBeCloseTo(64, 8);
  });

  it('не выдумывает counter под nonzero у одинаково намотанных контуров', () => {
    const content = svg(
      '<path d="M2 2H18V18H2Z M6 6H14V14H6Z"/>',
    );
    const result = topology(content);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toBeCloseTo(256, 8);
    expect(result.holes).toHaveLength(0);
  });

  it('сохраняет counter под nonzero при противоположной намотке', () => {
    const content = svg(
      '<path d="M2 2H18V18H2Z M6 6V14H14V6Z"/>',
    );
    const result = topology(content);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toBeCloseTo(192, 8);
    expect(result.holes).toHaveLength(1);
    expect(result.holes[0]).toBeCloseTo(64, 8);
  });

  it('композитит отдельный path поверх counter другого path', () => {
    const content = svg(
      '<path fill-rule="evenodd" d="M2 2H18V18H2Z M6 6H14V14H6Z"/>' +
        '<path d="M6 6H14V14H6Z"/>',
    );
    const result = topology(content);

    expect(result.components).toHaveLength(1);
    expect(result.components[0]).toBeCloseTo(256, 8);
    expect(result.holes).toHaveLength(0);
  });

  it('игнорирует defs, читает single quotes и inline fill-rule', () => {
    const content =
      `<svg viewBox='0 0 24 24'>` +
      `<defs><path d='M0 0H24V24H0Z'/></defs>` +
      `<path style='fill-rule: evenodd' d='M2 2H18V18H2Z M6 6H14V14H6Z'/>` +
      `</svg>`;
    const entries = renderedPathEntries(content);

    expect(entries).toHaveLength(1);
    expect(entries[0].fillRule).toBe('evenodd');
    expect(topology(content).holes).toHaveLength(1);
  });

  it('отказывает на inherited fill-rule вместо приблизительной XML-cascade', () => {
    const content =
      `<svg viewBox='0 0 24 24'>` +
      `<g fill-rule='evenodd'><path d='M2 2H18V18H2Z M6 6H14V14H6Z'/></g>` +
      `</svg>`;

    expect(() => renderedPathEntries(content)).toThrow(/наследуемый fill-rule/);
  });

  it('нормализует первый относительный moveto без связи с предыдущим path', () => {
    const entries = renderedPathEntries(
      svg("<path d='m2 2 4 0 0 4z'/><path d='m10 2 4 0 0 4z'/>") ,
    );

    expect(entries.map((entry) => entry.d)).toEqual([
      'M2 2l4 0 0 4z',
      'M10 2l4 0 0 4z',
    ]);
  });

  it('стабилен по четырём фазам для законного негативного канала', () => {
    const content = svg(
      '<path d="M2 2H8V8H2Z"/><path d="M8.8 2H14.8V8H8.8Z"/>',
      16,
      10,
    );
    const report = topologyAcrossPhases(renderedPathEntries(content), {
      width: 16,
      height: 10,
      step: 0.5,
    });

    expect(report.stable).toBe(true);
    expect(new Set(report.signatures)).toEqual(new Set(['2:0']));
  });

  it('красит фазовую зависимость субпиксельного зазора вместо случайного PASS', () => {
    const content = svg(
      '<path d="M2 2H8V8H2Z"/><path d="M8.2 2H14.2V8H8.2Z"/>',
      16,
      10,
    );
    const report = topologyAcrossPhases(renderedPathEntries(content), {
      width: 16,
      height: 10,
      step: 0.5,
    });

    expect(report.stable).toBe(false);
    expect(new Set(report.signatures)).toEqual(new Set(['1:0', '2:0']));
  });
});
