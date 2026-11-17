import type { SymbolPathView, SymbolPointProjection } from '../render/index.js';

export function projectPoint(coordinates: ArrayLike<number>, projection: SymbolPointProjection): readonly [number, number] {
  const { basis, weights } = projection;
  return [0, 1].map(axis => weights.reduce((sum, weight, i) => sum + coordinates[basis[i]! * 2 + axis]! * weight, 0)) as [number, number];
}

/** Runs only when source axes change. The frame path uses prepared transforms. */
export function projectPathView(view: SymbolPathView, source: ArrayLike<number>): Float64Array {
  const coordinates = new Float64Array(view.points.length * 2);
  for (let i = 0; i < view.points.length; i++) {
    const reference = view.points[i]!;
    if (typeof reference === 'number') { coordinates[i * 2] = source[reference * 2]!; coordinates[i * 2 + 1] = source[reference * 2 + 1]!; }
    else {
      for (let axis = 0; axis < 2; axis++) coordinates[i * 2 + axis] = reference.reduce((sum, weight, j) => sum + source[view.basis[j]! * 2 + axis]! * weight, 0);
    }
  }
  return coordinates;
}
