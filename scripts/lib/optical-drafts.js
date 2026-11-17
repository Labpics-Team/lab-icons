import paper from 'paper';
import { parsePathData } from '../../src/core/path-data.js';
import { opticalPathSource } from './optical-grid.js';

const widths = { M: 2, L: 2, C: 6, Z: 0 };
const length = v => Math.hypot(...v);
const subtract = (a, b) => a.map((value, axis) => value - b[axis]);
const unit = vector => length(vector) > 1e-10 ? vector.map(value => value / length(vector)) : null;
const round = value => Math.round(value * 1e6) / 1e6;

function point(edge, t) {
  if (edge.points.length === 2) return edge.points[0].map((value, axis) => value * (1 - t) + edge.points[1][axis] * t);
  const [a, b, c, d] = edge.points, s = 1 - t;
  return a.map((value, axis) => value * s ** 3 + 3 * b[axis] * s * s * t + 3 * c[axis] * s * t * t + d[axis] * t ** 3);
}

function tangent(edge, t) {
  const p = edge.points;
  if (p.length === 2) return unit(subtract(p[1], p[0]));
  const s = 1 - t;
  const derivative = p[0].map((_, axis) => (p[1][axis] - p[0][axis]) * s * s +
    2 * (p[2][axis] - p[1][axis]) * s * t + (p[3][axis] - p[2][axis]) * t * t);
  // Exact zero handles are common in exported SVG. Use the first nonzero
  // derivative in the same direction, retaining every original control point.
  return unit(derivative) ?? (t < 0.5
    ? unit(subtract(p[2], p[0])) ?? unit(subtract(p[3], p[0]))
    : unit(subtract(p[3], p[1])) ?? unit(subtract(p[3], p[0])));
}

function normal(edge, t) {
  const vector = tangent(edge, t);
  return vector ? [vector[1] * edge.sign, -vector[0] * edge.sign] : [0, 0];
}

function contoursOf(path) {
  let cursor = 0, current, start, previous, previousIndex;
  const contours = [];
  for (const segment of parsePathData(path.d)) {
    if (!Object.hasOwn(widths, segment.cmd)) throw new TypeError('optical drafts require M/L/C/Z');
    if (segment.cmd === 'M') {
      current = { start: cursor, count: 0, edges: [] }; contours.push(current);
      start = previous = [segment.x, segment.y]; previousIndex = cursor;
    } else {
      const end = segment.cmd === 'Z' ? start : [segment.x, segment.y];
      const endIndex = segment.cmd === 'Z' ? current.start : cursor + widths[segment.cmd] - 2;
      const points = segment.cmd === 'C' ? [previous, [segment.x1, segment.y1], [segment.x2, segment.y2], end] : [previous, end];
      // A zero closing segment has no normal; its coordinates still belong to
      // the preceding endpoint and receive the same closing join displacement.
      if (points.some(p => length(subtract(p, previous)) > 1e-10)) {
        current.edges.push({ points, startIndex: previousIndex, endIndex, controlIndex: segment.cmd === 'C' ? cursor : undefined });
      }
      previous = end; previousIndex = endIndex;
    }
    cursor += widths[segment.cmd]; current.count = cursor - current.start;
  }
  return contours;
}

/**
 * Offline draft only. Offset samples retain source opcodes and correspondence.
 * Ink-side probes use the complete path's fill rule, not the contour winding.
 * No Paper objects or geometric inference enter the renderer or stored model.
 */
export function draftOpticalFields(source, { miterLimit = 2.5 } = {}) {
  const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
  try {
    return source.map((path, pathIndex) => {
      const shape = new scope.CompoundPath({ pathData: path.d, fillRule: path.fillRule ?? 'nonzero', insert: false });
      const base = opticalPathSource(path), contours = contoursOf(path);
      const fields = contours.map((contour, contourIndex) => {
        const flags = new Set(), values = new Array(contour.count).fill(0), edges = contour.edges;
        const outline = new scope.Path({ insert: false });
        outline.moveTo(edges[0].points[0]);
        for (const edge of edges) {
          if (edge.points.length === 4) outline.cubicCurveTo(...edge.points.slice(1));
          else outline.lineTo(edge.points[1]);
        }
        outline.closePath();
        const outward = Math.sign(outline.area);
        const offsetScale = Math.min(1, Math.abs(outline.area) / outline.length / 0.375);
        if (offsetScale < 1) flags.add('thin-detail');
        outline.remove();
        for (const edge of edges) {
          edge.sign = 1;
          const signs = [];
          for (const t of [0.5, 0.2113, 0.7887]) {
            const p = point(edge, t), n = normal(edge, t);
            for (const epsilon of [0.0001, 0.001, 0.01, 0.05]) {
              const plus = shape.contains(new scope.Point(p[0] + n[0] * epsilon, p[1] + n[1] * epsilon));
              const minus = shape.contains(new scope.Point(p[0] - n[0] * epsilon, p[1] - n[1] * epsilon));
              if (plus !== minus) { signs.push(plus ? -1 : 1); break; }
            }
          }
          edge.sign = signs[0] ?? outward;
          if (!signs.length) flags.add('occluded-boundary');
          if (signs.some(sign => sign !== edge.sign)) flags.add('mixed-ink-side');
        }
        const exterior = edges.filter(edge => edge.sign === outward).length;
        const role = exterior === edges.length ? 'exterior' : exterior === 0 ? 'counter' : 'mixed';
        if (role === 'mixed') flags.add('mixed-ink-side');
        const write = (index, vector) => {
          for (let axis = 0; axis < 2; axis++) values[index - contour.start + axis] = round(vector[axis]);
        };
        const joins = edges.map((edge, index) => {
          const before = normal(edges[(index + edges.length - 1) % edges.length], 1), after = normal(edge, 0);
          const denominator = 1 + before[0] * after[0] + before[1] * after[1];
          let join = denominator > 1e-5 ? before.map((value, axis) => (value + after[axis]) / denominator) : after;
          if (denominator <= 1e-5 || length(join) > miterLimit) {
            flags.add('limited-join'); join = (unit(join) ?? after).map(value => value * Math.min(length(join), miterLimit));
          }
          return join;
        });
        for (let index = 0; index < edges.length; index++) {
          const edge = edges[index], a = joins[index], d = joins[(index + 1) % joins.length];
          write(edge.startIndex, a); write(edge.endIndex, d);
          if (edge.controlIndex !== undefined) {
            const n1 = normal(edge, 1 / 3), n2 = normal(edge, 2 / 3);
            const r1 = n1.map((value, axis) => 27 * value - 8 * a[axis] - d[axis]);
            const r2 = n2.map((value, axis) => 27 * value - a[axis] - 8 * d[axis]);
            const b = r1.map((value, axis) => (2 * value - r2[axis]) / 18);
            const c = r2.map((value, axis) => (2 * value - r1[axis]) / 18);
            for (const [offset, vector] of [[0, b], [2, c]]) {
              if (length(vector) > 4) flags.add('large-control-offset');
              write(edge.controlIndex + offset, vector);
            }
          }
        }
        // Preserve repeated endpoints in original commands, including explicit
        // final L/C coordinates followed by a zero-length Z.
        const first = base.coordinates.slice(contour.start, contour.start + 2);
        const final = contour.start + contour.count - 2;
        if (length(subtract(first, base.coordinates.slice(final, final + 2))) < 1e-10) write(final, joins[0]);
        return { contourIndex, role, normal: values, ...(offsetScale < 1 ? { offsetScale } : {}),
          ...(flags.size ? { flags: [...flags].sort() } : {}) };
      });
      shape.remove();
      return { pathIndex, contours: fields };
    });
  } finally { scope.project.remove(); }
}

/** Independent geometric diagnostics; counts are evidence, never approval. */
export function inspectOpticalPaths(paths) {
  const scope = new paper.PaperScope(); scope.setup(new scope.Size(24, 24));
  try {
    return paths.map(path => {
      const shape = new scope.CompoundPath({ pathData: path.d, fillRule: path.fillRule ?? 'nonzero', insert: false });
      const { left, top, right, bottom } = shape.bounds;
      const result = { crossings: shape.getCrossings().length, areas: shape.children.map(child => round(child.area)),
        bounds: [left, top, right, bottom].map(round) };
      shape.remove(); return result;
    });
  } finally { scope.project.remove(); }
}
