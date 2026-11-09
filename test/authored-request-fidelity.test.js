import { beforeAll, describe, expect, it } from 'vitest';
import { authoredSymbolPayloads } from './helpers/authored-symbol-payload.js';
import { createCompiledGlyph } from '../src/ir/symbol-runtime.js';
import { createCompiledAnnulusGlyph } from '../src/ir/author-annulus-runtime.js';
import { createCompiledVariationGlyph } from '../src/ir/authored-variation.js';

let payloads;
beforeAll(async () => { payloads = await authoredSymbolPayloads(['plus-circle', 'ellipsis-horizontal']); });

const families = [
  { icon: 'plus-circle', variation: { enclosureEmphasis: 1.1 }, defaults: { enclosureEmphasis: 1 },
    compile: payload => createCompiledAnnulusGlyph(payload.icon, payload.source, payload.variation.outline) },
  { icon: 'ellipsis-horizontal', variation: { dotScale: 1.1 }, defaults: { dotScale: 1, spacingScale: 1 },
    compile: payload => createCompiledVariationGlyph(payload.icon, payload.source, payload.variation) },
];

function represented(values, representation) {
  if (representation === 'own') return { ...values };
  if (representation === 'hidden') return Object.defineProperties({}, Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { value }])));
  return Object.create(Object.defineProperties({}, Object.fromEntries(
    Object.entries(values).map(([key, value]) => [key, { get: () => value }]))));
}

function outcome(operation) {
  try { return { ok: true, value: operation() }; }
  catch (error) { return { ok: false, name: error.name, code: error.code, message: error.message }; }
}

describe.each(families)('$icon: форма запроса сохраняет authored selection и отказы', family => {
  it.each(['own', 'hidden', 'inherited'])('сохраняет независимую Filled форму: %s', representation => {
    const payload = payloads[family.icon], glyph = family.compile(payload);
    expect(glyph(represented({ variant: 'filled' }, representation))).toBe(payload.source.filled);
    expect(glyph()).toBe(payload.source.outline);
  });

  it.each(['hidden', 'inherited'])('вариация использует выбранный master: %s', representation => {
    const payload = payloads[family.icon], glyph = family.compile(payload);
    const request = { variant: 'filled', variation: family.variation };
    if (family.icon === 'plus-circle') {
      expect(() => glyph(represented(request, representation)))
        .toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
    } else {
      const varied = glyph(represented(request, representation));
      expect(varied.variant).toBe('filled');
      expect(varied.provenance.kind).toBe('authored-variation');
      expect(varied).toEqual(glyph(request));
    }
  });

  it.each(['own', 'hidden', 'inherited'])('не обходит static policy или parse-отказы: %s', representation => {
    const payload = payloads[family.icon], glyph = family.compile(payload);
    const source = createCompiledGlyph(payload.icon, payload.source);
    for (const fields of [{ modelMode: 'allow-candidate' }, { modelMode: 'foreign' },
      { axes: { weight: 1.1 } }, { axes: { weight: NaN } }, { axes: { foreign: 1 } },
      { axes: null }, { axes: [] }, { variant: null }]) {
      const control = outcome(() => source(fields));
      expect(control.ok).toBe(false);
      expect(outcome(() => glyph(represented(fields, representation)))).toEqual(control);
      expect(outcome(() => glyph(represented({ ...fields, variation: family.variation }, representation))))
        .toEqual(control);
    }
  });

  it.each(['own', 'hidden', 'inherited'])('source-only допускает только точный default: %s', representation => {
    const payload = payloads[family.icon], glyph = family.compile(payload);
    expect(glyph(represented({ modelMode: 'source-only', variation: family.defaults }, representation)))
      .toBe(payload.source.outline);
    expect(() => glyph(represented({ modelMode: 'source-only', variation: family.variation }, representation)))
      .toThrow(expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
  });

  it('getter с private state читает каждый selector один раз на исходном receiver', () => {
    const payload = payloads[family.icon], glyph = family.compile(payload);
    const reads = { variant: 0, modelMode: 0, axes: 0, variation: 0 };
    class Request {
      #fields = { variant: 'outline', modelMode: 'source-only', axes: {}, variation: family.defaults };
      get variant() { reads.variant++; return this.#fields.variant; }
      get modelMode() { reads.modelMode++; return this.#fields.modelMode; }
      get axes() { reads.axes++; return this.#fields.axes; }
      get variation() { reads.variation++; return this.#fields.variation; }
    }
    expect(glyph(new Request())).toBe(payload.source.outline);
    expect(reads).toEqual({ variant: 1, modelMode: 1, axes: 1, variation: 1 });
  });

  it('сохраняет отказ неизвестным own полям и malformed запросам', () => {
    const payload = payloads[family.icon], glyph = family.compile(payload);
    const source = createCompiledGlyph(payload.icon, payload.source);
    for (const request of [null, [], 1, 'filled', { unexpected: true }]) {
      const control = outcome(() => source(request));
      expect(control.ok).toBe(false);
      expect(outcome(() => glyph(request))).toEqual(control);
    }
    const inherited = represented({ variant: 'filled', variation: family.variation }, 'inherited');
    inherited.unexpected = true;
    expect(() => glyph(inherited)).toThrow(TypeError);
  });
});
