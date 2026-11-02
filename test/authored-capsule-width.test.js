import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { authoredSymbolPayloads } from '../scripts/lib/authored-symbol-payload.js';
import { createCompiledCapsuleGlyph } from '../src/ir/author-capsule-runtime.js';
import { compileAuthorCapsule } from '../scripts/lib/author-capsule.js';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { parsePathData, pathBBox } from '../src/core/path-data.js';
import { authorPathEntries } from '../src/core/icon-geometry.js';
import { renderSymbolModules, variationModuleDeclaration, symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
import { authorVariationIconNames, authorVariationLawNames } from '../scripts/lib/author-variation.js';
import { compileSymbolEffect } from '../src/motion/index.js';
import { fileURLToPath } from 'node:url';

const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const names = ['mic', 'mic-circle'], manifest = read('semantics/figma-baseline.json');
const baseline = loadAuthorBaseline(fileURLToPath(new URL('..', import.meta.url)), { manifest: { ...manifest,
  counts: { families: 2, variants: 4 }, icons: Object.fromEntries(names.map(icon => [icon, manifest.icons[icon]])) } });
const anatomy = read('semantics/author-anatomy.json'), selected = { ...anatomy, icons: Object.fromEntries(names.map(icon => [icon, anatomy.icons[icon]])) };
const grid = read('semantics/grid.json'), contracts = compileAuthorAnatomy(baseline, selected, grid);
const payloads = await authoredSymbolPayloads(names);
const glyphs = Object.fromEntries(names.map(icon => [icon, createCompiledCapsuleGlyph(icon, payloads[icon].source, payloads[icon].variation)]));
const split = d => {
  const contours = [];
  for (const segment of parsePathData(d)) { if (segment.cmd === 'M') contours.push([]); contours.at(-1).push(segment); }
  return contours;
};
const points = segments => segments.flatMap(segment => segment.cmd === 'Z' ? [] : segment.cmd === 'C'
  ? [[segment.x1, segment.y1], [segment.x2, segment.y2], [segment.x, segment.y]]
  : segment.cmd === 'Q' ? [[segment.x1, segment.y1], [segment.x, segment.y]] : [[segment.x, segment.y]]);
const span = contour => { const xs = points(contour).map(point => point[0]); return Math.max(...xs) - Math.min(...xs); };

describe('source-owned capsule width changes context without shrinking the whole symbol', () => {
  it.each(['mic/outline', 'mic/filled', 'mic-circle/outline'])('%s keeps exact default and preserves command/part semantics', label => {
    const [icon, variant] = label.split('/'), glyph = glyphs[icon], source = glyph({ variant });
    for (const request of [{variant}, {variant,variation:{}}, {variant,variation:{bodyWidth:1}}]) expect(glyph(request)).toBe(source);
    expect(source.parts.map(part => part.d)).toEqual(authorPathEntries(baseline.icons[icon][variant].artifactSvg).map(entry => entry.d));
    const bodyIndex = source.parts.findIndex(part => part.id === 'microphone-body');
    for (const width of [.8, .9, (1 + payloads[icon].variation[variant].domain.minimum) / 2, payloads[icon].variation[variant].domain.minimum]) {
      const varied = glyph({ variant, variation: { bodyWidth: width } });
      expect(varied.parts.map(part => [part.id,part.role,part.fillRule,part.topologySignature,part.zIndex]))
        .toEqual(source.parts.map(part => [part.id,part.role,part.fillRule,part.topologySignature,part.zIndex]));
      for (const [i, part] of varied.parts.entries()) if (i !== bodyIndex) expect(part).toBe(source.parts[i]);
      const before = split(source.parts[bodyIndex].d), after = split(varied.parts[bodyIndex].d);
      expect(after.map(contour => contour.map(segment => segment.cmd))).toEqual(before.map(contour => contour.map(segment => segment.cmd)));
      expect(after.map(contour => points(contour).map(point => point[1]))).toEqual(before.map(contour => points(contour).map(point => point[1])));
      expect(span(after[0])).toBeCloseTo(span(before[0]) * width, 11);
      if (before.length === 2) {
        expect(span(before[0]) - span(before[1])).toBeCloseTo(span(after[0]) - span(after[1]), 11);
        expect(span(after[1])).toBeGreaterThanOrEqual(payloads[icon].variation[variant].domain.policy.minimumGap);
      }
      expect(pathBBox(varied.parts[bodyIndex].d).maxY).toBe(pathBBox(source.parts[bodyIndex].d).maxY);
      expect(varied.svg).toContain(`d="${varied.parts[bodyIndex].d}"`);
      expect(varied.provenance).toMatchObject({kind:'authored-variation',variation:{law:'capsule.width',parameters:{bodyWidth:width}}});
      expect(varied.provenance.author).toBe(source.provenance.author);
    }
  });

  it('keeps independent Filled circle static and refuses foreign axes, parameters, size and exports', () => {
    const glyph = glyphs['mic-circle'];
    expect(glyph({variant:'filled'})).toBe(payloads['mic-circle'].source.filled);
    for (const variation of [{}, {bodyWidth:1}, {bodyWidth:.9}]) expect(() => glyph({variant:'filled',variation})).toThrowError(expect.objectContaining({code:'AUTHOR_VARIATION_UNSUPPORTED'}));
    for (const value of [0, -1, NaN, Infinity, '0.9']) expect(() => glyph({variation:{bodyWidth:value}})).toThrowError(expect.objectContaining({code:'INVALID_VARIATION'}));
    for (const value of [{radius:1}, {contentScale:.9}, {[Symbol('bodyWidth')]:.9}]) expect(() => glyph({variation:value})).toThrowError(expect.objectContaining({code:'INVALID_VARIATION'}));
    for (const value of [payloads['mic-circle'].variation.outline.domain.minimum / 2, 1.1]) expect(() => glyph({variation:{bodyWidth:value}})).toThrowError(expect.objectContaining({code:'VARIATION_OUTSIDE_DOMAIN'}));
    expect(() => glyph({modelMode:'source-only',variation:{bodyWidth:.9}})).toThrowError(expect.objectContaining({code:'AUTHOR_PARITY_REQUIRED'}));
    const varied = glyph({variation:{bodyWidth:.9}});
    expect(compileSymbolEffect(varied,payloads['mic-circle'].capabilities.outline,'mic-circle.presence',{duration:300}))
      .toMatchObject({ok:false,reason:{code:'SEMANTIC_MOTION_UNAVAILABLE'}});
  });

  it('binds complete source, commands and controls; detached packets refuse before any glyph', () => {
    const original = payloads.mic;
    expect(createCompiledCapsuleGlyph('mic',original.source,original.variation)({variation:{bodyWidth:.9}}).provenance.kind).toBe('authored-variation');
    for (const mutate of [
      value => {value.variation.outline.body.contours[0].commands = value.variation.outline.body.contours[0].commands.replace('C','L');},
      value => {value.variation.outline.body.contours[0].points[0][0] += .1;},
      value => {value.source.outline.parts[1].d = value.source.outline.parts[1].d.replace('C','L');},
      value => {value.source.outline.parts[0].d += 'M0 0L1 1Z';},
      value => {value.source.outline.parts[1].fillRule='nonzero';},
    ]) {
      const input = structuredClone(original); mutate(input);
      expect(() => createCompiledCapsuleGlyph('mic',input.source,input.variation)).toThrowError(expect.objectContaining({code:'VARIATION_SOURCE_MISMATCH'}));
    }
    const source = structuredClone(baseline.icons.mic.outline), parts = contracts['mic/outline'].parts;
    const bodyD = authorPathEntries(source.artifactSvg)[1].d;
    source.artifactSvg = source.artifactSvg.replace(bodyD,bodyD.replace('C','L'));
    expect(() => compileAuthorCapsule(source,parts,selected.icons.mic.outline.variation,grid)).toThrowError(expect.objectContaining({code:'SOURCE_MISMATCH'}));
    expect(() => compileAuthorCapsule(baseline.icons['mic-circle'].filled,baseline.icons['mic-circle'].filled.sourceContract.parts,
      {law:'capsule.width',parameter:'bodyWidth',bodyPartId:'microphone-body'},grid)).toThrow();
  });

  it('uses existing sliced export owner and keeps optional type closure', () => {
    for (const icon of names) {
      const output = renderSymbolModules(payloads[icon]);
      expect(output.variation).toContain('capsule-runtime.js');
      expect(output.symbol + output.data).not.toMatch(/capsule-runtime|bodyWidth|body\.contours|counter.*rates/);
      expect(output.variation).not.toMatch(/authoring|catalog\.generated|node:fs/);
      expect(payloads[icon].variation.outline).not.toHaveProperty('evidence');
    }
    const projection = symbolReleaseProjection(read('release/contract.json'), names, [], names, ['capsule.width']);
    expect(projection.files).toContain('dist/ir/author-capsule-types.d.ts');
    expect(projection.runtimeDependencies).toContain('dist/ir/capsule-runtime.js');
    const removed = symbolReleaseProjection(read('release/contract.json'), names, [], [], []);
    expect(removed.files).toContain('dist/ir/author-capsule-types.d.ts');
    expect(removed.runtimeDependencies).not.toContain('dist/ir/capsule-runtime.js');
    expect(variationModuleDeclaration('mic-circle','capsule.width',['outline'])).toContain("GlyphRequest<'outline'>");
    expect(authorVariationIconNames(selected)).toEqual(names);
    expect(authorVariationLawNames(selected)).toEqual(['capsule.width']);
  });
});
