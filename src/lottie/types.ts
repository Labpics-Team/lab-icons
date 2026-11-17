import type { IconVariant, RenderIconOptions } from '../render/index.js';

export type LottieRefusalCode = 'INVALID_REQUEST' | 'COMPOSITION_UNSUPPORTED' |
  'PAINT_UNSUPPORTED' | 'PATH_INVALID' | 'OPEN_CONTOUR_UNSUPPORTED' |
  'MOTION_UNAVAILABLE' | 'CANVAS_UNSUPPORTED' | 'VARIATION_UNSUPPORTED' |
  'SYMBOL_DATA_REQUIRED' | 'MOTION_UNSUPPORTED' | 'TOPOLOGY_UNSUPPORTED';

export interface LottieExportRequest extends RenderIconOptions {
  /** Without a gesture or transition, exports the requested static optical pose. */
  readonly gesture?: string;
  readonly duration?: number;
  readonly from?: number;
  readonly to?: number;
  readonly reducedMotion?: boolean;
  /** Lottie не имеет currentColor: цвет материализуется явно. */
  readonly color?: `#${string}`;
  readonly frameRate?: number;
  readonly transition?: Readonly<{ from: RenderIconOptions; to: RenderIconOptions }>;
}

export interface LottieCapabilities {
  readonly profile: 'lottie-web-svg-5.13';
  readonly static: boolean;
  readonly gestures: readonly string[];
  readonly reason?: Readonly<{ code: LottieRefusalCode; message: string }>;
}

/** JSON отдаётся свежим и изменяемым: player нормализует tangents in-place. */
export interface LottieAnimation {
  v: '5.13.0'; fr: number; ip: 0; op: number; w: number; h: number; nm: string;
  ddd: 0; assets: unknown[]; layers: Record<string, unknown>[];
  meta: { labIcons: {
    profile: 'lottie-web-svg-5.13'; icon: string; variant: IconVariant;
    logicalViewBox: number[]; offset: number[]; durationMs: number;
    terminalFrame: number; terminalHoldFrames: number; masterSha256?: string;
    gesture: string | null; from: number; to: number;
  } };
}

export type LottieExportResult =
  | { readonly ok: true; readonly animation: LottieAnimation }
  | { readonly ok: false; readonly reason: Readonly<{ code: LottieRefusalCode; message: string }> };
