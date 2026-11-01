import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline, authorSymbolPayload } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledSymbol } from '../src/ir/symbol-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';
import { expectedAuthorEffect, expectedAuthorMotion, validateAuthorAdmission } from '../scripts/bench/author-oracle.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => JSON.parse(readFileSync(new URL(path, new URL('..', import.meta.url)), 'utf8'));
const manifest = read('semantics/figma-baseline.json'), stored = read('semantics/author-anatomy.json');
const icon = 'arrow-forward';
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest, counts: { families: 1, variants: 2 }, icons: { [icon]: manifest.icons[icon] } } });
const anatomy = compileAuthorAnatomy(baseline, { ...stored, icons: { [icon]: stored.icons[icon] } });
const sources = Object.fromEntries(Object.entries(baseline.icons[icon]).map(([variant, source]) =>
  [variant, { ...source, sourceContract: anatomy[`${icon}/${variant}`] }]));
const compiler = createGlyphCompiler({ catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
  icons: { [icon]: { model: null, source: Object.fromEntries(Object.entries(sources).map(([variant, source]) => [variant, source.sourceContract])) } } },
  anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
  staticIcons: { arrowForwardOutline: sources.outline.artifactSvg, arrowForwardFilled: sources.filled.artifactSvg } });
const symbol = createCompiledSymbol(authorSymbolPayload(icon, sources, compiler));

describe('независимая consumer projection directional law', () => {
  it.each(['outline', 'filled'])('%s: полный timeline сохраняет declared viewBox units и поворотную точку', variant => {
    const contract = sources[variant].sourceContract;
    const expected = { version: 3,
      targets: [{ partId: 'direction-body', property: 'x', unit: 'viewBox', from: 0, to: 0 }],
      stages: [
        { partId: 'direction-body', property: 'x', unit: 'viewBox', to: 3, at: 0, duration: 180 },
        { partId: 'direction-body', property: 'x', unit: 'viewBox', to: 0, at: 180, duration: 180 },
      ] };
    expect(expectedAuthorEffect(contract.gestures[0])).toEqual(expected);
    const glyph = symbol.glyph({ variant }), caps = symbol.glyphCapabilities(variant);
    expect(compileSymbolEffect(glyph, caps, `${icon}.nudge`, { duration: 360 })).toMatchObject({ ok: true, effect: expected });
    expect(caps.motion).toEqual(expectedAuthorMotion(contract));
    expect(() => validateAuthorAdmission(glyph, caps, sources[variant], contract)).not.toThrow();
    const wrongUnit = { ...caps, motion: { ...caps.motion, tracks: caps.motion.tracks.map(track => ({ ...track, unit: 'px' })) } };
    expect(() => validateAuthorAdmission(glyph, wrongUnit, sources[variant], contract)).toThrow(/capabilities/);
    const missingApex = { ...expected, stages: [{ ...expected.stages[1], at: 0, duration: 360 }] };
    expect(expectedAuthorEffect(contract.gestures[0])).not.toEqual(missingApex);
  });
});
