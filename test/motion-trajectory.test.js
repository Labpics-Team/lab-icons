import { describe, expect, it } from 'vitest';
import { buildGlyphParts } from '../scripts/lib/anatomy-gen.js';
import { checkMotionContracts } from '../scripts/check-motion.js';
import {
  motionEntriesAt,
  proveMotionTrajectory,
} from '../scripts/lib/motion-trajectory.js';
import { sampleMotionGesture } from '../scripts/lib/motion-sampler.js';
import anatomy from '../semantics/anatomy.json';
import grid from '../semantics/grid.json';
import catalog from '../semantics/catalog.json';

const time = anatomy.glyphs.time;
const built = buildGlyphParts(time, grid, {}, anatomy.glyphs);
const composition = catalog.icons.time.model.variants.outline.composition;
const gesture = time.motion.gestures[0];

describe('time motion trajectory', () => {
  it('uses normalized progress and independent minute/hour angular laws', () => {
    expect(sampleMotionGesture(gesture, 0)).toMatchObject([
      { partId: 'hand-minute', rotation: 0 },
      { partId: 'hand-hour', rotation: 0 },
    ]);
    expect(sampleMotionGesture(gesture, 0.5)).toMatchObject([
      { partId: 'hand-minute', rotation: 180 },
      { partId: 'hand-hour', rotation: 15 },
    ]);
    expect(sampleMotionGesture(gesture, 1)).toMatchObject([
      { partId: 'hand-minute', rotation: 360 },
      { partId: 'hand-hour', rotation: 30 },
    ]);
    expect(() => sampleMotionGesture(gesture, -0.01)).toThrow(/\[0,1\]/);
    expect(() => sampleMotionGesture(gesture, 1.01)).toThrow(/\[0,1\]/);
  });

  it('keeps boolean lowering explicit for every sampled frame', () => {
    const entries = motionEntriesAt(built.outline, composition, gesture, 0.5);
    expect(entries.map(({ operation }) => operation)).toEqual(['union', 'union', 'union']);
    expect(entries).toHaveLength(3);

    const filledComposition = catalog.icons.time.model.variants.filled.composition;
    const filledEntries = motionEntriesAt(built.filled, filledComposition, gesture, 0.5);
    expect(filledEntries.map(({ operation }) => operation)).toEqual(['union', 'subtract', 'subtract']);
  });

  it('proves the whole time.advance trajectory for both variants at target sizes and raster phases', () => {
    for (const variant of ['outline', 'filled']) {
      const result = proveMotionTrajectory({
        parts: built[variant],
        composition: catalog.icons.time.model.variants[variant].composition,
        gesture,
      });
      expect(result.ok, `${variant}: ${result.findings.join('\n')}`).toBe(true);
      expect(result.samples).toHaveLength(9 * 5 * 4);
      expect(result.findings).toEqual([]);
    }
  });

  it('executable gate is sensitive to malformed gesture declarations', () => {
    const broken = structuredClone(anatomy);
    broken.glyphs.time.motion.gestures[0].tracks[0].anchor = [1.5, 0.5];
    const findings = checkMotionContracts({ anatomy: broken, catalog, grid });
    expect(findings.some((finding) => finding.includes('time.advance'))).toBe(true);
  });
});
