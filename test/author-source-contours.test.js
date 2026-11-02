import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { closedSourceContourLiterals } from '../src/core/source-contours.js';
import { authorPathEntries } from '../src/core/icon-geometry.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { symbolExportName } from '../scripts/lib/symbol-modules.js';

const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const manifest = read('semantics/figma-baseline.json'), all = read('semantics/author-anatomy.json');
const baseline = loadAuthorBaseline(fileURLToPath(new URL('..', import.meta.url)), { manifest: { ...manifest,
  counts: { families: 1, variants: 2 }, icons: { 'mic-circle': manifest.icons['mic-circle'] } } });
const master = baseline.icons['mic-circle'].filled;
const declaration = {
  masterSha256: master.author.masterSha256, pathFingerprintSha256: master.author.pathFingerprintSha256,
  composition: { kind: 'compound', fillRule: 'evenodd' },
  parts: [
    { pathIndex: 0, contourIndices: [0], id: 'microphone-enclosure', role: 'container' },
    { pathIndex: 0, contourIndices: [1], id: 'microphone-support', role: 'counter' },
    { pathIndex: 0, contourIndices: [2], id: 'microphone-body', role: 'counter' },
  ], gesture: null, variation: { law: 'capsule.width', parameter: 'bodyWidth', bodyPartId: 'microphone-body' },
};
const document = () => ({ ...all, icons: { 'mic-circle': { filled: structuredClone(declaration) } } });
const hash = value => createHash('sha256').update(value).digest('hex');

describe('source contour anatomy preserves the single authored evenodd fill owner', () => {
  it('binds ordered closed contour coverage without inventing independent layers', () => {
    const contract = compileAuthorAnatomy(baseline, document())['mic-circle/filled'];
    expect(contract.composition).toEqual({ kind: 'compound', fillRule: 'evenodd' });
    expect(contract.parts.map(part => [part.id, part.role, part.fillRule, part.zIndex])).toEqual([
      ['microphone-enclosure', 'container', null, 0], ['microphone-support', 'counter', null, 1], ['microphone-body', 'counter', null, 2],
    ]);
    expect(contract.parts.map(part => part.contourIndices)).toEqual([[0], [1], [2]]);
    expect(contract.anatomy.pathFingerprintSha256).toBe(master.author.pathFingerprintSha256);
    expect(contract.variation.domain.policy.minimumPositiveSpan).toBe(contract.variation.domain.policy.minimumGap);
  });
  it.each([
    ['missing', value => { value.parts.pop(); }, 'PARTS_INVALID'],
    ['duplicate', value => { value.parts[2].contourIndices = [1]; }, 'PARTS_INVALID'],
    ['reordered', value => { value.parts[1].contourIndices = [2]; value.parts[2].contourIndices = [1]; }, 'PARTS_INVALID'],
    ['foreign parent', value => { value.parts[2].pathIndex = 1; }, 'PARTS_INVALID'],
    ['noninteger', value => { value.parts[2].contourIndices = [.5]; }, 'PARTS_INVALID'],
    ['positive body', value => { value.parts[2].role = 'content'; }, 'PARTS_INVALID'],
    ['negative enclosure', value => { value.parts[0].role = 'counter'; }, 'PARTS_INVALID'],
    ['wrong fill', value => { value.composition.fillRule = 'nonzero'; }, 'PARTS_INVALID'],
    ['mask substitute', value => { value.composition = { kind: 'mask-subtract' }; }, 'ANNOTATION_INVALID'],
    ['foreign coordinates', value => { value.parts[2].d = 'M0 0Z'; }, 'ANNOTATION_INVALID'],
    ['stale master', value => { value.masterSha256 = 'a'.repeat(64); }, 'MASTER_MISMATCH'],
  ])('refuses %s before partial anatomy is returned', (_, mutate, code) => {
    const input = document(); mutate(input.icons['mic-circle'].filled);
    expect(() => compileAuthorAnatomy(baseline, input)).toThrowError(expect.objectContaining({ code }));
  });
  it('retains literal fragments and refuses origin-changing relative moveto or open selections', () => {
    const [entry] = authorPathEntries(master.artifactSvg), fragments = closedSourceContourLiterals(entry.d);
    expect(fragments).toHaveLength(3); expect(fragments.join('')).toBe(entry.d);
    expect(hash(fragments.join(''))).toBe(hash(entry.d));
    expect(() => closedSourceContourLiterals('M0 0L1 1ZM2 2L3 3Z')).not.toThrow();
    for (const d of ['M0 0L1 1Zm2 2L3 3Z', 'M0 0L1 1M2 2L3 3Z', 'M0 0L1 1', 'M0 0ZL2 2']) {
      expect(() => closedSourceContourLiterals(d)).toThrow();
    }
  });
  it('projects literal source parts once and refuses detached compiler parent or contour contracts', () => {
    const contract = compileAuthorAnatomy(baseline, document())['mic-circle/filled'];
    const compiler = input => createGlyphCompiler({ catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
      icons: { 'mic-circle': { model: null, source: { outline: baseline.icons['mic-circle'].outline.sourceContract, filled: input } } } },
      anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
      staticIcons: Object.fromEntries(['outline', 'filled'].map(variant => [symbolExportName('mic-circle', variant), baseline.icons['mic-circle'][variant].artifactSvg])) });
    const glyph = compiler(contract).glyph({ icon: 'mic-circle', variant: 'filled', modelMode: 'source-only' });
    expect(glyph.composition).toEqual(contract.composition);
    expect(glyph.d).toBe(authorPathEntries(master.artifactSvg)[0].d);
    expect(glyph.parts.map(part => part.d).join('')).toBe(glyph.d);
    expect(glyph.parts.map(part => part.fillRule)).toEqual([null, null, null]);
    expect(glyph.svg.match(/<path\b/g)).toHaveLength(1);
    for (const mutate of [value => { value.parts[1].contourIndices = [0]; },
      value => { value.composition.fillRule = 'nonzero'; }, value => { value.anatomy.pathFingerprintSha256 = 'b'.repeat(64); },
      value => { value.parts[2].artifactFingerprint = `sha256:${'a'.repeat(64)}`; }]) {
      const invalid = structuredClone(contract); mutate(invalid);
      expect(() => compiler(invalid).glyph({ icon: 'mic-circle', variant: 'filled', modelMode: 'source-only' })).toThrow();
    }
  });
});
