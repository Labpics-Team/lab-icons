export interface MotionSamplerTrack {
  readonly partId: string;
  readonly kind: 'rotate';
  readonly anchor: readonly [number, number];
  readonly from: number;
  readonly to: number;
  readonly unit: 'degrees';
  readonly interpolation: 'linear';
}

export interface MotionSamplerGesture {
  readonly id: string;
  readonly progress: 'normalized-0-to-1';
  readonly partIds: readonly string[];
  readonly tracks: readonly MotionSamplerTrack[];
}

export interface MotionSamplerSample {
  readonly partId: string;
  readonly kind: 'rotate';
  readonly anchor: readonly [number, number];
  readonly rotation: number;
}

export function validateMotionGesture<T extends MotionSamplerGesture>(gesture: T): T;
export function sampleMotionGesture(
  gesture: MotionSamplerGesture,
  progress: number,
): readonly MotionSamplerSample[];
