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
const stored = read('semantics/author-anatomy.json');
const names = ['notifications', 'notifications-unread', 'notifications-off'];
const accepted = names.slice(0, 2).flatMap(name => ['outline', 'filled'].map(variant => [name, variant]));
const ids = {
  'notifications/outline': ['notification-bell', 'notification-clapper'],
  'notifications/filled': ['notification-clapper', 'notification-bell'],
  'notifications-unread/outline': ['notification-bell-fragment-1', 'notification-bell-fragment-2',
    'notification-bell-fragment-3', 'notification-clapper', 'notification-badge'],
  'notifications-unread/filled': ['notification-clapper', 'notification-bell', 'notification-badge'],
};
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest,
  counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map(name => [name, manifest.icons[name]])),
} });
const declaration = (name, variant) => ({
  masterSha256: baseline.icons[name][variant].author.masterSha256,
  pathFingerprintSha256: baseline.icons[name][variant].author.pathFingerprintSha256,
  parts: ids[`${name}/${variant}`].map((id, pathIndex) => ({ pathIndex, id,
    role: id === 'notification-clapper' ? 'content' : 'container' })),
  gesture: { law: 'notification.ring', purpose: 'incoming-notification', partId: 'notification-clapper' },
});
const document = { ...stored, icons: Object.fromEntries(names.slice(0, 2).map(name => [name,
  Object.fromEntries(['outline', 'filled'].map(variant => [variant, declaration(name, variant)]))])) };
const rawPaths = svg => [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
  d: /\bd="([^"]+)"/.exec(tag)[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
}));

// Независимый oracle шести raw cubic clapper: экстремумы Bernstein-полинома,
// без production parser/bbox, normalized SVG или скомпилированных tracks.
function rawClapperWidth(d) {
  const commands = d.replace(/[^A-Za-z]/g, '');
  expect(commands).toMatch(/^MCCCCCC[HL]Z$/);
  const values = d.match(/[-+]?(?:\d*\.\d+|\d+)(?:e[-+]?\d+)?/gi).map(Number);
  expect(values).toHaveLength(commands.includes('H') ? 39 : 40);
  const points = [values[0], values[38]];
  let x = values[0];
  for (let i = 2; i < 38; i += 6) {
    const p = [x, values[i], values[i + 2], values[i + 4]];
    const a = -p[0] + 3 * p[1] - 3 * p[2] + p[3];
    const b = 2 * (p[0] - 2 * p[1] + p[2]), c = p[1] - p[0];
    const roots = a === 0 ? (b === 0 ? [] : [-c / b]) :
      b * b - 4 * a * c < 0 ? [] : [(-b + Math.sqrt(b * b - 4 * a * c)) / (2 * a),
        (-b - Math.sqrt(b * b - 4 * a * c)) / (2 * a)];
    for (const t of [0, 1, ...roots.filter(t => t > 0 && t < 1)]) {
      points.push((1 - t) ** 3 * p[0] + 3 * (1 - t) ** 2 * t * p[1] +
        3 * (1 - t) * t ** 2 * p[2] + t ** 3 * p[3]);
    }
    x = p[3];
  }
  return Math.max(...points) - Math.min(...points);
}
const factors = [0, 1, -1, 0.5, -0.5, 0];
function ringAt(progress) {
  if (progress === 1) return 0;
  const phase = progress * 5, i = Math.floor(phase), t = phase - i;
  return factors[i] * (1 - t) + factors[i + 1] * t;
}

function consumers() {
  const anatomy = compileAuthorAnatomy(baseline, document);
  const sources = Object.fromEntries(Object.entries(baseline.icons).map(([name, variants]) => [name,
    Object.fromEntries(Object.entries(variants).map(([variant, source]) => [variant,
      { ...source, sourceContract: anatomy[`${name}/${variant}`] ?? source.sourceContract }]))]));
  const compiler = createGlyphCompiler({ catalog: {
    canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
    icons: Object.fromEntries(Object.entries(sources).map(([name, variants]) => [name, { model: null,
      source: Object.fromEntries(Object.entries(variants).map(([variant, source]) => [variant, source.sourceContract])) }])),
  }, anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
  staticIcons: Object.fromEntries(Object.entries(sources).flatMap(([name, variants]) => Object.entries(variants)
    .map(([variant, source]) => [symbolExportName(name, variant), source.artifactSvg]))),
  });
  return Object.fromEntries(names.map(name => {
    const payload = authorSymbolPayload(name, sources[name], compiler);
    const symbol = { glyph: createCompiledGlyph(payload.icon, payload.source),
      glyphCapabilities: createCompiledCapabilities(payload.capabilities) };
    const lottie = createLottieSymbol(symbol, Object.fromEntries(['outline', 'filled'].map(variant =>
      [variant, compileLottieGeometry(payload.source[variant])])));
    return [name, { symbol, lottie }];
  }));
}

describe('notification.ring: явное входящее уведомление без выдуманного шарнира', () => {
  it('принимает ровно четыре сохранённых авторских аннотации', () => {
    expect(Object.keys(compileAuthorAnatomy(baseline, document))).toHaveLength(4);
    for (const [name, variant] of accepted) expect(stored.icons[name]?.[variant]).toEqual(declaration(name, variant));
    expect(stored.icons['notifications-off']).toBeUndefined();
  });

  it.each(accepted)('%s/%s сохраняет raw master, z-order и четверть ширины clapper', (name, variant) => {
    const { symbol } = consumers()[name];
    const glyph = symbol.glyph({ variant }), caps = symbol.glyphCapabilities(variant);
    const raw = rawPaths(baseline.icons[name][variant].rawSvg);
    expect(glyph.parts.map(({ d, fillRule }) => ({ d, fillRule }))).toEqual(raw);
    expect(rawPaths(glyph.svg)).toEqual(raw);
    expect(glyph.parts.map(part => part.id)).toEqual(ids[`${name}/${variant}`]);
    expect(glyph.parts.map(part => part.zIndex)).toEqual(raw.map((_, index) => index));
    expect(glyph.provenance.author).toEqual(baseline.icons[name][variant].author);
    expect(caps.supportedAxes).toEqual([]);
    const clapper = glyph.parts.find(part => part.id === 'notification-clapper');
    const amplitude = rawClapperWidth(raw[clapper.zIndex].d) / 4;
    // Общий GlyphIR сохраняет bbox metadata; ring не объявляет и не использует pivot.
    expect(clapper.anchorSource).toBe('geometry-bbox-center');
    expect(declaration(name, variant).parts[clapper.zIndex]).not.toHaveProperty('anchor');
    const gesture = caps.motion.gestures[0];
    expect(gesture).toMatchObject({ id: `${name}.ring`, kind: 'cycle', restProgress: 0,
      partIds: ['notification-clapper'], tracks: [{ kind: 'translate', axis: 'x', unit: 'viewBox' }] });
    expect(gesture.tracks[0].stops.map(stop => stop.at)).toEqual([0, 0.2, 0.4, 0.6, 0.8, 1]);
    expect(gesture.tracks[0]).not.toHaveProperty('anchor');
    for (let i = 0; i <= 10; i++) {
      const samples = sampleMotionGesture(gesture, i / 10);
      expect(samples).toHaveLength(1);
      expect(samples[0]).toMatchObject({ partId: 'notification-clapper', kind: 'translate', axis: 'x' });
      expect(samples[0].translation).toBeCloseTo(amplitude * ringAt(i / 10), 11);
    }
    expect(Object.isFrozen(gesture.tracks[0].stops[1])).toBe(true);
    expect(() => symbol.glyph({ variant, axes: { opsz: 16 } })).toThrow(
      expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
  });

  it.each(accepted)('%s/%s сохраняет фазы reverse, неподвижные части и reduced terminal', (name, variant) => {
    const { symbol } = consumers()[name];
    const glyph = symbol.glyph({ variant }), caps = symbol.glyphCapabilities(variant);
    const fixed = glyph.parts.filter(part => part.id !== 'notification-clapper');
    const amplitude = rawClapperWidth(rawPaths(baseline.icons[name][variant].rawSvg)
      [glyph.parts.find(part => part.id === 'notification-clapper').zIndex].d) / 4;
    for (const [from, to] of [[0, 1], [1, 0], [0.13, 0.87], [0.87, 0.13]]) {
      const result = compileSymbolEffect(glyph, caps, `${name}.ring`, { duration: 1000, from, to });
      expect(result).toMatchObject({ ok: true, effect: { version: 3, unchangedPartIds: fixed.map(part => part.id),
        targets: [{ partId: 'notification-clapper', property: 'x', unit: 'viewBox' }] } });
      const effect = result.effect;
      expect(effect.targets[0].from).toBeCloseTo(amplitude * ringAt(from), 11);
      expect(effect.targets[0].to).toBeCloseTo(amplitude * ringAt(to), 11);
      expect(effect.stages.every(stage => stage.partId === 'notification-clapper')).toBe(true);
      expect(effect.stages.at(-1).at + effect.stages.at(-1).duration).toBe(1000);
      for (const part of fixed) expect(glyph.parts.find(item => item.id === part.id)).toBe(part);
    }
    const a = compileSymbolEffect(glyph, caps, `${name}.ring`, { duration: 1000, from: 0.3, to: 0 }).effect;
    const b = compileSymbolEffect(glyph, caps, `${name}.ring`, { duration: 1000, from: 0.7, to: 0 }).effect;
    expect(a.targets[0].from).toBeCloseTo(0, 11); expect(b.targets[0].from).toBeCloseTo(0, 11);
    expect(a.stages[0].to).toBeCloseTo(amplitude, 11);
    expect(b.stages[0].to).toBeCloseTo(amplitude / 2, 11);
    for (const to of [0, 0.5, 1]) {
      const reduced = compileSymbolEffect(glyph, caps, `${name}.ring`, { duration: 1000, from: 0.37, to, reducedMotion: true });
      expect(reduced).toMatchObject({ ok: true, effect: { options: { duration: 0 },
        unchangedPartIds: fixed.map(part => part.id), stages: [{ at: 0, duration: 0 }] } });
      expect(reduced.effect.stages[0].to).toBeCloseTo(amplitude * ringAt(to), 11);
    }
  });

  it.each(accepted)('%s/%s экспортирует точные статические curves и тот же цикл в Lottie', (name, variant) => {
    const { symbol, lottie } = consumers()[name];
    const glyph = symbol.glyph({ variant });
    const amplitude = rawClapperWidth(rawPaths(baseline.icons[name][variant].rawSvg)
      [glyph.parts.find(part => part.id === 'notification-clapper').zIndex].d) / 4;
    const staticAnimation = lottie.exportLottie({ variant }).animation;
    for (const [from, to] of [[0, 1], [1, 0], [0.13, 0.87], [0.87, 0.13]]) {
      const result = lottie.exportLottie({ variant, gesture: `${name}.ring`, duration: 1000, from, to });
      expect(result.ok).toBe(true);
      const animation = result.animation, offset = animation.meta.labIcons.offset;
      expect(animation.layers.map(layer => layer.nm).reverse()).toEqual(ids[`${name}/${variant}`]);
      expect(animation.meta.labIcons.masterSha256).toBe(glyph.provenance.author.masterSha256);
      for (const layer of animation.layers) {
        expect(layer.shapes).toEqual(staticAnimation.layers.find(item => item.nm === layer.nm).shapes);
        expect(layer.ks.o).toEqual({ a: 0, k: 100 }); expect(layer.ks.r).toEqual({ a: 0, k: 0 });
        expect(layer.ks.a).toEqual({ a: 0, k: [0, 0, 0] });
        if (layer.nm !== 'notification-clapper') {
          expect(layer.ks.p.a).toBe(0);
          expect(layer.ks.p.k[0] - offset[0]).toBe(0);
          expect(layer.ks.p.k[1] - offset[1]).toBe(0);
          expect(layer.ks.p.k[2]).toBe(0);
        }
        else for (const frame of layer.ks.p.k) {
          expect(frame.s[0] - offset[0]).toBeCloseTo(amplitude * ringAt(from + (to - from) * frame.t / 60), 11);
          expect(frame.s[1] - offset[1]).toBe(0);
          expect(frame.s[2]).toBe(0);
        }
      }
      expect(animation.layers.find(layer => layer.nm === 'notification-clapper').ks.p.k.at(-1).t).toBe(60);
    }
    const reduced = lottie.exportLottie({ variant, gesture: `${name}.ring`, duration: 1000, to: 0.5, reducedMotion: true });
    expect(reduced.animation.op).toBe(1);
    expect(reduced.animation.layers.every(layer => layer.ks.p.a === 0)).toBe(true);
    expect(reduced.animation.layers.find(layer => layer.nm === 'notification-clapper').ks.p.k[0] -
      reduced.animation.meta.labIcons.offset[0]).toBeCloseTo(-amplitude / 4, 11);
    expect(lottie.exportLottie({ variant, gesture: `${name}.ring`, to: 2 })).toMatchObject({
      ok: false, reason: { code: 'INVALID_REQUEST' } });
  });

  it.each(['outline', 'filled'])('notifications-off/%s: геометрия clapper не назначает ring', variant => {
    const { symbol, lottie } = consumers()['notifications-off'];
    expect(symbol.glyphCapabilities(variant).motion.state).toBe('source-only');
    expect(compileSymbolEffect(symbol.glyph({ variant }), symbol.glyphCapabilities(variant),
      'notifications-off.ring', { duration: 1000 })).toMatchObject({
      ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' } });
    expect(lottie.exportLottie({ variant, gesture: 'notifications-off.ring' })).toMatchObject({
      ok: false, reason: { code: 'MOTION_UNAVAILABLE' } });
  });

  it.each([
    ['compound', topology => `${topology}|MLLZ`],
    ['open', topology => topology.slice(0, -1)],
  ])('nonzero %s clapper получает отказ на границе source contract', (_, changeTopology) => {
    const original = baseline.icons.notifications.filled.sourceContract.parts[0];
    expect(original.fillRule).toBe('nonzero');
    expect(original.topologySignature).not.toContain('|');
    expect(original.topologySignature.endsWith('Z')).toBe(true);
    expect(compileAuthorAnatomy(baseline, document)['notifications/filled'].gestures).toHaveLength(1);
    // Меняется только topology: даже правильный fill и отдельная content роль
    // не допускают составной или открытый путь как один закрытый язычок.
    const invalidSource = structuredClone(baseline);
    invalidSource.icons.notifications.filled.sourceContract.parts[0].topologySignature =
      changeTopology(original.topologySignature);
    expect(() => compileAuthorAnatomy(invalidSource, document)).toThrow(
      expect.objectContaining({ code: 'LAW_TOPOLOGY_UNSUPPORTED' }));
  });

  it.each([
    ['muted', value => { value.icons.notifications.outline.gesture.purpose = 'muted'; }, 'LAW_SEMANTICS_UNSUPPORTED'],
    ['disabled', value => { value.icons.notifications.outline.gesture.purpose = 'disabled'; }, 'LAW_SEMANTICS_UNSUPPORTED'],
    ['без смысла', value => { value.icons.notifications.outline.gesture.purpose = undefined; }, 'LAW_SEMANTICS_UNSUPPORTED'],
    ['несуществующая часть', value => { value.icons.notifications.outline.gesture.partId = 'missing'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
    ['вторая content часть', value => { value.icons.notifications.outline.parts[0].role = 'content'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
    ['перемещение compound bell', value => {
      value.icons.notifications.outline.gesture.partId = 'notification-bell';
      value.icons.notifications.outline.parts[0].role = 'content';
      value.icons.notifications.outline.parts[1].role = 'container';
    }, 'LAW_TOPOLOGY_UNSUPPORTED'],
    ['per-icon amplitude', value => { value.icons.notifications.outline.gesture.amplitude = 3; }, 'ANNOTATION_INVALID'],
    ['выдуманный pivot', value => { value.icons.notifications.outline.parts[1].anchor = [0.5, 0.8]; }, 'ANNOTATION_INVALID'],
    ['stale master', value => { value.icons.notifications.outline.masterSha256 = '0'.repeat(64); }, 'MASTER_MISMATCH'],
  ])('типизированный отказ: %s', (_, mutate, code) => {
    const invalid = structuredClone(document); mutate(invalid);
    expect(() => compileAuthorAnatomy(baseline, invalid)).toThrow(expect.objectContaining({ code }));
  });
});
