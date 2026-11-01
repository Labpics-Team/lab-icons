import { compileSymbolEffect } from '../motion/index.js';
import type { GlyphIR, GlyphCapabilities, IconVariant } from '../ir/compiler.js';
import type { LottieAnimation, LottieCapabilities, LottieExportRequest, LottieExportResult, LottieRefusalCode } from './types.js';
type Point = [number, number];
interface Contour { v: Point[]; i: Point[]; o: Point[]; c: true }
interface Geometry {
  version: 1; icon: string; variant: IconVariant; viewBox: number[];
  author: { masterSha256: string; pathFingerprintSha256: string; fileKey: string; version: string; nodeId: string };
  parts: { id: string; anchor: Point; fillRule: 'nonzero' | 'evenodd'; contours: Contour[] }[];
}
type Lowering = { ok: true; geometry: Geometry } | { ok: false; reason: { code: LottieRefusalCode; message: string } };
interface SymbolSource {
  glyph(request?: { variant?: IconVariant }): GlyphIR<string>;
  glyphCapabilities(variant?: IconVariant): GlyphCapabilities<string>;
}
const profile = 'lottie-web-svg-5.13' as const;
const supportedEffectVersions = [1, 2, 3];
const refuse = (code: LottieRefusalCode, message: string): LottieExportResult => ({ ok: false, reason: { code, message } });
const fixed = (k: unknown) => ({ a: 0, k });
const frame = (t: number, value: number | readonly number[]) => {
  const s = typeof value === 'number' ? [value] : [...value];
  return { t, s, i: { x: s.map(() => 1), y: s.map(() => 1) }, o: { x: s.map(() => 0), y: s.map(() => 0) } };
};
const cloneContour = (contour: Contour) => ({ c: true, v: contour.v.map(p => [...p]), i: contour.i.map(p => [...p]), o: contour.o.map(p => [...p]) });

/** @internal Геометрия уже скомпилирована. Runtime не импортирует parser или каталог. */
export function createLottieSymbol(source: SymbolSource, variants: Record<IconVariant, Lowering>) {
  function selected(variant: IconVariant): Lowering {
    const target = variants[variant];
    if (!target.ok) return target;
    const glyph = source.glyph({ variant }), geometry = target.geometry;
    const author = glyph.provenance.kind === 'source' ? glyph.provenance.author : undefined;
    if (geometry.icon !== glyph.icon || geometry.variant !== glyph.variant || geometry.version !== 1 ||
        !author || Object.keys(geometry.author).some(key => geometry.author[key as keyof Geometry['author']] !== author[key as keyof typeof author]) ||
        geometry.parts.length !== glyph.parts.length || geometry.viewBox.some((value, index) => value !== glyph.viewBox[index]) ||
        geometry.parts.some((part, index) => part.id !== glyph.parts[index]?.id || part.fillRule !== glyph.parts[index]?.fillRule ||
          part.anchor.some((value, axis) => value !== glyph.parts[index]?.anchor[axis]))) {
      return { ok: false, reason: { code: 'GEOMETRY_MISMATCH', message: 'Target и symbol принадлежат разным авторским снимкам.' } };
    }
    return target;
  }
  function lottieCapabilities(variant: IconVariant = 'outline'): LottieCapabilities {
    if (!['outline', 'filled'].includes(variant)) return { profile, static: false, gestures: [], reason: { code: 'INVALID_REQUEST', message: 'Неизвестный вариант.' } };
    const target = selected(variant);
    if (!target.ok) return { profile, static: false, gestures: [], reason: target.reason };
    const glyph = source.glyph({ variant }), caps = source.glyphCapabilities(variant);
    return { profile, static: true, gestures: caps.motion.gestures.filter(gesture => {
      const result = compileSymbolEffect(glyph, caps, gesture.id, { duration: 0 });
      return result.ok && supportedEffectVersions.includes(result.effect.version);
    }).map(gesture => gesture.id) };
  }
  function exportLottie(request: LottieExportRequest = {}): LottieExportResult {
    if (!request || typeof request !== 'object' || Array.isArray(request) ||
        Object.keys(request).some(key => !['variant', 'gesture', 'duration', 'from', 'to', 'reducedMotion', 'color', 'frameRate'].includes(key))) {
      return refuse('INVALID_REQUEST', 'Неизвестные параметры Lottie export.');
    }
    const variant = request.variant ?? 'outline', color = request.color ?? '#000000', rate = request.frameRate ?? 60;
    const duration = request.duration ?? 1000, from = request.from ?? 0, to = request.to ?? 1;
    if (!['outline', 'filled'].includes(variant) || typeof color !== 'string' || !/^#[\da-f]{6}$/i.test(color) ||
        !Number.isSafeInteger(rate) || rate <= 0 || !Number.isFinite(duration) || duration < 0 ||
        ![from, to].every(value => Number.isFinite(value) && value >= 0 && value <= 1) ||
        (request.reducedMotion !== undefined && typeof request.reducedMotion !== 'boolean') ||
        (request.gesture !== undefined && (typeof request.gesture !== 'string' || !request.gesture))) {
      return refuse('INVALID_REQUEST', 'Нужны RGB #rrggbb, положительный целый fps и конечные duration/progress.');
    }
    if (request.gesture === undefined && ['duration', 'from', 'to', 'reducedMotion'].some(key => Object.hasOwn(request, key))) {
      return refuse('INVALID_REQUEST', 'Параметры движения требуют явного gesture.');
    }
    const target = selected(variant);
    if (!target.ok) return target;
    const geometry = target.geometry;
    const effectResult = request.gesture === undefined ? null : compileSymbolEffect(
      source.glyph({ variant }), source.glyphCapabilities(variant), request.gesture, { duration, from, to, reducedMotion: request.reducedMotion });
    if (effectResult && !effectResult.ok) return refuse('MOTION_UNAVAILABLE', `${effectResult.reason.code}: ${effectResult.reason.message}`);
    const effect = effectResult?.ok ? effectResult.effect : null;
    if (effect && !supportedEffectVersions.includes(effect.version)) return refuse('MOTION_UNAVAILABLE', 'Версия эффекта не поддержана Lottie target.');
    const effectiveDuration = effect?.options.duration ?? 0;
    const terminalFrame = Math.round(effectiveDuration * rate / 1000);
    // Exact roundtrip допускает N*1000/fps в Number, без epsilon и
    // молчаливого округления произвольной пользовательской длительности.
    if (!Number.isSafeInteger(terminalFrame) || !Number.isSafeInteger(terminalFrame + 1) ||
        effectiveDuration !== terminalFrame * 1000 / rate) return refuse('DURATION_NOT_FRAME_ALIGNED', 'Duration обязан состоять из безопасного целого числа кадров выбранного fps с терминальным кадром.');
    const opacityTargets = effect?.version === 2 ? new Map(effect.targets.map(track => [track.partId, track])) : new Map();
    const rotations = effect?.version === 1 ? new Map(effect.targets.map(track => [track.partId, track.rotation])) : new Map();
    const translations = effect?.version === 3 ? new Map(effect.targets.map(track => [track.partId, track])) : new Map();
    if (effect?.version === 3 && (translations.size !== effect.targets.length || effect.targets.some(track =>
      track.unit !== 'viewBox' || !['x', 'y'].includes(track.property)))) {
      return refuse('MOTION_UNAVAILABLE', 'Translation target требует одну объявленную ось viewBox на часть.');
    }
    let minX = geometry.viewBox[0]!, minY = geometry.viewBox[1]!;
    let maxX = minX + geometry.viewBox[2]!, maxY = minY + geometry.viewBox[3]!;
    // Bézier находится внутри convex hull controls. Полный круг вокруг anchor
    // консервативно покрывает любую дугу from→to без per-frame geometry/layout.
    for (const part of geometry.parts) if (rotations.has(part.id)) {
      const pivot: Point = [geometry.viewBox[0]! + part.anchor[0] * geometry.viewBox[2]!, geometry.viewBox[1]! + part.anchor[1] * geometry.viewBox[3]!];
      let radius = 0;
      for (const contour of part.contours) for (let index = 0; index < contour.v.length; index++) {
        const vertex = contour.v[index]!;
        for (const tangent of [[0, 0], contour.i[index]!, contour.o[index]!]) {
          radius = Math.max(radius, Math.hypot(vertex[0] + tangent[0]! - pivot[0], vertex[1] + tangent[1]! - pivot[1]));
        }
      }
      minX = Math.min(minX, pivot[0] - radius); minY = Math.min(minY, pivot[1] - radius);
      maxX = Math.max(maxX, pivot[0] + radius); maxY = Math.max(maxY, pivot[1] + radius);
    }
    if (effect?.version === 3) for (const track of effect.targets) {
      // Linear scalar stages не выходят за extrema своих endpoints.
      // Внутренний пик out-and-back входит в stages, даже когда from=to=0.
      const values = terminalFrame ? [track.from, track.to, ...effect.stages.filter(stage => stage.partId === track.partId).map(stage => stage.to)] : [track.to];
      const low = Math.min(...values), high = Math.max(...values);
      if (track.property === 'x') {
        minX = Math.min(minX, geometry.viewBox[0]! + low);
        maxX = Math.max(maxX, geometry.viewBox[0]! + geometry.viewBox[2]! + high);
      } else {
        minY = Math.min(minY, geometry.viewBox[1]! + low);
        maxY = Math.max(maxY, geometry.viewBox[1]! + geometry.viewBox[3]! + high);
      }
    }
    const origin: Point = [Math.floor(minX), Math.floor(minY)], offset: Point = [-origin[0], -origin[1]];
    const width = Math.ceil(maxX) - origin[0], height = Math.ceil(maxY) - origin[1];
    if (![width, height, ...origin].every(Number.isSafeInteger) || width <= 0 || height <= 0) return refuse('CANVAS_UNSUPPORTED', 'Canvas не представим безопасными целыми размерами target.');
    const rgb = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16) / 255);
    const op = terminalFrame + 1;
    const layers = geometry.parts.map((part, index) => {
      const rotation = rotations.get(part.id), opacity = opacityTargets.get(part.id), translation = translations.get(part.id);
      const pivot: Point = rotation ? [geometry.viewBox[0]! + part.anchor[0] * geometry.viewBox[2]!, geometry.viewBox[1]! + part.anchor[1] * geometry.viewBox[3]!] : [0, 0];
      let opacityProperty: unknown = fixed(opacity ? (terminalFrame ? opacity.from : opacity.to) * 100 : 100);
      if (opacity && terminalFrame && effect?.version === 2) {
        const values = [frame(0, opacity.from * 100)];
        const stages = effect.stages.filter(stage => stage.partId === part.id);
        for (const [stageIndex, stage] of stages.entries()) {
          const stageEnd = stage.at + stage.duration;
          const t = stageIndex === stages.length - 1
            ? terminalFrame : stageEnd / effectiveDuration * terminalFrame;
          if (t === values.at(-1)!.t) values[values.length - 1] = frame(t, stage.to * 100);
          else values.push(frame(t, stage.to * 100));
        }
        opacityProperty = { a: 1, k: values };
      }
      const position = (value = 0) => [pivot[0] + offset[0] + (translation?.property === 'x' ? value : 0),
        pivot[1] + offset[1] + (translation?.property === 'y' ? value : 0), 0];
      let positionProperty: unknown = fixed(position(translation?.to ?? 0));
      if (translation && terminalFrame && effect?.version === 3) {
        const values = [frame(0, position(translation.from))];
        const stages = effect.stages.filter(stage => stage.partId === part.id);
        for (const [stageIndex, stage] of stages.entries()) {
          const t = stageIndex === stages.length - 1 ? terminalFrame : (stage.at + stage.duration) / effectiveDuration * terminalFrame;
          const keyframe = frame(t, position(stage.to));
          if (t === values.at(-1)!.t) values[values.length - 1] = keyframe;
          else values.push(keyframe);
        }
        positionProperty = { a: 1, k: values };
      }
      return { ddd: 0, ind: index + 1, ty: 4, nm: part.id, sr: 1, ip: 0, op, st: 0, bm: 0,
        ks: { o: opacityProperty, r: rotation && terminalFrame ? { a: 1, k: [frame(0, rotation.from), frame(terminalFrame, rotation.to)] } : fixed(rotation?.to ?? 0),
          p: positionProperty, a: fixed([...pivot, 0]), s: fixed([100, 100, 100]) },
        // Один fill scope на исходный SVG path, включая все его countershapes.
        shapes: [...part.contours.map(contour => ({ ty: 'sh', ks: fixed(cloneContour(contour)), nm: part.id })),
          { ty: 'fl', c: fixed(rgb), o: fixed(100), r: part.fillRule === 'evenodd' ? 2 : 1, bm: 0, nm: 'ink' }] };
    }).reverse();
    const animation: LottieAnimation = { v: '5.13.0', fr: rate, ip: 0, op, w: width, h: height, nm: `${geometry.icon}/${variant}`, ddd: 0, assets: [], layers,
      meta: { labIcons: { profile, icon: geometry.icon, variant, logicalViewBox: [...geometry.viewBox], offset, durationMs: effectiveDuration,
        terminalFrame, terminalHoldFrames: 1, masterSha256: geometry.author.masterSha256, gesture: request.gesture ?? null, from: effect?.from ?? 0, to: effect?.to ?? 0 } } };
    return { ok: true, animation };
  }
  return Object.freeze({ exportLottie, lottieCapabilities });
}
