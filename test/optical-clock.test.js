import { describe, expect, it } from 'vitest';
import paper from 'paper';
import time from '../dist/symbols/time.js';
import history from '../dist/symbols/history.js';
import { opticalPathData, opticalPosition, sampleOpticalPath } from '../src/render/optical-grid.ts';
import { projectPathView, projectPoint } from '../src/motion/path-view.ts';

describe('source-correspondent optical clock hands', () => {
  it.each([time, history])('$id preserves the source union and a common interior pivot across both axes', symbol => {
    const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
    for (const variant of ['outline', 'filled']) {
      const semantics = symbol.semantics.variants[variant], hands = semantics.parts.filter(part => part.geometry);
      expect(hands).toHaveLength(2);
      expect(semantics.effects.advance).toMatchObject({ parameter: 'elapsed-hours', rest: 0 });
      const source = symbol.data.variants[variant].paths[hands[0].pathIndex];
      expect(hands[1].pathIndex).toBe(hands[0].pathIndex);
      for (const weight of [300, 350, 400, 500, 600]) for (const opsz of [16, 20, 24, 36, 48]) {
        const sampled = sampleOpticalPath(source, opticalPosition(symbol.data.axes, weight, opsz));
        const limbs = hands.map(part => {
          const coordinates = projectPathView(part.geometry, sampled);
          return new scope.Path(opticalPathData({ commands: part.geometry.commands, coordinates }, coordinates));
        });
        const original = new scope.Path(opticalPathData(source, sampled, [hands[0].negative ? 1 : 0]));
        const union = limbs[0].unite(limbs[1], { insert: false });
        expect(Math.abs(original.exclude(union, { insert: false }).area)).toBeLessThan(1e-8);
        const anchor = projectPoint(sampled, hands[0].pivot);
        expect(projectPoint(sampled, hands[1].pivot)).toEqual(anchor);
        for (const limb of limbs) {
          const center = new scope.Point(anchor);
          expect(limb.contains(center)).toBe(true);
          // A disk inside both limbs remains inside them under independent rotations.
          expect(limb.getNearestPoint(center).getDistance(center)).toBeGreaterThan(.25);
        }
        scope.project.clear();
      }
    }
    scope.remove();
  });
});
