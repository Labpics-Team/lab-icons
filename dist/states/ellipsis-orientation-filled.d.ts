import type { ContourStateRenderRequest, ContourStateEffectRequest, ContourStateExportRequest, StateSvgResult, ContourStateEffectResult, ContourStateCapabilities } from '../ir/contour-state-types.js';
export type State = "horizontal" | "vertical";
export declare function render(state?: State, options?: ContourStateRenderRequest): StateSvgResult;
export declare function renderStateSvg(state?: State, options?: ContourStateRenderRequest): StateSvgResult;
export declare function compileStateEffect(state: State, request: ContourStateEffectRequest): ContourStateEffectResult;
export declare function exportStateTransition(state: State, request: ContourStateExportRequest): ContourStateEffectResult;
export declare function stateCapabilities(): ContourStateCapabilities<State>;
