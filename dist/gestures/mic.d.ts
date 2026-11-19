import type { PrepareBodyWidthResult, BodyWidthMotionCapabilitiesResult } from '../ir/author-capsule-motion-types.js';
export type MotionVariant = "filled" | "outline";
export declare function prepareBodyWidth(variant?: MotionVariant): PrepareBodyWidthResult;
export declare function motionCapabilities(variant?: MotionVariant): BodyWidthMotionCapabilitiesResult;
