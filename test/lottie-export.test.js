import { describe, expect, it } from 'vitest';
import { lottieContours, compileLottieGeometry, renderLottieSymbolModule } from '../scripts/lib/lottie-geometry.js';
import { createLottieSymbol } from '../src/lottie/runtime.js';
import { lottieSymbols, names, nudgeNames } from './helpers/lottie-symbols.js';
import { sampleMotionGesture } from '../src/core/motion-sampler.js';
const consumers = lottieSymbols();
const layer = (animation, id) => animation.layers.find(item => item.nm === id);
function scalar(property, t, component = 0) {
  if (!property.a) return Array.isArray(property.k) ? property.k[component] : property.k;
  const keyframes = property.k;
  const next = keyframes.findIndex(item => item.t >= t);
  if (next <= 0) return keyframes[next < 0 ? keyframes.length - 1 : 0].s[component];
  const a = keyframes[next - 1], b = keyframes[next];
  return a.s[component] + (b.s[component] - a.s[component]) * (t - a.t) / (b.t - a.t);
}

describe('точный build-time Lottie target', () => {
  it('сохраняет closing cubic tangent, несколько контуров и направление', () => {
    expect(lottieContours('M0 0 C0 2 2 2 2 0 C2 -2 0 -2 0 0Z M4 4L4 6L6 6Z')).toEqual([
      { v: [[0, 0], [2, 0]], i: [[0, -2], [0, 2]], o: [[0, 2], [0, -2]], c: true },
      { v: [[4, 4], [4, 6], [6, 6]], i: [[0, 0], [0, 0], [0, 0]], o: [[0, 0], [0, 0], [0, 0]], c: true },
    ]);
  });
  it('нормализует relative/smooth/implicit-line и degree elevation квадратики', () => {
    expect(lottieContours('m1 2 2 0h1v2z')[0].v).toEqual([[1, 2], [3, 2], [4, 2], [4, 4]]);
    const curve = lottieContours('M0 0Q3 3 6 0Z')[0];
    expect(curve.o[0]).toEqual([2, 2]); expect(curve.i[1]).toEqual([-2, 2]);
  });
  it('точно отказывает arcs/open paths/невалидному path, не исправляет author рисунок', () => {
    expect(() => lottieContours('M0 0A2 2 0 0 1 2 2Z')).toThrow(expect.objectContaining({ code: 'ARC_UNSUPPORTED' }));
    expect(() => lottieContours('M0 0L1 1')).toThrow(expect.objectContaining({ code: 'OPEN_CONTOUR_UNSUPPORTED' }));
    expect(() => lottieContours('M0 0 garbage')).toThrow(expect.objectContaining({ code: 'PATH_INVALID' }));
    expect(lottieContours('M0 0A0 2 0 0 1 2 2Z')[0].v).toEqual([[0, 0], [2, 2]]);
  });
  it('не импортирует parser/каталог в target module', () => {
    const module = renderLottieSymbolModule('reload', consumers.reload.targets);
    expect(module).toContain("../symbols/reload.js"); expect(module).toContain("../ir/lottie-runtime.js");
    expect(module).not.toMatch(/parsePathData|catalog|createGlyphCompiler/);
  });
  it.each(names)('сохраняет layers/fill scopes независимых %s masters', name => {
    const { symbol, targets, lottie } = consumers[name];
    for (const variant of ['outline', 'filled']) {
      expect(targets[variant].ok).toBe(true);
      const result = lottie.exportLottie({ variant, color: '#123456' });
      expect(result.ok).toBe(true);
      const animation = result.animation, glyph = symbol.glyph({ variant });
      expect(animation.layers.map(item => item.nm).reverse()).toEqual(glyph.parts.map(part => part.id));
      expect(animation.meta.labIcons.masterSha256).toBe(glyph.provenance.author.masterSha256);
      for (const part of glyph.parts) {
        const shapes = layer(animation, part.id).shapes;
        expect(shapes.filter(shape => shape.ty === 'fl')).toHaveLength(1);
        expect(shapes.at(-1).r).toBe(part.fillRule === 'evenodd' ? 2 : 1);
        expect(shapes.filter(shape => shape.ty === 'sh')).toHaveLength((part.d.match(/[Mm]/g) ?? []).length);
      }
    }
  });
});

describe('Lottie использует единые semantic effects', () => {
  it('принимает канонический целый кадр без ложного floating-point отказа', () => {
    for (const frameRate of [24, 30, 60, 120]) {
      const duration = 1000 / frameRate;
      for (const [name, gesture] of [['reload', 'reload.cycle'], ['volume-high', 'volume-high.level'], ['ellipsis-horizontal', 'ellipsis-horizontal.activity'], ['arrow-up', 'arrow-up.nudge']]) {
        const result = consumers[name].lottie.exportLottie({ gesture, duration, frameRate });
        expect(result.ok, `${name}: ${frameRate} fps`).toBe(true);
        expect(result.animation.meta.labIcons.terminalFrame).toBe(1);
        for (const item of result.animation.layers) for (const property of [item.ks.r, item.ks.o, item.ks.p]) {
          if (property.a) expect(property.k.at(-1).t).toBe(1);
        }
      }
    }
    expect(consumers.reload.lottie.exportLottie({ gesture: 'reload.cycle', duration: 1001, frameRate: 60 }))
      .toMatchObject({ ok: false, reason: { code: 'DURATION_NOT_FRAME_ALIGNED' } });
  });
  const variants = names.flatMap(name => ['outline', 'filled'].flatMap(variant => consumers[name].symbol.glyphCapabilities(variant).motion.gestures.map(gesture => [name, variant, gesture])));
  it.each(variants)('%s/%s gesture соответствует sampler, включая reverse/segment/terminal', (name, variant, gesture) => {
    const { lottie } = consumers[name];
    for (const [from, to] of [[0, 1], [1, 0], [0.37, 0.8]]) {
      const result = lottie.exportLottie({ variant, gesture: gesture.id, duration: 1000, from, to });
      expect(result.ok).toBe(true);
      const animation = result.animation;
      expect(animation.op).toBe(61); expect(animation.meta.labIcons.terminalFrame).toBe(60);
      for (const t of [0, 13, 30, 60]) {
        const expected = sampleMotionGesture(gesture, from + (to - from) * t / 60);
        for (const sample of expected) {
          const ks = layer(animation, sample.partId).ks;
          if (sample.kind === 'translate') {
            const axis = sample.axis === 'x' ? 0 : 1;
            expect(scalar(ks.p, t, axis) - animation.meta.labIcons.offset[axis]).toBeCloseTo(sample.translation, 10);
            expect(scalar(ks.p, t, 1 - axis) - animation.meta.labIcons.offset[1 - axis]).toBe(0);
          } else {
            expect(scalar(sample.kind === 'rotate' ? ks.r : ks.o, t)).toBeCloseTo(sample.kind === 'rotate' ? sample.rotation : sample.opacity * 100, 10);
          }
        }
      }
    }
  });
  it('reduced motion сериализует конечную статическую позу', () => {
    const gesture = consumers['volume-high'].symbol.glyphCapabilities().motion.gestures[0].id;
    const result = consumers['volume-high'].lottie.exportLottie({ gesture, duration: 1000, from: 1, to: 0.3, reducedMotion: true });
    expect(result.ok).toBe(true); expect(result.animation.op).toBe(1); expect(result.animation.meta.labIcons.durationMs).toBe(0);
    expect(result.animation.layers.every(item => item.ks.o.a === 0 && item.ks.r.a === 0 && item.ks.p.a === 0)).toBe(true);
  });
  it('не приписывает motion source-only variant и сохраняет precise geometry refusals', () => {
    expect(consumers['volume-middle'].lottie.exportLottie({ gesture: 'volume-middle.level' })).toMatchObject({ ok: false, reason: { code: 'MOTION_UNAVAILABLE' } });
    const glyph = consumers.reload.symbol.glyph();
    expect(compileLottieGeometry({ ...glyph, composition: { kind: 'compound', fillRule: 'evenodd' } })).toMatchObject({ ok: false, reason: { code: 'COMPOSITION_UNSUPPORTED' } });
    expect(compileLottieGeometry({ ...glyph, parts: glyph.parts.map(part => ({ ...part, d: 'M0 0A2 2 0 0 1 2 2Z' })) })).toMatchObject({ ok: false, reason: { code: 'ARC_UNSUPPORTED' } });
  });
  it.each([null, { color: 'currentColor' }, { frameRate: 0 }, { frameRate: 2.1 }, { bogus: 1 }, { from: 0.2 }, { gesture: 'reload.cycle', duration: NaN }, { gesture: 'reload.cycle', to: 2 }])('отказывает недопустимому request %j', request => {
    expect(consumers.reload.lottie.exportLottie(request)).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
  });
  it('не округляет молча duration и не выдаёт другую версию geometry', () => {
    expect(consumers.reload.lottie.exportLottie({ gesture: 'reload.cycle', duration: 1001 })).toMatchObject({ ok: false, reason: { code: 'DURATION_NOT_FRAME_ALIGNED' } });
    const target = structuredClone(consumers.reload.targets);
    target.outline.geometry.author.masterSha256 = '0'.repeat(64);
    expect(createLottieSymbol(consumers.reload.symbol, target).exportLottie()).toMatchObject({ ok: false, reason: { code: 'GEOMETRY_MISMATCH' } });
  });
  it('защищает geometry от in-place нормализации player и последующего export', () => {
    const first = consumers.reload.lottie.exportLottie().animation;
    const pristine = structuredClone(first);
    first.layers[0].shapes[0].ks.k.i[0][0] += 10;
    first.layers[0].shapes[0].ks.k.v[0][0] += 20;
    first.meta.labIcons.logicalViewBox[0] += 30;
    expect(consumers.reload.lottie.exportLottie().animation).toEqual(pristine);
    const moving = consumers['arrow-forward'].lottie.exportLottie({ gesture: 'arrow-forward.nudge' }).animation;
    const initial = structuredClone(moving);
    moving.layers[0].ks.p.k[1].s[0] += 10;
    moving.layers[0].ks.p.k[1].o.x[0] = 1;
    expect(consumers['arrow-forward'].lottie.exportLottie({ gesture: 'arrow-forward.nudge' }).animation).toEqual(initial);
  });
  it('canvas покрывает полный круг контрольных точек вокруг declared anchor', () => {
    const result = consumers.reload.lottie.exportLottie({ gesture: 'reload.cycle' });
    expect(result.ok).toBe(true);
    const { animation } = result, geometry = consumers.reload.targets.outline.geometry;
    for (const part of geometry.parts) for (const contour of part.contours) for (let index = 0; index < contour.v.length; index++) {
      const pivot = [geometry.viewBox[0] + part.anchor[0] * geometry.viewBox[2], geometry.viewBox[1] + part.anchor[1] * geometry.viewBox[3]];
      const p = contour.v[index];
      for (const tangent of [[0, 0], contour.i[index], contour.o[index]]) for (const angle of [0, 33, 90, 180, 271]) {
        const radians = angle * Math.PI / 180, x = p[0] + tangent[0] - pivot[0], y = p[1] + tangent[1] - pivot[1];
        const actual = [pivot[0] + x * Math.cos(radians) - y * Math.sin(radians) + animation.meta.labIcons.offset[0], pivot[1] + x * Math.sin(radians) + y * Math.cos(radians) + animation.meta.labIcons.offset[1]];
        expect(actual[0]).toBeGreaterThanOrEqual(0); expect(actual[0]).toBeLessThanOrEqual(animation.w);
        expect(actual[1]).toBeGreaterThanOrEqual(0); expect(actual[1]).toBeLessThanOrEqual(animation.h);
      }
    }
  });
  it.each(nudgeNames)('%s: внутренний nudge-пик, canvas и terminal без изменения contours', name => {
    for (const variant of ['outline', 'filled']) {
      const { symbol, lottie, targets } = consumers[name];
      const result = lottie.exportLottie({ variant, gesture: `${name}.nudge`, duration: 1000 });
      expect(result.ok).toBe(true);
      const animation = result.animation, gesture = symbol.glyphCapabilities(variant).motion.gestures[0];
      const track = gesture.tracks[0], axis = track.axis === 'x' ? 0 : 1;
      const part = layer(animation, track.partId);
      expect(part.ks.p.a).toBe(1);
      expect(part.ks.p.k.map(item => item.t)).toEqual([0, 30, 60]);
      expect(scalar(part.ks.p, 0, axis) - animation.meta.labIcons.offset[axis]).toBe(0);
      expect(scalar(part.ks.p, 30, axis) - animation.meta.labIcons.offset[axis]).toBe(track.stops[1].value);
      expect(scalar(part.ks.p, 60, axis) - animation.meta.labIcons.offset[axis]).toBe(0);
      expect(part.ks.p.k.every(item => item.s.length === 3 && item.i.x.length === 3 && item.o.x.length === 3)).toBe(true);
      const geometry = targets[variant].geometry, span = geometry.viewBox[axis + 2];
      expect(axis === 0 ? animation.w : animation.h).toBe(span + Math.abs(track.stops[1].value));
      expect(axis === 0 ? animation.h : animation.w).toBe(geometry.viewBox[3 - axis]);
      const staticAnimation = lottie.exportLottie({ variant }).animation;
      expect(part.shapes).toEqual(layer(staticAnimation, track.partId).shapes);
      expect(part.ks.a).toEqual(layer(staticAnimation, track.partId).ks.a);
      for (const endpoint of [0, track.stops[1].value]) for (const contour of geometry.parts[0].contours) {
        for (let index = 0; index < contour.v.length; index++) for (const tangent of [[0, 0], contour.i[index], contour.o[index]]) {
          const point = contour.v[index].map((value, coordinate) => value + tangent[coordinate] + animation.meta.labIcons.offset[coordinate] + (coordinate === axis ? endpoint : 0));
          expect(point[0]).toBeGreaterThanOrEqual(0); expect(point[0]).toBeLessThanOrEqual(animation.w);
          expect(point[1]).toBeGreaterThanOrEqual(0); expect(point[1]).toBeLessThanOrEqual(animation.h);
        }
      }
      for (const request of [{ duration: 0 }, { from: 0.37, to: 0.37 }, { from: 1, to: 0.37, reducedMotion: true }]) {
        const fixed = lottie.exportLottie({ variant, gesture: `${name}.nudge`, ...request }).animation;
        expect(fixed.op).toBe(1); expect(fixed.layers.every(item => !item.ks.p.a && !item.ks.o.a && !item.ks.r.a)).toBe(true);
        const terminal = request.to ?? 1;
        expect(scalar(layer(fixed, track.partId).ks.p, 0, axis) - fixed.meta.labIcons.offset[axis])
          .toBeCloseTo(sampleMotionGesture(gesture, terminal)[0].translation, 10);
      }
    }
  });
});
