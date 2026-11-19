import type { MotionCapabilitiesResult, MotionEffectRequest, MotionEffectResult, MotionSvgResult } from '../ir/gesture-types.js';
export type MotionVariant = "filled" | "outline";
export type Gesture = "reload.cycle";
export declare function renderMotionSvg(variant?: MotionVariant): MotionSvgResult;
export declare function compileMotionEffect(gesture: Gesture, request: Omit<MotionEffectRequest, "variant"> & { readonly variant?: MotionVariant }): MotionEffectResult;
export declare function motionCapabilities(variant?: MotionVariant): MotionCapabilitiesResult;
