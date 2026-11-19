import type { SourceStateRenderRequest, SourceStateEffectRequest, SourceStateTransitionExportRequest, StateSvgResult, SourceStateEffectResult, SourceStateGroupCapabilities } from '../ir/source-state-types.js';
export type State = "hidden" | "visible";
export declare function render(state?: State, options?: SourceStateRenderRequest<"filled">): StateSvgResult;
export declare function renderStateSvg(state?: State, options?: SourceStateRenderRequest<"filled">): StateSvgResult;
export declare function compileStateEffect(state: State, request: SourceStateEffectRequest<"filled">): SourceStateEffectResult<"filled">;
export declare function exportStateTransition(state: State, request: SourceStateTransitionExportRequest<"filled">): SourceStateEffectResult<"filled">;
export declare function stateCapabilities(): SourceStateGroupCapabilities<State, "filled">;
