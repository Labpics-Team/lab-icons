import { describe, expect, it } from 'vitest';
import check from '../dist/symbols/checkmark-circle.js';
import { opticalPosition, sampleOpticalPath } from '../src/render/optical-grid.ts';

describe('subtractive motion preserves the optical source', () => {
  it('retains every original coordinate and coefficient when splitting the authored contours', () => {
    const original = check.data.variants.filled.paths[0];
    const motion = check.semantics.variants.filled;
    expect(motion.parts.map(part => part.id)).toEqual(['circle-enclosure', 'confirmation-mark']);
    expect(motion.parts.map(part => part.negative ?? false)).toEqual([false, true]);
    expect(new Set(motion.parts.map(part => part.layer)).size).toBe(1);
    expect(motion.parts[1].draw).toBeDefined();
    expect(motion.paths.map(path => path.commands).join('')).toBe(original.commands);
    for (const weight of [300, 350, 400, 500, 600]) for (const opsz of [16, 20, 24, 36, 48]) {
      const at = opticalPosition(check.data.axes, weight, opsz);
      expect(motion.paths.flatMap(path => [...sampleOpticalPath(path, at)])).toEqual([...sampleOpticalPath(original, at)]);
    }
    expect(check.semantics.variants.outline.paths).toBeUndefined();
  });
});
