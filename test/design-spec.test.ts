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
    version: 1,
    anchors: [
      { id: 'center', kind: 'canvas', at: 'center' },
      { id: 'north', kind: 'canvas', at: 'north' },
      { id: 'east', kind: 'canvas', at: 'east' },
      { id: 'upper', kind: 'midpoint', between: ['center', 'north'] },
      { id: 'mid', kind: 'midpoint', between: ['center', 'east'] },
      { id: 'polar', kind: 'polar', from: 'center', angle: 45, distance: 0.18 },
      { id: 'projected', kind: 'project', xFrom: 'polar', yFrom: 'upper' },
    ],
    parts: [
      {
        id: 'circle',
        role: 'body',
        geometry: { kind: 'circle', center: 'center', radius: 0.16 },
        paint: { kind: 'fill' },
      },
      {
        id: 'ellipse',
        role: 'detail',
        geometry: { kind: 'ellipse', center: 'mid', rx: 0.08, ry: 0.05, rotation: 30 },
        paint: { kind: 'stroke', width: 0.02, linecap: 'round' },
      },
      {
        id: 'line',
        role: 'content',
        geometry: { kind: 'line', from: 'center', to: 'upper' },
        paint: { kind: 'stroke', width: 0.02, linecap: 'round' },
      },
      {
        id: 'arc',
        role: 'content',
        geometry: {
          kind: 'arc',
          center: 'center',
          radius: 0.22,
          startAngle: 15,
          endAngle: 165,
          direction: 'cw',
        },
        paint: { kind: 'stroke', width: 0.02, linecap: 'round' },
      },
      {
        id: 'capsule',
        role: 'control',
        geometry: { kind: 'capsule', from: 'center', to: 'polar', radius: 0.025 },
        paint: { kind: 'fill' },
      },
      {
        id: 'rect',
        role: 'container',
        geometry: {
          kind: 'rect',
          center: 'center',
          width: 0.6,
          height: 0.5,
          cornerRadius: 0.04,
        },
        paint: { kind: 'stroke', width: 0.02, linecap: 'round' },
      },
      {
        id: 'residual',
        role: 'detail',
        morphGroup: 'status-shape',
        geometry: {
          kind: 'residual',
          recipe: 'superellipse',
          center: 'projected',
          rx: 0.055,
          ry: 0.035,
          exponent: 3.2,
          rotation: 15,
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
        minimum: 0.005,
        participants: ['rect'],
        measurement: 'ink-bounds-to-canvas',
      },
      {
        id: 'body-gap',
        kind: 'gap',
        minimum: 0,
        participants: ['circle', 'residual'],
        measurement: 'axis-aligned-group-bounds-separation',
      },
    ],
  } as const;
}

function expectCode(fn: () => unknown, code: DesignSpecError['code']) {
  try {
    fn();
    throw new Error(`ожидалась ошибка ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(DesignSpecError);
    expect((error as DesignSpecError).code).toBe(code);
  }
}

describe('DesignSpec v1', () => {
  it('понимает закрытую конструктивную грамматику и детерминированно lowers в recipe IR', () => {
    const parsed = parseDesignSpec(legalSpec());
    const first = lowerDesignSpec(parsed);
    const second = lowerDesignSpec(parseDesignSpec(JSON.parse(JSON.stringify(legalSpec()))));

    expect(first).toEqual(second);
    expect(Object.isFrozen(first)).toBe(true);
    expect(first.kind).toBe('design-spec');
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
      'exterior-margin', 'aperture', 'gap', 'knockout',
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
    version.version = 2;
    expectCode(() => parseDesignSpec(version), 'UNSUPPORTED_VERSION');
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
      minimum: 0.02,
      participants: ['residual', 'circle'],
    });
    expectCode(() => parseDesignSpec(contradictory), 'CONTRADICTORY_CONSTRAINT');
  });

  it('mask-subtract обязан классифицировать каждую часть ровно один раз', () => {
    const omitted: any = legalSpec();
    omitted.composition.basePartIds = omitted.composition.basePartIds.filter((id: string) => id !== 'residual');
    expectCode(() => parseDesignSpec(omitted), 'UNDERDEFINED_CONSTRAINT');
  });

  it('residual curve не принимает control points и отказывает вне declared domain', () => {
    const controls: any = legalSpec();
    controls.parts.at(-1).geometry.controls = [{ x: 0.1, y: 0.2 }];
    expectCode(() => parseDesignSpec(controls), 'ARBITRARY_POINTS_FORBIDDEN');

    const unbounded: any = legalSpec();
    unbounded.parts.at(-1).geometry.exponent = 80;
    expectCode(() => parseDesignSpec(unbounded), 'UNBOUNDED_RESIDUAL');
  });

  it('hard negative-space failure и вырожденная геометрия остаются typed outcomes', () => {
    const clearance: any = legalSpec();
    clearance.negativeSpace[0].minimum = 0.4;
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
    rect.geometry.width = 1;
    rect.geometry.height = 1;
    rect.paint.width = 0.1;
    expectCode(() => lowerDesignSpec(overflow), 'CONSTRAINT_VIOLATION');
  });
});
