import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline, authorSymbolPayload } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { authorPackageExpectations } from '../scripts/check-package-artifact.js';
import { expectedAuthorEffect, validateAuthorAdmission } from '../scripts/bench/author-oracle.js';
import { symbolExportName } from '../scripts/lib/symbol-modules.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledGlyph, createCompiledCapabilities } from '../src/ir/symbol-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';
import { sampleMotionGesture, validateMotionGesture } from '../src/core/motion-sampler.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => JSON.parse(readFileSync(new URL(path, new URL('..', import.meta.url)), 'utf8'));
const captured = read('semantics/figma-baseline.json');
const names = ['ellipsis-horizontal', 'chatbubble-ellipses', 'ellipsis-vertical'];
const baseline = loadAuthorBaseline(root, { manifest: { ...captured, counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map(name => [name, captured.icons[name]])) } });
const allAnnotations = read('semantics/author-anatomy.json');
const annotations = { ...allAnnotations, icons: Object.fromEntries(names.filter(name => allAnnotations.icons[name]).map(name => [name, allAnnotations.icons[name]])) };
const contracts = compileAuthorAnatomy(baseline, annotations);
const sources = Object.fromEntries(Object.entries(baseline.icons).map(([icon, variants]) => [icon,
  Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, {
    ...item, sourceContract: contracts[`${icon}/${variant}`] ?? item.sourceContract,
  }])),
]));
const compiler = createGlyphCompiler({ catalog: {
  canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
  icons: Object.fromEntries(Object.entries(sources).map(([icon, variants]) => [icon, {
    model: null, source: { outline: variants.outline.sourceContract, filled: variants.filled.sourceContract },
  }])),
}, anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
staticIcons: Object.fromEntries(Object.entries(sources).flatMap(([icon, variants]) =>
  Object.entries(variants).map(([variant, item]) => [symbolExportName(icon, variant), item.artifactSvg]))),
});
const symbol = icon => {
  const payload = authorSymbolPayload(icon, sources[icon], compiler);
  return { glyph: createCompiledGlyph(payload.icon, payload.source),
    glyphCapabilities: createCompiledCapabilities(payload.capabilities) };
};
const dotIds = ['dot-leading', 'dot-middle', 'dot-trailing'];

describe('activity.triad: exact author anatomy, finite scalar stages', () => {
  it.each(['ellipsis-horizontal/outline', 'ellipsis-horizontal/filled', 'chatbubble-ellipses/outline'])('%s retains independent master and precise capabilities', id => {
    const [icon, variant] = id.split('/');
    const module = symbol(icon), glyph = module.glyph({ variant }), caps = module.glyphCapabilities(variant);
    const record = sources[icon][variant], contract = record.sourceContract;
    const paths = [...record.rawSvg.matchAll(/\bd="([^"]+)"/g)].map(match => match[1]);
    expect(glyph.parts.map(part => part.d)).toEqual(paths);
    expect(glyph.parts.map(part => part.fillRule)).toEqual(contract.parts.map(part => part.fillRule));
    expect(glyph.parts.slice(0, 3).map(part => ({ id: part.id, role: part.role, anchorSource: part.anchorSource })))
      .toEqual(dotIds.map(id => ({ id, role: 'content', anchorSource: 'geometry-bbox-center' })));
    expect(contract.parts.every(part => !Object.hasOwn(part, 'anchor'))).toBe(true);
    expect(caps.modelState).toBeNull();
    expect(caps.supportedAxes).toEqual([]);
    expect(() => module.glyph({ variant, axes: { weight: 1.1 } })).toThrow(expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
    expect(() => validateAuthorAdmission(glyph, caps, record, contract)).not.toThrow();
    const effect = compileSymbolEffect(glyph, caps, `${icon}.activity`, { duration: 360 });
    expect(effect).toMatchObject({ ok: true, effect: { version: 2, targets: dotIds.map(partId => ({ partId, property: 'opacity', from: 1, to: 1 })) } });
    expect(effect.effect.stages).toEqual(expectedAuthorEffect(contract.gestures[0]).stages);
    expect(effect.effect.unchangedPartIds).toEqual(icon === 'chatbubble-ellipses' ? ['bubble'] : []);
    expect(effect.effect.stages.every(stage => Object.keys(stage).sort().join(',') === 'at,duration,partId,property,to')).toBe(true);
    expect(effect.effect.stages.every(stage => Object.isFrozen(stage))).toBe(true);
    expect(effect.effect.targets.every(target => !Object.hasOwn(target, 'style'))).toBe(true);
    const packed = authorPackageExpectations(baseline, annotations)[icon][variant];
    expect(packed.effects[`${icon}.activity`]).toEqual({ version: 2, targets: effect.effect.targets, stages: effect.effect.stages });
    expect(packed.parts.every(part => part.anchorSource === 'geometry-bbox-center' && !Object.hasOwn(part, 'anchor'))).toBe(true);
  });

  it('one law orders loading and typing dots, without moving bubble', () => {
    for (const id of ['ellipsis-horizontal/outline', 'chatbubble-ellipses/outline']) {
      const gesture = contracts[id].gestures[0];
      for (const [progress, leadingIndex] of [[2 / 12, 0], [5 / 12, 1], [8 / 12, 2]]) {
        const samples = sampleMotionGesture(gesture, progress);
        expect(samples.map(sample => sample.opacity)).toEqual(dotIds.map((_, index) => index === leadingIndex ? 1 : 0.35));
        expect(samples.every(sample => sample.kind === 'opacity' && !Object.hasOwn(sample, 'anchor'))).toBe(true);
      }
      expect(sampleMotionGesture(gesture, 0).map(sample => sample.opacity)).toEqual([1, 1, 1]);
      expect(sampleMotionGesture(gesture, 1).map(sample => sample.opacity)).toEqual([1, 1, 1]);
    }
    expect(contracts['ellipsis-horizontal/outline'].parts[0].sourceFingerprint)
      .not.toBe(contracts['ellipsis-horizontal/filled'].parts[0].sourceFingerprint);
  });

  it.each([[0.23, 0.79], [0.79, 0.23], [0.6, 0], [0, 1], [1, 0]])('slices %s → %s into scalar stages with bounded timing and honest origin', (from, to) => {
    const module = symbol('ellipsis-horizontal'), caps = module.glyphCapabilities();
    const result = compileSymbolEffect(module.glyph(), caps, 'ellipsis-horizontal.activity', { duration: 900, from, to });
    expect(result).toMatchObject({ ok: true, effect: { version: 2, from, to, options: { duration: 900 } } });
    const expectedFrom = sampleMotionGesture(caps.motion.gestures[0], from);
    const expectedTo = sampleMotionGesture(caps.motion.gestures[0], to);
    for (const [index, partId] of dotIds.entries()) {
      const stages = result.effect.stages.filter(stage => stage.partId === partId);
      expect(stages[0].at).toBe(0);
      expect(stages.every(stage => stage.to >= 0 && stage.to <= 1 && stage.duration > 0)).toBe(true);
      expect(stages.at(-1).at + stages.at(-1).duration).toBe(900);
      expect(result.effect.targets[index].from).toBe(expectedFrom[index].opacity);
      expect(stages.at(-1).to).toBe(expectedTo[index].opacity);
      for (let n = 1; n < stages.length; n++) expect(stages[n].at).toBe(stages[n - 1].at + stages[n - 1].duration);
    }
  });

  it('idle, reduced motion and seek collapse to honest terminal scalar values', () => {
    const module = symbol('chatbubble-ellipses'), glyph = module.glyph(), caps = module.glyphCapabilities();
    const idle = compileSymbolEffect(glyph, caps, 'chatbubble-ellipses.idle', { duration: 180 });
    expect(idle).toMatchObject({ ok: true, effect: { version: 2, unchangedPartIds: ['bubble'], stages: dotIds.map(partId => ({ partId, property: 'opacity', to: 1, at: 0, duration: 180 })) } });
    for (const request of [{ duration: 900, reducedMotion: true }, { duration: 900, from: 0.4, to: 0.4 }]) {
      const effect = compileSymbolEffect(glyph, caps, 'chatbubble-ellipses.activity', request).effect;
      expect(effect.options.duration).toBe(0);
      expect(effect.stages).toHaveLength(3);
      expect(effect.stages.every(stage => stage.at === 0 && stage.duration === 0)).toBe(true);
      expect(effect.stages.map(stage => stage.to)).toEqual(effect.targets.map(target => target.to));
    }
  });

  it('vertical-menu geometry and compound Filled bubble do not acquire loading by resemblance', () => {
    for (const [icon, variant] of [['ellipsis-vertical', 'outline'], ['ellipsis-vertical', 'filled'], ['chatbubble-ellipses', 'filled']]) {
      const module = symbol(icon);
      expect(module.glyphCapabilities(variant).motion.state).toBe('source-only');
      expect(compileSymbolEffect(module.glyph({ variant }), module.glyphCapabilities(variant), `${icon}.activity`, { duration: 900 }))
        .toMatchObject({ ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' } });
    }
    const invalid = structuredClone(annotations);
    const record = baseline.icons['chatbubble-ellipses'].filled;
    invalid.icons['chatbubble-ellipses'].filled = { ...structuredClone(invalid.icons['chatbubble-ellipses'].outline), masterSha256: record.author.masterSha256, pathFingerprintSha256: record.author.pathFingerprintSha256 };
    expect(() => compileAuthorAnatomy(baseline, invalid)).toThrow(expect.objectContaining({ code: 'PARTS_INVALID' }));
  });

  it.each([
    ['menu purpose', doc => { doc.icons['ellipsis-horizontal'].outline.gesture.purpose = 'menu'; }, 'LAW_SEMANTICS_UNSUPPORTED'],
    ['duplicate dot', doc => { doc.icons['ellipsis-horizontal'].outline.gesture.partIds[1] = 'dot-leading'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
    ['synthetic anchor', doc => { doc.icons['ellipsis-horizontal'].outline.parts[0].anchor = [0.5, 0.5]; }, 'ANNOTATION_INVALID'],
    ['moving shell', doc => { doc.icons['chatbubble-ellipses'].outline.gesture.partIds[2] = 'bubble'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
  ])('annotation refuses %s', (_, mutate, code) => {
    const invalid = structuredClone(annotations); mutate(invalid);
    expect(() => compileAuthorAnatomy(baseline, invalid)).toThrow(expect.objectContaining({ code }));
  });

  it.each([
    ['unordered stops', track => { track.stops[1].at = 0; }],
    ['nonfinite stop', track => { track.stops[1].value = NaN; }],
    ['opacity outside range', track => { track.stops[1].value = -0.1; }],
    ['missing endpoint', track => { track.stops.pop(); }],
    ['invented units', track => { track.unit = 'degrees'; }],
    ['unused anchor', track => { track.anchor = [0.5, 0.5]; }],
  ])('grammar refuses %s before compilation', (_, mutate) => {
    const module = symbol('ellipsis-horizontal'), caps = module.glyphCapabilities();
    const gesture = structuredClone(caps.motion.gestures[0]); mutate(gesture.tracks[0]);
    expect(() => validateMotionGesture(gesture)).toThrow();
    expect(compileSymbolEffect(module.glyph(), { ...caps, motion: { ...caps.motion, gestures: [gesture] } }, gesture.id, { duration: 900 }))
      .toMatchObject({ ok: false, reason: { code: 'INVALID_GESTURE' } });
  });
});
