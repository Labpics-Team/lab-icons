import type { IconVariant } from '../ir/compiler.js';

export type LottieRefusalCode = 'INVALID_REQUEST' | 'AUTHOR_SOURCE_REQUIRED' | 'COMPOSITION_UNSUPPORTED' |
  'PAINT_UNSUPPORTED' | 'PATH_INVALID' | 'ARC_UNSUPPORTED' | 'OPEN_CONTOUR_UNSUPPORTED' |
  'GEOMETRY_MISMATCH' | 'MOTION_UNAVAILABLE' | 'DURATION_NOT_FRAME_ALIGNED' | 'CANVAS_UNSUPPORTED';

export interface LottieExportRequest {
  readonly variant?: IconVariant;
  /** Без gesture экспортируется неподвижный авторский master. */
  readonly gesture?: string;
  readonly duration?: number;
  readonly from?: number;
  readonly to?: number;
  readonly reducedMotion?: boolean;
  /** Lottie не имеет currentColor: цвет материализуется явно. */
  readonly color?: `#${string}`;
  readonly frameRate?: number;
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
    terminalFrame: number; terminalHoldFrames: 1; masterSha256: string;
    gesture: string | null; from: number; to: number;
  } };
}

export type LottieExportResult =
  | { readonly ok: true; readonly animation: LottieAnimation }
  | { readonly ok: false; readonly reason: Readonly<{ code: LottieRefusalCode; message: string }> };
