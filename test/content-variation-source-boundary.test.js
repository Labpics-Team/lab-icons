import { describe, expect, it } from 'vitest';
import { authoredSymbolPayloads } from '../scripts/lib/authored-symbol-payload.js';
import { createCompiledContentGlyph } from '../src/ir/author-content-runtime.js';

const icon = 'plus-circle';
const input = (await authoredSymbolPayloads([icon]))[icon];
const compiled = input.contentVariation.outline;

describe('content runtime binds the complete source path projection', () => {
  it('accepts the exact compiled source including its counter', () => {
    const glyph = createCompiledContentGlyph(icon, input.source, compiled);
    expect(glyph()).toBe(input.source.outline);
    expect(glyph({variation:{contentScale:.9}}).parts.at(-1).d).toBe(input.source.outline.parts.at(-1).d);
  });

  it.each([
    ['lost counter', source => {source.outline.parts.at(-1).d=compiled.enclosure.outerD;}],
    ['extra contour', source => {source.outline.parts.at(-1).d+='M0 0L1 0L1 1Z';}],
    ['counter polarity', source => {source.outline.parts.at(-1).fillRule='nonzero';}],
    ['changed content', source => {source.outline.parts[0].d='M11 11L13 11L13 13Z';}],
  ])('refuses %s with unchanged admission receipts', (_name, mutate) => {
    const sources = structuredClone(input.source);
    mutate(sources);
    expect(() => createCompiledContentGlyph(icon,sources,compiled)).toThrowError(
      expect.objectContaining({code:'VARIATION_SOURCE_MISMATCH'}));
  });
});
