import { describe, expect, it } from 'vitest';
import {
  DesignSpecError,
  designSpecContract,
  lowerDesignSpec,
  parseDesignSpec,
} from '../src/authoring/design-spec.js';
// @ts-expect-error — JS geometry owner пока не публикует декларации типов.
import { topologySignature } from '../src/core/anatomy-gen.js';

function legalSpec() {
  return {
    version: 2,
    kind: 'constructive',
    anchors: [
      { id: 'center', kind: 'canvas', at: 'center' },
      { id: 'north', kind: 'canvas', at: 'north' },
      { id: 'east', kind: 'canvas', at: 'east' },
      { id: 'upper', kind: 'midpoint', between: ['center', 'north'] },
      { id: 'mid', kind: 'midpoint', between: ['center', 'east'] },
      {
        id: 'polar',
        kind: 'polar',
        from: 'center',
        angle: { token: 'angle.45' },
        distance: { token: 'operator.directional.head-length' },
      },
      { id: 'projected', kind: 'project', xFrom: 'polar', yFrom: 'upper' },
    ],
    parts: [
      {
        id: 'circle',
        role: 'body',
        geometry: { kind: 'circle', center: 'center', radius: { token: 'operator.rays.body-radius' } },
        paint: { kind: 'fill' },
      },
      {
        id: 'ellipse',
        role: 'detail',
        geometry: {
          kind: 'ellipse',
          center: 'mid',
          rx: { token: 'operator.note.head-radius-x' },
          ry: { token: 'operator.note.head-radius-y' },
          rotation: { token: 'angle.30' },
        },
        paint: { kind: 'stroke', width: { token: 'grid.stroke.base' }, linecap: 'round' },
      },
      {
        id: 'line',
        role: 'content',
        geometry: { kind: 'line', from: 'center', to: 'upper' },
        paint: { kind: 'stroke', width: { token: 'grid.stroke.base' }, linecap: 'round' },
      },
      {
        id: 'arc',
        role: 'content',
        geometry: {
          kind: 'arc',
          center: 'center',
          radius: { token: 'operator.directional.head-length' },
          startAngle: { token: 'angle.zero' },
          endAngle: { token: 'angle.90' },
          direction: 'cw',
        },
        paint: { kind: 'stroke', width: { token: 'grid.stroke.base' }, linecap: 'round' },
      },
      {
        id: 'capsule',
        role: 'control',
        geometry: { kind: 'capsule', from: 'center', to: 'polar', radius: { token: 'grid.stroke.cap-radius' } },
        paint: { kind: 'fill' },
      },
      {
        id: 'rect',
        role: 'container',
        geometry: {
          kind: 'rect',
          center: 'center',
          width: { token: 'grid.keyline.square.size' },
          height: { token: 'grid.keyline.square.size' },
          cornerRadius: { token: 'grid.stroke.cap-radius' },
        },
        paint: { kind: 'stroke', width: { token: 'grid.stroke.enclosure' }, linecap: 'round' },
      },
      {
        id: 'residual',
        role: 'decorator',
        morphGroup: 'status-shape',
        geometry: {
          kind: 'residual',
          recipe: 'superellipse',
          center: 'projected',
          rx: { token: 'operator.note.head-radius-x' },
          ry: { token: 'operator.note.head-radius-y' },
          exponent: { token: 'curve.superellipse.exponent-min' },
          rotation: { token: 'angle.30' },
        },
        paint: { kind: 'fill' },
      },
    ],
    composition: {
      kind: 'mask-subtract',
      basePartIds: ['rect', 'ellipse', 'line', 'arc', 'capsule', 'residual'],
      subtractPartIds: ['circle'],
    },
    decorators: [
      { id: 'status-overlay', kind: 'overlay', partId: 'residual', targetPartIds: ['rect'] },
    ],
    negativeSpace: [
      {
        id: 'canvas-clearance',
        kind: 'exterior-margin',
        minimum: { token: 'grid.margin' },
        participants: ['rect'],
        measurement: 'ink-bounds-to-canvas',
      },
      {
        id: 'body-gap',
        kind: 'gap',
        minimum: { token: 'canvas.zero' },
        participants: ['circle', 'residual'],
        measurement: 'axis-aligned-group-bounds-separation',
      },
    ],
  } as const;
}

function expectCode(fn: () => unknown, code: DesignSpecError['code']) {
  let thrown: unknown;
  let didThrow = false;
  try {
    fn();
  } catch (error) {
    didThrow = true;
    thrown = error;
  }
  if (!didThrow) throw new Error(`ожидалась ошибка ${code}`);
  expect(thrown).toBeInstanceOf(DesignSpecError);
  expect((thrown as DesignSpecError).code).toBe(code);
}

describe('DesignSpec v2', () => {
  it('test helper явно падает, если ожидаемая typed error не была выброшена', () => {
    let caught: unknown;
    try {
      expectCode(() => undefined, 'INVALID_VALUE');
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('ожидалась ошибка INVALID_VALUE');
  });

  it('понимает закрытую конструктивную грамматику и детерминированно lowers в recipe IR', () => {
    const parsed = parseDesignSpec(legalSpec());
    const first = lowerDesignSpec(parsed);
    const second = lowerDesignSpec(parseDesignSpec(JSON.parse(JSON.stringify(legalSpec()))));

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.kind).toBe('design-spec');
    if (first.kind !== 'design-spec') throw new Error('expected constructive lowering');
    expect(first.parts.map(({ id }) => id)).toEqual([
      'circle', 'ellipse', 'line', 'arc', 'capsule', 'rect', 'residual',
    ]);
    expect(first.parts.every(({ geometry }) => geometry.kind === 'path' && geometry.d.length > 0)).toBe(true);
    const residual = first.parts.find(({ id }) => id === 'residual');
    expect(residual?.morphGroup).toBe('status-shape');
    if (!residual) throw new Error('legal fixture lost residual part');
    expect(residual.topologySignature).toBe(topologySignature(residual.geometry.d));
    expect(first.composition).toEqual({
      kind: 'mask-subtract',
      basePartIds: ['rect', 'ellipse', 'line', 'arc', 'capsule', 'residual'],
      subtractPartIds: ['circle'],
    });
    expect(first.decorators).toEqual([
      { id: 'status-overlay', kind: 'overlay', partId: 'residual', targetPartIds: ['rect'] },
    ]);
    expect(first.negativeSpace.constraints).toHaveLength(2);
    const polar = first.anchors.polar;
    const upper = first.anchors.upper;
    if (!polar || !upper) throw new Error('legal fixture lost required anchors');
    expect(first.anchors.projected).toEqual({ x: polar.x, y: upper.y });
  });

  it('публикует bounded residual contract, а не caller-controlled bezier', () => {
    expect(designSpecContract.schema).toBe('labpics.design-spec/2');
    expect(designSpecContract.version).toBe(2);
    expect(designSpecContract.scalarTokens['grid.stroke.base']).toMatchObject({
      unit: 'normalized-canvas',
      source: 'semantics/grid.json#ratios.strokeWidth.base',
    });
    expect(designSpecContract.recipeRegistry['directional-arrow']).toMatchObject({
      version: 1,
      outputs: {
        partIds: ['head', 'shaft'],
        anchorIds: ['arrow.tip'],
        negativeSpace: [
          {
            kind: 'aperture',
            measurementMethod: 'polyline-endpoint-distance-minus-stroke',
          },
          {
            kind: 'exterior-margin',
            measurementMethod: 'ink-bounds-to-canvas',
          },
        ],
      },
    });
    expect(designSpecContract.residualRecipes.superellipse).toEqual({
      continuity: 'C1',
      tangency: 'central-difference-hermite',
      domain: {
        rx: { minExclusive: 0, max: 0.5 },
        ry: { minExclusive: 0, max: 0.5 },
        exponent: { min: 2, max: 8 },
        rotation: { min: -180, max: 180 },
      },
    });
    expect(designSpecContract.negativeSpaceKinds).toEqual([
      'exterior-margin', 'gap',
    ]);
    expect(designSpecContract.negativeSpaceMeasurements).toEqual([
      'ink-bounds-to-canvas', 'axis-aligned-group-bounds-separation',
    ]);
  });

  it('отвергает raw path payload отдельным typed error', () => {
    const value: any = legalSpec();
    value.parts[0].geometry = { kind: 'circle', center: 'center', radius: 0.16, d: 'M0 0L1 1' };
    expectCode(() => parseDesignSpec(value), 'RAW_PATH_FORBIDDEN');

    const pathKind: any = legalSpec();
    pathKind.parts[0].geometry = { kind: 'path', d: 'M0 0L1 1' };
    expectCode(() => parseDesignSpec(pathKind), 'RAW_PATH_FORBIDDEN');
  });

  it('отвергает arbitrary point/control arrays отдельным typed error', () => {
    const value: any = legalSpec();
    value.parts[0].geometry = { kind: 'circle', center: 'center', radius: 0.16, points: [[0, 0], [1, 1]] };
    expectCode(() => parseDesignSpec(value), 'ARBITRARY_POINTS_FORBIDDEN');
  });

  it('отвергает anonymous transforms/offsets отдельным typed error', () => {
    const transformed: any = legalSpec();
    transformed.parts[0].geometry = {
      kind: 'circle', center: 'center', radius: 0.16, transform: 'translate(1 2)',
    };
    expectCode(() => parseDesignSpec(transformed), 'ANONYMOUS_TRANSFORM_FORBIDDEN');

    const offset: any = legalSpec();
    offset.anchors[0] = { id: 'center', kind: 'canvas', at: 'center', dx: 0.1 };
    expectCode(() => parseDesignSpec(offset), 'ANONYMOUS_TRANSFORM_FORBIDDEN');
  });

  it('отвергает неизвестные поля и версии fail-closed', () => {
    const unknown: any = legalSpec();
    unknown.parts[0].surprise = true;
    expectCode(() => parseDesignSpec(unknown), 'UNKNOWN_FIELD');

    const version: any = legalSpec();
    version.version = 3;
    expectCode(() => parseDesignSpec(version), 'UNSUPPORTED_VERSION');

    const legacy: any = legalSpec();
    legacy.version = 1;
    expectCode(() => parseDesignSpec(legacy), 'UNSUPPORTED_VERSION');
  });

  it('отвергает anchor cycle и неизвестные ссылки до lowering', () => {
    const cyclic: any = legalSpec();
    cyclic.anchors = [
      { id: 'a', kind: 'midpoint', between: ['b', 'b'] },
      { id: 'b', kind: 'midpoint', between: ['a', 'a'] },
    ];
    cyclic.parts[0].geometry.center = 'a';
    expectCode(() => parseDesignSpec(cyclic), 'ANCHOR_CYCLE');

    const missing: any = legalSpec();
    missing.parts[0].geometry.center = 'ghost';
    expectCode(() => parseDesignSpec(missing), 'UNKNOWN_REFERENCE');
  });

  it('отвергает underdefined и contradictory negative-space constraints', () => {
    const underdefined: any = legalSpec();
    underdefined.negativeSpace[1].participants = ['circle'];
    expectCode(() => parseDesignSpec(underdefined), 'UNDERDEFINED_CONSTRAINT');

    const contradictory: any = legalSpec();
    contradictory.negativeSpace.push({
      ...contradictory.negativeSpace[1],
      id: 'body-gap-duplicate',
      participants: ['residual', 'circle'],
    });
    expectCode(() => parseDesignSpec(contradictory), 'CONTRADICTORY_CONSTRAINT');

    const falseAperture: any = legalSpec();
    falseAperture.negativeSpace[0].kind = 'aperture';
    expectCode(() => parseDesignSpec(falseAperture), 'INVALID_VALUE');

    const exteriorMeasuredAsGap: any = legalSpec();
    exteriorMeasuredAsGap.negativeSpace[0].measurement = 'axis-aligned-group-bounds-separation';
    exteriorMeasuredAsGap.negativeSpace[0].participants = ['rect', 'ellipse'];
    expectCode(() => parseDesignSpec(exteriorMeasuredAsGap), 'CONTRADICTORY_CONSTRAINT');

    const gapMeasuredAsExterior: any = legalSpec();
    gapMeasuredAsExterior.negativeSpace[1].measurement = 'ink-bounds-to-canvas';
    expectCode(() => parseDesignSpec(gapMeasuredAsExterior), 'CONTRADICTORY_CONSTRAINT');
  });

  it('decorator semantics не могут противоречить composition', () => {
    const falseKnockout: any = legalSpec();
    falseKnockout.decorators[0] = {
      id: 'false-knockout',
      kind: 'knockout',
      partId: 'residual',
      targetPartIds: ['rect'],
    };
    expectCode(() => parseDesignSpec(falseKnockout), 'CONTRADICTORY_CONSTRAINT');

    const falseOverlay: any = legalSpec();
    falseOverlay.decorators[0] = {
      id: 'false-overlay',
      kind: 'overlay',
      partId: 'circle',
      targetPartIds: ['rect'],
    };
    expectCode(() => parseDesignSpec(falseOverlay), 'CONTRADICTORY_CONSTRAINT');
  });

  it('mask-subtract обязан классифицировать каждую часть ровно один раз', () => {
    const omitted: any = legalSpec();
    omitted.composition.basePartIds = omitted.composition.basePartIds.filter((id: string) => id !== 'residual');
    expectCode(() => parseDesignSpec(omitted), 'UNDERDEFINED_CONSTRAINT');
  });

  it('residual curve не принимает control points и незарегистрированный residual recipe', () => {
    const controls: any = legalSpec();
    controls.parts.at(-1).geometry.controls = [{ x: 0.1, y: 0.2 }];
    expectCode(() => parseDesignSpec(controls), 'ARBITRARY_POINTS_FORBIDDEN');

    const unbounded: any = legalSpec();
    unbounded.parts.at(-1).geometry.recipe = 'caller-bezier';
    expectCode(() => parseDesignSpec(unbounded), 'UNBOUNDED_RESIDUAL');
  });

  it('hard negative-space failure и вырожденная геометрия остаются typed outcomes', () => {
    const clearance: any = legalSpec();
    clearance.negativeSpace[0].minimum = { token: 'grid.keyline.circle.radius' };
    expectCode(() => lowerDesignSpec(clearance), 'CONSTRAINT_VIOLATION');

    const degenerateArc: any = legalSpec();
    const arc = degenerateArc.parts.find((part: any) => part.id === 'arc');
    arc.geometry.endAngle = arc.geometry.startAngle;
    expectCode(() => lowerDesignSpec(degenerateArc), 'INVALID_VALUE');
  });

  it('painted ink не может выйти за normalized canvas даже без optional clearance constraint', () => {
    const overflow: any = legalSpec();
    overflow.negativeSpace = [];
    const rect = overflow.parts.find((part: any) => part.id === 'rect');
    rect.geometry.width = { token: 'grid.keyline.wide.width' };
    rect.geometry.height = { token: 'grid.keyline.tall.height' };
    rect.paint.width = { token: 'grid.stroke.bold' };
    expectCode(() => lowerDesignSpec(overflow), 'CONSTRAINT_VIOLATION');
  });
});

describe('DesignSpec authoring authority', () => {
  it('не допускает свободный geometry scalar на author-facing границе', () => {
    const mutations: readonly ((value: any) => void)[] = [
      (value) => { value.anchors.find((anchor: any) => anchor.id === 'polar').angle = 45; },
      (value) => { value.anchors.find((anchor: any) => anchor.id === 'polar').distance = 0.18; },
      (value) => { value.parts.find((part: any) => part.id === 'circle').geometry.radius = 0.173; },
      (value) => { value.parts.find((part: any) => part.id === 'ellipse').geometry.rx = 0.08; },
      (value) => { value.parts.find((part: any) => part.id === 'ellipse').geometry.rotation = 30; },
      (value) => { value.parts.find((part: any) => part.id === 'arc').geometry.startAngle = 15; },
      (value) => { value.parts.find((part: any) => part.id === 'capsule').geometry.radius = 0.025; },
      (value) => { value.parts.find((part: any) => part.id === 'rect').geometry.width = 0.6; },
      (value) => { value.parts.find((part: any) => part.id === 'rect').geometry.cornerRadius = 0.04; },
      (value) => { value.parts.find((part: any) => part.id === 'residual').geometry.exponent = 3.2; },
      (value) => { value.parts.find((part: any) => part.id === 'ellipse').paint.width = 0.02; },
      (value) => { value.negativeSpace[0].minimum = 0.005; },
    ];
    for (const mutate of mutations) {
      const value: any = legalSpec();
      mutate(value);
      expectCode(() => parseDesignSpec(value), 'FREE_SCALAR_FORBIDDEN');
    }
  });

  it('различает неизвестный registered recipe от версии схемы', () => {
    const value = {
      version: 2,
      kind: 'recipe',
      invocation: {
        id: 'primary',
        recipe: 'invented-shape',
        recipeVersion: 1,
        parameters: {},
      },
    };
    expectCode(
      () => parseDesignSpec(value),
      'UNKNOWN_RECIPE' as DesignSpecError['code'],
    );

    const wrongVersion: any = JSON.parse(JSON.stringify(value));
    wrongVersion.invocation.recipe = 'directional-arrow';
    wrongVersion.invocation.recipeVersion = 2;
    expectCode(() => parseDesignSpec(wrongVersion), 'UNSUPPORTED_RECIPE_VERSION');
  });

  it('отвергает unknown token, unit mismatch и opaque parameter map до lowering', () => {
    const unknownToken: any = legalSpec();
    unknownToken.parts[0].geometry.radius = { token: 'invented.radius' };
    expectCode(() => parseDesignSpec(unknownToken), 'UNKNOWN_SCALAR_TOKEN');

    const wrongUnit: any = legalSpec();
    wrongUnit.parts[0].geometry.radius = { token: 'angle.45' };
    expectCode(() => parseDesignSpec(wrongUnit), 'SCALAR_UNIT_MISMATCH');

    const opaque = {
      version: 2,
      kind: 'recipe',
      invocation: {
        id: 'primary',
        recipe: 'directional-arrow',
        recipeVersion: 1,
        parameters: { shaftLength: { value: 0.6 } },
      },
    };
    expectCode(() => parseDesignSpec(opaque), 'OPAQUE_RECIPE_PARAMETER_FORBIDDEN');
  });

  it('recipe schema закрывает unknown parameter, raw fallback и domain violation', () => {
    const unknownParameter: any = {
      version: 2,
      kind: 'recipe',
      invocation: {
        id: 'primary',
        recipe: 'directional-arrow',
        recipeVersion: 1,
        parameters: { center: 0.5 },
      },
    };
    expectCode(() => parseDesignSpec(unknownParameter), 'UNKNOWN_RECIPE_PARAMETER');

    const rawFallback: any = JSON.parse(JSON.stringify(unknownParameter));
    delete rawFallback.invocation.parameters.center;
    rawFallback.invocation.raw = 'M0 0L1 1';
    expectCode(() => parseDesignSpec(rawFallback), 'RAW_FALLBACK_FORBIDDEN');

    const belowOpticalMinimum: any = JSON.parse(JSON.stringify(unknownParameter));
    belowOpticalMinimum.invocation.parameters = { opsz: 16, weight: 0.001 };
    expectCode(() => parseDesignSpec(belowOpticalMinimum), 'RECIPE_PARAMETER_OUT_OF_DOMAIN');
  });

  it('registered recipe принимает только named parameters и namespaces semantic output', () => {
    const input = {
      version: 2,
      kind: 'recipe',
      invocation: {
        id: 'primary',
        recipe: 'directional-arrow',
        recipeVersion: 1,
        parameters: {
          orientation: 'forward',
          shaftLength: 0.58,
        },
      },
    } as const;
    const parsed = parseDesignSpec(input);
    expect(parsed.kind).toBe('recipe');
    const lowered = lowerDesignSpec(parsed);
    expect(lowered.kind).toBe('design-spec-recipe');
    if (lowered.kind !== 'design-spec-recipe') throw new Error('expected recipe lowering');
    expect(lowered.parts.map(({ id }) => id)).toEqual(['primary.head', 'primary.shaft']);
    expect(Object.keys(lowered.anchors)).toEqual(['primary.arrow.tip']);
    expect(lowered.joins?.[0]).toMatchObject({
      id: 'primary.arrow.tip',
      members: ['primary.head', 'primary.shaft'],
    });
    expect(lowered.negativeSpace.constraints.map(({ kind }) => kind)).toEqual([
      'aperture', 'exterior-margin',
    ]);
    expect(lowered.negativeSpace.constraints.map(({ measurementMethod }) => measurementMethod)).toEqual([
      'polyline-endpoint-distance-minus-stroke', 'ink-bounds-to-canvas',
    ]);
    expect(lowered.negativeSpace.constraints[0]?.participants).toEqual([
      'primary.head.start', 'primary.head.end',
    ]);
    expect(lowered.negativeSpace.constraints.flatMap(({ participants }) => participants)).toContain('canvas');
    expect(lowered.recipe).toEqual({
      invocationId: 'primary',
      id: 'directional-arrow',
      version: 1,
      parameters: { orientation: 'forward', shaftLength: 0.58 },
    });
  });
});
