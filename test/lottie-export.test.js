import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { exportLottie, lottieCapabilities } from '../src/lottie/index.ts';
import { numericLottieContours } from '../src/lottie/numeric-path.ts';
import calendar from '../dist/symbols/calendar-number.js';
import time from '../dist/symbols/time.js';
import volume from '../dist/states/volume.js';

const manifest = JSON.parse(readFileSync(new URL('../semantics/figma-baseline.json', import.meta.url)));
const symbols = await Promise.all(Object.keys(manifest.icons).map(async id => (await import(`../dist/symbols/${id}.js`)).default));
const layers = animation => [...animation.layers, ...animation.assets.flatMap(asset => asset.layers)];
const shapes = animation => layers(animation).flatMap(layer => layer.shapes ?? []);

describe('common numeric IconSymbol Lottie export', () => {
  it('exports every optical support and corresponding path transition in the complete corpus', () => {
    let count = 0, gestures = 0;
    for (const symbol of symbols) for (const variant of ['outline', 'filled']) {
      for (const weight of [300, 400, 600]) for (const opsz of [16, 24, 48]) {
        const result = exportLottie(symbol, { variant, weight, opsz });
        expect(result.ok, `${symbol.id}/${variant}/${weight}/${opsz}: ${JSON.stringify(result.reason)}`).toBe(true); count++;
      }
      const change = exportLottie(symbol, { variant, transition: { from: { weight: 300, opsz: 48 }, to: { weight: 600, opsz: 16 } } });
      expect(change.ok, `${symbol.id}/${variant}: ${JSON.stringify(change.reason)}`).toBe(true);
      for (const gesture of lottieCapabilities(symbol, variant).gestures) {
        for (const [from, to] of [[0, 1], [1, 0], [.17, .83]]) {
          const result = exportLottie(symbol, { variant, gesture, from, to });
          expect(result.ok, `${symbol.id}/${variant}/${gesture}: ${JSON.stringify(result.reason)}`).toBe(true); gestures++;
        }
      }
    }
    expect(count).toBe(5940); expect(gestures).toBeGreaterThan(100);
  }, 30000);

  it('keeps elapsed-hour turns, fractional terminal frames and an exact reduced terminal pose', () => {
    const result = exportLottie(time, { gesture: 'advance', from: -.5, to: 2.5, duration: 317 });
    expect(result.ok).toBe(true);
    expect(result.animation.meta.labIcons.terminalFrame).toBe(19.02);
    expect(result.animation.op).toBe(21);
    const rotations = layers(result.animation).filter(layer => layer.ks.r.a === 1);
    expect(rotations.map(layer => layer.ks.r.k.at(-1).s[0])).toEqual(expect.arrayContaining([900, 75]));
    const reduced = exportLottie(time, { gesture: 'advance', from: -.5, to: 2.5, reducedMotion: true });
    expect(reduced.animation.op).toBe(1);
    expect(layers(reduced.animation).filter(layer => /clock-(minute|hour)/.test(layer.nm)).map(layer => layer.ks.r.k)).toEqual(expect.arrayContaining([900, 75]));
  });

  it('accepts explicit calendar dates and state transitions through the same render options', () => {
    const date = new Date('2026-11-17T23:30:00Z');
    expect(exportLottie(calendar, { date, timeZone: 'Asia/Tokyo' }).ok).toBe(true);
    expect(exportLottie(volume, { transition: { from: { state: 'high' }, to: { state: 'mute' } } }).ok).toBe(true);
    expect(exportLottie(calendar, { date }).ok).toBe(false);
    expect(exportLottie(calendar, { date, timeZone: '+01' }).ok).toBe(false);
  });

  it('never shares mutable path objects between keyframe records or exports', () => {
    const request = { transition: { from: { weight: 300 }, to: { weight: 600 } } };
    const first = exportLottie(time, request).animation, second = exportLottie(time, request).animation;
    const path = shapes(first).find(shape => shape.ty === 'sh' && shape.ks.a === 1);
    expect(path.ks.k[0].e[0]).not.toBe(path.ks.k[1].s[0]);
    const before = JSON.stringify(second);
    path.ks.k[0].e[0].v[0][0] += 1;
    expect(JSON.stringify(second)).toBe(before);
    expect(JSON.stringify(exportLottie(time, request).animation)).toBe(before);
  });

  it('keeps the exact locus of numeric line and cubic segments', () => {
    const [path] = numericLottieContours('MLLZ', [0, 0, 9, 12, 0, 12]);
    expect(path.v).toEqual([[0, 0], [9, 12], [0, 12]]);
    expect(path.i.every(point => point.every(value => value === 0))).toBe(true);
    expect(path.o.every(point => point.every(value => value === 0))).toBe(true);
    const [curve] = numericLottieContours('MCZ', [1, 2, 3, 4, 5, 6, 7, 8]);
    expect(curve.o[0]).toEqual([2, 2]); expect(curve.i[1]).toEqual([-2, -2]);
  });

  it.each([
    [{ gesture: 'missing' }, 'MOTION_UNAVAILABLE'],
    [{ gesture: 'toString' }, 'MOTION_UNAVAILABLE'],
    [{ variation: { dotScale: 1.1 } }, 'VARIATION_UNSUPPORTED'],
    [{ transition: { from: { unknown: 1 }, to: {} } }, 'INVALID_REQUEST'],
    [{ transition: { from: {}, to: {} }, gesture: 'advance' }, 'INVALID_REQUEST'],
    [{ color: 'currentColor' }, 'INVALID_REQUEST'],
    [{ frameRate: 0 }, 'INVALID_REQUEST'],
    [{ weight: 700 }, 'INVALID_REQUEST'],
  ])('gives a precise refusal for %j', (request, code) => {
    expect(exportLottie(time, request)).toMatchObject({ ok: false, reason: { code } });
  });

  it('refuses absent compiled data and unknown gesture channels', () => {
    expect(exportLottie({ id: 'missing' })).toMatchObject({ ok: false, reason: { code: 'SYMBOL_DATA_REQUIRED' } });
    const changed = structuredClone(time);
    changed.semantics.variants.outline.effects.advance.tracks[0].property = 'scale';
    expect(exportLottie(changed, { gesture: 'advance' })).toMatchObject({ ok: false, reason: { code: 'MOTION_UNSUPPORTED' } });
    expect(lottieCapabilities(changed).gestures).not.toContain('advance');
  });
});
