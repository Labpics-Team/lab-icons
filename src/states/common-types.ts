export type StateRefusalCode =
  | 'INVALID_REQUEST'
  | 'STATE_UNSUPPORTED'
  | 'VARIANT_UNSUPPORTED'
  | 'FORMAT_UNSUPPORTED'
  | 'VARIATION_UNSUPPORTED'
  | 'EFFECT_UNSUPPORTED'
  | 'POSE_UNREPRESENTABLE';

export interface StateRenderRequest {
  readonly variant?: 'outline' | 'filled';
}

export interface StateRefusal {
  readonly ok: false;
  readonly reason: Readonly<{ code: StateRefusalCode; message: string }>;
}

export type StateSvgResult = Readonly<{ ok: true; svg: string }> | StateRefusal;

