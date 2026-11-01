import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline, authorSymbolPayload } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { symbolExportName } from '../scripts/lib/symbol-modules.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledGlyph, createCompiledCapabilities } from '../src/ir/symbol-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';
import { sampleMotionGesture } from '../src/core/motion-sampler.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => JSON.parse(readFileSync(new URL(path, new URL('..', import.meta.url)), 'utf8'));
const manifest = read('semantics/figma-baseline.json');
const names = ['volume-high', 'volume-middle', 'volume-low', 'volume-mute', 'volume-muted'];
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest,
  counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map(name => [name, manifest.icons[name]])),
} });
const stored = read('semantics/author-anatomy.json');
const document = { ...stored, icons: {
  'volume-high': stored.icons['volume-high'], 'volume-middle': stored.icons['volume-middle'],
} };
const accepted = [['volume-high', 'outline', 3], ['volume-high', 'filled', 3], ['volume-middle', 'filled', 2]];
const rawPaths = svg => [...svg.matchAll(/<path\b([^>]*)>/g)].map(([tag]) => ({
  d: /\bd="([^"]+)"/.exec(tag)[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
}));
const bandValue = (count, index, level) => Math.min(1, Math.max(0, count * level - index));

function effectOpacity(effect, partId, elapsed) {
  let value = effect.targets.find(target => target.partId === partId).from;
  for (const stage of effect.stages.filter(stage => stage.partId === partId)) {
    if (elapsed < stage.at) break;
    if (elapsed <= stage.at + stage.duration) {
      return stage.duration === 0 ? stage.to : value + (stage.to - value) * (elapsed - stage.at) / stage.duration;
    }
    value = stage.to;
  }
  return value;
}

function consumer() {
  const annotations = compileAuthorAnatomy(baseline, document);
  const sources = Object.fromEntries(Object.entries(baseline.icons).map(([icon, variants]) => [icon,
    Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, {
      ...item, sourceContract: annotations[`${icon}/${variant}`] ?? item.sourceContract,
    }])),
  ]));
  const compiler = createGlyphCompiler({
    catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
      icons: Object.fromEntries(Object.entries(sources).map(([icon, variants]) => [icon, {
        model: null, source: Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, item.sourceContract])),
      }])),
    }, anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
    staticIcons: Object.fromEntries(Object.entries(sources).flatMap(([icon, variants]) =>
      Object.entries(variants).map(([variant, item]) => [symbolExportName(icon, variant), item.artifactSvg]))),
  });
  return Object.fromEntries(names.map(icon => {
    const payload = authorSymbolPayload(icon, sources[icon], compiler);
    return [icon, { glyph: createCompiledGlyph(payload.icon, payload.source),
      glyphCapabilities: createCompiledCapabilities(payload.capabilities) }];
  }));
}

function errorCode(changed, expected) {
  try { compileAuthorAnatomy(baseline, changed); throw new Error('false signal admission'); }
  catch (error) { expect(error.code).toBe(expected); }
}

describe('signal.levels: независимые авторские полосы уровня volume', () => {
  it.each(accepted)('сохраняет raw master %s/%s и объявляет только независимые полосы', (icon, variant, count) => {
    const symbol = consumer()[icon];
    const glyph = symbol.glyph({ variant });
    const caps = symbol.glyphCapabilities(variant);
    const expected = rawPaths(baseline.icons[icon][variant].rawSvg);
    expect(glyph.parts.map(({ d, fillRule }) => ({ d, fillRule }))).toEqual(expected);
    const ids = icon === 'volume-high' ? ['wave-far', 'wave-middle', 'speaker', 'wave-near'] : ['wave-far', 'speaker', 'wave-near'];
    expect(glyph.parts.map(part => part.id)).toEqual(ids);
    expect(glyph.parts.map(part => part.zIndex)).toEqual(expected.map((_, index) => index));
    expect(glyph.parts.find(part => part.id === 'speaker').role).toBe('container');
    expect(glyph.parts.every(part => part.anchorSource === 'geometry-bbox-center')).toBe(true);
    expect(glyph.provenance.author).toEqual(baseline.icons[icon][variant].author);
    expect(glyph.provenance.kind).toBe('source');
    expect(caps.modelState).toBeNull();
    expect(caps.supportedAxes).toEqual([]);
    expect(caps.axes).toEqual({});
    expect(symbol.glyph({ variant, modelMode: 'source-only' })).toBe(glyph);
    expect(() => symbol.glyph({ variant, axes: { weight: 1.2 } })).toThrow(expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
    const gesture = caps.motion.gestures[0];
    expect(gesture).toMatchObject({ id: `${icon}.level`, kind: 'state', restProgress: 1 });
    expect(gesture.partIds).toHaveLength(count);
    expect(gesture.partIds).toEqual(icon === 'volume-high' ? ['wave-near', 'wave-middle', 'wave-far'] : ['wave-near', 'wave-far']);
    expect(gesture.tracks.every(track => track.kind === 'opacity' && !('anchor' in track))).toBe(true);
    for (let sample = 0; sample <= 24; sample++) {
      const level = sample / 24;
      const observed = sampleMotionGesture(gesture, level);
      observed.forEach((track, index) => expect(track.opacity).toBeCloseTo(bandValue(count, index, level), 12));
      expect(observed.every((track, index) => index === 0 || observed[index - 1].opacity >= track.opacity)).toBe(true);
    }
    expect(sampleMotionGesture(gesture, 1).map(track => track.opacity)).toEqual(Array(count).fill(1));
    expect(sampleMotionGesture(gesture, 0).map(track => track.opacity)).toEqual(Array(count).fill(0));
  });

  it.each(accepted)('production effect %s/%s: rest1, reverse/seek/reduced и неподвижный speaker', (icon, variant, count) => {
    const symbol = consumer()[icon];
    const glyph = symbol.glyph({ variant });
    const caps = symbol.glyphCapabilities(variant);
    for (const [from, to] of [[1, 0.4], [0.4, 0.8], [0.8, 0], [0, 1]]) {
      const result = compileSymbolEffect(glyph, caps, `${icon}.level`, { duration: 600, from, to });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.effect.version).toBe(2);
      expect(result.effect.unchangedPartIds).toEqual(['speaker']);
      result.effect.targets.forEach((target, index) => {
        expect(target.from).toBeCloseTo(bandValue(count, index, from), 12);
        expect(target.to).toBeCloseTo(bandValue(count, index, to), 12);
        const stages = result.effect.stages.filter(stage => stage.partId === target.partId);
        expect(stages[0].at).toBe(0);
        expect(stages.at(-1).at + stages.at(-1).duration).toBe(600);
        expect(stages.at(-1).to).toBeCloseTo(bandValue(count, index, to), 12);
        expect(stages.every(stage => stage.property === 'opacity' && stage.duration > 0)).toBe(true);
        for (let sample = 0; sample <= 12; sample++) {
          const elapsed = sample * 50;
          expect(effectOpacity(result.effect, target.partId, elapsed)).toBeCloseTo(bandValue(count, index, from + (to - from) * elapsed / 600), 12);
        }
      });
    }
    for (const request of [{ duration: 600, from: 1, to: 0.2, reducedMotion: true }, { duration: 600, from: 0.2, to: 0.2 }]) {
      const result = compileSymbolEffect(glyph, caps, `${icon}.level`, request);
      expect(result).toMatchObject({ ok: true, effect: { version: 2, options: { duration: 0 }, unchangedPartIds: ['speaker'] } });
      if (!result.ok) continue;
      expect(result.effect.stages).toHaveLength(count);
      result.effect.stages.forEach(stage => {
        const index = caps.motion.gestures[0].partIds.indexOf(stage.partId);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(stage).toMatchObject({ at: 0, duration: 0, property: 'opacity' });
        expect(stage.to).toBeCloseTo(bandValue(count, index, request.to), 12);
      });
    }
    expect(compileSymbolEffect(glyph, caps, `${icon}.draw`, { duration: 600 })).toMatchObject({ ok: false, reason: { code: 'GESTURE_UNSUPPORTED' } });
    expect(compileSymbolEffect({ ...glyph, composition: { kind: 'compound', fillRule: 'evenodd' } }, caps, `${icon}.level`, { duration: 600 })).toMatchObject({ ok: false, reason: { code: 'COMPOSITION_NOT_ADDRESSABLE' } });
  });

  it('middle Outline far body0 + cap3 — две paths одной полосы; flat opacity не получает admission', () => {
    const raw = rawPaths(baseline.icons['volume-middle'].outline.rawSvg);
    expect(raw).toHaveLength(4);
    expect(raw[0].d).toContain('M19.976 5.33102');
    expect(raw[0].d).toContain('L19.976 5.33102Z');
    expect(raw[3].d).toContain('19.976 5.33102L18.6147 6.50974');
    expect(document.icons['volume-middle'].outline).toBeUndefined();
    const symbol = consumer()['volume-middle'];
    expect(symbol.glyph().parts.map(({ d, fillRule }) => ({ d, fillRule }))).toEqual(raw);
    expect(symbol.glyphCapabilities().motion.state).toBe('source-only');
    expect(compileSymbolEffect(symbol.glyph(), symbol.glyphCapabilities(), 'volume-middle.level', { duration: 600 })).toMatchObject({ ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' } });
  });

  it('low/mute/slash остаются независимыми master, не получают level или morph по сходству имени', () => {
    const symbols = consumer();
    for (const icon of ['volume-low', 'volume-mute', 'volume-muted']) for (const variant of ['outline', 'filled']) {
      const glyph = symbols[icon].glyph({ variant });
      const caps = symbols[icon].glyphCapabilities(variant);
      expect(glyph.parts.map(({ d, fillRule }) => ({ d, fillRule }))).toEqual(rawPaths(baseline.icons[icon][variant].rawSvg));
      expect(caps.motion.state).toBe('source-only');
      expect(compileSymbolEffect(glyph, caps, `${icon}.level`, { duration: 600 })).toMatchObject({ ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' } });
    }
    const highSpeaker = symbols['volume-high'].glyph({ variant: 'filled' }).parts.find(part => part.id === 'speaker').d;
    expect(highSpeaker).not.toBe(rawPaths(baseline.icons['volume-low'].filled.rawSvg)[0].d);
  });

  it('отказывает ложному purpose, speaker/content ID, незакрытой/compound полосе и неподдержанной группе', () => {
    for (const [change, code] of [
      [entry => { entry.gesture.purpose = 'mute'; }, 'LAW_SEMANTICS_UNSUPPORTED'],
      [entry => { entry.gesture.partIds[0] = 'speaker'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
      [entry => { entry.gesture.containerPartId = 'wave-near'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
      [entry => { entry.gesture.partIds[0] = 'missing'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
      [entry => { entry.gesture.partIds[1] = entry.gesture.partIds[0]; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
      [entry => { entry.gesture.partIds.pop(); }, 'LAW_TOPOLOGY_UNSUPPORTED'],
      [entry => { entry.parts[3].role = 'container'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
      [entry => { entry.gesture.partIds[1] = ['wave-middle', 'wave-far']; }, 'LAW_COMPOSITION_UNSUPPORTED'],
    ]) {
      const changed = structuredClone(document); change(changed.icons['volume-high'].outline);
      errorCode(changed, code);
    }
    for (const topologySignature of ['MLL', 'MCCZ|MCCZ']) {
      const altered = structuredClone(baseline);
      altered.icons['volume-high'].outline.sourceContract.parts[3].topologySignature = topologySignature;
      expect(() => compileAuthorAnatomy(altered, document)).toThrow(expect.objectContaining({ code: 'LAW_TOPOLOGY_UNSUPPORTED' }));
    }
  });
});
