import { parsePathData } from '../../src/core/path-data.js';

const coordinates = { M: ['x', 'y'], L: ['x', 'y'], C: ['x1', 'y1', 'x2', 'y2', 'x', 'y'], Z: [] };
function bindRecipe(recipe, path) {
  if (!path) throw new TypeError('optical recipe references a missing path');
  const contours = [];
  for (const segment of path.segments) {
    if (segment.cmd === 'M') contours.push([]);
    contours.at(-1).push(segment);
  }
  const selected = contours[recipe.contourIndex ?? 0];
  if (!selected) throw new TypeError('optical recipe references a missing contour');
  const coordinate = reference => {
    const value = typeof reference === 'number' ? reference : selected[reference.segment]?.[reference.field];
    if (!Number.isFinite(value)) throw new TypeError('optical recipe has an invalid coordinate reference');
    return value;
  };
  const center = recipe.center.map(coordinate);
  if (recipe.kind === 'rounded-cross') return { ...recipe, center,
    halfWidth: recipe.halfWidth.map((reference, axis) => Math.abs(coordinate(reference) - center[axis])),
    capCenter: recipe.capCenter.map((reference, axis) => Math.abs(coordinate(reference) - center[axis])),
  };
  if (recipe.radiusMeasure !== 'start-y') throw new TypeError('optical circle requires its authored cardinal radius reference');
  const radius = contour => Math.abs(contour[0].y - center[1]);
  if (recipe.kind === 'disc') return { ...recipe, center, radius: radius(selected) };
  if (recipe.kind !== 'annulus' || contours.length !== 2) throw new TypeError('optical annulus requires two authored contours');
  return { ...recipe, center, radii: contours.map(radius) };
}
function crossCoordinate(value, axis, recipe, w, o) {
  const delta = value - recipe.center[axis], sign = Math.sign(delta), distance = Math.abs(delta);
  const factor = recipe.weightScale[w] * recipe.opszScale[o], span = recipe.spanScale[o];
  if (factor === 1 && span === 1) return value;
  const half = recipe.halfWidth[axis], cap = recipe.capCenter[axis];
  const nextHalf = half * factor, nextCap = cap * span;
  const mapped = distance <= half ? distance * factor
    : distance <= cap ? nextHalf + (distance - half) * (nextCap - nextHalf) / (cap - half)
      : nextCap + (distance - cap) * factor;
  return recipe.center[axis] + sign * mapped;
}

/** Recipes retain authored control points and adjust declared anatomical dimensions. */
export function opticalRecipeMasters({ axes, source, recipes }) {
  const paths = source.map(path => ({ ...path, segments: parsePathData(path.d) }));
  const bound = recipes.map(recipe => bindRecipe(recipe, paths[recipe.pathIndex]));
  return axes.weight.flatMap((weight, w) => axes.opsz.map((opsz, o) => ({ weight, opsz,
    paths: paths.map((path, pathIndex) => {
      let contourIndex = -1;
      const d = path.segments.map(segment => {
        if (segment.cmd === 'M') contourIndex++;
        const matching = bound.filter(recipe => recipe.pathIndex === pathIndex &&
          (recipe.contourIndex === undefined || recipe.contourIndex === contourIndex));
        if (matching.length > 1) throw new TypeError('optical recipes overlap the same contour');
        const recipe = matching[0];
        const fields = coordinates[segment.cmd];
        if (!fields) throw new TypeError('optical recipe requires M/L/C/Z');
        const values = fields.map((field, coordinate) => {
          const value = segment[field], axis = coordinate % 2;
          if (!recipe) return value;
          if (recipe.kind === 'rounded-cross') return crossCoordinate(value, axis, recipe, w, o);
          if (recipe.kind === 'disc' || recipe.kind === 'annulus') {
            const radius = recipe.kind === 'disc' ? recipe.radius : recipe.radii[contourIndex];
            const outer = (recipe.kind === 'disc' ? recipe.radius : recipe.radii[0]) + recipe.radiusDelta[o];
            const next = recipe.kind === 'disc' || contourIndex === 0 ? outer
              : outer - (recipe.radii[0] - recipe.radii[1]) * recipe.weightScale[w] * recipe.opszScale[o];
            const scale = next / radius;
            return scale === 1 ? value : recipe.center[axis] + (value - recipe.center[axis]) * scale;
          }
          throw new TypeError(`unknown optical recipe ${recipe.kind}`);
        });
        return segment.cmd + values.join(' ');
      }).join('');
      return { d, fillRule: path.fillRule };
    }),
  })));
}
