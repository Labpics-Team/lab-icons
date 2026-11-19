import type { StateRenderRequest, StateEffectRequest, StateTransitionExportRequest, StateSvgResult, StateEffectResult, StateGroupCapabilities } from '../ir/state-types.js';
export type State = "pause" | "play";
export declare function render(state?: State, options?: StateRenderRequest): StateSvgResult;
export declare function renderStateSvg(state?: State, options?: StateRenderRequest): StateSvgResult;
export declare function compileStateEffect(state: State, request: StateEffectRequest): StateEffectResult;
export declare function exportStateTransition(state: State, request: StateTransitionExportRequest): StateEffectResult;
export declare function stateCapabilities(): StateGroupCapabilities<State>;
