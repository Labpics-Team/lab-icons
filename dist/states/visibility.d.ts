import type { SourceStateRenderRequest, SourceStateEffectRequest, SourceStateTransitionExportRequest, StateSvgResult, SourceStateEffectResult, SourceStateGroupCapabilities } from '../ir/source-state-types.js';
export type State = "hidden" | "visible";
export declare function render(state?: State, options?: SourceStateRenderRequest<"outline">): StateSvgResult;
export declare function renderStateSvg(state?: State, options?: SourceStateRenderRequest<"outline">): StateSvgResult;
export declare function compileStateEffect(state: State, request: SourceStateEffectRequest<"outline">): SourceStateEffectResult<"outline">;
export declare function exportStateTransition(state: State, request: SourceStateTransitionExportRequest<"outline">): SourceStateEffectResult<"outline">;
export declare function stateCapabilities(): SourceStateGroupCapabilities<State, "outline">;

import type { IconSymbol } from '../render/index.js';
export declare const family: IconSymbol;
export default family;
