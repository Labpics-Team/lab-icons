import { expect, it } from 'vitest';
import { parseCompiledGlyphOptions } from '../src/ir/author-request-runtime.js';
import { annulusEmphasisParameter } from '../src/ir/annulus-geometry-runtime.js';
import type { AuthorSymbolGlyphRequest } from '../src/ir/author-source.js';

it('an explicitly undefined optional variation behaves like an omitted field', () => {
  const request: AuthorSymbolGlyphRequest = { variation: undefined };
  expect(parseCompiledGlyphOptions('alert', request)).toEqual(parseCompiledGlyphOptions('alert', {}));
});

it('a source-only symbol refuses inherited and non-enumerable variations', () => {
  for (const request of [Object.create({ variation: { enclosureEmphasis: 1.1 } }),
    Object.defineProperty({}, 'variation', { value: { enclosureEmphasis: 1.1 } })]) {
    expect(() => parseCompiledGlyphOptions('alert', request))
      .toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
  }
});

it('annulus admission rejects every undeclared own property', () => {
  expect(annulusEmphasisParameter({ enclosureEmphasis: 1.1 })).toBe(1.1);
  for (const key of ['contentScale', Symbol('contentScale')]) {
    const request = Object.defineProperty({ enclosureEmphasis: 1.1 }, key, { value: 2 });
    expect(() => annulusEmphasisParameter(request)).toThrow(expect.objectContaining({ code: 'INVALID_VARIATION' }));
  }
});
