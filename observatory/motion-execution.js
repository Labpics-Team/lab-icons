import * as motion from '@labpics/motion';
import { createSymbolMotion } from './package/motion/index.js';

export const { executeSymbolEffect, executePreparedWidth, executePreparedClock } = createSymbolMotion(motion);
export const executionIdentity = Object.freeze(__MOTION_IDENTITY__);
