export{render,renderStateSvg,compileStateEffect,exportStateTransition,stateCapabilities}from'../states/status-circle.js';
import type{State}from'../states/status-circle.js';
export type{State}from'../states/status-circle.js';
import type{EnclosureVariationRequest,EnclosureVariationResult,EnclosureVariationCapabilities}from'../ir/state-annulus-types.js';
export declare function renderEnclosurePatch(request?:EnclosureVariationRequest):EnclosureVariationResult;
export declare function enclosureVariationCapabilities():EnclosureVariationCapabilities<State>;
