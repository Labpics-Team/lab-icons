import type { SymbolEffect, SymbolEffectRequest, SymbolEffectResult, SymbolEffectTarget } from './index.js';

export interface RotationGestureDefinition {
  readonly id: string;
  readonly targets: readonly Readonly<{ partId: string; anchor: readonly [number, number]; from: number; to: number }>[];
  readonly unchangedPartIds: readonly string[];
}

export type ParsedEffectRequest =
  | Readonly<{ ok: true; from: number; to: number; duration: number }>
  | Extract<SymbolEffectResult, { ok: false }>;

/** Одна граница фаз и reduced motion для IR и готового target packet. */
export function parseEffectRequest(request: SymbolEffectRequest): ParsedEffectRequest {
  if (!request || typeof request !== 'object' || Array.isArray(request) ||
      Object.keys(request).some(key => !['duration', 'from', 'to', 'reducedMotion'].includes(key)) ||
      !Number.isFinite(request.duration) || request.duration < 0 ||
      (request.reducedMotion !== undefined && typeof request.reducedMotion !== 'boolean')) {
    return Object.freeze({ ok: false, reason: Object.freeze({ code: 'INVALID_REQUEST',
      message: 'Нужны конечная длительность ≥0 и поддержанные параметры эффекта.' }) });
  }
  const from = request.from === undefined ? 0 : request.from;
  const to = request.to === undefined ? 1 : request.to;
  if (![from, to].every(value => Number.isFinite(value) && value >= 0 && value <= 1)) {
    return Object.freeze({ ok: false, reason: Object.freeze({ code: 'INVALID_REQUEST',
      message: 'Прогресс from и to обязан принадлежать [0,1].' }) });
  }
  return { ok: true, from, to, duration: request.reducedMotion || from === to ? 0 : request.duration };
}

/** Семантика и anchors проверены владельцем; runtime вычисляет только две позы. */
export function projectRotationEffect(icon: string, variant: SymbolEffect['variant'], gesture: RotationGestureDefinition,
  request: Extract<ParsedEffectRequest, { ok: true }>): SymbolEffect {
  const { from, to, duration } = request;
  const targets = gesture.targets.map((track): SymbolEffectTarget => Object.freeze({
    partId: track.partId,
    rotation: Object.freeze({ from: track.from + (track.to - track.from) * from,
      to: track.from + (track.to - track.from) * to, unit: 'degrees' }),
    style: Object.freeze({ transformBox: 'view-box',
      transformOrigin: `${track.anchor[0] * 100}% ${track.anchor[1] * 100}%` }),
    keyframes: Object.freeze([
      Object.freeze({ offset: 0, transform: `rotate(${track.from + (track.to - track.from) * from}deg)` }),
      Object.freeze({ offset: 1, transform: `rotate(${track.from + (track.to - track.from) * to}deg)` }),
    ] as const),
  }));
  return Object.freeze({ version: 1, icon, variant, gesture: gesture.id, from, to,
    targets: Object.freeze(targets), unchangedPartIds: Object.freeze([...gesture.unchangedPartIds]),
    viewport: Object.freeze({ overflow: 'visible' }),
    options: Object.freeze({ duration, easing: 'linear', fill: 'both' }) });
}
