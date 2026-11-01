import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline, authorSymbolPayload } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledSymbol } from '../src/ir/symbol-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';
import { compileLottieGeometry } from '../scripts/lib/lottie-geometry.js';
import { authorPackageExpectations } from '../scripts/check-package-artifact.js';
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
const packageContext = (variant, svg = sources[variant].normalizedSvg, compositionKind = 'layers') =>
  ({ kind: 'package', svg, compositionKind });

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

  it.each(['outline', 'filled'])('%s: raw source и shipped target получают разные точные adapter contracts', variant => {
    const glyph = symbol.glyph({ variant }), caps = symbol.glyphCapabilities(variant), record = sources[variant];
    const target = compileLottieGeometry(glyph);
    expect(target.ok).toBe(true);
    // Повторяет только реальную boundary-проекцию сборки; expected читает raw SVG.
    const shippedCaps = { ...caps, motion: { ...caps.motion, adapters: { ...caps.motion.adapters,
      lottie: target.ok && caps.motion.state === 'gesture-ready' ? 'lottie-web-svg-5.13' : 'not-exported' } } };
    const expected = expectedAuthorMotion(record.sourceContract, packageContext(variant));
    expect(expected).toEqual(shippedCaps.motion);
    const packed = authorPackageExpectations(baseline, { ...stored, icons: { [icon]: stored.icons[icon] } })[icon][variant];
    expect(packed.motion).toEqual(shippedCaps.motion);
    expect(expected.adapters.lottie).toBe('lottie-web-svg-5.13');
    expect(expectedAuthorMotion(record.sourceContract).adapters.lottie).toBe('not-exported');
    expect(() => validateAuthorAdmission(glyph, shippedCaps, record, record.sourceContract, packageContext(variant))).not.toThrow();
    expect(() => validateAuthorAdmission(glyph, shippedCaps, record, record.sourceContract)).toThrow(/capabilities/);
    expect(() => validateAuthorAdmission(glyph, caps, record, record.sourceContract, packageContext(variant))).toThrow(/capabilities/);
  });

  it.each([
    ['arc', 'M1 1A1 1 0 0 1 2 2Z', 'layers'],
    ['open fill', 'M1 1L2 2', 'layers'],
    ['compound', 'M1 1L2 2Z', 'compound'],
    ['zero rx after close', 'M1 1L2 2Z A0 1 0 0 1 1 1', 'layers'],
    ['zero ry after close', 'M1 1L2 2Z A1 0 0 0 1 1 1', 'layers'],
    ['zero radii after close', 'M1 1L2 2Z A0 0 0 0 1 1 1', 'layers'],
  ])('%s: unsupported source сохраняет точный not-exported', (_, d, compositionKind) => {
    const variant = 'outline', source = sources[variant];
    const svg = source.normalizedSvg.replace(/\bd="[^"]+"/, `d="${d}"`);
    const glyph = symbol.glyph({ variant });
    const target = compileLottieGeometry({ ...glyph, composition: { kind: compositionKind },
      parts: glyph.parts.map(part => ({ ...part, d })) });
    expect(target.ok).toBe(false);
    const expected = expectedAuthorMotion(source.sourceContract, packageContext(variant, svg, compositionKind));
    expect(expected.adapters.lottie).toBe('not-exported');
    expect(expected.state).toBe('gesture-ready');
  });

  it('stroke вне source fill domain не получает target admission', () => {
    const source = sources.outline;
    const svg = source.normalizedSvg.replace('<path', '<path stroke="currentColor" stroke-width="1"');
    expect(expectedAuthorMotion(source.sourceContract, packageContext('outline', svg)).adapters.lottie).toBe('not-exported');
    const glyph = symbol.glyph();
    expect(compileLottieGeometry({ ...glyph, parts: glyph.parts.map(part => ({ ...part, paint: { kind: 'stroke', stroke: 'currentColor' } })) }).ok).toBe(false);
  });

  it.each(['M1 1A0 1 0 0 1 2 2Z', 'M1 1A1 1 0 0 1 1 1L2 2Z', 'M1 1L2 2Z A1 1 0 0 1 1 1'])('вырожденная A сохраняет exact line/no-op capability: %s', d => {
    const glyph = symbol.glyph(), source = sources.outline;
    const target = compileLottieGeometry({ ...glyph, parts: glyph.parts.map(part => ({ ...part, d })) });
    expect(target.ok).toBe(true);
    const svg = source.normalizedSvg.replace(/\bd="[^"]+"/, `d="${d}"`);
    expect(expectedAuthorMotion(source.sourceContract, packageContext('outline', svg)).adapters.lottie).toBe('lottie-web-svg-5.13');
  });

  it('x/y разных gestures сохраняют две независимые aggregate channel identity', () => {
    const contract = sources.outline.sourceContract, gesture = contract.gestures[0];
    const pair = { ...contract, gestures: [gesture, { ...gesture, id: 'arrow-forward.vertical-nudge',
      tracks: gesture.tracks.map(track => ({ ...track, axis: 'y' })) }] };
    expect(expectedAuthorMotion(pair).tracks).toEqual([
      { id: 'translate.x.direction-body', kind: 'translate', partIds: ['direction-body'], axis: 'x', unit: 'viewBox' },
      { id: 'translate.y.direction-body', kind: 'translate', partIds: ['direction-body'], axis: 'y', unit: 'viewBox' },
    ]);
  });

  it('анатомия без жеста и неполный package context не дают ложный target admission', () => {
    const motion = expectedAuthorMotion({ ...sources.outline.sourceContract, gestures: [] }, packageContext('outline'));
    expect(motion).toMatchObject({ state: 'source-only', partIds: [], tracks: [], gestures: [], adapters: { lottie: 'not-exported' } });
    for (const context of [{ kind: 'package' }, { kind: 'other' }, { kind: 'source', svg: sources.outline.normalizedSvg }]) {
      expect(() => expectedAuthorMotion(sources.outline.sourceContract, context)).toThrow(TypeError);
    }
  });
});
