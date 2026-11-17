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
    if (reference?.midpoint) {
      if (reference.midpoint.length !== 2) throw new TypeError('optical midpoint requires two coordinates');
      return (coordinate(reference.midpoint[0]) + coordinate(reference.midpoint[1])) / 2;
    }
    const value = typeof reference === 'number' ? reference : selected[reference.segment]?.[reference.field];
    if (!Number.isFinite(value)) throw new TypeError('optical recipe has an invalid coordinate reference');
    return value;
  };
  const center = recipe.center.map(coordinate);
  if (recipe.kind === 'rounded-bar') return validateRecipe({ ...recipe, center, capCenter: Math.abs(coordinate(recipe.capCenter) - center[0]) });
  if (recipe.kind === 'rounded-cross') return validateRecipe({ ...recipe, center,
    halfWidth: recipe.halfWidth.map((reference, axis) => Math.abs(coordinate(reference) - center[axis])),
    capCenter: recipe.capCenter.map((reference, axis) => Math.abs(coordinate(reference) - center[axis])),
  });
  if (recipe.radiusMeasure !== 'start-y') throw new TypeError('optical circle requires its authored cardinal radius reference');
  const radius = contour => Math.abs(contour[0].y - center[1]);
  if (recipe.kind === 'disc') return validateRecipe({ ...recipe, center, radius: radius(selected) });
  if (recipe.kind !== 'annulus' || contours.length !== 2) throw new TypeError('optical annulus requires two authored contours');
  return validateRecipe({ ...recipe, center, radii: contours.map(radius) });
}

function validateRecipe(recipe) {
  const scaleFields = recipe.kind === 'disc' ? [] : recipe.kind === 'annulus'
    ? ['weightScale', 'opszScale'] : ['weightScale', 'opszScale', 'spanScale'];
  for (const field of scaleFields) {
    const values = recipe[field];
    if (!Array.isArray(values) || values.length !== 3 || values[1] !== 1 ||
        values.some(value => !Number.isFinite(value) || value <= 0)) throw new TypeError(`optical ${field} requires three positive scales with exact source center`);
  }
  if (recipe.kind === 'disc' || recipe.kind === 'annulus') {
    if (!Array.isArray(recipe.radiusDelta) || recipe.radiusDelta.length !== 3 || recipe.radiusDelta[1] !== 0 ||
        recipe.radiusDelta.some(value => !Number.isFinite(value))) throw new TypeError('optical radiusDelta requires three finite offsets with exact source center');
    const outer = recipe.kind === 'disc' ? recipe.radius : recipe.radii[0];
    if (!(outer > 0) || recipe.kind === 'annulus' && !(recipe.radii[1] > 0 && recipe.radii[1] < outer)) {
      throw new TypeError('optical circle has invalid authored radii');
    }
    for (let w = 0; w < 3; w++) for (let o = 0; o < 3; o++) {
      const inner = outer + recipe.radiusDelta[o] - (recipe.kind === 'annulus'
        ? (outer - recipe.radii[1]) * recipe.weightScale[w] * recipe.opszScale[o] : 0);
      if (!(inner > 0)) throw new RangeError('optical circle would collapse');
    }
  } else if (recipe.kind === 'rounded-bar') {
    if (!(recipe.capCenter > 0)) throw new TypeError('optical bar has no positive straight span');
  } else {
    if (recipe.halfWidth.some((half, axis) => !(half > 0 && recipe.capCenter[axis] > half))) {
      throw new TypeError('optical cross has invalid source dimensions');
    }
    for (const weight of recipe.weightScale) for (let o = 0; o < 3; o++) {
      if (recipe.halfWidth.some((half, axis) => half * weight * recipe.opszScale[o] >= recipe.capCenter[axis] * recipe.spanScale[o])) {
        throw new RangeError('optical cross would lose its arm span');
      }
    }
  }
  return recipe;
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

function barCoordinate(value, axis, recipe, w, o) {
  const factor = recipe.weightScale[w] * recipe.opszScale[o], span = recipe.spanScale[o];
  if (factor === 1 && span === 1) return value;
  const delta = value - recipe.center[axis];
  if (axis === 1) return recipe.center[axis] + delta * factor;
  const distance = Math.abs(delta), cap = recipe.capCenter;
  return recipe.center[axis] + Math.sign(delta) * (distance <= cap
    ? distance * span : cap * span + (distance - cap) * factor);
}

/** Recipes retain authored control points and adjust declared anatomical dimensions. */
export function opticalRecipeMasters({ axes, source, recipes, fields = [], fieldProfile, fieldScale = 1, negativeStrokes = [] }) {
  const paths = source.map(path => ({ ...path, segments: parsePathData(path.d) }));
  const bound = recipes.map(recipe => bindRecipe(recipe, paths[recipe.pathIndex]));
  if (fields.length) {
    for (const key of ['weightOffset', 'opszOffset', 'counterOpszOffset', 'spanScale']) {
      if (fieldProfile?.[key]?.length !== 3 || fieldProfile[key].some(value => !Number.isFinite(value)) ||
          fieldProfile[key][1] !== (key === 'spanScale' ? 1 : 0) ||
          key === 'spanScale' && fieldProfile[key].some(value => value <= 0)) throw new TypeError(`optical field requires a valid ${key}`);
    }
    if (!Number.isFinite(fieldScale) || fieldScale <= 0 || fieldScale > 1) throw new TypeError('optical field scale must be in (0,1]');
  }
  const fieldPaths = new Map();
  for (const field of fields) {
    if (!paths[field.pathIndex] || fieldPaths.has(field.pathIndex)) throw new TypeError('optical field has a duplicate or missing path');
    const contours = new Map();
    for (const contour of field.contours) {
      if (contours.has(contour.contourIndex) || !['exterior', 'counter', 'mixed'].includes(contour.role) ||
          !Array.isArray(contour.normal) || contour.normal.some(value => !Number.isFinite(value)) ||
          contour.weightNormal !== undefined && (!Array.isArray(contour.weightNormal) || contour.weightNormal.length !== contour.normal.length ||
            contour.weightNormal.some(value => !Number.isFinite(value))) ||
          contour.offsetScale !== undefined && (!Number.isFinite(contour.offsetScale) || contour.offsetScale <= 0 || contour.offsetScale > 1)) {
        throw new TypeError('optical field has invalid contour data');
      }
      contours.set(contour.contourIndex, contour);
    }
    const counts = [];
    for (const segment of paths[field.pathIndex].segments) {
      if (segment.cmd === 'M') counts.push(0);
      counts[counts.length - 1] += coordinates[segment.cmd].length;
    }
    if (contours.size !== counts.length || counts.some((count, index) => contours.get(index)?.normal.length !== count)) {
      throw new TypeError('optical field changed contour correspondence');
    }
    fieldPaths.set(field.pathIndex, contours);
  }
  const byPath = paths.map((path, pathIndex) => path.segments.filter(segment => segment.cmd === 'M').map((_, contourIndex) => {
    const matches = bound.filter(recipe => recipe.pathIndex === pathIndex &&
      (recipe.contourIndex === undefined || recipe.contourIndex === contourIndex));
    if (matches.length > 1) throw new TypeError('optical recipes overlap the same contour');
    return matches[0];
  }));
  // Semantic negative strokes include holes, positive islands inside those
  // holes, and selected points of a notch open to the exterior. Geometric
  // winding alone cannot distinguish them from structural apertures.
  const negativePoints = new Map();
  if (!Array.isArray(negativeStrokes)) throw new TypeError('negative strokes must be an array');
  for (const selector of negativeStrokes) {
    const { pathIndex, contourIndex, pointIndices } = selector;
    const contour = fieldPaths.get(pathIndex)?.get(contourIndex);
    const key = `${pathIndex}/${contourIndex}`;
    if (!Number.isInteger(pathIndex) || !Number.isInteger(contourIndex) || !contour || negativePoints.has(key)) {
      throw new TypeError('negative stroke references a missing or repeated draft contour');
    }
    const count = contour.normal.length / 2;
    const indices = pointIndices ?? Array.from({ length: count }, (_, index) => index);
    if (!Array.isArray(indices) || !indices.length || new Set(indices).size !== indices.length ||
        indices.some(index => !Number.isInteger(index) || index < 0 || index >= count)) {
      throw new TypeError('negative stroke references an invalid or repeated point');
    }
    negativePoints.set(key, new Set(indices));
  }
  return axes.weight.flatMap((weight, w) => axes.opsz.map((opsz, o) => ({ weight, opsz,
    paths: paths.map((path, pathIndex) => {
      let contourIndex = -1, contourCoordinate = 0;
      const d = path.segments.map(segment => {
        if (segment.cmd === 'M') { contourIndex++; contourCoordinate = 0; }
        const recipe = byPath[pathIndex][contourIndex];
        const fields = coordinates[segment.cmd];
        if (!fields) throw new TypeError('optical recipe requires M/L/C/Z');
        const values = fields.map((field, coordinate) => {
          const value = segment[field], axis = coordinate % 2;
          if (!recipe) {
            const draft = fieldPaths.get(pathIndex)?.get(contourIndex);
            if (!draft || w === 1 && o === 1) return value;
            const scale = 1 + (fieldProfile.spanScale[o] - 1) * fieldScale;
            const selected = negativePoints.get(`${pathIndex}/${contourIndex}`);
            const negative = selected?.has((contourCoordinate + coordinate - axis) / 2);
            const normal = draft.normal[contourCoordinate + coordinate];
            const weightNormal = draft.weightNormal?.[contourCoordinate + coordinate] ?? normal * (negative ? -1 : 1);
            // An open negative stroke joins a positive silhouette. Both sides
            // share its semantic join field; an enclosed mark and its islands
            // use the independent small-size negative-stroke compensation.
            const semanticOpsz = draft.weightNormal;
            const opszNormal = semanticOpsz ? weightNormal : normal;
            const opszOffset = semanticOpsz
              ? selected?.size === draft.normal.length / 2 ? -fieldProfile.counterOpszOffset[o]
                : draft.role === 'counter' ? fieldProfile.counterOpszOffset[o] : fieldProfile.opszOffset[o]
              : negative || draft.role === 'counter' ? fieldProfile.counterOpszOffset[o] : fieldProfile.opszOffset[o];
            const offset = (weightNormal * fieldProfile.weightOffset[w] + opszNormal * opszOffset) * fieldScale * (draft.offsetScale ?? 1);
            return 12 + (value - 12) * scale + offset;
          }
          if (recipe.kind === 'rounded-cross') return crossCoordinate(value, axis, recipe, w, o);
          if (recipe.kind === 'rounded-bar') return barCoordinate(value, axis, recipe, w, o);
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
        contourCoordinate += fields.length;
        return segment.cmd + values.join(' ');
      }).join('');
      return { d, fillRule: path.fillRule };
    }),
  })));
}
