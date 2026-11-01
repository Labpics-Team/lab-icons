export interface MotionSamplerRotationTrack {
  readonly partId: string;
  readonly kind: 'rotate';
  readonly anchor: readonly [number, number];
  readonly from: number;
  readonly to: number;
  readonly unit: 'degrees';
  readonly interpolation: 'linear';
}

export interface MotionSamplerOpacityTrack {
  readonly partId: string;
  readonly kind: 'opacity';
  readonly unit: 'fraction';
  readonly interpolation: 'linear';
  readonly stops: readonly Readonly<{ at: number; value: number }>[];
}

export interface MotionSamplerTranslationTrack {
  readonly partId: string;
  readonly kind: 'translate';
  readonly axis: 'x' | 'y';
  readonly unit: 'viewBox';
  readonly interpolation: 'linear';
  readonly stops: readonly Readonly<{ at: number; value: number }>[];
}

export type MotionSamplerTrack = MotionSamplerRotationTrack | MotionSamplerOpacityTrack | MotionSamplerTranslationTrack;

export interface MotionSamplerGesture {
  readonly id: string;
  readonly progress: 'normalized-0-to-1';
  readonly partIds: readonly string[];
  readonly tracks: readonly MotionSamplerTrack[];
}

export interface MotionSamplerRotationSample {
  readonly partId: string;
  readonly kind: 'rotate';
  readonly anchor: readonly [number, number];
  readonly rotation: number;
}

export type MotionSamplerSample = MotionSamplerRotationSample |
  Readonly<{ partId: string; kind: 'opacity'; opacity: number }> |
  Readonly<{ partId: string; kind: 'translate'; axis: 'x' | 'y'; unit: 'viewBox'; translation: number }>;

export function sampleOpacityTrack(track: MotionSamplerOpacityTrack, progress: number): number;
export function sampleTranslationTrack(track: MotionSamplerTranslationTrack, progress: number): number;

export function validateMotionGesture<T extends MotionSamplerGesture>(gesture: T): T;
export function sampleMotionGesture(
  gesture: MotionSamplerGesture,
  progress: number,
): readonly MotionSamplerSample[];
