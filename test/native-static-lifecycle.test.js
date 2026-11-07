import { describe, expect, it } from 'vitest';
import { observeNativeStaticLifecycle } from '../scripts/bench/native-static-lifecycle.js';
import { createCompiledCapabilities, createCompiledGlyph } from '../src/ir/symbol-runtime.js';

function fixture(eager = false) {
  const staticSvg = { outline: '<svg>outline</svg>', filled: '<svg>filled</svg>' };
  const sources = Object.fromEntries(['outline', 'filled'].map(variant => [variant, {
    icon: 'alert', variant, viewBox: [0, 0, 24, 24], parts: [], d: '', svg: staticSvg[variant],
    composition: { kind: 'layers' }, provenance: { kind: 'source', file: `${variant}.svg` },
  }]));
  const capabilities = Object.fromEntries(['outline', 'filled'].map(variant => [variant, {
    icon: 'alert', variant, modelState: null, supportedAxes: [], axes: {},
    motion: { state: 'source-only', partIds: [], tracks: [], gestures: [],
      adapters: { lottie: 'not-exported', sfSymbols: 'not-exported' } },
  }]));
  return { staticSvg, load: async () => {
    let glyph = eager ? createCompiledGlyph('alert', sources) : undefined;
    let caps = eager ? createCompiledCapabilities(capabilities) : undefined;
    return { ...staticSvg,
      glyph(request) { return (glyph ??= createCompiledGlyph('alert', sources))(request); },
      glyphCapabilities(variant) { return (caps ??= createCompiledCapabilities(capabilities))(variant); },
    };
  } };
}

describe('отдельный native static lifecycle diagnostic', () => {
  it('lazy import, first use и warm identity измеряются раздельно; observer восстановлен', async () => {
    const before = Object.getOwnPropertyDescriptor(Object, 'freeze');
    const { load, staticSvg } = fixture();
    const report = await observeNativeStaticLifecycle(load, staticSvg);
    expect(report.verdict).toBe('PASS');
    expect(report.freezes.import).toBe(0);
    expect(report.freezes.capabilities).toBeGreaterThan(0);
    expect(report.freezes.glyph).toBeGreaterThan(0);
    expect(report.freezes.warm).toBe(0);
    expect(report.freezes.explicitRequest).toBeGreaterThan(0);
    expect(Object.getOwnPropertyDescriptor(Object, 'freeze')).toEqual(before);
  });

  it('исходный eager factory обнаруживается до first-use assertions', async () => {
    const before = Object.freeze;
    const { load, staticSvg } = fixture(true);
    await expect(observeNativeStaticLifecycle(load, staticSvg)).rejects.toThrow('static import замораживает');
    expect(Object.freeze).toBe(before);
  });

  it('loader failure не оставляет глобальный observer', async () => {
    const before = Object.getOwnPropertyDescriptor(Object, 'freeze');
    const failure = new Error('load failed');
    await expect(observeNativeStaticLifecycle(async () => { throw failure; }, {})).rejects.toBe(failure);
    expect(Object.getOwnPropertyDescriptor(Object, 'freeze')).toEqual(before);
  });
});
