import { describe, expect, it } from 'vitest';
import { lottieContours, compileLottieGeometry, renderLottieSymbolModule } from '../scripts/lib/lottie-geometry.js';
import { createLottieSymbol } from '../src/lottie/runtime.js';
import { lottieSymbols, names, nudgeNames } from './helpers/lottie-symbols.js';
import { sampleMotionGesture } from '../src/core/motion-sampler.js';
import { readFileSync } from 'node:fs';
import { gzipSync, strToU8 } from 'fflate';
import { transformSync } from 'esbuild';
import { compactDataLiteral, compactGeneratedModule, jsonDataLiteral } from '../scripts/lib/generated-module.js';
const consumers = lottieSymbols();
const layer = (animation, id) => animation.layers.find(item => item.nm === id);

// Только interior witnesses статической evenodd заливки, не raster tolerance:
// независимое семплирование cubic проверяет точки вдали от границ контура.
function evenOddInkAt(animation, point) {
  const inside = contour => {
    const polygon = [];
    for (let index = 0; index < contour.v.length; index++) {
      const next = (index + 1) % contour.v.length, a = contour.v[index], b = contour.v[next];
      const c = a.map((value, axis) => value + contour.o[index][axis]);
      const d = b.map((value, axis) => value + contour.i[next][axis]);
      for (let sample = 0; sample < 16; sample++) {
        const t = sample / 16, u = 1 - t;
        polygon.push(a.map((value, axis) => u ** 3 * value + 3 * u ** 2 * t * c[axis] + 3 * u * t ** 2 * d[axis] + t ** 3 * b[axis]));
      }
    }
    let crossings = 0;
    for (let index = 0; index < polygon.length; index++) {
      const a = polygon[index], b = polygon[(index + 1) % polygon.length];
      if ((a[1] > point[1]) !== (b[1] > point[1]) &&
          point[0] < a[0] + (point[1] - a[1]) * (b[0] - a[0]) / (b[1] - a[1])) crossings++;
    }
    return crossings % 2;
  };
  return animation.layers.some(item => {
    const fill = item.shapes.find(shape => shape.ty === 'fl');
    const interiors = item.shapes.filter(shape => shape.ty === 'sh').map(shape => inside(shape.ks.k));
    expect(fill.r).toBe(2);
    return interiors.reduce((count, value) => count + value, 0) % 2 === 1;
  });
}

function scalar(property, t, component = 0) {
  if (!property.a) return Array.isArray(property.k) ? property.k[component] : property.k;
  const keyframes = property.k;
  const next = keyframes.findIndex(item => item.t >= t);
  if (next <= 0) return keyframes[next < 0 ? keyframes.length - 1 : 0].s[component];
  const a = keyframes[next - 1], b = keyframes[next];
  return a.s[component] + (b.s[component] - a.s[component]) * (t - a.t) / (b.t - a.t);
}

describe('точный build-time Lottie target', () => {
  it('новый compound target помещается в прежние shipping ceilings', () => {
    const policy = JSON.parse(readFileSync(new URL('../release/package-size-ratchet.json', import.meta.url), 'utf8'))
      .artifacts['dist/lottie/mic-circle.js'];
    const module = renderLottieSymbolModule('mic-circle', consumers['mic-circle'].targets);
    const bytes = strToU8(module);
    process.stdout.write(`${JSON.stringify({ artifact: 'dist/lottie/mic-circle.js', bytes: bytes.length,
      gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).length })}\n`);
    expect(bytes.length).toBeLessThanOrEqual(policy.maxBytes);
    expect(gzipSync(bytes, { level: 9, mtime: 0 }).length).toBeLessThanOrEqual(policy.maxGzipBytes);
    expect(/\/\*\s*[@#]__PURE__\s*\*\/\s*createLottieSymbol\(/.test(module)).toBe(true);
    expect(module).toMatch(/export function exportLottie\(/);
    expect(module).toMatch(/export function lottieCapabilities\(/);
    // Удаляем только два последних публичных wrapper declarations:
    // импортированные модули не получают package-level sideEffects подсказку.
    const unused = module.slice(0, module.lastIndexOf('export function exportLottie('));
    const options = { target: 'es2022', treeShaking: true, minifySyntax: true, minifyWhitespace: true };
    const removed = transformSync(unused, options).code;
    expect(/\bcreateLottieSymbol\s*\(/.test(removed)).toBe(false);
    expect(removed).not.toContain('microphone-body');
    const withoutPure = unused.replace(/\/\*\s*[@#]__PURE__\s*\*\/\s*(?=createLottieSymbol\()/, '');
    const retainedWithoutPure = transformSync(withoutPure, options).code;
    expect(/\bcreateLottieSymbol\s*\(/.test(retainedWithoutPure)).toBe(true);
    expect(retainedWithoutPure).toContain('microphone-body');
    const used = transformSync(module, options).code;
    expect(/\bcreateLottieSymbol\s*\(/.test(used)).toBe(true);
    expect(used).toContain('microphone-body');
    // Проверяется именно выпущенный wrapper, включая binding imports и data.
    expect(module.split('\n').filter(line => line.startsWith('import '))).toEqual([
      "import { glyph, glyphCapabilities } from '../symbols/mic-circle.js';",
      "import { createLottieSymbol } from '../ir/lottie-runtime.js';",
    ]);
    const executable = module.split('\n').filter(line => !line.startsWith('import ')).join('\n').replace(/^export /gm, '');
    const glyph = () => {}, glyphCapabilities = () => {};
    let captured;
    const wrapper = new Function('glyph', 'glyphCapabilities', 'createLottieSymbol',
      `${executable}\nreturn { exportLottie, lottieCapabilities };`)(glyph, glyphCapabilities, (source, targets) => {
      captured = { source, targets };
      return { exportLottie: request => request, lottieCapabilities: variant => variant };
    });
    expect(captured.source).toEqual({ glyph, glyphCapabilities });
    expect(captured.targets).toEqual(consumers['mic-circle'].targets);
    expect(wrapper.exportLottie.name).toBe('exportLottie');
    expect(wrapper.lottieCapabilities.name).toBe('lottieCapabilities');
    const request = { variant: 'filled' };
    expect(wrapper.exportLottie(request)).toBe(request);
    expect(wrapper.lottieCapabilities('filled')).toBe('filled');
  });
  it('не добавляет metadata в envelope прежних layered targets', () => {
    for (const { symbol, targets } of Object.values(consumers)) for (const [variant, target] of Object.entries(targets)) {
      if (symbol.glyph({ variant }).composition.kind !== 'layers') continue;
      expect(target.ok).toBe(true);
      expect(Object.hasOwn(target.geometry, 'composition')).toBe(false);
      expect(target.geometry.version).toBe(1);
      expect(Object.keys(target.geometry)).toEqual(['version', 'icon', 'variant', 'viewBox', 'author', 'parts']);
    }
    for (const name of names) {
      const variants = consumers[name].targets;
      const envelope = literal => [
        '/** GENERATED: target-contours одного авторского символа; path parser остаётся в сборке. */',
        `import { glyph, glyphCapabilities } from '../symbols/${name}.js';`,
        "import { createLottieSymbol } from '../ir/lottie-runtime.js';",
        `const symbol = /* @__PURE__ */ createLottieSymbol({ glyph, glyphCapabilities }, ${literal(variants)});`,
        'export function exportLottie(request) { return symbol.exportLottie(request); }',
        'export function lottieCapabilities(variant) { return symbol.lottieCapabilities(variant); }', '',
      ].join('\n');
      expect(renderLottieSymbolModule(name, variants)).toBe(compactGeneratedModule([envelope(jsonDataLiteral), envelope(compactDataLiteral)]));
    }
  });
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
  it('экспортирует настоящий Filled mic-circle одним fill owner с отрицательными контурами', () => {
    const { symbol, targets, lottie, masters } = consumers['mic-circle'];
    const glyph = symbol.glyph({ variant: 'filled' }), result = lottie.exportLottie({ variant: 'filled' });
    expect(result.ok).toBe(true);
    expect(targets.filled.geometry.composition).toEqual(glyph.composition);
    expect(targets.filled.geometry.parts.map(part => [part.id, part.anchor, part.fillRule]))
      .toEqual(glyph.parts.map(part => [part.id, part.anchor, part.fillRule]));
    const { animation } = result;
    expect(animation.layers).toHaveLength(1);
    const shapes = animation.layers[0].shapes;
    expect(shapes.filter(shape => shape.ty === 'fl')).toHaveLength(1);
    expect(shapes.at(-1).r).toBe(2);
    expect(shapes.filter(shape => shape.ty === 'sh').map(shape => shape.nm)).toEqual(glyph.parts.map(part => part.id));
    const rawPath = masters.filled.rawSvg.match(/<path\b[^>]*\bd="([^"]+)"/)[1];
    const rawStarts = [...rawPath.matchAll(/M([-\d.]+)[ ,]+([-\d.]+)/g)].map(match => [Number(match[1]), Number(match[2])]);
    expect(shapes.filter(shape => shape.ty === 'sh').map(shape => shape.ks.k.v[0])).toEqual(rawStarts);
    expect(animation.meta.labIcons.masterSha256).toBe(masters.filled.sha256);
    expect(evenOddInkAt(animation, [12, 3])).toBe(true);
    expect(evenOddInkAt(animation, [12, 9])).toBe(false);
    expect(evenOddInkAt(animation, [12, 18])).toBe(false);
    expect(evenOddInkAt(animation, [0, 0])).toBe(false);
    const missingCounter = structuredClone(animation);
    missingCounter.layers[0].shapes = missingCounter.layers[0].shapes.filter(shape => shape.nm !== 'microphone-body');
    expect(evenOddInkAt(missingCounter, [12, 9])).toBe(true);
    const independentlyPainted = structuredClone(animation);
    independentlyPainted.layers.push({ shapes: [shapes.find(shape => shape.nm === 'microphone-body'), shapes.at(-1)] });
    expect(evenOddInkAt(independentlyPainted, [12, 9])).toBe(true);
  });
  it.each([null, undefined, [], { kind: 'mask-subtract' }, { kind: 'layers', fillRule: 'evenodd' },
    { kind: 'compound' }, { kind: 'compound', fillRule: 'nonzero' }, { kind: 'compound', fillRule: 'evenodd', extra: true }])
    ('точно отказывает неподдержанной composition %j', composition => {
      const glyph = consumers['mic-circle'].symbol.glyph({ variant: 'filled' });
      expect(compileLottieGeometry({ ...glyph, composition })).toMatchObject({ ok: false, reason: { code: 'COMPOSITION_UNSUPPORTED' } });
    });
  it('не принимает compound contours за самостоятельный paint и проверяет source coverage', () => {
    const glyph = consumers['mic-circle'].symbol.glyph({ variant: 'filled' });
    for (const patch of [{ fillRule: 'evenodd' }, { paint: { kind: 'stroke', stroke: 'currentColor' } },
      { paint: { kind: 'fill', fill: '#123456' } }, { provenance: { kind: 'source', identity: 'derived' } }]) {
      expect(compileLottieGeometry({ ...glyph, parts: glyph.parts.map((part, index) => index === 2 ? { ...part, ...patch } : part) }))
        .toMatchObject({ ok: false, reason: { code: 'PAINT_UNSUPPORTED' } });
    }
    expect(compileLottieGeometry({ ...glyph, parts: glyph.parts.slice(0, 2) }))
      .toMatchObject({ ok: false, reason: { code: 'COMPOSITION_UNSUPPORTED' } });
    expect(compileLottieGeometry({ ...glyph, provenance: { ...glyph.provenance, anatomy: undefined } }))
      .toMatchObject({ ok: false, reason: { code: 'COMPOSITION_UNSUPPORTED' } });
    expect(compileLottieGeometry({ ...glyph, provenance: { ...glyph.provenance, anatomy: { ...glyph.provenance.anatomy, version: 2 } } }))
      .toMatchObject({ ok: false, reason: { code: 'COMPOSITION_UNSUPPORTED' } });
  });
  it('проверяет composition identity, порядок stable IDs и anchors target snapshot', () => {
    const { symbol, targets } = consumers['mic-circle'];
    for (const composition of [undefined, { kind: 'layers' }, { kind: 'compound', fillRule: 'nonzero' },
      { kind: 'compound', fillRule: 'evenodd', extra: true }]) {
      const changed = structuredClone(targets);
      changed.filled.geometry.composition = composition;
      const lottie = createLottieSymbol(symbol, changed);
      expect(lottie.exportLottie({ variant: 'filled' })).toMatchObject({ ok: false, reason: { code: 'GEOMETRY_MISMATCH' } });
      expect(lottie.lottieCapabilities('filled')).toMatchObject({ static: false, gestures: [], reason: { code: 'GEOMETRY_MISMATCH' } });
    }
    for (const mutate of [geometry => geometry.parts.reverse(), geometry => { geometry.parts[2].anchor[0] += 0.1; },
      geometry => { geometry.parts[2].fillRule = 'evenodd'; }, geometry => { geometry.version = 2; }]) {
      const changed = structuredClone(targets);
      mutate(changed.filled.geometry);
      expect(createLottieSymbol(symbol, changed).exportLottie({ variant: 'filled' }))
        .toMatchObject({ ok: false, reason: { code: 'GEOMETRY_MISMATCH' } });
    }
    for (const composition of [undefined, { kind: 'layers' }, { kind: 'compound', fillRule: 'evenodd', extra: true }]) {
      const changedSource = { ...symbol, glyph: request => ({ ...symbol.glyph(request), composition }) };
      expect(createLottieSymbol(changedSource, targets).exportLottie({ variant: 'filled' }))
        .toMatchObject({ ok: false, reason: { code: 'GEOMETRY_MISMATCH' } });
    }
  });
  it('существующий motion owner не допускает независимое движение отрицательного контура', () => {
    const { symbol, targets, lottie } = consumers['mic-circle'];
    expect(lottie.lottieCapabilities('filled')).toMatchObject({ static: true, gestures: [] });
    expect(lottie.exportLottie({ variant: 'filled', gesture: 'mic-circle.body' }))
      .toMatchObject({ ok: false, reason: { code: 'MOTION_UNAVAILABLE' } });
    const capabilities = symbol.glyphCapabilities('filled');
    const gesture = { id: 'mic-circle.body', kind: 'state', meaning: 'Отдельная отрицательная часть в проверке отказа',
      partIds: ['microphone-body'], progress: 'normalized-0-to-1', tracks: [{ partId: 'microphone-body',
        kind: 'opacity', unit: 'fraction', interpolation: 'linear', stops: [{ at: 0, value: 0 }, { at: 1, value: 1 }] }] };
    const injected = createLottieSymbol({ ...symbol, glyphCapabilities: () => ({ ...capabilities,
      motion: { ...capabilities.motion, state: 'gesture-ready', gestures: [gesture] } }) }, targets);
    expect(injected.lottieCapabilities('filled')).toMatchObject({ static: true, gestures: [] });
    expect(injected.exportLottie({ variant: 'filled', gesture: gesture.id }))
      .toMatchObject({ ok: false, reason: { code: 'MOTION_UNAVAILABLE', message: expect.stringMatching(/^COMPOSITION_NOT_ADDRESSABLE:/) } });
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
    expect(compileLottieGeometry({ ...glyph, composition: { kind: 'mask-subtract', basePartIds: [], subtractPartIds: [] } }))
      .toMatchObject({ ok: false, reason: { code: 'COMPOSITION_UNSUPPORTED' } });
    expect(compileLottieGeometry({ ...glyph, parts: glyph.parts.map(part => ({ ...part, d: 'M0 0A2 2 0 0 1 2 2Z' })) })).toMatchObject({ ok: false, reason: { code: 'ARC_UNSUPPORTED' } });
  });
  it.each([null, { color: 'currentColor' }, { frameRate: 0 }, { frameRate: 2.1 }, { bogus: 1 }, { from: 0.2 }, { gesture: 'reload.cycle', duration: NaN }, { gesture: 'reload.cycle', to: 2 }])('отказывает недопустимому request %j', request => {
    expect(consumers.reload.lottie.exportLottie(request)).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
  });
  it('пропущенные поля и явный undefined сохраняют статические defaults', () => {
    expect(consumers.reload.lottie.exportLottie({ variant: undefined, color: undefined, frameRate: undefined, gesture: undefined }))
      .toEqual(consumers.reload.lottie.exportLottie());
  });
  it('пропущенные поля и явный undefined сохраняют defaults объявленного жеста', () => {
    expect(consumers.reload.lottie.exportLottie({ gesture: 'reload.cycle', variant: undefined, color: undefined,
      frameRate: undefined, duration: undefined, from: undefined, to: undefined, reducedMotion: undefined }))
      .toEqual(consumers.reload.lottie.exportLottie({ gesture: 'reload.cycle' }));
  });
  it.each(['variant', 'color', 'frameRate'])('null статического поля %s получает точный отказ', field => {
    expect(consumers.reload.lottie.exportLottie({ [field]: null }))
      .toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
  });
  it.each(['variant', 'color', 'frameRate', 'duration', 'from', 'to', 'gesture', 'reducedMotion'])
    ('null motion поля %s получает точный отказ', field => {
      expect(consumers.reload.lottie.exportLottie({ gesture: 'reload.cycle', [field]: null }))
        .toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
    });
  it('переданные параметры движения без gesture не исчезают из статического запроса', () => {
    for (const field of ['duration', 'from', 'to', 'reducedMotion']) for (const value of [undefined, null, 0]) {
      expect(consumers.reload.lottie.exportLottie({ [field]: value }))
        .toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
    }
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
