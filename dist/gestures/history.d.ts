import type { PrepareClockHandsResult, ClockHandsCapabilitiesResult } from '../ir/author-clock-motion-types.js';
export type MotionVariant = "filled" | "outline";
export declare function prepareClockHands(variant?: MotionVariant): PrepareClockHandsResult;
export declare function motionCapabilities(variant?: MotionVariant): ClockHandsCapabilitiesResult;
