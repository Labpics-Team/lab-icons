import { describe, expect, it, vi } from 'vitest';
import * as curveSampling from '../scripts/lib/curve-sampling.js';
import * as pathData from '../src/core/path-data.js';
import { renderedPathEntries } from '../src/core/icon-geometry.js';
import {
  rasterizePathEntries,
  topologyAcrossPhases,
  topologyOfSvg,
  topologyOfMask,
  significantTopology,
} from '../scripts/lib/ink-raster.js';

const svg = (body, width = 24, height = 24) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">${body}</svg>`;

const topology = (content, options = {}) =>
  topologyOfSvg(content, { width: 24, height: 24, step: 0.25, ...options });

describe('path-aware ink raster', () => {
  it('computes mask-subtract as union(base) minus union(subtractors), independent of entry order', () => {
    const base = { d: 'M2 2H22V22H2Z', fillRule: 'nonzero', operation: 'union' };
    const subtractA = { d: 'M5 5H14V14H5Z', fillRule: 'nonzero', operation: 'subtract' };
    const subtractB = { d: 'M10 10H19V19H10Z', fillRule: 'nonzero', operation: 'subtract' };
    const options = { width: 24, height: 24, step: 0.25, phaseX: 0.5, phaseY: 0.5 };

    const expected = rasterizePathEntries([base, subtractA, subtractB], options);
    const permutations = [
      [subtractA, base, subtractB],
      [subtractA, subtractB, base],
      [subtractB, base, subtractA],
    ];

    expect(expected.mask.reduce((sum, cell) => sum + cell, 0) * options.step ** 2)
      .toBeCloseTo(254, 8);
    for (const entries of permutations) {
      expect(Array.from(rasterizePathEntries(entries, options).mask)).toEqual(
        Array.from(expected.mask),
      );
    }

    const phases = topologyAcrossPhases([base, subtractA, subtractB], {
      width: 24,
      height: 24,
      step: 0.25,
    });
    expect(phases.stable).toBe(true);
    expect(new Set(phases.signatures)).toEqual(new Set(['1:1']));
  });

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

  it('соблюдает локальную cascade: style важнее атрибута, последний !important побеждает', () => {
    const content = svg(
      `<path fill-rule='evenodd' ` +
        `style='fill-rule: evenodd !important; fill-rule: nonzero; fill-rule: nonzero !important' ` +
        `d='M2 2H18V18H2Z M6 6H14V14H6Z'/>`,
    );
    const entries = renderedPathEntries(content);

    expect(entries[0].fillRule).toBe('nonzero');
    expect(topology(content).holes).toHaveLength(0);
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
      svg(
        "<path d='m2 2 4 0 0 4z'/>" +
          "<path d='m10 2 4 0 0 4z'/>" +
          "<path d='m+18 +2 +4 0 0 +4z'/>",
      ),
    );

    expect(entries.map((entry) => entry.d)).toEqual([
      'M2 2l4 0 0 4z',
      'M10 2l4 0 0 4z',
      'M+18 +2l+4 0 0 +4z',
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

  it('готовит каждый путь один раз для четырёх фаз и заново в следующем отчёте', () => {
    const entries = [
      { d: 'M2 2C2 0 14 0 14 2V14H2Z', fillRule: 'evenodd' },
      { d: 'M5 5H11V11H5Z M6 6H10V10H6Z', fillRule: 'nonzero', operation: 'subtract' },
      { d: 'M14.2 2H18V14H14.2Z', fillRule: 'nonzero' },
    ];
    const phases = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
    const options = { width: 20, height: 16, step: 0.5, stepsPerSeg: 32 };
    let sampler;
    let parser;
    try {
      // Наблюдаем настоящие выборку и парсер; обе функции сохраняют вычисления.
      sampler = vi.spyOn(curveSampling, 'samplePolylines');
      parser = vi.spyOn(pathData, 'parsePathData');
      const preparedOnce = (stepsPerSeg) => {
        expect(sampler.mock.calls).toHaveLength(entries.length);
        expect(sampler.mock.calls).toEqual(expect.arrayContaining(
          entries.map(({ d }) => [d, stepsPerSeg]),
        ));
        expect(parser.mock.calls).toHaveLength(entries.length);
        expect(parser.mock.calls).toEqual(expect.arrayContaining(entries.map(({ d }) => [d])));
      };
      const clearCalls = () => {
        sampler.mockClear();
        parser.mockClear();
      };

      // Один исходный растр доказывает, что наблюдатели действительно подключены.
      rasterizePathEntries(entries, { ...options, phaseX: 0.25, phaseY: 0.25 });
      preparedOnce(32);
      clearCalls();

      const first = topologyAcrossPhases(entries, { ...options, phases });
      preparedOnce(32);
      expect(first.samples.map(({ phase }) => phase)).toEqual(phases);
      clearCalls();

      entries[0].d = 'M2 2C2 1 12 1 12 2V14H2Z';
      entries.push({ d: 'M16 4H19V12H16Z', fillRule: 'nonzero' });
      const after = topologyAcrossPhases(entries, { ...options, phases });
      preparedOnce(32);
      expect(after.samples.map(({ phase }) => phase)).toEqual(phases);
      clearCalls();

      const denser = topologyAcrossPhases(entries, { ...options, phases, stepsPerSeg: 64 });
      preparedOnce(64);
      expect(denser.samples.map(({ phase }) => phase)).toEqual(phases);
      clearCalls();

      expect(topologyAcrossPhases([], { phases: [], step: -1 })).toEqual({
        stable: true,
        signatures: [],
        samples: [],
      });
      expect(sampler.mock.calls).toHaveLength(0);
      expect(parser.mock.calls).toHaveLength(0);
    } finally {
      parser?.mockRestore();
      sampler?.mockRestore();
    }
  });

  it('сохраняет отдельные фазовые растры для кривых, правил заливки и вычитания', () => {
    const entries = [
      { d: 'M2 2C2 0 14 0 14 2V14H2Z', fillRule: 'evenodd' },
      { d: 'M5 5H11V11H5Z M6 6H10V10H6Z', fillRule: 'nonzero', operation: 'subtract' },
      { d: 'M14.2 2H18V14H14.2Z', fillRule: 'nonzero' },
    ];
    const phases = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
    const options = { width: 20, height: 16, step: 0.5, stepsPerSeg: 32 };
    const minFeatureArea = 0.5;
    const expected = phases.map(([phaseX, phaseY]) => {
      const result = topologyOfMask(rasterizePathEntries(entries, { ...options, phaseX, phaseY }));
      return {
        phase: [phaseX, phaseY],
        topology: result,
        significant: significantTopology(result, minFeatureArea),
      };
    });
    const actual = topologyAcrossPhases(entries, { ...options, phases, minFeatureArea });

    expect(actual.samples).toEqual(expected);
    expect(actual.signatures).toEqual(expected.map(({ significant }) =>
      `${significant.components}:${significant.holes}`));
  });

  it('видит правки между отчётами и сохраняет поведение пустого списка фаз', () => {
    const entries = [{ d: 'M2 2H8V8H2Z' }];
    const options = { width: 16, height: 10, step: 0.5 };
    const before = topologyAcrossPhases(entries, options);
    entries.push({ d: 'M10 2H14V8H10Z' });
    const after = topologyAcrossPhases(entries, options);

    expect(new Set(before.signatures)).toEqual(new Set(['1:0']));
    expect(new Set(after.signatures)).toEqual(new Set(['2:0']));
    expect(topologyAcrossPhases([], { phases: [], step: -1 })).toEqual({
      stable: true,
      signatures: [],
      samples: [],
    });
  });

});

describe('площади топологии совпадают с эталоном по меткам клеток', () => {
  it('сохраняет компоненты и отверстия для всех бинарных масок 4×4', async () => {
    const { labelMaskFeatures, topologyOfMask } = await import('../scripts/lib/ink-raster.js');
    for (let bits = 0; bits < 65536; bits++) {
      const mask = Uint8Array.from({ length: 16 }, (_, i) => (bits >>> i) & 1);
      const negative = mask.map(cell => cell ? 0 : 1);
      const components = labelMaskFeatures(mask, 4, 4, { eightConnected: true })
        .features.map(feature => feature.cells * 0.25).sort((a, b) => b - a);
      const holes = labelMaskFeatures(negative, 4, 4, { eightConnected: false })
        .features.filter(feature => !feature.touchesFrame)
        .map(feature => feature.cells * 0.25).sort((a, b) => b - a);
      expect(topologyOfMask({ mask, cols: 4, rows: 4, step: 0.5 }), `mask ${bits}`)
        .toEqual({ components, holes });
    }
  }, 30000);
});


describe('изменение геометрии внутри прежнего массива', () => {
  it.each([
    { field: 'd', index: 0, value: 'M1 1H6V7H1Z', components: [30, 4], holes: [] },
    { field: 'fillRule', index: 0, value: 'evenodd', components: [32, 4], holes: [4] },
    { field: 'operation', index: 1, value: 'subtract', components: [36], holes: [] },
  ])('пересчитывает $field без изменения длины и плотности', ({ field, index, value, components, holes }) => {
    const entries = [
      { d: 'M1 1H7V7H1Z M3 3H5V5H3Z', fillRule: 'nonzero', operation: 'union' },
      { d: 'M8 1H10V3H8Z', fillRule: 'nonzero', operation: 'union' },
    ];
    const phases = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
    const options = { width: 12, height: 8, step: 0.5, stepsPerSeg: 24, phases };
    // Целочисленные прямоугольники имеют точные площади во всех выбранных фазах.
    // Ожидания заданы геометрией, без вызова парсера, растеризатора или классификатора.
    const report = (areas, gaps) => ({
      stable: true,
      signatures: phases.map(() => `:`),
      samples: phases.map(phase => ({
        phase,
        topology: { components: areas, holes: gaps },
        significant: { components: areas.length, holes: gaps.length },
      })),
    });
    const before = topologyAcrossPhases(entries, options);
    expect(before).toEqual(report([36, 4], []));

    entries[index][field] = value;
    expect(entries).toHaveLength(2);
    const after = topologyAcrossPhases(entries, options);
    expect(after).toEqual(report(components, holes));
    expect(after.samples).not.toEqual(before.samples);
  });
});
