import { describe, expect, it } from 'vitest';
import { compareSilhouettes } from '../scripts/lib/quality-metrics.js';

const path = (d) => ({ d, fillRule: 'evenodd' });
const solidSquare = path('M0 0H10V10H0Z');

describe('Quality Observatory topology oracle', () => {
  it('не отбрасывает arc-counter с точной площадью выше публичного floor', () => {
    const area = 0.01002;
    const radius = Math.sqrt(area / Math.PI);
    const centerX = 5.09;
    const centerY = 5.09;
    const circle = [
      `M${centerX - radius} ${centerY}`,
      `A${radius} ${radius} 0 1 0 ${centerX + radius} ${centerY}`,
      `A${radius} ${radius} 0 1 0 ${centerX - radius} ${centerY}Z`,
    ].join('');
    const candidate = path(`${solidSquare.d} ${circle}`);
    const metrics = compareSilhouettes([solidSquare], [candidate], { canvas: 24 });

    // 24-segment polygon недооценивает площадь этой точной окружности ниже
    // 0.01. Решение significant обязано опираться на exact/conservative vector
    // bound, иначе реальный counter выше floor получает ложный RESOLVED/PASS.
    expect(Math.PI * radius * radius).toBeGreaterThan(0.01);
    expect(metrics.topology.resolution.vectorGuide.candidate).toMatchObject({
      subpaths: 2,
      significantSubpaths: 2,
      ignoredBelowResolutionSubpaths: 0,
      areaClassificationUncertainSubpaths: 1,
    });
    expect(metrics.topology).toMatchObject({
      mismatch: false,
      difference: false,
      uncertain: true,
      confidence: { status: 'UNCERTAIN' },
    });
    expect(metrics.topology.confidence.reasons).toContain(
      'CURVE_SUBPATH_AREA_FLOOR_UNRESOLVED',
    );
  });

  it('держит area-floor включительным и отбрасывает только доказанно меньший L-контур', () => {
    const rectangle = (width, height) => path(
      `${solidSquare.d} M5 5h${width}v${height}h-${width}Z`,
    );
    const below = compareSilhouettes([solidSquare], [rectangle(0.099, 0.1)], { canvas: 24 });
    const atFloor = compareSilhouettes([solidSquare], [rectangle(0.1, 0.1)], { canvas: 24 });

    expect(below.topology.resolution.vectorGuide.candidate).toMatchObject({
      significantSubpaths: 1,
      ignoredBelowResolutionSubpaths: 1,
    });
    expect(atFloor.topology.resolution.vectorGuide.candidate).toMatchObject({
      significantSubpaths: 2,
      ignoredBelowResolutionSubpaths: 0,
    });
  });

  it('для Q/C отбрасывает только exact-bbox ниже floor, а пограничное незнание сохраняет', () => {
    const cases = [
      {
        kind: 'Q',
        below: 'M5 5Q5.099 5.198 5.099 5L5 5Z',
        possibleAtFloor: 'M5 5Q5.1 5.2 5.1 5L5 5Z',
      },
      {
        kind: 'C',
        // Закрытый cubic с endpoint=start раньше терялся из exactBoundary;
        // source command class обязан остаться нелинейным независимо от этого.
        below: 'M5 5C5 5.12 5.2 5.12 5 5Z',
        possibleAtFloor: 'M5 5C5 5.14 5.225 5.14 5 5Z',
      },
    ];

    for (const sample of cases) {
      const below = compareSilhouettes(
        [solidSquare],
        [path(`${solidSquare.d} ${sample.below}`)],
        { canvas: 24 },
      );
      const possible = compareSilhouettes(
        [solidSquare],
        [path(`${solidSquare.d} ${sample.possibleAtFloor}`)],
        { canvas: 24 },
      );

      expect(below.topology.resolution.vectorGuide.candidate, sample.kind).toMatchObject({
        significantSubpaths: 1,
        ignoredBelowResolutionSubpaths: 1,
        areaClassificationUncertainSubpaths: 0,
      });
      expect(possible.topology.resolution.vectorGuide.candidate, sample.kind).toMatchObject({
        significantSubpaths: 2,
        ignoredBelowResolutionSubpaths: 0,
        areaClassificationUncertainSubpaths: 1,
      });
      expect(possible.topology, sample.kind).toMatchObject({
        mismatch: false,
        difference: false,
        uncertain: true,
      });
      expect(possible.topology.confidence.reasons, sample.kind).toContain(
        'CURVE_SUBPATH_AREA_FLOOR_UNRESOLVED',
      );
    }
  });

  it('ловит 0.1-unit counter, невидимый во всех целевых binary-occupancy raster', () => {
    const withThinCounter = path('M0 0H10V10H0Z M5 5H5.1V5.1H5Z');
    const metrics = compareSilhouettes([solidSquare], [withThinCounter], { canvas: 24 });

    // Bite: прежний single-phase analysisStep=0.12 и все target sizes видели
    // ноль различий, хотя в векторе появился настоящий counter.
    expect(metrics.silhouette.symmetricDifferenceCells).toBe(0);
    expect(metrics.raster.map(({ differingPixels }) => differingPixels)).toEqual([0, 0, 0, 0, 0]);

    expect(metrics.topology).toMatchObject({
      original: { components: 1, holes: 0 },
      candidate: { components: 1, holes: 1 },
      mismatch: true,
      difference: true,
      uncertain: false,
      confidence: { status: 'RESOLVED', reasons: [] },
      resolution: {
        limitedByGridBudget: false,
        pixelsPerFeature: 4,
        minimumFeatureSpan: 0.1,
      },
    });
    expect(metrics.topology.resolution.step).toBeLessThanOrEqual(0.025001);
    expect(metrics.topology.resolution.phases).toHaveLength(4);
    expect(metrics.method.targetRaster).toContain('no alpha coverage');
  });

  it('ловит counter минимальной площади внутри одного self-intersecting subpath', () => {
    const withInternalLoop = path(
      'M0 4.98V0H10V10H0V4.98H5.011H5.061V5.18H5.011V4.98H0Z',
    );
    const metrics = compareSilhouettes([solidSquare], [withInternalLoop], { canvas: 24 });

    // Bite: whole-subpath span равен 10, а отдельные-subpath clearances здесь
    // отсутствуют. Только traversal cycle раскрывает counter 0.05 x 0.20.
    expect(metrics.silhouette.symmetricDifferenceCells).toBe(0);
    expect(metrics.raster.map(({ differingPixels }) => differingPixels)).toEqual([0, 0, 0, 0, 0]);
    expect(metrics.topology).toMatchObject({
      original: { components: 1, holes: 0 },
      candidate: { components: 1, holes: 1 },
      mismatch: false,
      difference: false,
      uncertain: true,
      confidence: {
        status: 'UNCERTAIN',
        reasons: ['GRID_BUDGET_CANNOT_RESOLVE_VECTOR_FEATURE'],
      },
      resolution: {
        minimumFeatureSpan: 0.05,
        vectorGuide: {
          candidate: {
            minimumInternalCycleSpan: 0.05,
          },
        },
      },
    });
    expect(metrics.topology.resolution.requestedStep).toBeLessThanOrEqual(0.012501);
    expect(metrics.topology.resolution.step).toBe(0.025);
  });

  it('не считает signed-area-zero bow-tie пустым subpath', () => {
    const original = [{ d: 'M0 0H2V2H0Z', fillRule: 'nonzero' }];
    const candidate = [{
      d: 'M0 0H2V2H0Z M10 10L11 10.04L10 10.04L11 10Z',
      fillRule: 'nonzero',
    }];
    const metrics = compareSilhouettes(original, candidate, { canvas: 24 });

    // Algebraic signed area cancels to zero, but the two lobes contain ≈0.02
    // ink above the declared 0.01 floor. Target rasters miss the extra component;
    // the vector guide must retain it and fail closed on the grid budget.
    expect(metrics.raster.map(({ topology }) => topology.mismatch)).toEqual([
      false, false, false, false, false,
    ]);
    expect(metrics.topology).toMatchObject({
      mismatch: false,
      difference: false,
      uncertain: true,
      confidence: {
        reasons: expect.arrayContaining(['GRID_BUDGET_CANNOT_RESOLVE_VECTOR_FEATURE']),
      },
      resolution: {
        limitedByGridBudget: true,
        vectorGuide: {
          candidate: {
            subpaths: 2,
            significantSubpaths: 2,
            degenerateSubpaths: 0,
            algebraicCancellationSubpaths: 1,
            internalCycles: 1,
          },
        },
      },
    });
    expect(metrics.topology.resolution.requestedStep).toBeLessThanOrEqual(0.005001);
  });

  it('fail-closed на non-adjacent endpoint-on-segment внутри subpath', () => {
    const original = [{
      d: 'M0 0H20V16H0V8H5V4H0Z M20 0H24V16H20Z',
      fillRule: 'nonzero',
    }];
    const candidate = [{
      d: 'M0 0H20V16H0V8H15V7.96H10V8H5V4H0Z M20 0H24V16H20Z',
      fillRule: 'nonzero',
    }];
    const metrics = compareSilhouettes(original, candidate, { canvas: 24 });

    // Fine 0.02/0.01 grids see a 0.2-area hole. Default phases miss it, but
    // endpoint-on-interior is not a simple traversal cycle and cannot inherit
    // PASS from the otherwise exact seam between the two subpaths.
    expect(metrics.topology).toMatchObject({
      mismatch: false,
      difference: false,
      uncertain: true,
      confidence: {
        reasons: expect.arrayContaining(['INTERNAL_SUBPATH_ARRANGEMENT_UNRESOLVED']),
      },
      resolution: {
        vectorGuide: {
          candidate: {
            internalArrangementUnresolvedSubpaths: 1,
            arrangement: {
              exactSharedBoundaryPairs: 0,
              exactCollinearSeamPairs: 0,
            },
          },
        },
      },
    });
  });

  it('не объявляет доказанной топологию тонкого counter между пересекающимися subpaths', () => {
    const entry = (d) => ({ d, fillRule: 'nonzero' });
    const shared = [
      entry('M26.99851322604152 7.930949639289776L8.00148677395848 8.449050360710224L7.9976707714744375 8.309130269628678L26.994697223557477 7.791029548208229Z'),
      entry('M15.99851322604152 8.449050360710224L-2.9985132260415206 7.930949639289776L-2.9946972235574782 7.791029548208229L16.002329228525564 8.309130269628678Z'),
    ];
    const original = [
      entry('M-3 8.04L27 8.04L27 8.200972117806463L-3 8.200972117806463Z'),
      ...shared,
    ];
    const candidate = [
      entry('M-3 8.04L27 8.04L27 8.179972117806463L-3 8.179972117806463Z'),
      ...shared,
    ];
    const metrics = compareSilhouettes(original, candidate, { canvas: 24 });

    // Три большие полосы образуют между собой counter площадью ≈0.01467 —
    // выше публичного floor 0.01. Целевые растры его не видят, а guide по
    // bbox отдельных subpath не имеет права превращать это незнание в RESOLVED.
    expect(metrics.raster.map(({ differingPixels }) => differingPixels)).toEqual([0, 0, 0, 0, 0]);
    expect(metrics.topology).toMatchObject({
      mismatch: false,
      difference: false,
      uncertain: true,
      confidence: {
        status: 'UNCERTAIN',
        reasons: expect.arrayContaining(['INTER_SUBPATH_CYCLES_UNRESOLVED']),
      },
      resolution: {
        minimumFeatureArea: 0.01,
        vectorGuide: {
          original: {
            intersectingSubpathPairs: 3,
            arrangement: {
              edges: 3,
              simpleGraphCycle: true,
              multigraphCycle: true,
            },
          },
          candidate: {
            intersectingSubpathPairs: 3,
            arrangement: {
              edges: 3,
              simpleGraphCycle: true,
              multigraphCycle: true,
            },
          },
        },
      },
    });
  });

  it('разрешает только монотонный forest weld: same-winding nonzero и compositor OR', () => {
    const vertical = 'M2 0H4V6H2Z';
    const horizontal = 'M0 2H6V4H0Z';
    const sameEntry = [{ d: `${vertical} ${horizontal}`, fillRule: 'nonzero' }];
    const compositor = [
      { d: vertical, fillRule: 'nonzero' },
      { d: horizontal, fillRule: 'evenodd' },
    ];

    const sameEntryMetrics = compareSilhouettes(sameEntry, sameEntry, { canvas: 24 });
    const compositorMetrics = compareSilhouettes(compositor, compositor, { canvas: 24 });
    expect(sameEntryMetrics.topology).toMatchObject({ uncertain: false, mismatch: false });
    expect(sameEntryMetrics.topology.resolution.vectorGuide.original.arrangement).toMatchObject({
      edges: 1,
      sameWindingNonzeroPairs: 1,
      simpleGraphCycle: false,
      multigraphCycle: false,
    });
    expect(compositorMetrics.topology).toMatchObject({ uncertain: false, mismatch: false });
    expect(compositorMetrics.topology.resolution.vectorGuide.original.arrangement).toMatchObject({
      edges: 1,
      compositorOrPairs: 1,
      simpleGraphCycle: false,
      multigraphCycle: false,
    });
  });

  it('различает same-entry seam, compositor butt и цикл из трёх seams', () => {
    const left = 'M0 0H2V2H0Z';
    const right = 'M2 0H4V2H2Z';
    const sameEntrySeam = [{ d: `${left} ${right}`, fillRule: 'nonzero' }];
    const arcEndpointSeam = [{
      d: [
        'M7.14 15.07a1.2 1.2 0 0 1-1.7-1.7Z',
        'M7.14 15.07L6.29 14.22L5.44 13.37L8 12Z',
      ].join(' '),
      fillRule: 'nonzero',
    }];
    const compositorButt = [
      { d: left, fillRule: 'nonzero' },
      { d: right, fillRule: 'nonzero' },
    ];
    const threeSeamCycle = [{
      d: [
        'M2 2L0 0L4 0Z',
        'M2 2L4 0L2 4Z',
        'M2 2L2 4L0 0Z',
      ].join(' '),
      fillRule: 'nonzero',
    }];

    const seam = compareSilhouettes(sameEntrySeam, sameEntrySeam, { canvas: 24 });
    expect(seam.topology).toMatchObject({ uncertain: false, mismatch: false });
    expect(seam.topology.resolution.vectorGuide.original.arrangement).toMatchObject({
      edges: 1,
      collinearSeamComponents: 1,
      exactCollinearSeamPairs: 1,
      tangentContactPairs: 0,
      simpleGraphCycle: false,
      multigraphCycle: false,
    });

    // Historical chevron: source L/Z остаются независимым exact proof общей
    // 1D seam и не зависят от плотности curve sampling.
    const arcSeam = compareSilhouettes(arcEndpointSeam, arcEndpointSeam, { canvas: 24 });
    expect(arcSeam.topology).toMatchObject({ uncertain: false, mismatch: false });
    expect(arcSeam.topology.resolution.vectorGuide.original.arrangement).toMatchObject({
      collinearSeamComponents: 1,
      exactCollinearSeamPairs: 1,
      tangentContactPairs: 0,
    });

    const butt = compareSilhouettes(compositorButt, compositorButt, { canvas: 24 });
    expect(butt.topology.confidence.reasons).toContain('INTER_SUBPATH_CONTACT_UNRESOLVED');
    expect(butt.topology.resolution.vectorGuide.original.arrangement).toMatchObject({
      compositorOrPairs: 1,
      collinearSeamComponents: 1,
      exactCollinearSeamPairs: 0,
      tangentContactPairs: 1,
    });

    const cycle = compareSilhouettes(threeSeamCycle, threeSeamCycle, { canvas: 24 });
    expect(cycle.topology.confidence.reasons).toContain('INTER_SUBPATH_CYCLES_UNRESOLVED');
    expect(cycle.topology.resolution.vectorGuide.original.arrangement).toMatchObject({
      edges: 3,
      collinearSeamComponents: 3,
      exactCollinearSeamPairs: 3,
      tangentContactPairs: 0,
      simpleGraphCycle: true,
      multigraphCycle: true,
    });
  });

  it('доказывает exact reversed Q и partial A seam без sampled-collision эвристики', () => {
    const quadratic = [{
      d: 'M2 0Q3 2 2 4L0 4V0Z M2 4Q3 2 2 0H4V4Z',
      fillRule: 'nonzero',
    }];
    const lineAndArc = [{
      d: [
        'M11.17 5.87A1 1 0 0 1 13.17 5.87L13.17 11.87A1 1 0 0 1 11.17 11.87Z',
        'M13.17 10.87L16.29 10.87A1 1 0 0 1 16.29 12.87L12.17 12.87A1 1 0 0 0 13.17 11.87Z',
      ].join(' '),
      fillRule: 'nonzero',
    }];

    const quadraticMetrics = compareSilhouettes(quadratic, quadratic, { canvas: 24 });
    expect(quadraticMetrics.topology).toMatchObject({ uncertain: false, mismatch: false });
    expect(quadraticMetrics.topology.resolution.vectorGuide.original.arrangement).toMatchObject({
      exactSharedBoundaryComponents: 1,
      exactSharedBoundaryPairs: 1,
      exactCollinearSeamPairs: 0,
      offSeamContactPoints: 0,
    });

    const arcMetrics = compareSilhouettes(lineAndArc, lineAndArc, { canvas: 24 });
    expect(arcMetrics.topology).toMatchObject({ uncertain: false, mismatch: false });
    expect(arcMetrics.topology.resolution.vectorGuide.original.arrangement).toMatchObject({
      collinearSeamComponents: 1,
      exactSharedBoundaryComponents: 1,
      exactSharedBoundaryPairs: 1,
      exactCollinearSeamPairs: 1,
      offSeamContactPoints: 0,
    });
  });

  it('не принимает seam и отдельный endpoint contact за одно forest-ребро', () => {
    const original = [{ d: 'M0 0H24V16H0Z', fillRule: 'nonzero' }];
    const candidate = [{
      d: 'M0 0H20V8.02L0 8.06Z M20 0H24V16H0V8.06H20Z',
      fillRule: 'nonzero',
    }];
    const metrics = compareSilhouettes(original, candidate, { canvas: 24 });

    // Default phases miss the 0.04-high triangular counter (area 0.4), but
    // the exact seam and the separate endpoint are two interaction components.
    expect(metrics.topology).toMatchObject({
      mismatch: false,
      difference: false,
      uncertain: true,
      confidence: {
        reasons: expect.arrayContaining([
          'INTER_SUBPATH_CYCLES_UNRESOLVED',
          'INTER_SUBPATH_CONTACT_UNRESOLVED',
          'INTER_SUBPATH_ARRANGEMENT_COMPLEX',
        ]),
      },
      resolution: {
        vectorGuide: {
          candidate: {
            arrangement: {
              edges: 1,
              collinearSeamComponents: 1,
              exactCollinearSeamPairs: 0,
              offSeamContactPoints: 1,
              disconnectedInteractionPairs: 1,
              possibleMultiComponentPairs: 1,
              multigraphCycle: true,
            },
          },
        },
      },
    });
  });

  it('fail-closed на non-monotone fill и endpoint-only contact без area weld', () => {
    const vertical = 'M2 0H4V6H2Z';
    const horizontal = 'M0 2H6V4H0Z';
    const evenodd = [{ d: `${vertical} ${horizontal}`, fillRule: 'evenodd' }];
    const opposite = [{
      d: `${vertical} M0 2V4H6V2Z`,
      fillRule: 'nonzero',
    }];
    const endpointOnly = [
      { d: 'M0 0H2V2H0Z', fillRule: 'nonzero' },
      { d: 'M2 2H4V4H2Z', fillRule: 'nonzero' },
    ];

    for (const entries of [evenodd, opposite]) {
      const metrics = compareSilhouettes(entries, entries, { canvas: 24 });
      expect(metrics.topology.confidence.reasons).toContain('INTER_SUBPATH_NON_MONOTONE');
      expect(metrics.topology.resolution.vectorGuide.original.arrangement.nonMonotonePairs).toBe(1);
    }
    const contact = compareSilhouettes(endpointOnly, endpointOnly, { canvas: 24 });
    expect(contact.topology.confidence.reasons).toContain('INTER_SUBPATH_CONTACT_UNRESOLVED');
    expect(contact.topology.resolution.vectorGuide.original.arrangement).toMatchObject({
      tangentContactPairs: 1,
      positiveAreaWeldPairs: 0,
    });
  });

  it('считает non-convex pair возможным multiedge, а исчерпание pair budget — незнанием', () => {
    const possibleDisconnected = [
      { d: 'M0 0H4V1H1V4H0Z', fillRule: 'nonzero' },
      { d: 'M.5 2H3V3H.5Z', fillRule: 'nonzero' },
    ];
    const complex = compareSilhouettes(possibleDisconnected, possibleDisconnected, { canvas: 24 });
    expect(complex.topology.confidence.reasons).toEqual(expect.arrayContaining([
      'INTER_SUBPATH_CYCLES_UNRESOLVED',
      'INTER_SUBPATH_ARRANGEMENT_COMPLEX',
    ]));
    expect(complex.topology.resolution.vectorGuide.original.arrangement).toMatchObject({
      possibleMultiComponentPairs: 1,
      complexInteractionPairs: 1,
      multigraphCycle: true,
    });

    const budget = compareSilhouettes(possibleDisconnected, possibleDisconnected, {
      canvas: 24,
      topologyMaxSegmentPairs: 1,
    });
    expect(budget.topology.confidence.reasons).toContain('VECTOR_SEGMENT_PAIR_BUDGET_EXCEEDED');
  });

  it('закрывается в UNCERTAIN, если grid budget не разрешает векторную деталь', () => {
    // Площадь counter (3) выше объявленного feature-area floor (2.25), но
    // узкая сторона (1) всё ещё требует шаг 0.25 при доступных только 0.375.
    const belowBudget = path('M0 0H10V10H0Z M5 3H6V6H5Z');
    const metrics = compareSilhouettes([solidSquare], [belowBudget], {
      canvas: 24,
      topologyMaxGridSide: 64,
    });

    expect(metrics.topology).toMatchObject({
      mismatch: false,
      difference: false,
      uncertain: true,
      confidence: {
        status: 'UNCERTAIN',
        reasons: expect.arrayContaining(['GRID_BUDGET_CANNOT_RESOLVE_VECTOR_FEATURE']),
      },
      resolution: {
        limitedByGridBudget: true,
        maxGridSide: 64,
        grid: { cols: 64, rows: 64 },
      },
    });
  });

  it('sanitization не скрывает raw degenerate и below-resolution subpaths', () => {
    const exporterDebris = path(
      'M0 0H10V10H0Z M2 2H2.05V2.05H2Z M3 3H3.1Z',
    );
    const metrics = compareSilhouettes([solidSquare], [exporterDebris], { canvas: 24 });

    expect(metrics.topology).toMatchObject({
      mismatch: false,
      uncertain: false,
      confidence: { status: 'RESOLVED' },
      resolution: {
        minimumFeatureArea: 0.01,
        vectorGuide: {
          candidate: {
            subpaths: 3,
            significantSubpaths: 1,
            degenerateSubpaths: 1,
            ignoredBelowResolutionSubpaths: 1,
          },
        },
      },
    });
  });
});
