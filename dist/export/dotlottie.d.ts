import type { LottieAnimation } from './types.js';
export interface DotLottieOptions {
    /** Archive-local animation ID; defaults to "animation". */
    readonly id?: string;
}
/** Packages the existing animation JSON as dotLottie v2; no geometry or timing changes. */
export declare function packDotLottie(animation: LottieAnimation, options?: DotLottieOptions): Uint8Array;
