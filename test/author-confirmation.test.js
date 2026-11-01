import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline, authorSymbolPayload } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { compileLottieGeometry } from '../scripts/lib/lottie-geometry.js';
import { symbolExportName } from '../scripts/lib/symbol-modules.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledGlyph, createCompiledCapabilities } from '../src/ir/symbol-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';
import { createLottieSymbol } from '../src/lottie/runtime.js';
import { sampleMotionGesture } from '../src/core/motion-sampler.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(new URL(file, new URL('..', import.meta.url)), 'utf8'));
const manifest = read('semantics/figma-baseline.json');
const names = ['checkmark', 'checkmark-circle', 'cloud-checkmark', 'shield-checkmark', 'link-horizontal-off'];
const accepted = [['checkmark', 'outline'], ['checkmark', 'filled'],
  ['checkmark-circle', 'outline'], ['cloud-checkmark', 'outline'], ['shield-checkmark', 'outline']];
const enclosed = ['checkmark-circle', 'cloud-checkmark', 'shield-checkmark'];
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest,
  counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map(name => [name, manifest.icons[name]])),
} });
const allAnnotations = read('semantics/author-anatomy.json');
const document = { ...allAnnotations,
  icons: Object.fromEntries(names.filter(name => name !== 'link-horizontal-off').map(name => [name, allAnnotations.icons[name]])) };
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
const consumers = Object.fromEntries(names.map(icon => {
  const payload = authorSymbolPayload(icon, sources[icon], compiler);
  const symbol = { glyph: createCompiledGlyph(payload.icon, payload.source),
    glyphCapabilities: createCompiledCapabilities(payload.capabilities) };
  const lottie = createLottieSymbol(symbol, Object.fromEntries(['outline', 'filled'].map(variant =>
    [variant, compileLottieGeometry(payload.source[variant])])));
  return [icon, { symbol, lottie }];
}));

// Oracle читает raw master непосредственно, минуя production parser/assembler.
const rawPaths = svg => [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
  d: /\bd="([^"]+)"/.exec(tag)[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
}));

describe('confirmation.presence: внутренние состояния авторской отметки', () => {
  it.each(accepted)('%s/%s сохраняет raw geometry и неподвижную оболочку', (icon, variant) => {
    const { symbol } = consumers[icon];
    const glyph = symbol.glyph({ variant }), caps = symbol.glyphCapabilities(variant);
    const original = rawPaths(baseline.icons[icon][variant].rawSvg);
    expect(glyph.parts.map(({ d, fillRule }) => ({ d, fillRule }))).toEqual(original);
    expect(rawPaths(glyph.svg)).toEqual(original);
    expect(glyph.parts.map(part => part.zIndex)).toEqual(original.map((_, index) => index));
    expect(glyph.parts.map(part => part.id)).toEqual(icon === 'checkmark'
      ? ['confirmation-mark'] : ['confirmation-mark', 'confirmation-enclosure']);
    expect(glyph.provenance.author).toEqual(baseline.icons[icon][variant].author);
    expect(caps.modelState).toBeNull();
    expect(caps.supportedAxes).toEqual([]);
    expect(() => symbol.glyph({ variant, axes: { weight: 1.2 } })).toThrow(
      expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
    const gesture = caps.motion.gestures[0];
    expect(gesture).toMatchObject({ id: `${icon}.presence`, kind: 'state', restProgress: 1,
      partIds: ['confirmation-mark'] });
    for (const progress of [0, 0.125, 0.5, 0.875, 1]) {
      expect(sampleMotionGesture(gesture, progress)).toEqual([
        { partId: 'confirmation-mark', kind: 'opacity', opacity: progress },
      ]);
    }
    expect(symbol.glyph({ variant })).toBe(glyph);
    expect(Object.isFrozen(gesture.tracks[0].stops[0])).toBe(true);
  });

  it.each(accepted)('%s/%s использует существующий v2 effect для подтверждения/обратного состояния', (icon, variant) => {
    const { symbol } = consumers[icon];
    const glyph = symbol.glyph({ variant }), caps = symbol.glyphCapabilities(variant);
    const geometryBefore = glyph.parts.map(({ d, fillRule, zIndex }) => ({ d, fillRule, zIndex }));
    for (const [from, to] of [[0, 1], [1, 0], [0.37, 0.8], [0.8, 0.2]]) {
      const result = compileSymbolEffect(glyph, caps, `${icon}.presence`, { duration: 600, from, to });
      expect(result).toMatchObject({ ok: true, effect: { version: 2,
        targets: [{ partId: 'confirmation-mark', property: 'opacity', from, to }],
        unchangedPartIds: icon === 'checkmark' ? [] : ['confirmation-enclosure'],
        stages: [{ partId: 'confirmation-mark', property: 'opacity', at: 0, duration: 600, to }],
      } });
      expect(glyph.parts.map(({ d, fillRule, zIndex }) => ({ d, fillRule, zIndex }))).toEqual(geometryBefore);
    }
    for (const [from, to] of [[1, 0], [0, 1], [0.4, 0.4]]) {
      const result = compileSymbolEffect(glyph, caps, `${icon}.presence`, { duration: 600, from, to, reducedMotion: true });
      expect(result).toMatchObject({ ok: true, effect: { version: 2, options: { duration: 0 },
        stages: [{ partId: 'confirmation-mark', property: 'opacity', at: 0, duration: 0, to }] } });
    }
    expect(compileSymbolEffect(glyph, caps, `${icon}.draw`, { duration: 600 })).toMatchObject({
      ok: false, reason: { code: 'GESTURE_UNSUPPORTED' },
    });
  });

  it.each(accepted)('%s/%s экспортирует тот же presence law в Lottie, не создавая TrimPath', (icon, variant) => {
    const { lottie, symbol } = consumers[icon];
    const source = symbol.glyph({ variant });
    for (const [from, to] of [[0, 1], [1, 0], [0.37, 0.8]]) {
      const result = lottie.exportLottie({ variant, gesture: `${icon}.presence`, duration: 1000, from, to });
      expect(result.ok).toBe(true);
      const animation = result.animation;
      const mark = animation.layers.find(layer => layer.nm === 'confirmation-mark');
      expect(mark.ks.o.a).toBe(1);
      expect(mark.ks.o.k[0].s).toEqual([from * 100]);
      expect(mark.ks.o.k.at(-1).s).toEqual([to * 100]);
      expect(mark.ks.o.k.at(-1).t).toBe(60);
      expect(animation.layers.flatMap(layer => layer.shapes).some(shape => shape.ty === 'tm')).toBe(false);
      expect(animation.meta.labIcons.masterSha256).toBe(source.provenance.author.masterSha256);
      if (icon !== 'checkmark') {
        const enclosure = animation.layers.find(layer => layer.nm === 'confirmation-enclosure');
        expect(enclosure.ks.o).toEqual({ a: 0, k: 100 });
        expect(enclosure.shapes.filter(shape => shape.ty === 'sh')).toHaveLength(2);
        expect(enclosure.shapes.at(-1).r).toBe(2);
      }
    }
  });

  it.each(enclosed)('%s Filled: body и negative mark-hole сохраняются, presence не приписывается', icon => {
    const { symbol, lottie } = consumers[icon];
    const glyph = symbol.glyph({ variant: 'filled' }), caps = symbol.glyphCapabilities('filled');
    expect(rawPaths(baseline.icons[icon].filled.rawSvg)).toHaveLength(1);
    expect(glyph.parts[0].fillRule).toBe('evenodd');
    expect(glyph.parts[0].topologySignature.split('|')).toHaveLength(2);
    expect(caps.motion.state).toBe('source-only');
    expect(compileSymbolEffect(glyph, caps, `${icon}.presence`, { duration: 600 })).toMatchObject({
      ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' },
    });
    expect(lottie.exportLottie({ variant: 'filled', gesture: `${icon}.presence`, duration: 1000 })).toMatchObject({
      ok: false, reason: { code: 'MOTION_UNAVAILABLE' },
    });
    const invalid = structuredClone(document), master = baseline.icons[icon].filled;
    invalid.icons[icon].filled = { masterSha256: master.author.masterSha256,
      pathFingerprintSha256: master.author.pathFingerprintSha256,
      parts: [{ pathIndex: 0, id: 'confirmation-mark', role: 'content' }],
      gesture: { law: 'confirmation.presence', purpose: 'confirmation', partId: 'confirmation-mark' } };
    expect(() => compileAuthorAnatomy(baseline, invalid)).toThrow(
      expect.objectContaining({ code: 'LAW_TOPOLOGY_UNSUPPORTED' }));
  });

  it('off-суффикс не назначает slash или confirmation: link-horizontal-off имеет две самостоятельные chain paths', () => {
    const { symbol } = consumers['link-horizontal-off'];
    expect(rawPaths(baseline.icons['link-horizontal-off'].outline.rawSvg)).toHaveLength(2);
    expect(annotations['link-horizontal-off/outline']).toBeUndefined();
    expect(compileSymbolEffect(symbol.glyph(), symbol.glyphCapabilities(), 'link-horizontal-off.presence', { duration: 600 })).toMatchObject({
      ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' },
    });
  });

  it.each([
    ['неподходящий смысл', value => { value.icons.checkmark.outline.gesture.purpose = 'loading'; }, 'LAW_SEMANTICS_UNSUPPORTED'],
    ['чужая часть', value => { value.icons.checkmark.outline.gesture.partId = 'missing'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
    ['анимация оболочки', value => { value.icons['checkmark-circle'].outline.gesture.partId = 'confirmation-enclosure'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
    ['вторая движущаяся часть', value => { value.icons['checkmark-circle'].outline.parts[1].role = 'content'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
    ['stale master', value => { value.icons.checkmark.outline.masterSha256 = '0'.repeat(64); }, 'MASTER_MISMATCH'],
    ['stale source', value => { value.source.version = '1'; }, 'SOURCE_MISMATCH'],
  ])('точный отказ: %s', (_, mutate, code) => {
    const invalid = structuredClone(document);
    mutate(invalid);
    expect(() => compileAuthorAnatomy(baseline, invalid)).toThrow(expect.objectContaining({ code }));
  });
});
