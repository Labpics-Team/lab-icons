import { parsePathData } from '../../src/core/path-data.js';

const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const weights = (point, [a, b, c]) => {
  const x = point[0] - c[0], y = point[1] - c[1];
  const ax = a[0] - c[0], ay = a[1] - c[1], bx = b[0] - c[0], by = b[1] - c[1];
  const determinant = ax * by - ay * bx;
  if (!Number.isFinite(determinant) || determinant === 0) throw new TypeError('Clock source triangle is singular');
  const u = (x * by - y * bx) / determinant, v = (ax * y - ay * x) / determinant;
  const result = [u, v, 1 - u - v];
  if (result.some(value => !Number.isFinite(value) || value < 0 || value > 1)) throw new TypeError('Clock hidden closure leaves its source triangle');
  return result;
};

/** Source edge identity is retained; only hidden closures use convex source-point combinations. */
export function compileOpticalClock(path, joint) {
  const points = Array.from({ length: path.coordinates.length / 2 }, (_, i) => path.coordinates.slice(i * 2, i * 2 + 2));
  const reference = point => {
    const found = points.flatMap((value, index) => same(value, point) ? [index] : []);
    if (!found.length) throw new TypeError('Clock correspondence lost a source point');
    // A repeated endpoint may be represented twice, but must retain the same optical motion.
    for (const index of found.slice(1)) for (const [, delta] of path.terms) for (const axis of [0, 1]) {
      const at = coordinate => { for (let i = 0; i < delta.length; i += 2) if (delta[i] === coordinate) return delta[i + 1]; return 0; };
      if (at(index * 2 + axis) !== at(found[0] * 2 + axis)) throw new TypeError('Clock has ambiguous optical endpoint correspondence');
    }
    return found[0];
  };
  const edges = []; let first, previous;
  for (const command of parsePathData(joint.original.d)) {
    if (command.cmd === 'M') first = previous = [command.x, command.y];
    else if (command.cmd === 'Z') { if (!same(first, previous)) edges.push({ start: previous, end: first }); }
    else { const end = [command.x, command.y]; edges.push({ start: previous, end }); previous = end; }
  }
  const edge = index => joint.evidence.exterior.reversed
    ? { start: edges[index].end, end: edges[index].start } : edges[index];
  const { inside, bottom, left } = joint.evidence.contacts;
  const right = joint.evidence.exterior.hourEdgeIndices.map(edge), tail = joint.evidence.exterior.minuteEdgeIndices.map(edge);
  // Each triangle is inside the opposite authored limb. Convex weights keep a
  // hidden closure in that triangle as its source control points follow the optical grid.
  const triangles = [[inside, right.at(-1).start, bottom], [left, tail[0].end, inside]];
  const pivotTriangle = [inside, bottom, left];
  const pivot = { basis: pivotTriangle.map(reference), weights: weights(joint.bearing, pivotTriangle) };
  return { pivot, limbs: joint.limbs.map((limb, index) => ({ id: limb.id, geometry: {
    commands: limb.commands, basis: triangles[index].map(reference), points: limb.points.map(point => {
      const direct = points.findIndex(value => same(value, point));
      return direct < 0 ? weights(point, triangles[index]) : reference(point);
    }),
  } })) };
}
