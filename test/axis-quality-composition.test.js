import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyphParts } from '../src/core/anatomy-gen.js';
import { proveVariantAxes } from '../scripts/lib/axis-quality.js';
import { DEFAULT_RASTER_PHASES, topologyAcrossPhases } from '../scripts/lib/ink-raster.js';
import { lowerModelComposition } from '../scripts/lib/model-composition.js';

const root = join(import.meta.dirname, '..');
const anatomy = JSON.parse(readFileSync(join(root, 'semantics/anatomy.json'), 'utf8'));
const grid = JSON.parse(readFileSync(join(root, 'semantics/grid.json'), 'utf8'));

describe('axis proof composition lowering', () => {
  it('evaluates mask-subtract as declared operations instead of concatenated nonzero path data', () => {
    const entry = anatomy.glyphs.time;
    const parts = buildGlyphParts(entry, grid, { weight: 0.6 }, anatomy.glyphs).filled;
    const built = parts.map((part) => part.d).join('');
    const lowered = lowerModelComposition({
      built,
      parts,
      composition: entry.composition.filled,
      label: 'time/filled',
    });
    const options = {
      width: grid.canvas.width,
      height: grid.canvas.height,
      step: grid.canvas.width / 24,
      stepsPerSeg: 24,
      minFeatureArea: 0,
      phases: DEFAULT_RASTER_PHASES,
    };

    expect(topologyAcrossPhases([{ d: built, fillRule: 'nonzero' }], options).stable).toBe(false);
    expect(topologyAcrossPhases(lowered, options).stable).toBe(true);

    expect(proveVariantAxes(entry, 'filled', grid, anatomy.glyphs, 'nonzero')).toEqual([
      {
        axis: 'weight',
        finding: expect.objectContaining({
          kind: 'axis-phase-unstable',
          value: 0.6,
          rasterSize: 16,
          signatures: ['1:1', '1:1', '1:2', '1:1', '1:1'],
        }),
      },
    ]);
  });
});
