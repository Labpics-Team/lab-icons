import { describe, expect, it } from 'vitest';
import { createCompiledGlyph, createCompiledCapabilities } from '../src/ir/symbol-runtime.js';
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
    const input = data(), glyph = createCompiledGlyph(input.icon, input.source);
    expect(glyph.name).toBe('glyph');
    expect(glyph.length).toBe(1);
    const first = glyph();
    expect(glyph()).toBe(first);
    expect(glyph({ variant: 'outline' })).toBe(first);
    expect(glyph({ modelMode: 'source-only' })).toBe(first);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first.viewBox)).toBe(true);
    expect(() => { (first.viewBox as unknown as number[])[0] = 99; }).toThrow();
    const filled = glyph({ variant: 'filled' });
    expect(filled).toBe(input.source.filled);
    expect(filled).not.toBe(first);
    expect(glyph({ variant: 'filled', modelMode: 'source-only' })).toBe(filled);
    expect(Object.isFrozen(filled.viewBox)).toBe(true);
  });

  it('материализованный capability не меняется при render и не строит геометрию', () => {
    const input = data(), glyphCapabilities = createCompiledCapabilities(input.capabilities);
    expect(glyphCapabilities.name).toBe('glyphCapabilities');
    expect(glyphCapabilities.length).toBe(1);
    const first = glyphCapabilities('filled');
    expect(glyphCapabilities('filled')).toBe(first);
    expect(Object.isFrozen(first.motion.gestures)).toBe(true);
    expect(first.variant).toBe('filled');
    expect(glyphCapabilities()).toBe(input.capabilities.outline);
    expect(glyphCapabilities('outline')).toBe(glyphCapabilities());
  });

  it('каждая фабрика материализует только свой независимый input', () => {
    const input = data();
    createCompiledGlyph(input.icon, input.source);
    expect(Object.isFrozen(input.source.outline)).toBe(true);
    expect(Object.isFrozen(input.capabilities.outline)).toBe(false);
    const other = data();
    createCompiledCapabilities(other.capabilities);
    expect(Object.isFrozen(other.capabilities.outline)).toBe(true);
    expect(Object.isFrozen(other.source.outline)).toBe(false);
  });

  it.each([null, [], {}, 'mixed'])('capability variant сохраняет parser refusal: %j', input => {
    expect(() => createCompiledCapabilities(data().capabilities)(input as never)).toThrow(TypeError);
  });

  it.each([{ weight: 1 }, { opsz: 24 }, { corner: 1 }, { weight: 1000 }])('авторский source не наследует старый axis domain: %j', requestedAxes => {
    const input = data(), glyph = createCompiledGlyph(input.icon, input.source);
    try {
      glyph({ axes: requestedAxes });
      throw new Error('axis unexpectedly accepted');
    } catch (error) {
      expect(error).toBeInstanceOf(GlyphModelError);
      expect((error as GlyphModelError).code).toBe('AUTHOR_PARITY_REQUIRED');
    }
  });

  it('явно отказывает в candidate admission и source axes', () => {
    const input = data(), glyph = createCompiledGlyph(input.icon, input.source);
    expect(glyph().provenance.kind).toBe('source');
    expect(() => glyph({ modelMode: 'allow-candidate' })).toThrow(GlyphModelError);
    try { glyph({ modelMode: 'allow-candidate' }); }
    catch (error) { expect((error as GlyphModelError).code).toBe('AUTHOR_PARITY_REQUIRED'); }
    expect(() => glyph({ modelMode: 'source-only', axes: { weight: 1 } })).toThrow(GlyphModelError);
    expect(() => parseSymbolOptions({ axes: { weight: 1000 } }, axes)).toThrow(RangeError);
  });

  it.each([null, [], { icon: 'time' }, { modelMode: null }, { variant: 'mixed' }, { axes: null }, { axes: { weight: NaN } }, { axes: { alien: 1 } }])('недоверенный запрос отвергается: %j', input => {
    expect(() => parseSymbolOptions(input, axes)).toThrow();
    const payload = data();
    expect(() => createCompiledGlyph(payload.icon, payload.source)(input as never)).toThrow();
  });
});
