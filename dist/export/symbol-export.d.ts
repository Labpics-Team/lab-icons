import type { IconSymbol, IconVariant, RenderIconOptions } from '../render/index.js';
import type { LottieCapabilities, LottieExportRequest, LottieExportResult } from './types.js';
/** Exports the same numeric symbol and semantic pose used by mounted SVG motion. */
export declare function exportSymbolLottie(symbol: IconSymbol, request?: LottieExportRequest): LottieExportResult;
export declare function symbolLottieCapabilities(symbol: IconSymbol, options?: IconVariant | RenderIconOptions): LottieCapabilities;
