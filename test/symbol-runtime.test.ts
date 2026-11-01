import { describe, expect, it } from 'vitest';
import { createCompiledSymbol } from '../src/ir/symbol-runtime.js';
import { GlyphModelError, parseSymbolOptions } from '../src/ir/request.js';
import type { AxisContract, AxisName, GlyphCapabilities, GlyphIR, IconVariant } from '../src/ir/index.js';

const axes = {
  weight: { kind: 'continuous', min: 0.6, default: 1, max: 1.29167, lifecycle: 'active-after-sampled-optical-proof' },
  corner: { kind: 'continuous', min: 0, default: 1, max: 1.666667, lifecycle: 'active-after-sampled-optical-proof' },
  opsz: { kind: 'continuous', min: 16, default: 24, max: 48, lifecycle: 'active-after-sampled-optical-proof' },
} as const satisfies Record<AxisName, AxisContract>;

function source(variant: IconVariant): GlyphIR {
  return {
    icon: 'alert', variant, viewBox: [0, 0, 24, 24], parts: [], d: 'M0 0H24V24H0Z',
    svg: '<svg viewBox="0 0 24 24"><path d="M0 0H24V24H0Z"/></svg>',
    composition: { kind: 'layers' }, provenance: { kind: 'source', file: `svg/${variant}/alert.svg` },
  };
}

function capability(variant: IconVariant, modelState: GlyphCapabilities['modelState'] = null, supportedAxes: AxisName[] = []): GlyphCapabilities {
  return {
    icon: 'alert', variant, modelState, supportedAxes,
    axes: Object.fromEntries(supportedAxes.map(name => [name, axes[name]])),
    motion: { state: 'source-only', partIds: [], tracks: [], gestures: [], adapters: { lottie: 'not-exported', sfSymbols: 'not-exported' } },
  };
}

function data(modelState: GlyphCapabilities['modelState'] = null, supportedAxes: AxisName[] = []) {
  const sources = { outline: source('outline'), filled: source('filled') };
  return {
    icon: 'alert' as const, axes, source: sources, defaults: sources,
    capabilities: { outline: capability('outline', modelState, supportedAxes), filled: capability('filled', modelState, supportedAxes) },
  };
}

describe('предварительно собранный символ', () => {
  it('повторный default render возвращает immutable snapshot без вызова compiler', () => {
    let calls = 0;
    const symbol = createCompiledSymbol(data(), () => { calls++; throw new Error('unexpected geometry work'); });
    const first = symbol.glyph();
    expect(symbol.glyph()).toBe(first);
    expect(symbol.glyph({ variant: 'outline' })).toBe(first);
    expect(symbol.glyph({ modelMode: 'source-only' })).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.viewBox)).toBe(true);
    expect(calls).toBe(0);
    expect(() => { (first.viewBox as unknown as number[])[0] = 99; }).toThrow();
  });

  it('материализованный capability не меняется при render и не строит геометрию', () => {
    const symbol = createCompiledSymbol(data());
    const first = symbol.glyphCapabilities('filled');
    expect(symbol.glyphCapabilities('filled')).toBe(first);
    expect(Object.isFrozen(first.motion.gestures)).toBe(true);
    expect(symbol.glyph({ variant: 'filled' }).variant).toBe('filled');
  });

  it('только действительно поддержанный non-default axis вызывает общий compiler', () => {
    const input = data('accepted', ['weight']);
    const requests: unknown[] = [];
    const result = source('outline');
    const symbol = createCompiledSymbol(input, request => { requests.push(request); return result; });
    expect(symbol.glyph({ axes: { weight: 1 } })).toBe(input.defaults.outline);
    expect(requests).toHaveLength(0);
    expect(symbol.glyph({ axes: { weight: 1.1 } })).toBe(result);
    expect(requests).toEqual([{ icon: 'alert', variant: 'outline', modelMode: 'accepted-only', axes: { weight: 1.1 } }]);
    expect(() => symbol.glyph({ axes: { opsz: 24 } })).toThrow(RangeError);
    expect(() => symbol.glyph({ axes: { weight: 0.5 } })).toThrow(RangeError);
  });

  it('явно отказывает в source axes и candidate admission', () => {
    expect(() => createCompiledSymbol(data()).glyph({ axes: { weight: 1 } })).toThrow(RangeError);
    const candidate = createCompiledSymbol(data('candidate', ['weight']));
    expect(candidate.glyph().provenance.kind).toBe('source');
    expect(() => candidate.glyph({ modelMode: 'allow-candidate' })).toThrow(GlyphModelError);
    try { candidate.glyph({ modelMode: 'allow-candidate' }); }
    catch (error) { expect((error as GlyphModelError).code).toBe('CANDIDATES_REQUIRED'); }
    expect(() => candidate.glyph({ modelMode: 'source-only', axes: { weight: 1 } })).toThrow(RangeError);
  });

  it.each([null, [], { icon: 'time' }, { modelMode: null }, { variant: 'mixed' }, { axes: null }, { axes: { weight: NaN } }, { axes: { alien: 1 } }])('недоверенный запрос отвергается: %j', input => {
    expect(() => parseSymbolOptions(input, axes)).toThrow();
    expect(() => createCompiledSymbol(data()).glyph(input as never)).toThrow();
  });
});
