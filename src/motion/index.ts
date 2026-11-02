import type { GlyphCapabilities, GlyphIR, MotionGestureOpacityTrackContract, MotionGestureTranslationTrackContract } from '../ir/glyph-types.js';
import { sampleOpacityTrack, sampleTranslationTrack, validateMotionGesture } from '../core/motion-sampler.js';
import type { PreparedContourStateEffect, SymbolContourStateEffect } from '../states/contour-types.js';
import { prepareContourStateEffect as prepareContourPacket } from '../ir/contour-runtime.js';

export type { SymbolContourStateEffect, PreparedContourStateEffect, ContourStatePoseResult } from '../states/contour-types.js';
/** Подготовка контура без каталога и часов. */
export function prepareContourStateEffect(effect: SymbolContourStateEffect): PreparedContourStateEffect {
  return prepareContourPacket(effect);
}

export type SymbolEffectRefusalCode =
  | 'INVALID_REQUEST'
  | 'CAPABILITY_MISMATCH'
  | 'SEMANTIC_MOTION_UNAVAILABLE'
  | 'GESTURE_UNSUPPORTED'
  | 'INVALID_GESTURE'
  | 'COMPOSITION_NOT_ADDRESSABLE';

export interface SymbolEffectRequest {
  readonly duration: number;
  readonly from?: number;
  readonly to?: number;
  readonly reducedMotion?: boolean;
}

export interface SymbolEffectTarget {
  readonly partId: string;
  readonly rotation: Readonly<{ from: number; to: number; unit: 'degrees' }>;
  readonly style: Readonly<{ transformBox: 'view-box'; transformOrigin: string }>;
  readonly keyframes: readonly [
    Readonly<{ offset: 0; transform: string }>,
    Readonly<{ offset: 1; transform: string }>,
  ];
}

export interface SymbolEffect {
  readonly version: 1;
  readonly icon: string;
  readonly variant: GlyphIR['variant'];
  readonly gesture: string;
  readonly from: number;
  readonly to: number;
  readonly targets: readonly SymbolEffectTarget[];
  readonly unchangedPartIds: readonly string[];
  /** Форма может выходить за viewBox при движении. */
  readonly viewport: Readonly<{ overflow: 'visible' }>;
  readonly options: Readonly<{ duration: number; easing: 'linear'; fill: 'both' }>;
}

export interface SymbolOpacityStage {
  readonly partId: string;
  readonly property: 'opacity';
  /** Первый этап подхватывает текущую позу. */
  readonly to: number;
  /** От начала эффекта, мс. */
  readonly at: number;
  readonly duration: number;
}

export interface SymbolSequenceEffect {
  readonly version: 2;
  readonly icon: string;
  readonly variant: GlyphIR['variant'];
  readonly gesture: string;
  readonly from: number;
  readonly to: number;
  readonly targets: readonly Readonly<{ partId: string; property: 'opacity'; from: number; to: number }>[];
  readonly stages: readonly SymbolOpacityStage[];
  readonly unchangedPartIds: readonly string[];
  readonly viewport: Readonly<{ overflow: 'visible' }>;
  readonly options: Readonly<{ duration: number; easing: 'linear'; fill: 'both' }>;
}

export interface SymbolTranslationStage {
  readonly partId: string;
  readonly property: 'x' | 'y';
  readonly unit: 'viewBox';
  readonly to: number;
  readonly at: number;
  readonly duration: number;
}

export interface SymbolTranslationEffect {
  readonly version: 3;
  readonly icon: string;
  readonly variant: GlyphIR['variant'];
  readonly gesture: string;
  readonly from: number;
  readonly to: number;
  readonly targets: readonly Readonly<{ partId: string; property: 'x' | 'y'; unit: 'viewBox'; from: number; to: number }>[];
  readonly stages: readonly SymbolTranslationStage[];
  readonly unchangedPartIds: readonly string[];
  readonly viewport: Readonly<{ overflow: 'visible' }>;
  readonly options: Readonly<{ duration: number; easing: 'linear'; fill: 'both' }>;
}

export type SymbolEffectResult =
  | Readonly<{ ok: true; effect: SymbolEffect | SymbolSequenceEffect | SymbolTranslationEffect }>
  | Readonly<{ ok: false; reason: Readonly<{ code: SymbolEffectRefusalCode; message: string }> }>;

function refuse(code: SymbolEffectRefusalCode, message: string): SymbolEffectResult {
  return Object.freeze({ ok: false, reason: Object.freeze({ code, message }) });
}

function scalarStages(stops: readonly Readonly<{ at: number; value: number }>[], sample: (progress: number) => number,
  from: number, to: number, duration: number): readonly Readonly<{ to: number; at: number; duration: number }>[] {
  if (duration === 0) return [Object.freeze({ to: sample(to), at: 0, duration: 0 })];
  const forward = to > from;
  const interior = stops.filter(stop => forward ? stop.at > from && stop.at < to : stop.at < from && stop.at > to);
  if (!forward) interior.reverse();
  const points = [from, ...interior.map(stop => stop.at), to];
  const stages: Readonly<{ to: number; at: number; duration: number }>[] = [];
  let at = 0;
  for (let index = 1; index < points.length; index++) {
    const progress = points[index]!;
    const end = index === points.length - 1 ? duration : Math.abs((progress - from) / (to - from)) * duration;
    stages.push(Object.freeze({ to: sample(progress), at, duration: end - at }));
    // Следующий этап начинается в том же IEEE-754 end, который отдаётся executor.
    at += end - at;
  }
  return stages;
}

function opacityStages(track: MotionGestureOpacityTrackContract, from: number, to: number, duration: number): readonly SymbolOpacityStage[] {
  return scalarStages(track.stops, progress => sampleOpacityTrack(track, progress), from, to, duration)
    .map(stage => Object.freeze({ partId: track.partId, property: 'opacity' as const, ...stage }));
}

function translationStages(track: MotionGestureTranslationTrackContract, from: number, to: number, duration: number): readonly SymbolTranslationStage[] {
  return scalarStages(track.stops, progress => sampleTranslationTrack(track, progress), from, to, duration)
    .map(stage => Object.freeze({ partId: track.partId, property: track.axis, unit: track.unit, ...stage }));
}

/**
 * Компилирует объявленный жест в обычные keyframes без каталога и разбора path.
 * from задаёт уже видимый прогресс: прерывание не возвращает символ к началу.
 */
export function compileSymbolEffect(
  glyph: GlyphIR<string>,
  capabilities: GlyphCapabilities<string>,
  gestureId: string,
  request: SymbolEffectRequest,
): SymbolEffectResult {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).some((key) => !['duration', 'from', 'to', 'reducedMotion'].includes(key)) ||
      !Number.isFinite(request.duration) || request.duration < 0 ||
      (request.reducedMotion !== undefined && typeof request.reducedMotion !== 'boolean')) {
    return refuse('INVALID_REQUEST', 'Нужны конечная длительность ≥0 и поддержанные параметры эффекта.');
  }
  const from = request.from ?? 0;
  const to = request.to ?? 1;
  if (![from, to].every((value) => Number.isFinite(value) && value >= 0 && value <= 1)) {
    return refuse('INVALID_REQUEST', 'Прогресс from и to обязан принадлежать [0,1].');
  }
  if (glyph.icon !== capabilities.icon || glyph.variant !== capabilities.variant) {
    return refuse('CAPABILITY_MISMATCH', 'Возможности относятся к другому символу или варианту.');
  }
  const modelReady = glyph.provenance.kind === 'model' && glyph.provenance.state === 'accepted' &&
    capabilities.modelState === 'accepted';
  const authorBacked = glyph.provenance.kind === 'source' || glyph.provenance.kind === 'authored-variation';
  const anatomy = authorBacked ? glyph.provenance.anatomy : undefined;
  const author = authorBacked ? glyph.provenance.author : undefined;
  const variationReady = glyph.provenance.kind !== 'authored-variation' ||
    glyph.provenance.variation.version === 1 && capabilities.variation?.version === 1 &&
    (glyph.provenance.variation.law === 'dots.affine' || glyph.provenance.variation.law === 'annulus.counter-scale' ||
     glyph.provenance.variation.law === 'annulus.content-counter-scale') &&
    capabilities.variation.law === glyph.provenance.variation.law &&
    capabilities.variation.targets?.webEffect === 'existing-part-gestures' &&
    glyph.provenance.variation.geometrySha256 === capabilities.variation.geometrySha256;
  const sourceReady = variationReady && capabilities.modelState === null && anatomy?.version === 1 && capabilities.anatomy?.version === 1 &&
    /^[a-f0-9]{64}$/.test(anatomy.annotationSha256) &&
    anatomy.annotationSha256 === capabilities.anatomy?.annotationSha256 &&
    anatomy.masterSha256 === capabilities.anatomy?.masterSha256 &&
    anatomy.pathFingerprintSha256 === capabilities.anatomy?.pathFingerprintSha256 &&
    anatomy.masterSha256 === author?.masterSha256 &&
    anatomy.pathFingerprintSha256 === author?.pathFingerprintSha256 &&
    author?.fileKey === capabilities.author?.fileKey && author?.version === capabilities.author?.version &&
    author?.nodeId === capabilities.author?.nodeId && author?.nodeSha256 === capabilities.author?.nodeSha256 &&
    author?.masterSha256 === capabilities.author?.masterSha256 &&
    author?.normalizedSha256 === capabilities.author?.normalizedSha256 &&
    author?.pathFingerprintSha256 === capabilities.author?.pathFingerprintSha256 &&
    glyph.parts.every(part => part.provenance.identity === 'declared' &&
      (part.provenance.kind === 'source' || glyph.provenance.kind === 'authored-variation' &&
       part.provenance.kind === 'authored-variation' && part.provenance.source.kind === 'source' &&
       part.provenance.source.identity === 'declared' &&
       part.provenance.variation.version === glyph.provenance.variation.version &&
       part.provenance.variation.law === glyph.provenance.variation.law &&
       part.provenance.variation.geometrySha256 === glyph.provenance.variation.geometrySha256));
  if ((!modelReady && !sourceReady) || capabilities.motion.state !== 'gesture-ready') {
    return refuse('SEMANTIC_MOTION_UNAVAILABLE', 'Для этого варианта нет принятого семантического жеста.');
  }
  const gesture = capabilities.motion.gestures.find((entry) => entry.id === gestureId);
  if (!gesture) return refuse('GESTURE_UNSUPPORTED', `Жест ${gestureId} не объявлен для этого варианта.`);
  if (glyph.provenance.kind === 'authored-variation' && !gesture.tracks.every(track => track.kind === 'opacity')) {
    return refuse('SEMANTIC_MOTION_UNAVAILABLE', 'Авторская вариация сохраняет только независимые opacity-жесты частей.');
  }
  try {
    validateMotionGesture(gesture);
  } catch {
    return refuse('INVALID_GESTURE', 'Объявленный жест не соответствует контракту движения.');
  }
  const partIds = new Set(glyph.parts.map((part) => part.id));
  if (partIds.size !== glyph.parts.length ||
      gesture.partIds.some((id) => !partIds.has(id)) ||
      glyph.composition.kind === 'compound') {
    return refuse('COMPOSITION_NOT_ADDRESSABLE', 'Композиция не сохраняет отдельные цели объявленного жеста.');
  }
  if (gesture.tracks.some(track => {
    if (track.kind !== 'rotate') return false;
    const part = glyph.parts.find(part => part.id === track.partId);
    return !part || part.anchorSource !== 'declared' || part.anchor.some((value, index) => value !== track.anchor[index]);
  })) {
    return refuse('CAPABILITY_MISMATCH', 'Якоря возможностей не относятся к этой версии анатомии.');
  }
  if (gesture.tracks.every(track => track.kind === 'opacity')) {
    if (glyph.composition.kind !== 'layers') {
      return refuse('COMPOSITION_NOT_ADDRESSABLE', 'Opacity-стадии требуют независимых layers авторской композиции.');
    }
    const duration = request.reducedMotion || from === to ? 0 : request.duration;
    const tracks = gesture.tracks as readonly MotionGestureOpacityTrackContract[];
    const animated = new Set(tracks.map(track => track.partId));
    const stages = tracks.flatMap(track => opacityStages(track, from, to, duration))
      .sort((a, b) => a.at - b.at || (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0));
    return Object.freeze({ ok: true, effect: Object.freeze({
      version: 2, icon: glyph.icon, variant: glyph.variant, gesture: gesture.id, from, to,
      targets: Object.freeze(tracks.map(track => Object.freeze({ partId: track.partId, property: 'opacity' as const,
        from: sampleOpacityTrack(track, from), to: sampleOpacityTrack(track, to) }))),
      stages: Object.freeze(stages),
      unchangedPartIds: Object.freeze(glyph.parts.filter(part => !animated.has(part.id)).map(part => part.id)),
      viewport: Object.freeze({ overflow: 'visible' as const }),
      options: Object.freeze({ duration, easing: 'linear' as const, fill: 'both' as const }),
    }) });
  }
  if (gesture.tracks.every(track => track.kind === 'translate')) {
    if (glyph.composition.kind !== 'layers') {
      return refuse('COMPOSITION_NOT_ADDRESSABLE', 'Translation-стадии требуют независимых layers авторской композиции.');
    }
    const duration = request.reducedMotion || from === to ? 0 : request.duration;
    const tracks = gesture.tracks as readonly MotionGestureTranslationTrackContract[];
    const animated = new Set(tracks.map(track => track.partId));
    const stages = tracks.flatMap(track => translationStages(track, from, to, duration))
      .sort((a, b) => a.at - b.at || (a.partId < b.partId ? -1 : a.partId > b.partId ? 1 : 0));
    return Object.freeze({ ok: true, effect: Object.freeze({
      version: 3, icon: glyph.icon, variant: glyph.variant, gesture: gesture.id, from, to,
      targets: Object.freeze(tracks.map(track => Object.freeze({ partId: track.partId, property: track.axis, unit: track.unit,
        from: sampleTranslationTrack(track, from), to: sampleTranslationTrack(track, to) }))),
      stages: Object.freeze(stages),
      unchangedPartIds: Object.freeze(glyph.parts.filter(part => !animated.has(part.id)).map(part => part.id)),
      viewport: Object.freeze({ overflow: 'visible' as const }),
      options: Object.freeze({ duration, easing: 'linear' as const, fill: 'both' as const }),
    }) });
  }
  if (!gesture.tracks.every(track => track.kind === 'rotate')) {
    return refuse('INVALID_GESTURE', 'Один эффект обязан использовать одну поддержанную систему каналов.');
  }
  const animatedPartIds = new Set(gesture.tracks.map((track) => track.partId));
  const targets = gesture.tracks.map((track): SymbolEffectTarget => Object.freeze({
    partId: track.partId,
    rotation: Object.freeze({
      from: track.from + (track.to - track.from) * from,
      to: track.from + (track.to - track.from) * to,
      unit: 'degrees',
    }),
    // Проценты относятся к viewBox, включая ненулевое начало и масштаб SVG.
    style: Object.freeze({
      transformBox: 'view-box',
      transformOrigin: `${track.anchor[0] * 100}% ${track.anchor[1] * 100}%`,
    }),
    keyframes: Object.freeze([
      Object.freeze({ offset: 0, transform: `rotate(${track.from + (track.to - track.from) * from}deg)` }),
      Object.freeze({ offset: 1, transform: `rotate(${track.from + (track.to - track.from) * to}deg)` }),
    ] as const),
  }));
  return Object.freeze({
    ok: true,
    effect: Object.freeze({
      version: 1,
      icon: glyph.icon,
      variant: glyph.variant,
      gesture: gesture.id,
      from,
      to,
      targets: Object.freeze(targets),
      unchangedPartIds: Object.freeze(glyph.parts.filter((part) => !animatedPartIds.has(part.id)).map((part) => part.id)),
      viewport: Object.freeze({ overflow: 'visible' }),
      options: Object.freeze({
        duration: request.reducedMotion || from === to ? 0 : request.duration,
        easing: 'linear',
        fill: 'both',
      }),
    }),
  });
}
