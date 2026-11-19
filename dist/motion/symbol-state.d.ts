import type { IconSymbol, RenderIconOptions } from '../render/index.js';
import type { SymbolMotionRuntime, SymbolPlayback } from './execution.js';
export interface IconTransitionOptions {
    readonly duration?: number;
    readonly reducedMotion?: boolean;
}
export interface IconEffectOptions extends IconTransitionOptions {
    /** Explicit endpoints continue; omission replays a gesture or advances elapsed time by one hour. */
    readonly to?: number;
}
export interface MountedIcon {
    readonly element: SVGSVGElement;
    readonly state: string | undefined;
    set(options: RenderIconOptions, transition?: IconTransitionOptions): SymbolPlayback;
    setState(state: string, transition?: IconTransitionOptions): SymbolPlayback;
    setDate(date: Date, timeZone: string, transition?: IconTransitionOptions): SymbolPlayback;
    effect(name: string, options?: IconEffectOptions): SymbolPlayback;
    /** Stops all controls and removes the mounted SVG. Idempotent. */
    dispose(): void;
}
/** No SVG parser, geometry inference, clock or subscriptions on a static mount. */
export declare function mountSymbol(runtime: SymbolMotionRuntime, root: Element, symbol: IconSymbol, initial?: RenderIconOptions): MountedIcon;
