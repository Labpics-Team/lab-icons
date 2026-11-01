import { describe, expect, it } from 'vitest';
import {
  compileDesignSpec,
  DesignSpecError,
  lowerDesignSpec,
  renderGlyphSvg,
  type DesignSpec,
  type DesignSpecErrorCode,
} from '../src/authoring/index.js';
import type { GlyphIR } from '../src/ir/compiler.js';

function beacon(): DesignSpec {
  return {
    version: 1,
    anchors: [
      { id: 'center', kind: 'canvas', at: 'center' },
      { id: 'signal', kind: 'polar', from: 'center', angle: -45, distance: 0.32 },
    ],
    parts: [
      { id: 'body', role: 'body', geometry: { kind: 'circle', center: 'center', radius: 0.21 }, paint: { kind: 'stroke', width: 0.055 }, morphGroup: 'beacon-body' },
      { id: 'focus', role: 'content', geometry: { kind: 'circle', center: 'center', radius: 0.055 }, paint: { kind: 'fill' } },
      { id: 'signal', role: 'decorator', geometry: { kind: 'circle', center: 'signal', radius: 0.045 }, paint: { kind: 'fill' } },
    ],
    composition: { kind: 'layers' },
    decorators: [{ id: 'signal-overlay', kind: 'overlay', partId: 'signal', targetPartIds: ['body'] }],
    negativeSpace: [{ id: 'canvas-margin', kind: 'exterior-margin', minimum: 0.2, participants: ['body', 'focus', 'signal'], measurement: 'ink-bounds-to-canvas' }],
  };
}

function ring(kind: 'compound' | 'mask-subtract'): DesignSpec {
  return {
    version: 1,
    anchors: [{ id: 'center', kind: 'canvas', at: 'center' }],
    parts: [
      { id: 'body', role: 'body', geometry: { kind: 'circle', center: 'center', radius: 0.3 }, paint: { kind: 'fill' } },
      { id: 'hole', role: kind === 'mask-subtract' ? 'decorator' : 'counter', geometry: { kind: 'circle', center: 'center', radius: 0.16 }, paint: { kind: 'fill' } },
    ],
    composition: kind === 'compound'
      ? { kind, fillRule: 'evenodd' }
      : { kind, basePartIds: ['body'], subtractPartIds: ['hole'] },
    decorators: kind === 'mask-subtract'
      ? [{ id: 'hole-knockout', kind: 'knockout', partId: 'hole', targetPartIds: ['body'] }]
      : [],
    negativeSpace: [],
  };
}

function expectRefusal(action: () => unknown, code: DesignSpecErrorCode, at?: string): void {
  expect(action).toThrowError(DesignSpecError);
  try {
    action();
  } catch (error) {
    expect((error as DesignSpecError).code).toBe(code);
    if (at) expect((error as DesignSpecError).at).toBe(at);
  }
}

describe('публичный DesignSpec → GlyphIR → SVG', () => {
  it('строит новый layers-знак с независимой семантической анатомией и реальным paint', () => {
    const spec = beacon();
    const glyph = compileDesignSpec(spec, { icon: 'focus-beacon' });
    const consumer: GlyphIR<'focus-beacon'> = glyph;
    expect(consumer.icon).toBe('focus-beacon');
    expect(glyph.viewBox).toEqual([0, 0, 1, 1]);
    expect(glyph.svg).toContain('width="24" height="24"');
    expect(glyph.svg).toContain('data-part="body" data-role="body" fill="none" stroke="currentColor" stroke-width="0.055"');
    expect(glyph.svg).toContain('data-part="focus" data-role="content" fill="currentColor"');
    expect(glyph.parts.map(({ id, role, zIndex }) => [id, role, zIndex])).toEqual([
      ['body', 'body', 0], ['focus', 'content', 1], ['signal', 'decorator', 2],
    ]);
    expect(glyph.parts[0]?.d).toBe('M0.71 0.5A0.21 0.21 0 1 0 0.29 0.5A0.21 0.21 0 1 0 0.71 0.5Z');
    expect(glyph.parts[0]?.anchor).toEqual([0.5, 0.5]);
    expect(glyph.parts.every(({ anchorSource }) => anchorSource === 'geometry-bbox-center')).toBe(true);
    expect(glyph.parts[0]?.morphGroup).toBe('beacon-body');
    expect(glyph.parts[1]?.morphGroup).toBeNull();
    expect(glyph.parts[0]?.provenance).toEqual({ kind: 'recipe', identity: 'declared', recipe: 'design-spec/1' });
    expect(glyph.designSpec.anchors.signal?.x).toBeCloseTo(0.5 + Math.SQRT1_2 * 0.32, 6);
    expect(glyph.designSpec.anchors.signal?.y).toBeCloseTo(0.5 - Math.SQRT1_2 * 0.32, 6);
    expect(glyph.designSpec.decorators).toEqual(spec.decorators);
    expect(glyph.designSpec.negativeSpace.constraints[0]?.measured).toBeGreaterThanOrEqual(0.2);
    expect(glyph.provenance).toMatchObject({ kind: 'design-spec', specVersion: 1, state: 'candidate' });
    expect(glyph.provenance.specSha256).toMatch(/^sha256:[a-f0-9]{64}$/);
    expect(Object.isFrozen(glyph.designSpec.anchors.signal)).toBe(true);
    expect(Object.isFrozen(glyph.parts[0]?.provenance)).toBe(true);
  });

  it('compound сохраняет общую evenodd-семантику countershape, не рисует части отдельными fills', () => {
    const glyph = compileDesignSpec(ring('compound'), { icon: 'focus-ring', variant: 'filled' });
    expect(glyph.variant).toBe('filled');
    expect(glyph.svg.match(/<path /g)).toHaveLength(1);
    expect(glyph.svg).toContain('data-parts="body hole" data-roles="body counter" fill="currentColor" fill-rule="evenodd"');
    expect(glyph.parts.map(({ fillRule }) => fillRule)).toEqual([null, null]);
    expect(glyph.svg).toContain(`d="${glyph.parts[0]?.d}${glyph.parts[1]?.d}"`);
  });

  it('mask-subtract рисует только base и изолирует ресурсы двух consumer instances', () => {
    const glyph = compileDesignSpec(ring('mask-subtract'), { icon: 'focus-cutout' });
    expect(glyph.svg).toContain('maskUnits="userSpaceOnUse" x="0" y="0" width="1" height="1" mask-type="luminance"');
    expect(glyph.svg).toContain('data-part="body" data-role="body" fill="#fff"');
    expect(glyph.svg).toContain('data-part="hole" data-role="decorator" fill="#000"');
    const visible = glyph.svg.split('</defs>')[1];
    expect(visible).toContain('data-part="body"');
    expect(visible).not.toContain('data-part="hole"');
    const first = renderGlyphSvg(glyph, { instanceId: 'first' });
    const second = renderGlyphSvg(glyph, { instanceId: 'second' });
    const firstId = /<mask id="([^"]+)"/.exec(first)?.[1];
    const secondId = /<mask id="([^"]+)"/.exec(second)?.[1];
    expect(firstId).toMatch(/^lab-symbol-first-/);
    expect(secondId).toMatch(/^lab-symbol-second-/);
    expect(firstId).not.toBe(secondId);
    expect(first).toContain(`mask="url(#${firstId})"`);
    expect(glyph.designSpec.decorators[0]?.kind).toBe('knockout');
  });

  it('16/24/48 меняют только intrinsic size: canonical contours, paint и digest остаются теми же', () => {
    const glyphs = [16, 24, 48].map(size => compileDesignSpec(beacon(), { icon: 'focus-beacon', size }));
    for (const [index, size] of [16, 24, 48].entries()) {
      const glyph = glyphs[index]!;
      expect(glyph.svg).toContain(`width="${size}" height="${size}"`);
      expect(glyph.parts).toEqual(glyphs[0]!.parts);
      expect(glyph.provenance).toEqual(glyphs[0]!.provenance);
    }
  });

  it('digest связан с нормализованной spec, а не порядком JSON keys или caller label', () => {
    const spec = beacon();
    const first = compileDesignSpec(spec, { icon: 'focus-beacon' });
    const reordered = JSON.parse(JSON.stringify(spec, (key, value) => (
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).reverse())
        : value
    )));
    const second = compileDesignSpec(reordered, { icon: 'other-beacon', variant: 'filled', size: 16 });
    expect(second.designSpec.specSha256).toBe(first.provenance.specSha256);
    const explicitDefaults = { ...spec, parts: spec.parts.map(part => part.paint.kind === 'stroke'
      ? { ...part, paint: { ...part.paint, linecap: 'round' } }
      : part) };
    expect(compileDesignSpec(explicitDefaults, { icon: 'focus-beacon' }).provenance.specSha256).toBe(first.provenance.specSha256);
    const changed = { ...spec, parts: spec.parts.map(part => part.id === 'focus'
      ? { ...part, geometry: { kind: 'circle', center: 'center', radius: 0.06 } }
      : part) };
    expect(compileDesignSpec(changed, { icon: 'focus-beacon' }).provenance.specSha256).not.toBe(first.provenance.specSha256);
  });

  it('refuses неподдержанный compound stroke до SVG assembler и разрешает тот же stroke в layers', () => {
    const spec = { ...beacon(), composition: { kind: 'compound', fillRule: 'nonzero' } };
    expectRefusal(() => compileDesignSpec(spec, { icon: 'beacon' }), 'UNSUPPORTED_COMPOSITION', 'composition');
    expectRefusal(() => lowerDesignSpec(spec), 'UNSUPPORTED_COMPOSITION', 'composition');
    expect(compileDesignSpec(beacon(), { icon: 'beacon' }).svg).toContain('stroke-width="0.055"');
  });

  it('refuses residual, который сериализация превратила в точку, и сохраняет достижимый bounded residual', () => {
    const spec = {
      version: 1,
      anchors: [{ id: 'center', kind: 'canvas', at: 'center' }],
      parts: [{ id: 'body', role: 'body', geometry: { kind: 'residual', recipe: 'superellipse', center: 'center', rx: 0.00001, ry: 0.00001, exponent: 3 }, paint: { kind: 'fill' } }],
      composition: { kind: 'layers' }, decorators: [], negativeSpace: [],
    };
    expectRefusal(() => compileDesignSpec(spec, { icon: 'beacon' }), 'INVALID_VALUE', 'parts.body.geometry');
    const healthy = { ...spec, parts: [{ ...spec.parts[0]!, geometry: { ...spec.parts[0]!.geometry, rx: 0.12, ry: 0.08 } }] };
    expect(compileDesignSpec(healthy, { icon: 'beacon' }).parts[0]?.d).toContain('C');
  });

  it('refuses capsule с нулевыми сериализованными радиусами даже при ненулевых bbox по обеим осям', () => {
    const spec = {
      ...beacon(), decorators: [], negativeSpace: [],
      parts: [{ id: 'body', role: 'body', geometry: { kind: 'capsule', from: 'center', to: 'signal', radius: 0.0000000001 }, paint: { kind: 'fill' } }],
    };
    expectRefusal(() => compileDesignSpec(spec, { icon: 'beacon' }), 'INVALID_VALUE', 'parts.body.geometry');
    const healthy = { ...spec, parts: [{ ...spec.parts[0]!, geometry: { ...spec.parts[0]!.geometry, radius: 0.02 } }] };
    expect(compileDesignSpec(healthy, { icon: 'beacon' }).parts[0]?.d).toContain('A0.02 0.02');
  });

  it.each([
    [{ icon: 'beacon', axes: { weight: 2 } }, 'UNKNOWN_FIELD'],
    [{ icon: 'beacon', d: 'M0 0' }, 'RAW_PATH_FORBIDDEN'],
    [{ icon: 'beacon', size: 0 }, 'INVALID_VALUE'],
    [{ icon: 'beacon', size: -1 }, 'INVALID_VALUE'],
    [{ icon: 'beacon', size: Infinity }, 'INVALID_VALUE'],
    [{ icon: 'beacon', size: NaN }, 'INVALID_VALUE'],
    [{ icon: 'beacon', size: '24' }, 'INVALID_VALUE'],
    [{ icon: 'beacon', variant: 'auto' }, 'INVALID_VALUE'],
    [{ icon: 'beacon', variant: null }, 'INVALID_VALUE'],
    [{ icon: '../beacon' }, 'INVALID_VALUE'],
    [{ icon: '<svg>' }, 'INVALID_VALUE'],
    [{ icon: '' }, 'INVALID_VALUE'],
    [null, 'INVALID_VALUE'],
  ] as const)('closed options refuse %j', (options, code) => {
    expectRefusal(() => compileDesignSpec(beacon(), options as never), code);
  });

  it('публичный мост сохраняет отказы parser и painted containment', () => {
    expectRefusal(() => compileDesignSpec({ ...beacon(), svg: '<svg/>' }, { icon: 'beacon' }), 'RAW_PATH_FORBIDDEN');
    expectRefusal(() => compileDesignSpec({ ...beacon(), version: 2 }, { icon: 'beacon' }), 'UNSUPPORTED_VERSION');
    const outside = { ...beacon(), negativeSpace: [], decorators: [], parts: [{ ...beacon().parts[0]!, geometry: { kind: 'circle', center: 'center', radius: 0.49 } }] };
    expectRefusal(() => compileDesignSpec(outside, { icon: 'beacon' }), 'CONSTRAINT_VIOLATION');
  });
});
