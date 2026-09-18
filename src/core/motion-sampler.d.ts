export interface MotionSamplerTrack {
  readonly partId: string;
  readonly kind: 'rotate' | 'translate' | 'opacity' | 'scale' | 'reveal';
  readonly anchor?: readonly [number, number];
  readonly from: number;
  readonly to: number;
  readonly unit: 'degrees' | 'px' | 'percent' | 'normalized' | 'factor';
  readonly interpolation: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out';
}

export interface MotionSamplerGesture {
  readonly id: string;
  readonly kind?: string;
  readonly meaning?: string;
  readonly progress: 'normalized-0-to-1';
  readonly reducedMotion?: 'static' | 'fade-only' | 'none';
  readonly partIds: readonly string[];
  readonly tracks: readonly MotionSamplerTrack[];
}

export interface MotionSamplerSample {
  readonly partId: string;
  readonly kind: 'rotate' | 'translate' | 'opacity' | 'scale' | 'reveal';
  readonly anchor?: readonly [number, number];
  readonly rotation?: number;
  readonly opacity?: number;
  readonly translation?: number;
  readonly scale?: number;
}

export function validateMotionGesture<T extends MotionSamplerGesture>(gesture: T): T;
export function sampleMotionGesture(
  gesture: MotionSamplerGesture,
  progress: number,
): readonly MotionSamplerSample[];
