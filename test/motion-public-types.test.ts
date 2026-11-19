import { expect, it } from 'vitest';
import * as motion from '@labpics/motion';
import { createSymbolMotion, type SymbolMotionRuntime } from '../src/motion/index.js';

it('accepts the installed public Motion API without a custom adapter', () => {
  // This assignment is also checked by the package's real TypeScript compiler.
  const runtime: SymbolMotionRuntime = motion;
  const executor = createSymbolMotion(runtime);
  expect(Object.isFrozen(executor)).toBe(true);
});
