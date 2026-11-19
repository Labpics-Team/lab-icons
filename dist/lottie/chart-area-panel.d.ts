import type { LottieExportRequest, LottieExportResult, LottieCapabilities } from '../export/types.js';
import type { IconVariant, RenderIconOptions } from '../render/index.js';
export declare function exportLottie(request?: LottieExportRequest): LottieExportResult;
export declare function lottieCapabilities(options?: IconVariant | RenderIconOptions): LottieCapabilities;
