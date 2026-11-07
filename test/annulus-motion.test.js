import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { createCompiledAnnulusGlyph } from '../src/ir/author-annulus-runtime.js';
import { createCompiledGlyph } from '../src/ir/symbol-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';
import { validateMotionGesture } from '../src/core/motion-sampler.js';
import { authoredSymbolPayloads } from './helpers/authored-symbol-payload.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(new URL(`../${file}`, import.meta.url), 'utf8'));
const icon = 'checkmark-circle', gestureId = `${icon}.presence`;
const captured = read('semantics/figma-baseline.json');
const baseline = loadAuthorBaseline(root, { manifest: { ...captured,
  counts: { families: 1, variants: 2 }, icons: { [icon]: captured.icons[icon] } } });
const annotations = read('semantics/author-anatomy.json');
const contracts = compileAuthorAnatomy(baseline, { ...annotations,
  icons: { [icon]: annotations.icons[icon] } }, read('semantics/grid.json'));
const payload = (await authoredSymbolPayloads([icon]))[icon];
const glyph = createCompiledAnnulusGlyph(icon, payload.source, contracts[`${icon}/outline`].variation);
const sourceGlyph = createCompiledGlyph(icon, payload.source);
const caps = payload.capabilities.outline;
// Raw master — независимый oracle для неизменённой отметки и внешней границы.
const rawPaths = [...baseline.icons[icon].outline.rawSvg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)]
  .map(match => match[1]);
const requests = [
  { duration: 600 },
  { duration: 600, from: 1, to: 0 },
  { duration: 600, from: 0.37, to: 0.8 },
  { duration: 600, from: 0.8, to: 0.2 },
  { duration: 600, from: 0.4, to: 0.4 },
  { duration: 600, from: 0, to: 1, reducedMotion: true },
  { duration: 600, from: 1, to: 0, reducedMotion: true },
  { duration: 0, from: 0.37, to: 0.8 },
];
// confirmation.presence объявляет opacity=progress, без внутренних stops.
const expectedEffect = request => {
  const from = request.from ?? 0, to = request.to ?? 1;
  const duration = request.reducedMotion || from === to ? 0 : request.duration;
  return { ok: true, effect: {
    version: 2, icon, variant: 'outline', gesture: gestureId, from, to,
    targets: [{ partId: 'confirmation-mark', property: 'opacity', from, to }],
    stages: [{ partId: 'confirmation-mark', property: 'opacity', at: 0, duration, to }],
    unchangedPartIds: ['confirmation-enclosure'], viewport: { overflow: 'visible' },
    options: { duration, easing: 'linear', fill: 'both' },
  } };
};
const compile = (value, capability = caps, request = { duration: 600 }, id = gestureId) =>
  compileSymbolEffect(value, capability, id, request);

describe('annulus.counter-scale сохраняет объявленный confirmation.presence', () => {
  it.each([0.9, 1.1, 2])('реальная вариация %s компилирует только opacity отметки', enclosureEmphasis => {
    const source = sourceGlyph(), varied = glyph({ variation: { enclosureEmphasis } });
    expect(annotations.icons[icon].outline.gesture).toEqual({
      law: 'confirmation.presence', purpose: 'confirmation', partId: 'confirmation-mark' });
    expect(compile(source).ok).toBe(true);
    expect(varied.provenance).toMatchObject({ kind: 'authored-variation',
      variation: { version: 1, law: 'annulus.counter-scale',
        geometrySha256: contracts[`${icon}/outline`].variation.geometrySha256,
        parameters: { enclosureEmphasis } } });
    expect(varied.parts.map(part => part.id)).toEqual(['confirmation-mark', 'confirmation-enclosure']);
    expect(varied.parts[0]).toBe(source.parts[0]);
    expect(varied.parts[0].d).toBe(rawPaths[0]);
    expect(varied.parts[0].provenance).toMatchObject({ kind: 'source', identity: 'declared' });
    expect(varied.parts[1].provenance).toMatchObject({ kind: 'authored-variation', identity: 'declared',
      source: source.parts[1].provenance,
      variation: varied.provenance.variation });
    expect(varied.parts[1].d).not.toBe(rawPaths[1]);
    expect(varied.parts[1].d.startsWith(contracts[`${icon}/outline`].variation.enclosure.outerD)).toBe(true);
    const before = structuredClone(varied);
    for (const request of requests) {
      const expected = expectedEffect(request);
      expect(compile(source, caps, request)).toEqual(expected);
      expect(compile(varied, caps, request)).toEqual(expected);
    }
    expect(varied).toEqual(before);
  });

  it('объявляет точную capability, сохраняет source default и независимый Filled отказ', () => {
    expect(caps.variation).toMatchObject({ version: 1, law: 'annulus.counter-scale',
      geometrySha256: contracts[`${icon}/outline`].variation.geometrySha256,
      targets: { svg: 'supported', webEffect: 'existing-part-gestures', lottie: 'not-exported', sfSymbols: 'not-exported' } });
    expect(caps.motion.gestures).toHaveLength(1);
    expect(caps.motion.gestures[0]).toMatchObject({ id: gestureId, kind: 'state', restProgress: 1,
      partIds: ['confirmation-mark'], tracks: [{ partId: 'confirmation-mark', kind: 'opacity',
        stops: [{ at: 0, value: 0 }, { at: 1, value: 1 }] }] });
    expect(glyph()).toBe(sourceGlyph());
    expect(glyph({ variation: { enclosureEmphasis: 1 } })).toBe(sourceGlyph());
    const filled = glyph({ variant: 'filled' });
    expect(filled).toBe(sourceGlyph({ variant: 'filled' }));
    expect(payload.capabilities.filled.variation).toBeUndefined();
    expect(compile(filled, payload.capabilities.filled)).toMatchObject({
      ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' } });
    expect(() => glyph({ variant: 'filled', variation: { enclosureEmphasis: 1.1 } }))
      .toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
  });

  it.each([
    ['чужой закон receipt', value => {
      value.glyph.provenance.variation = { ...value.glyph.provenance.variation, law: 'dots.affine' };
    }],
    ['неподдержанная версия receipt', value => {
      value.glyph.provenance.variation = { ...value.glyph.provenance.variation, version: 2 };
    }],
    ['неподдержанная версия capability', value => { value.caps.variation.version = 2; }],
    ['чужой geometry hash receipt', value => {
      value.glyph.provenance.variation = { ...value.glyph.provenance.variation, geometrySha256: '0'.repeat(64) };
    }],
    ['чужой закон capability', value => { value.caps.variation.law = 'dots.affine'; }],
    ['неизвестный согласованный закон', value => {
      value.glyph.provenance.variation = { ...value.glyph.provenance.variation, law: 'unknown.counter-scale' };
      value.caps.variation.law = 'unknown.counter-scale';
    }],
    ['чужой geometry hash capability', value => { value.caps.variation.geometrySha256 = '0'.repeat(64); }],
    ['необъявленная webEffect цель', value => { value.caps.variation.targets.webEffect = 'not-declared'; }],
    ['потерянные variation targets', value => { delete value.caps.variation.targets; }],
    ['потерянная variation capability', value => { delete value.caps.variation; }],
    ['stale author glyph', value => { value.glyph.provenance.author.version = 'stale'; }],
    ['stale author capability', value => { value.caps.author.normalizedSha256 = '0'.repeat(64); }],
    ['stale anatomy glyph', value => { value.glyph.provenance.anatomy.annotationSha256 = '0'.repeat(64); }],
    ['stale anatomy capability', value => { value.caps.anatomy.masterSha256 = '0'.repeat(64); }],
    ['потерянная anatomy', value => { delete value.glyph.provenance.anatomy; }],
    ['необъявленная identity изменённой части', value => { value.glyph.parts[1].provenance.identity = 'geometry-derived'; }],
    ['необъявленная source identity изменённой части', value => {
      value.glyph.parts[1].provenance.source.identity = 'geometry-derived';
    }],
    ['чужой закон receipt изменённой части', value => {
      value.glyph.parts[1].provenance.variation = { ...value.glyph.parts[1].provenance.variation, law: 'dots.affine' };
    }],
    ['неподдержанная версия receipt изменённой части', value => {
      value.glyph.parts[1].provenance.variation = { ...value.glyph.parts[1].provenance.variation, version: 2 };
    }],
    ['чужой geometry hash изменённой части', value => {
      // Runtime разделяет один receipt; отделяем подмену части от glyph receipt.
      value.glyph.parts[1].provenance.variation = { ...value.glyph.parts[1].provenance.variation,
        geometrySha256: '0'.repeat(64) };
    }],
  ])('отказывает конкретной подмене: %s', (_, mutate) => {
    const value = { glyph: structuredClone(glyph({ variation: { enclosureEmphasis: 1.1 } })), caps: structuredClone(caps) };
    expect(compile(value.glyph, value.caps).ok).toBe(true);
    mutate(value);
    expect(compile(value.glyph, value.caps)).toMatchObject({
      ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' } });
  });

  it.each([
    ['duplicate part ID', value => { value.parts[1].id = 'confirmation-mark'; }],
    ['missing declared target', value => { value.parts[0].id = 'different-mark'; }],
    ['compound composition', value => { value.composition = { kind: 'compound', fillRule: 'evenodd' }; }],
  ])('не выдаёт эффект для неадресуемой композиции: %s', (_, mutate) => {
    const value = structuredClone(glyph({ variation: { enclosureEmphasis: 1.1 } }));
    expect(compile(value).ok).toBe(true);
    mutate(value);
    expect(compile(value)).toMatchObject({ ok: false, reason: { code: 'COMPOSITION_NOT_ADDRESSABLE' } });
  });

  it('сохраняет точные отказы для чужого gesture и capability', () => {
    const varied = glyph({ variation: { enclosureEmphasis: 1.1 } });
    expect(compile(varied, caps, { duration: 600 }, `${icon}.draw`)).toMatchObject({
      ok: false, reason: { code: 'GESTURE_UNSUPPORTED' } });
    expect(compile(varied, payload.capabilities.filled)).toMatchObject({
      ok: false, reason: { code: 'CAPABILITY_MISMATCH' } });
  });

  it.each([
    ['rotate', { partId: 'confirmation-mark', kind: 'rotate', anchor: [0.5, 0.5],
      from: 0, to: 360, unit: 'degrees', interpolation: 'linear' }],
    ['translate', { partId: 'confirmation-mark', kind: 'translate', axis: 'x', unit: 'viewBox',
      interpolation: 'linear', stops: [{ at: 0, value: 0 }, { at: 1, value: 1 }] }],
  ])('вариация не получает новый %s gesture', (_, track) => {
    const varied = glyph({ variation: { enclosureEmphasis: 1.1 } });
    const capability = structuredClone(caps);
    capability.motion.gestures[0].tracks = [track];
    expect(() => validateMotionGesture(capability.motion.gestures[0])).not.toThrow();
    expect(compile(varied, capability)).toMatchObject({
      ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' } });
  });
});
