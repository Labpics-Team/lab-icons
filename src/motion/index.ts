import type { GlyphCapabilities, GlyphIR } from '../ir/compiler.js';
import { validateMotionGesture } from '../core/motion-sampler.js';

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

/** Данные эффекта; исполнитель и его часы принадлежат потребителю. */
export interface SymbolEffect {
  readonly version: 1;
  readonly icon: string;
  readonly variant: GlyphIR['variant'];
  readonly gesture: string;
  readonly from: number;
  readonly to: number;
  readonly targets: readonly SymbolEffectTarget[];
  readonly unchangedPartIds: readonly string[];
  /** Вращение authored silhouette может выходить за статический viewBox. */
  readonly viewport: Readonly<{ overflow: 'visible' }>;
  readonly options: Readonly<{ duration: number; easing: 'linear'; fill: 'both' }>;
}

export type SymbolEffectResult =
  | Readonly<{ ok: true; effect: SymbolEffect }>
  | Readonly<{ ok: false; reason: Readonly<{ code: SymbolEffectRefusalCode; message: string }> }>;

function refuse(code: SymbolEffectRefusalCode, message: string): SymbolEffectResult {
  return Object.freeze({ ok: false, reason: Object.freeze({ code, message }) });
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
  const anatomy = glyph.provenance.kind === 'source' ? glyph.provenance.anatomy : undefined;
  const author = glyph.provenance.kind === 'source' ? glyph.provenance.author : undefined;
  const sourceReady = capabilities.modelState === null && anatomy?.version === 1 && capabilities.anatomy?.version === 1 &&
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
    glyph.parts.every(part => part.provenance.kind === 'source' && part.provenance.identity === 'declared');
  if ((!modelReady && !sourceReady) || capabilities.motion.state !== 'gesture-ready') {
    return refuse('SEMANTIC_MOTION_UNAVAILABLE', 'Для этого варианта нет принятого семантического жеста.');
  }
  const gesture = capabilities.motion.gestures.find((entry) => entry.id === gestureId);
  if (!gesture) return refuse('GESTURE_UNSUPPORTED', `Жест ${gestureId} не объявлен для этого варианта.`);
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
    const part = glyph.parts.find(part => part.id === track.partId);
    return !part || part.anchorSource !== 'declared' || part.anchor.some((value, index) => value !== track.anchor[index]);
  })) {
    return refuse('CAPABILITY_MISMATCH', 'Якоря возможностей не относятся к этой версии анатомии.');
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
