import type { SymbolTrack } from '../render/index.js';

export const symbolRest: Readonly<Omit<SymbolPaintPose, 'alpha'>> = Object.freeze({ opacity: 1, x: 0, y: 0, rotate: 0, draw: 1 });
export type SymbolPoseChannel = keyof typeof symbolRest;
export const symbolPoseChannels = Object.keys(symbolRest) as readonly SymbolPoseChannel[];
export interface SymbolPaintPose { alpha: number; opacity: number; x: number; y: number; rotate: number; draw: number }

/** Pure piecewise-linear semantic law, shared by the live clock and file export. */
export function sampleSymbolTrack(track: SymbolTrack, progress: number, linear = false): number {
  const stops = track.stops;
  if (linear) return stops[0]![1] + progress * (stops.at(-1)![1] - stops[0]![1]);
  if (progress <= stops[0]![0]) return stops[0]![1];
  for (let index = 1; index < stops.length; index++) {
    const left = stops[index - 1]!, right = stops[index]!;
    if (progress <= right[0]) return left[1] + (right[1] - left[1]) * (progress - left[0]) / (right[0] - left[0]);
  }
  return stops[stops.length - 1]![1];
}

/** Mutates an existing pose; the live frame path does not allocate snapshots. */
export function sampleSymbolTransition(target: SymbolPaintPose, start: SymbolPaintPose, present: boolean,
  progress: number, resetChannels?: Iterable<SymbolPoseChannel>): void {
  target.alpha = start.alpha + ((present ? 1 : 0) - start.alpha) * progress;
  if (resetChannels) for (const channel of resetChannels) {
    target[channel] = start[channel] + (symbolRest[channel] - start[channel]) * progress;
  }
}

export function sampleSymbolEffectValue(track: SymbolTrack, phase: number, progress: number,
  start: number, base: number, linear: boolean, preserveTurn: boolean): number {
  return sampleSymbolTrack(track, phase, linear) + (start - base) * (preserveTurn ? 1 : 1 - progress);
}

/** Only members of an explicitly declared layer normalize their coverage. */
export function symbolCoverageAlpha(alpha: number, layerAlpha: number): number {
  return layerAlpha > 0 ? alpha / layerAlpha : 0;
}
