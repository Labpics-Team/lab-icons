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
    icon: 'alert' as const, source: sources,
    capabilities: { outline: capability('outline', modelState, supportedAxes), filled: capability('filled', modelState, supportedAxes) },
  };
}

describe('предварительно собранный символ', () => {
  it('повторный default render возвращает immutable snapshot без вызова compiler', () => {
    const symbol = createCompiledSymbol(data());
    const first = symbol.glyph();
    expect(symbol.glyph()).toBe(first);
    expect(symbol.glyph({ variant: 'outline' })).toBe(first);
    expect(symbol.glyph({ modelMode: 'source-only' })).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.viewBox)).toBe(true);
    expect(() => { (first.viewBox as unknown as number[])[0] = 99; }).toThrow();
  });

  it('материализованный capability не меняется при render и не строит геометрию', () => {
    const symbol = createCompiledSymbol(data());
    const first = symbol.glyphCapabilities('filled');
    expect(symbol.glyphCapabilities('filled')).toBe(first);
    expect(Object.isFrozen(first.motion.gestures)).toBe(true);
    expect(symbol.glyph({ variant: 'filled' }).variant).toBe('filled');
  });

  it.each([{ weight: 1 }, { opsz: 24 }, { corner: 1 }, { weight: 1000 }])('авторский source не наследует старый axis domain: %j', requestedAxes => {
    const symbol = createCompiledSymbol(data());
    try {
      symbol.glyph({ axes: requestedAxes });
      throw new Error('axis unexpectedly accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(GlyphModelError);
      expect((error as GlyphModelError).code).toBe('AUTHOR_PARITY_REQUIRED');
    }
  });

  it('явно отказывает в candidate admission и source axes', () => {
    const symbol = createCompiledSymbol(data());
    expect(symbol.glyph().provenance.kind).toBe('source');
    expect(() => symbol.glyph({ modelMode: 'allow-candidate' })).toThrow(GlyphModelError);
    try { symbol.glyph({ modelMode: 'allow-candidate' }); }
    catch (error) { expect((error as GlyphModelError).code).toBe('AUTHOR_PARITY_REQUIRED'); }
    expect(() => symbol.glyph({ modelMode: 'source-only', axes: { weight: 1 } })).toThrow(GlyphModelError);
    expect(() => parseSymbolOptions({ axes: { weight: 1000 } }, axes)).toThrow(RangeError);
  });

  it.each([null, [], { icon: 'time' }, { modelMode: null }, { variant: 'mixed' }, { axes: null }, { axes: { weight: NaN } }, { axes: { alien: 1 } }])('недоверенный запрос отвергается: %j', input => {
    expect(() => parseSymbolOptions(input, axes)).toThrow();
    expect(() => createCompiledSymbol(data()).glyph(input as never)).toThrow();
  });
});
