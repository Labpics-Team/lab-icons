/**
 * Deterministic binary-occupancy metrics for the Quality Observatory.
 *
 * The Observatory compares ink, not path strings: equivalent Bezier command
 * layouts must score identically.  All area, centroid, topology and raster
 * results therefore share the path-aware rasterizer used by the seeing gates.
 * Boundary distance is measured between boundary-cell centres on the same
 * high-resolution mask.  This makes its resolution explicit and prevents a
 * second, subtly different SVG interpretation from drifting into the report.
 *
 * Topology is deliberately NOT inferred from that one perceptual mask.  Its
 * oracle uses several phases and a vector guide: above its declared feature-
 * area floor, the smallest closed-subpath span or disjoint-boundary clearance
 * receives at least four samples.  If the declared cell/segment budget cannot
 * honour that resolution, or phases do not agree, confidence is UNCERTAIN and
 * the comparison fails closed.
 */

import { samplePolylines } from './curve-sampling.js';
import { parsePathData, pathBBox } from './path-data.js';
import {
  DEFAULT_RASTER_PHASES,
  rasterizePathEntries,
  topologyAcrossPhases,
  topologyOfMask,
} from './ink-raster.js';

export const DEFAULT_OBSERVATORY_RASTER_SIZES = Object.freeze([16, 20, 24, 32, 48]);
export const DEFAULT_TOPOLOGY_PIXELS_PER_FEATURE = 4;
// 960 cells on the canonical 24-unit canvas give a 0.025-unit step: the
// 0.1-unit bite counter is represented by exactly 4×4 samples.  Changing this
// limit changes the public minimum topology feature, not merely performance.
export const DEFAULT_TOPOLOGY_MAX_GRID_SIDE = 960;
export const DEFAULT_TOPOLOGY_MAX_SEGMENT_PAIRS = 2_000_000;
// Это не resolution claim: сетка ищет только положительный interior witness.
// Промах никогда не даёт PASS, а переводит пару в UNCERTAIN. Четыре topology
// pixels по каждой из четырёх фаз дают 16 детерминированных проб на ось без
// нового порога качества; изменение числа влияет лишь на false-UNCERTAIN.
const OVERLAP_WITNESS_GRID_SIDE = DEFAULT_TOPOLOGY_PIXELS_PER_FEATURE * 4;

const METRIC_PRECISION = 1_000_000;
const GEOMETRY_EPSILON = 1e-9;

function finiteRound(value) {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value * METRIC_PRECISION) / METRIC_PRECISION;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function assertComparableMasks(a, b) {
  if (
    !a ||
    !b ||
    !(a.mask instanceof Uint8Array) ||
    !(b.mask instanceof Uint8Array) ||
    a.cols !== b.cols ||
    a.rows !== b.rows ||
    a.step !== b.step ||
    a.phase[0] !== b.phase[0] ||
    a.phase[1] !== b.phase[1]
  ) {
    throw new Error('quality-metrics: сравниваемые растры обязаны иметь одну сетку и фазу');
  }
}

function topologySignature(raster) {
  const topology = topologyOfMask(raster);
  return {
    components: topology.components.length,
    holes: topology.holes.length,
  };
}

function pointEquals(a, b) {
  return Math.abs(a[0] - b[0]) <= GEOMETRY_EPSILON && Math.abs(a[1] - b[1]) <= GEOMETRY_EPSILON;
}

function signedPolygonArea(points) {
  let twiceArea = 0;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    twiceArea += a[0] * b[1] - b[0] * a[1];
  }
  return twiceArea / 2;
}

function polygonArea(points) {
  return Math.abs(signedPolygonArea(points));
}

/**
 * Сумма абсолютных площадей fan-треугольников — translation-invariant upper
 * bound площади polygonal fill. Для simple contour signed area точнее, но при
 * self-intersection она может сократиться до нуля. Bound не доказывает ink;
 * он доказывает лишь, что subpath нельзя безопасно отбросить ниже floor.
 */
function traversalAreaUpperBound(points) {
  if (points.length < 3) return 0;
  const origin = points[0];
  let twiceArea = 0;
  for (let index = 1; index + 1 < points.length; index++) {
    twiceArea += Math.abs(orientation(origin, points[index], points[index + 1]));
  }
  return twiceArea / 2;
}

function scalarEquals(left, right) {
  return Math.abs(left - right) <= GEOMETRY_EPSILON;
}

function serializedPathSegment(segment) {
  if (segment.cmd === 'M' || segment.cmd === 'L') {
    return `${segment.cmd}${segment.x} ${segment.y}`;
  }
  if (segment.cmd === 'Q') {
    return `Q${segment.x1} ${segment.y1} ${segment.x} ${segment.y}`;
  }
  if (segment.cmd === 'C') {
    return `C${segment.x1} ${segment.y1} ${segment.x2} ${segment.y2} ${segment.x} ${segment.y}`;
  }
  if (segment.cmd === 'A') {
    return `A${segment.rx} ${segment.ry} ${segment.rotation} ${segment.largeArc} ${segment.sweep} ${segment.x} ${segment.y}`;
  }
  if (segment.cmd === 'Z') return 'Z';
  throw new Error(`quality-metrics: неподдержанная path-команда ${segment.cmd}`);
}

/** Exact normalized source geometry split at M, suitable for pathBBox(). */
function exactSubpathData(d) {
  const subpaths = [];
  let current = null;
  for (const segment of parsePathData(d)) {
    if (segment.cmd === 'M') {
      if (current != null) subpaths.push(current);
      current = { d: serializedPathSegment(segment), hasCurves: false };
      continue;
    }
    if (current != null) {
      current.d += serializedPathSegment(segment);
      if (segment.cmd === 'Q' || segment.cmd === 'C' || segment.cmd === 'A') {
        current.hasCurves = true;
      }
    }
  }
  if (current != null) subpaths.push(current);
  return subpaths;
}

/**
 * Source primitives сохраняют точные команды и отдельно несут sampled
 * segments только как locator уже доказанной Q/C-кривой, не как proof.
 */
function exactBoundarySubpaths(d, polylines, stepsPerSeg) {
  const subpaths = [];
  let primitives = null;
  let current = null;
  let start = null;
  let subpathIndex = -1;
  let pointIndex = 0;
  for (const segment of parsePathData(d)) {
    if (segment.cmd === 'M') {
      primitives = [];
      subpaths.push(primitives);
      subpathIndex++;
      pointIndex = 0;
      current = [segment.x, segment.y];
      start = current;
      continue;
    }
    if (!primitives) continue;

    const endpoint = segment.cmd === 'Z' ? start : [segment.x, segment.y];
    const sampledPointCount = segment.cmd === 'L' || segment.cmd === 'Z'
      ? 1
      : segment.cmd === 'A' && (
          segment.rx === 0 ||
          segment.ry === 0 ||
          pointEquals(current, endpoint)
        )
        ? 1
        : stepsPerSeg;
    const polyline = polylines[subpathIndex] ?? [];
    const sampledSegments = [];
    for (let offset = 0; offset < sampledPointCount; offset++) {
      const a = polyline[pointIndex + offset];
      const b = polyline[pointIndex + offset + 1];
      if (a && b && !pointEquals(a, b)) sampledSegments.push([a, b]);
    }
    pointIndex += sampledPointCount;

    if (!pointEquals(current, endpoint)) {
      const cmd = segment.cmd === 'Z' || (
        segment.cmd === 'A' && (segment.rx === 0 || segment.ry === 0)
      )
        ? 'L'
        : segment.cmd;
      primitives.push({
        ...segment,
        cmd,
        start: current,
        end: endpoint,
        sampledSegments,
      });
    }
    current = endpoint;
  }
  return subpaths;
}

function polylineFacts(entries, stepsPerSeg, minimumFeatureArea) {
  const subpaths = [];
  let degenerateSubpaths = 0;
  let ignoredBelowResolutionSubpaths = 0;
  let algebraicCancellationSubpaths = 0;
  let areaClassificationUncertainSubpaths = 0;

  for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
    const polylines = samplePolylines(entries[entryIndex].d, stepsPerSeg);
    const exactBoundary = exactBoundarySubpaths(entries[entryIndex].d, polylines, stepsPerSeg);
    const exactData = exactSubpathData(entries[entryIndex].d);
    for (let subpathIndex = 0; subpathIndex < polylines.length; subpathIndex++) {
      const source = polylines[subpathIndex];
      const points = [];
      for (const point of source) {
        if (!points.length || !pointEquals(points[points.length - 1], point)) points.push(point);
      }
      if (points.length > 1 && pointEquals(points[0], points[points.length - 1])) points.pop();

      const sourceInfo = exactData[subpathIndex];
      if (sourceInfo == null) {
        throw new Error(`quality-metrics: потерян exact subpath ${entryIndex}/${subpathIndex}`);
      }
      const { minX, minY, maxX, maxY } = pathBBox(sourceInfo.d);
      const width = maxX - minX;
      const height = maxY - minY;
      const minorSpan = Math.min(width, height);
      const signedArea = points.length < 3 ? 0 : signedPolygonArea(points);
      const area = Math.abs(signedArea);
      const sampledTraversalAreaUpperBound = traversalAreaUpperBound(points);
      const boundary = exactBoundary[subpathIndex] ?? [];
      const lineOnly = !sourceInfo.hasCurves;
      // Для L fan-triangles дают точную консервативную верхнюю границу fill.
      // Для Q/C/A sampled polygon такой границей не является: точная кривая
      // целиком лежит внутри exact pathBBox, поэтому bbox area безопасно решает
      // только «точно ниже floor». Пограничное незнание сохраняем и ниже
      // превращаем в UNCERTAIN, а не в разрешение отбросить subpath.
      const exactBoundsAreaUpperBound = width * height;
      const areaUpperBound = lineOnly
        ? sampledTraversalAreaUpperBound
        : exactBoundsAreaUpperBound;
      const areaClassificationUncertain =
        !lineOnly &&
        sampledTraversalAreaUpperBound + GEOMETRY_EPSILON < minimumFeatureArea &&
        exactBoundsAreaUpperBound + GEOMETRY_EPSILON >= minimumFeatureArea;
      const algebraicCancellation =
        !(area > GEOMETRY_EPSILON) &&
        sampledTraversalAreaUpperBound > GEOMETRY_EPSILON;
      const degenerate =
        !(areaUpperBound > GEOMETRY_EPSILON) ||
        !(minorSpan > GEOMETRY_EPSILON);
      const significant =
        !degenerate &&
        areaUpperBound + GEOMETRY_EPSILON >= minimumFeatureArea;
      if (degenerate) degenerateSubpaths++;
      else if (!significant) ignoredBelowResolutionSubpaths++;
      if (algebraicCancellation) algebraicCancellationSubpaths++;
      if (areaClassificationUncertain) areaClassificationUncertainSubpaths++;
      subpaths.push({
        entryIndex,
        subpathIndex,
        points,
        exactBoundary: boundary,
        bounds: { minX, minY, maxX, maxY },
        area,
        areaUpperBound,
        areaClassificationUncertain,
        algebraicCancellation,
        windingSign: Math.sign(signedArea),
        fillRule: entries[entryIndex].fillRule === 'evenodd' ? 'evenodd' : 'nonzero',
        minorSpan: significant ? minorSpan : null,
        significant,
      });
    }
  }

  return {
    subpaths,
    degenerateSubpaths,
    ignoredBelowResolutionSubpaths,
    algebraicCancellationSubpaths,
    areaClassificationUncertainSubpaths,
  };
}

function orientation(a, b, c) {
  return (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
}

function onSegment(a, b, point) {
  return (
    Math.abs(orientation(a, b, point)) <= GEOMETRY_EPSILON &&
    point[0] >= Math.min(a[0], b[0]) - GEOMETRY_EPSILON &&
    point[0] <= Math.max(a[0], b[0]) + GEOMETRY_EPSILON &&
    point[1] >= Math.min(a[1], b[1]) - GEOMETRY_EPSILON &&
    point[1] <= Math.max(a[1], b[1]) + GEOMETRY_EPSILON
  );
}

function segmentsIntersect(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (
    ((abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON) ||
      (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON)) &&
    ((cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON) ||
      (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON))
  ) return true;
  return (
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  );
}

function pointSegmentDistance(point, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared <= GEOMETRY_EPSILON * GEOMETRY_EPSILON) {
    return Math.hypot(point[0] - a[0], point[1] - a[1]);
  }
  const t = Math.max(0, Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / lengthSquared));
  return Math.hypot(point[0] - (a[0] + t * dx), point[1] - (a[1] + t * dy));
}

function segmentDistance(a, b, c, d) {
  if (segmentsIntersect(a, b, c, d)) return 0;
  return Math.min(
    pointSegmentDistance(a, c, d),
    pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b),
    pointSegmentDistance(d, a, b),
  );
}

function properSegmentIntersection(a, b, c, d) {
  const abC = orientation(a, b, c);
  const abD = orientation(a, b, d);
  const cdA = orientation(c, d, a);
  const cdB = orientation(c, d, b);
  if (!(
    ((abC > GEOMETRY_EPSILON && abD < -GEOMETRY_EPSILON) ||
      (abC < -GEOMETRY_EPSILON && abD > GEOMETRY_EPSILON)) &&
    ((cdA > GEOMETRY_EPSILON && cdB < -GEOMETRY_EPSILON) ||
      (cdA < -GEOMETRY_EPSILON && cdB > GEOMETRY_EPSILON))
  )) return null;

  const abX = b[0] - a[0];
  const abY = b[1] - a[1];
  const cdX = d[0] - c[0];
  const cdY = d[1] - c[1];
  const denominator = abX * cdY - abY * cdX;
  if (Math.abs(denominator) <= GEOMETRY_EPSILON) return null;
  const acX = c[0] - a[0];
  const acY = c[1] - a[1];
  const t = (acX * cdY - acY * cdX) / denominator;
  return [a[0] + t * abX, a[1] + t * abY];
}

function segmentBoundsOverlap([a, b], [c, d]) {
  return !(
    Math.max(a[0], b[0]) < Math.min(c[0], d[0]) - GEOMETRY_EPSILON ||
    Math.max(c[0], d[0]) < Math.min(a[0], b[0]) - GEOMETRY_EPSILON ||
    Math.max(a[1], b[1]) < Math.min(c[1], d[1]) - GEOMETRY_EPSILON ||
    Math.max(c[1], d[1]) < Math.min(a[1], b[1]) - GEOMETRY_EPSILON
  );
}

function collinearSegmentOverlap(a, b, c, d) {
  if (
    Math.abs(orientation(a, b, c)) > GEOMETRY_EPSILON ||
    Math.abs(orientation(a, b, d)) > GEOMETRY_EPSILON
  ) return null;
  const axis = Math.abs(b[0] - a[0]) >= Math.abs(b[1] - a[1]) ? 0 : 1;
  const leftMin = Math.min(a[axis], b[axis]);
  const leftMax = Math.max(a[axis], b[axis]);
  const rightMin = Math.min(c[axis], d[axis]);
  const rightMax = Math.max(c[axis], d[axis]);
  const overlapMin = Math.max(leftMin, rightMin);
  const overlapMax = Math.min(leftMax, rightMax);
  if (!(overlapMax - overlapMin > GEOMETRY_EPSILON)) return null;
  const pointAt = (value) => {
    const t = (value - a[axis]) / (b[axis] - a[axis]);
    return [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])];
  };
  return [pointAt(overlapMin), pointAt(overlapMax)];
}

const TWO_PI = 2 * Math.PI;

/** W3C SVG 1.1 F.6.5/F.6.6: endpoint A -> canonical center ellipse. */
function canonicalArc(primitive) {
  let rx = Math.abs(primitive.rx);
  let ry = Math.abs(primitive.ry);
  if (rx === 0 || ry === 0 || pointEquals(primitive.start, primitive.end)) return null;
  const phi = (primitive.rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);
  const dx2 = (primitive.start[0] - primitive.end[0]) / 2;
  const dy2 = (primitive.start[1] - primitive.end[1]) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const scale = Math.sqrt(lambda);
    rx *= scale;
    ry *= scale;
  }
  const rxSquared = rx * rx;
  const rySquared = ry * ry;
  const numerator =
    rxSquared * rySquared -
    rxSquared * y1p * y1p -
    rySquared * x1p * x1p;
  const denominator = rxSquared * y1p * y1p + rySquared * x1p * x1p;
  let coefficient = Math.sqrt(Math.max(0, numerator / denominator));
  if (primitive.largeArc === primitive.sweep) coefficient = -coefficient;
  const cxp = (coefficient * rx * y1p) / ry;
  const cyp = (-coefficient * ry * x1p) / rx;
  const cx = cosPhi * cxp - sinPhi * cyp + (primitive.start[0] + primitive.end[0]) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (primitive.start[1] + primitive.end[1]) / 2;
  const vectorAngle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const length = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let angle = Math.acos(Math.min(1, Math.max(-1, dot / length)));
    if (ux * vy - uy * vx < 0) angle = -angle;
    return angle;
  };
  const theta1 = vectorAngle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = vectorAngle(
    (x1p - cxp) / rx,
    (y1p - cyp) / ry,
    (-x1p - cxp) / rx,
    (-y1p - cyp) / ry,
  );
  if (primitive.sweep === 0 && dTheta > 0) dTheta -= TWO_PI;
  if (primitive.sweep === 1 && dTheta < 0) dTheta += TWO_PI;
  return { cx, cy, rx, ry, phi, theta1, dTheta };
}

function normalizedAngle(angle) {
  return ((angle % TWO_PI) + TWO_PI) % TWO_PI;
}

function anglesEqual(left, right) {
  return Math.abs(Math.atan2(Math.sin(left - right), Math.cos(left - right))) <= GEOMETRY_EPSILON;
}

function sameArcSupport(left, right) {
  return (
    scalarEquals(left.cx, right.cx) &&
    scalarEquals(left.cy, right.cy) &&
    scalarEquals(left.rx, right.rx) &&
    scalarEquals(left.ry, right.ry) &&
    anglesEqual(left.phi, right.phi)
  );
}

function arcCoverageIntervals(arc) {
  const start = normalizedAngle(arc.dTheta >= 0 ? arc.theta1 : arc.theta1 + arc.dTheta);
  const length = Math.abs(arc.dTheta);
  const end = start + length;
  return end <= TWO_PI + GEOMETRY_EPSILON
    ? [[start, Math.min(end, TWO_PI)]]
    : [[start, TWO_PI], [0, end - TWO_PI]];
}

function arcPoint(arc, theta) {
  const cosPhi = Math.cos(arc.phi);
  const sinPhi = Math.sin(arc.phi);
  return [
    arc.cx + arc.rx * Math.cos(theta) * cosPhi - arc.ry * Math.sin(theta) * sinPhi,
    arc.cy + arc.rx * Math.cos(theta) * sinPhi + arc.ry * Math.sin(theta) * cosPhi,
  ];
}

function sharedArcPieces(leftPrimitive, rightPrimitive) {
  const left = canonicalArc(leftPrimitive);
  const right = canonicalArc(rightPrimitive);
  if (!left || !right || !sameArcSupport(left, right)) return [];
  if (Math.sign(left.dTheta) === Math.sign(right.dTheta)) return [];
  const pieces = [];
  for (const [leftStart, leftEnd] of arcCoverageIntervals(left)) {
    for (const [rightStart, rightEnd] of arcCoverageIntervals(right)) {
      const start = Math.max(leftStart, rightStart);
      const end = Math.min(leftEnd, rightEnd);
      if (!(end - start > GEOMETRY_EPSILON)) continue;
      pieces.push({
        kind: 'A',
        arc: left,
        start,
        end,
        endpoints: [arcPoint(left, start), arcPoint(left, end)],
      });
    }
  }
  return pieces;
}

function reversedPrimitive(left, right) {
  if (left.cmd !== right.cmd) return false;
  if (!pointEquals(left.start, right.end) || !pointEquals(left.end, right.start)) return false;
  if (left.cmd === 'Q') {
    return pointEquals([left.x1, left.y1], [right.x1, right.y1]);
  }
  if (left.cmd === 'C') {
    return (
      pointEquals([left.x1, left.y1], [right.x2, right.y2]) &&
      pointEquals([left.x2, left.y2], [right.x1, right.y1])
    );
  }
  return left.cmd === 'L';
}

function sharedBoundaryPieces(left, right) {
  if (left.cmd === 'A' && right.cmd === 'A') return sharedArcPieces(left, right);
  if (left.cmd === 'L' && right.cmd === 'L') {
    const leftDirection = [left.end[0] - left.start[0], left.end[1] - left.start[1]];
    const rightDirection = [right.end[0] - right.start[0], right.end[1] - right.start[1]];
    if (leftDirection[0] * rightDirection[0] + leftDirection[1] * rightDirection[1] >= 0) {
      return [];
    }
    const overlap = collinearSegmentOverlap(left.start, left.end, right.start, right.end);
    return overlap ? [{ kind: 'L', endpoints: overlap }] : [];
  }
  if (!reversedPrimitive(left, right)) return [];
  return [{
    kind: left.cmd,
    endpoints: [left.start, left.end],
    sampledSegments: left.sampledSegments,
  }];
}

function connectedBoundaryComponents(pieces) {
  if (!pieces.length) return 0;
  const parents = Array.from({ length: pieces.length }, (_, index) => index);
  const find = (value) => {
    let root = value;
    while (parents[root] !== root) root = parents[root];
    while (parents[value] !== value) {
      const next = parents[value];
      parents[value] = root;
      value = next;
    }
    return root;
  };
  for (let left = 0; left < pieces.length; left++) {
    for (let right = left + 1; right < pieces.length; right++) {
      const connected = pieces[left].endpoints.some((leftPoint) =>
        pieces[right].endpoints.some((rightPoint) => pointEquals(leftPoint, rightPoint)));
      if (!connected) continue;
      const leftRoot = find(left);
      const rightRoot = find(right);
      if (leftRoot !== rightRoot) parents[leftRoot] = rightRoot;
    }
  }
  return new Set(pieces.map((_, index) => find(index))).size;
}

function segmentContactPoints(a, b, c, d) {
  const points = [];
  for (const point of [a, b, c, d]) {
    if (!onSegment(a, b, point) || !onSegment(c, d, point)) continue;
    if (!points.some((candidate) => pointEquals(candidate, point))) points.push(point);
  }
  return points;
}

function pushUniquePoints(target, points) {
  for (const point of points) {
    if (!target.some((candidate) => pointEquals(candidate, point))) target.push(point);
  }
}

function pointOnArcPiece(point, piece) {
  const { arc } = piece;
  const cosPhi = Math.cos(arc.phi);
  const sinPhi = Math.sin(arc.phi);
  const dx = point[0] - arc.cx;
  const dy = point[1] - arc.cy;
  const x = cosPhi * dx + sinPhi * dy;
  const y = -sinPhi * dx + cosPhi * dy;
  const radiusEquation = (x * x) / (arc.rx * arc.rx) + (y * y) / (arc.ry * arc.ry);
  if (Math.abs(radiusEquation - 1) > GEOMETRY_EPSILON) return false;
  const theta = normalizedAngle(Math.atan2(y / arc.ry, x / arc.rx));
  return theta >= piece.start - GEOMETRY_EPSILON && theta <= piece.end + GEOMETRY_EPSILON;
}

function pointOnBoundaryPiece(point, piece) {
  if (piece.kind === 'L') return onSegment(...piece.endpoints, point);
  if (piece.kind === 'A') return pointOnArcPiece(point, piece);
  return piece.sampledSegments.some(([a, b]) => onSegment(a, b, point));
}

function polygonIsConvex(points) {
  let sign = 0;
  for (let index = 0; index < points.length; index++) {
    const turn = orientation(
      points[index],
      points[(index + 1) % points.length],
      points[(index + 2) % points.length],
    );
    if (Math.abs(turn) <= GEOMETRY_EPSILON) continue;
    const nextSign = Math.sign(turn);
    if (sign !== 0 && nextSign !== sign) return false;
    sign = nextSign;
  }
  return sign !== 0;
}

/** Strict interior: boundary evidence is a contact, not a positive-area weld. */
function pointInsideSubpath(point, subpath) {
  let winding = 0;
  let crossings = 0;
  const { points } = subpath;
  for (let index = 0; index < points.length; index++) {
    const a = points[index];
    const b = points[(index + 1) % points.length];
    if (onSegment(a, b, point)) return false;
    const upward = a[1] <= point[1] && b[1] > point[1];
    const downward = b[1] <= point[1] && a[1] > point[1];
    if (!upward && !downward) continue;
    const turn = orientation(a, b, point);
    if (upward && turn > GEOMETRY_EPSILON) winding++;
    if (downward && turn < -GEOMETRY_EPSILON) winding--;
    const x = a[0] + ((point[1] - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
    if (x > point[0] + GEOMETRY_EPSILON) crossings++;
  }
  return subpath.fillRule === 'evenodd' ? crossings % 2 === 1 : winding !== 0;
}

/**
 * Находит только конструктивное доказательство overlap: одна точка строго
 * внутри обеих sampled-границ задаёт открытую окрестность положительной площади.
 * Отсутствие witness ничего не доказывает и потому ниже становится UNCERTAIN.
 */
function hasPositiveAreaOverlap(left, right) {
  const minX = Math.max(left.bounds.minX, right.bounds.minX);
  const minY = Math.max(left.bounds.minY, right.bounds.minY);
  const maxX = Math.min(left.bounds.maxX, right.bounds.maxX);
  const maxY = Math.min(left.bounds.maxY, right.bounds.maxY);
  if (!(maxX - minX > GEOMETRY_EPSILON && maxY - minY > GEOMETRY_EPSILON)) return false;

  for (let row = 0; row < OVERLAP_WITNESS_GRID_SIDE; row++) {
    const y = minY + ((row + 0.5) / OVERLAP_WITNESS_GRID_SIDE) * (maxY - minY);
    for (let column = 0; column < OVERLAP_WITNESS_GRID_SIDE; column++) {
      const x = minX + ((column + 0.5) / OVERLAP_WITNESS_GRID_SIDE) * (maxX - minX);
      const point = [x, y];
      if (pointInsideSubpath(point, left) && pointInsideSubpath(point, right)) return true;
    }
  }
  return false;
}

function graphHasCycle(vertexCount, edges) {
  const parents = Array.from({ length: vertexCount }, (_, index) => index);
  const find = (value) => {
    let root = value;
    while (parents[root] !== root) root = parents[root];
    while (parents[value] !== value) {
      const next = parents[value];
      parents[value] = root;
      value = next;
    }
    return root;
  };
  for (const [left, right] of edges) {
    const leftRoot = find(left);
    const rightRoot = find(right);
    if (leftRoot === rightRoot) return true;
    parents[leftRoot] = rightRoot;
  }
  return false;
}

function closedCycleFacts(points, minimumFeatureArea) {
  if (points.length < 4 || !pointEquals(points[0], points[points.length - 1])) return null;
  const ring = points.slice(0, -1);
  const area = polygonArea(ring);
  if (area + GEOMETRY_EPSILON < minimumFeatureArea) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of ring) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  const minorSpan = Math.min(maxX - minX, maxY - minY);
  if (!(minorSpan > GEOMETRY_EPSILON)) return null;
  return { area, minorSpan };
}

function traversalIsCollinear(points) {
  const first = points[0];
  const second = points.find((point) => !pointEquals(point, first));
  if (!second) return true;
  return points.every((point) => Math.abs(orientation(first, second, point)) <= GEOMETRY_EPSILON);
}

/**
 * A self-intersecting evenodd subpath can contain a real counter while the
 * bounding box of the whole subpath remains large.  Repeated vertices cover
 * retraced/lollipop loops; proper non-adjacent intersections cover crossings.
 * Both are traversal-derived cycles, so their span is evidence for raster
 * resolution rather than a guessed visual epsilon.
 */
function internalCycleFacts(subpath, minimumFeatureArea, remainingPairBudget) {
  const points = subpath.points;
  const cycles = [];
  let testedSegmentPairs = 0;
  let budgetExceeded = false;
  let arrangementUnresolved = false;

  for (let left = 0; left < points.length; left++) {
    for (let right = left + 2; right < points.length; right++) {
      if (left === 0 && right === points.length - 1) continue;
      if (!pointEquals(points[left], points[right])) continue;
      const facts = closedCycleFacts(points.slice(left, right + 1), minimumFeatureArea);
      if (facts) cycles.push(facts);
    }
  }

  const segments = subpathSegments(subpath);
  outer: for (let left = 0; left < segments.length; left++) {
    for (let right = left + 1; right < segments.length; right++) {
      const adjacent = right === left + 1 || (left === 0 && right === segments.length - 1);
      if (adjacent) continue;
      // Bounding-box rejection is an exact planar fact. Counting only pairs
      // that can intersect keeps the safety budget about geometric ambiguity,
      // not about how finely a harmless circle happened to be sampled.
      if (!segmentBoundsOverlap(segments[left], segments[right])) continue;
      testedSegmentPairs++;
      if (testedSegmentPairs > remainingPairBudget) {
        budgetExceeded = true;
        break outer;
      }
      const intersection = properSegmentIntersection(
        segments[left][0],
        segments[left][1],
        segments[right][0],
        segments[right][1],
      );
      if (intersection) {
        const cycle = [intersection, ...points.slice(left + 1, right + 1), intersection];
        const facts = closedCycleFacts(cycle, minimumFeatureArea);
        if (facts) cycles.push(facts);
        continue;
      }
      if (!segmentsIntersect(...segments[left], ...segments[right])) continue;
      const contacts = segmentContactPoints(...segments[left], ...segments[right]);
      const repeatedEndpoints = contacts.length > 0 && contacts.every((point) => (
        (pointEquals(point, segments[left][0]) || pointEquals(point, segments[left][1])) &&
        (pointEquals(point, segments[right][0]) || pointEquals(point, segments[right][1]))
      ));
      const exactCollinearRetrace = contacts.length > 0 && contacts.every((point) => {
        const forward = [point, ...points.slice(left + 1, right + 1), point];
        const complement = [
          point,
          ...points.slice(right + 1),
          ...points.slice(0, left + 1),
          point,
        ];
        return traversalIsCollinear(forward) || traversalIsCollinear(complement);
      });
      // Repeated vertices были обработаны traversal-cycle выше. Endpoint на
      // interior другого сегмента, tangency или collinear retrace без такого
      // vertex не дают точного face decomposition — только UNCERTAIN.
      // Узкое исключение — traversal между двумя появлениями contact целиком
      // collinear: это точный zero-area retrace, включая implicit close у
      // installed minus/* и source list/*. Нецоллинеарный detour остаётся
      // unknown даже при малой высоте: именно он может ограничить новый face.
      if (!repeatedEndpoints && !exactCollinearRetrace) arrangementUnresolved = true;
    }
  }

  return { cycles, testedSegmentPairs, budgetExceeded, arrangementUnresolved };
}

function subpathSegments(subpath) {
  const segments = [];
  for (let index = 0; index < subpath.points.length; index++) {
    const a = subpath.points[index];
    const b = subpath.points[(index + 1) % subpath.points.length];
    if (!pointEquals(a, b)) segments.push([a, b]);
  }
  return segments;
}

function polylinePathData(points) {
  const [first, ...rest] = points;
  return `M${first[0]} ${first[1]}${rest.map(([x, y]) => `L${x} ${y}`).join('')}Z`;
}

function sanitizedEntries(entries, significantSubpaths) {
  const byEntry = new Map();
  for (const subpath of significantSubpaths) {
    const list = byEntry.get(subpath.entryIndex) ?? [];
    list.push(subpath);
    byEntry.set(subpath.entryIndex, list);
  }
  return [...byEntry.entries()]
    .sort(([left], [right]) => left - right)
    .map(([entryIndex, subpaths]) => ({
      d: subpaths
        .slice()
        .sort((left, right) => left.subpathIndex - right.subpathIndex)
        .map(({ points }) => polylinePathData(points))
        .join(''),
      fillRule: entries[entryIndex].fillRule,
    }));
}

/**
 * Vector guide for the occupancy oracle.  Minor subpath span catches tiny
 * counters; clearance between non-intersecting subpaths catches thin rings and
 * negative channels.  Exceeding the pair budget is evidence of uncertainty,
 * never permission to silently fall back to the coarse raster.
 */
function topologyVectorGuide(entries, stepsPerSeg, maxSegmentPairs, minimumFeatureArea) {
  const facts = polylineFacts(entries, stepsPerSeg, minimumFeatureArea);
  const spans = facts.subpaths.map(({ minorSpan }) => minorSpan).filter((value) => value != null);
  let minimumSubpathSpan = spans.length ? Math.min(...spans) : null;
  let minimumClearance = null;
  let testedSegmentPairs = 0;
  let intersectingSubpathPairs = 0;
  let properCrossingPairs = 0;
  let collinearWeldPairs = 0;
  let collinearSeamComponents = 0;
  let exactSharedBoundaryComponents = 0;
  let exactSharedBoundaryPairs = 0;
  let boundaryContactPoints = 0;
  let offSeamContactPoints = 0;
  let exactCollinearSeamPairs = 0;
  let positiveAreaWeldPairs = 0;
  let tangentContactPairs = 0;
  let compositorOrPairs = 0;
  let sameWindingNonzeroPairs = 0;
  let nonMonotonePairs = 0;
  let disconnectedInteractionPairs = 0;
  let possibleMultiComponentPairs = 0;
  let complexInteractionPairs = 0;
  let internalCycles = 0;
  const internallyUnresolvedSubpaths = new Set();
  let minimumInternalCycleSpan = null;
  let segmentBudgetExceeded = false;
  const significantSubpaths = facts.subpaths.filter(({ significant }) => significant);
  const segmentLists = significantSubpaths.map(subpathSegments);
  const arrangementEdges = [];

  for (let subpathIndex = 0; subpathIndex < significantSubpaths.length; subpathIndex++) {
    const subpath = significantSubpaths[subpathIndex];
    const internal = internalCycleFacts(
      subpath,
      minimumFeatureArea,
      Math.max(0, maxSegmentPairs - testedSegmentPairs),
    );
    testedSegmentPairs += internal.testedSegmentPairs;
    if (internal.budgetExceeded) {
      segmentBudgetExceeded = true;
      break;
    }
    if (internal.arrangementUnresolved) internallyUnresolvedSubpaths.add(subpathIndex);
    internalCycles += internal.cycles.length;
    for (const cycle of internal.cycles) {
      minimumInternalCycleSpan = minimumInternalCycleSpan == null
        ? cycle.minorSpan
        : Math.min(minimumInternalCycleSpan, cycle.minorSpan);
    }
  }

  outer: for (let left = 0; !segmentBudgetExceeded && left < significantSubpaths.length; left++) {
    for (let right = left + 1; right < significantSubpaths.length; right++) {
      let pairClearance = Infinity;
      let intersects = false;
      let properCrossings = 0;
      const sharedPieces = [];
      const contactPoints = [];
      for (const [a, b] of segmentLists[left]) {
        for (const [c, d] of segmentLists[right]) {
          testedSegmentPairs++;
          if (testedSegmentPairs > maxSegmentPairs) {
            segmentBudgetExceeded = true;
            break outer;
          }
          const proper = properSegmentIntersection(a, b, c, d);
          if (proper) {
            intersects = true;
            properCrossings++;
            continue;
          }
          if (segmentsIntersect(a, b, c, d)) {
            intersects = true;
            pushUniquePoints(contactPoints, segmentContactPoints(a, b, c, d));
            continue;
          }
          pairClearance = Math.min(pairClearance, segmentDistance(a, b, c, d));
        }
      }
      for (const leftPrimitive of significantSubpaths[left].exactBoundary) {
        for (const rightPrimitive of significantSubpaths[right].exactBoundary) {
          testedSegmentPairs++;
          if (testedSegmentPairs > maxSegmentPairs) {
            segmentBudgetExceeded = true;
            break outer;
          }
          const pieces = sharedBoundaryPieces(leftPrimitive, rightPrimitive);
          if (!pieces.length) continue;
          intersects = true;
          sharedPieces.push(...pieces);
        }
      }
      if (intersects) {
        intersectingSubpathPairs++;
        arrangementEdges.push([left, right]);
        if (properCrossings > 0) properCrossingPairs++;
        const collinearPieces = sharedPieces.filter(({ kind }) => kind === 'L');
        const seamComponents = connectedBoundaryComponents(collinearPieces);
        const sharedComponents = connectedBoundaryComponents(sharedPieces);
        const pairOffSeamContactPoints = contactPoints.filter(
          (point) => !sharedPieces.some((piece) => pointOnBoundaryPiece(point, piece)),
        ).length;
        collinearSeamComponents += seamComponents;
        exactSharedBoundaryComponents += sharedComponents;
        boundaryContactPoints += contactPoints.length;
        offSeamContactPoints += pairOffSeamContactPoints;
        if (collinearPieces.length > 0) collinearWeldPairs++;

        const leftSubpath = significantSubpaths[left];
        const rightSubpath = significantSubpaths[right];
        const positiveArea = hasPositiveAreaOverlap(leftSubpath, rightSubpath);
        if (positiveArea) positiveAreaWeldPairs++;

        const compositorOr = leftSubpath.entryIndex !== rightSubpath.entryIndex;
        const sameWindingNonzero =
          !compositorOr &&
          leftSubpath.fillRule === 'nonzero' &&
          rightSubpath.fillRule === 'nonzero' &&
          leftSubpath.windingSign !== 0 &&
          leftSubpath.windingSign === rightSubpath.windingSign;
        if (compositorOr) compositorOrPairs++;
        else if (sameWindingNonzero) sameWindingNonzeroPairs++;
        else nonMonotonePairs++;

        const bothConvex = polygonIsConvex(leftSubpath.points) && polygonIsConvex(rightSubpath.points);
        const internallySimple =
          !internallyUnresolvedSubpaths.has(left) &&
          !internallyUnresolvedSubpaths.has(right);
        const exactSharedBoundary =
          properCrossings === 0 &&
          sharedComponents === 1 &&
          pairOffSeamContactPoints === 0 &&
          internallySimple &&
          sameWindingNonzero;
        if (exactSharedBoundary) exactSharedBoundaryPairs++;
        const exactCollinearSeam = exactSharedBoundary && collinearPieces.length > 0;
        if (exactCollinearSeam) exactCollinearSeamPairs++;
        if (!positiveArea && !exactSharedBoundary) tangentContactPairs++;
        // Convex intersection is connected. Второй доказуемый класс — одна
        // связная exact 1D boundary из reversed source primitives (включая
        // partial A-overlap на одной W3C center-ellipse) между same-winding
        // nonzero subpaths. У неё нулевая площадь: compositor butt без
        // interior overlap остаётся unknown.
        // Всё остальное может скрывать несколько components одного pair и
        // становится multigraph uncertainty.
        const connectedInteractionProven =
          (positiveArea && bothConvex && internallySimple) || exactSharedBoundary;
        const disconnectedInteraction =
          sharedComponents > 1 ||
          (sharedComponents === 1 && pairOffSeamContactPoints > 0);
        if (disconnectedInteraction) disconnectedInteractionPairs++;
        if ((positiveArea && !connectedInteractionProven) || disconnectedInteraction) {
          possibleMultiComponentPairs++;
          complexInteractionPairs++;
        }
      } else if (Number.isFinite(pairClearance)) {
        minimumClearance = minimumClearance == null
          ? pairClearance
          : Math.min(minimumClearance, pairClearance);
      }
    }
  }

  const finiteFeatures = [minimumSubpathSpan, minimumClearance, minimumInternalCycleSpan].filter(
    (value) => value != null && value > GEOMETRY_EPSILON,
  );
  const simpleGraphCycle = graphHasCycle(significantSubpaths.length, arrangementEdges);
  const multigraphCycle = simpleGraphCycle || possibleMultiComponentPairs > 0;
  return {
    sanitizedEntries: sanitizedEntries(entries, significantSubpaths),
    report: {
      minimumFeatureSpan: finiteFeatures.length ? Math.min(...finiteFeatures) : null,
      minimumSubpathSpan,
      minimumClearance,
      minimumInternalCycleSpan,
      internalCycles,
      internalArrangementUnresolvedSubpaths: internallyUnresolvedSubpaths.size,
      subpaths: facts.subpaths.length,
      significantSubpaths: significantSubpaths.length,
      degenerateSubpaths: facts.degenerateSubpaths,
      ignoredBelowResolutionSubpaths: facts.ignoredBelowResolutionSubpaths,
      algebraicCancellationSubpaths: facts.algebraicCancellationSubpaths,
      areaClassificationUncertainSubpaths: facts.areaClassificationUncertainSubpaths,
      intersectingSubpathPairs,
      arrangement: {
        vertices: significantSubpaths.length,
        edges: arrangementEdges.length,
        properCrossingPairs,
        collinearWeldPairs,
        collinearSeamComponents,
        exactSharedBoundaryComponents,
        exactSharedBoundaryPairs,
        boundaryContactPoints,
        offSeamContactPoints,
        exactCollinearSeamPairs,
        positiveAreaWeldPairs,
        tangentContactPairs,
        compositorOrPairs,
        sameWindingNonzeroPairs,
        nonMonotonePairs,
        disconnectedInteractionPairs,
        possibleMultiComponentPairs,
        complexInteractionPairs,
        simpleGraphCycle,
        multigraphCycle,
      },
      testedSegmentPairs,
      segmentBudgetExceeded,
    },
  };
}

function assertTopologyOracleOptions({ pixelsPerFeature, maxGridSide, maxSegmentPairs }) {
  if (!(Number.isFinite(pixelsPerFeature) && pixelsPerFeature >= 2)) {
    throw new Error(`quality-metrics: topologyPixelsPerFeature обязан быть >= 2; найдено ${pixelsPerFeature}`);
  }
  if (!Number.isInteger(maxGridSide) || maxGridSide < 16) {
    throw new Error(`quality-metrics: topologyMaxGridSide обязан быть целым >= 16; найдено ${maxGridSide}`);
  }
  if (!Number.isInteger(maxSegmentPairs) || maxSegmentPairs < 1) {
    throw new Error(`quality-metrics: topologyMaxSegmentPairs обязан быть положительным целым; найдено ${maxSegmentPairs}`);
  }
}

function stableTopology(report) {
  if (!report.stable) return { components: null, holes: null };
  return report.samples[0].significant;
}

function compareTopologyWithOracle(
  originalEntries,
  candidateEntries,
  {
    canvas,
    analysisStep,
    stepsPerSeg,
    pixelsPerFeature,
    maxGridSide,
    maxSegmentPairs,
    phases,
  },
) {
  assertTopologyOracleOptions({ pixelsPerFeature, maxGridSide, maxSegmentPairs });
  const budgetStep = canvas / maxGridSide;
  // Это не вкусовой epsilon: квадрат со стороной pixelsPerFeature budget-cells
  // — минимальная 2D feature, которую заявленная сетка может подтвердить.
  const minimumFeatureArea = (pixelsPerFeature * budgetStep) ** 2;
  const originalGuided = topologyVectorGuide(
    originalEntries,
    stepsPerSeg,
    maxSegmentPairs,
    minimumFeatureArea,
  );
  const candidateGuided = topologyVectorGuide(
    candidateEntries,
    stepsPerSeg,
    maxSegmentPairs,
    minimumFeatureArea,
  );
  const originalGuide = originalGuided.report;
  const candidateGuide = candidateGuided.report;
  const featureSpans = [originalGuide.minimumFeatureSpan, candidateGuide.minimumFeatureSpan]
    .filter((value) => value != null);
  const minimumFeatureSpan = featureSpans.length ? Math.min(...featureSpans) : null;
  const requestedStep = minimumFeatureSpan == null
    ? analysisStep
    : Math.min(analysisStep, minimumFeatureSpan / pixelsPerFeature);
  const step = Math.max(requestedStep, budgetStep);
  const limitedByGridBudget = step > requestedStep + GEOMETRY_EPSILON;
  const rasterOptions = {
    width: canvas,
    height: canvas,
    step,
    phases,
    minFeatureArea: minimumFeatureArea,
    stepsPerSeg,
  };
  const originalReport = topologyAcrossPhases(originalGuided.sanitizedEntries, rasterOptions);
  const candidateReport = topologyAcrossPhases(candidateGuided.sanitizedEntries, rasterOptions);
  const reasons = [];
  if (limitedByGridBudget) reasons.push('GRID_BUDGET_CANNOT_RESOLVE_VECTOR_FEATURE');
  if (originalGuide.segmentBudgetExceeded || candidateGuide.segmentBudgetExceeded) {
    reasons.push('VECTOR_SEGMENT_PAIR_BUDGET_EXCEEDED');
  }
  if (
    originalGuide.internalArrangementUnresolvedSubpaths > 0 ||
    candidateGuide.internalArrangementUnresolvedSubpaths > 0
  ) {
    reasons.push('INTERNAL_SUBPATH_ARRANGEMENT_UNRESOLVED');
  }
  if (
    originalGuide.areaClassificationUncertainSubpaths > 0 ||
    candidateGuide.areaClassificationUncertainSubpaths > 0
  ) {
    reasons.push('CURVE_SUBPATH_AREA_FLOOR_UNRESOLVED');
  }
  const arrangements = [originalGuide.arrangement, candidateGuide.arrangement];
  // Provenance правила:
  // - compositor OR с доказанным interior overlap и same-winding nonzero —
  //   монотонные weld только локально; 1D seam разрешена лишь как одна связная
  //   exact boundary из reversed source primitives внутри того же nonzero
  //   entry (A сравнивается по W3C center-ellipse и angular interval);
  // - cycle interaction graph способен ограничить новый face между >=3 weld;
  // - возможные disconnected pair intersections являются parallel edges того
  //   же multigraph;
  // - evenodd/opposite winding не монотонны, а compositor butt и
  //   endpoint/tangent без interior witness не доказывают positive-area weld.
  // Ни один из этих классов нельзя превратить в PASS стабильным coarse raster.
  if (arrangements.some(({ multigraphCycle }) => multigraphCycle)) {
    reasons.push('INTER_SUBPATH_CYCLES_UNRESOLVED');
  }
  if (arrangements.some(({ nonMonotonePairs }) => nonMonotonePairs > 0)) {
    reasons.push('INTER_SUBPATH_NON_MONOTONE');
  }
  if (arrangements.some(({ tangentContactPairs }) => tangentContactPairs > 0)) {
    reasons.push('INTER_SUBPATH_CONTACT_UNRESOLVED');
  }
  if (arrangements.some(({ complexInteractionPairs }) => complexInteractionPairs > 0)) {
    reasons.push('INTER_SUBPATH_ARRANGEMENT_COMPLEX');
  }
  if (!originalGuided.sanitizedEntries.length) reasons.push('ORIGINAL_HAS_NO_SIGNIFICANT_SUBPATH');
  if (!candidateGuided.sanitizedEntries.length) reasons.push('CANDIDATE_HAS_NO_SIGNIFICANT_SUBPATH');
  if (!originalReport.stable) reasons.push('ORIGINAL_PHASE_INSTABILITY');
  if (!candidateReport.stable) reasons.push('CANDIDATE_PHASE_INSTABILITY');

  const original = stableTopology(originalReport);
  const candidate = stableTopology(candidateReport);
  const uncertain = reasons.length > 0;
  const difference = !uncertain && (
    original.components !== candidate.components || original.holes !== candidate.holes
  );

  return {
    original,
    candidate,
    // `mismatch` означает только доказанную разницу. Незнание живёт отдельно в
    // `uncertain`, чтобы machine consumers не превращали fail-closed verdict в
    // ложное утверждение о topology.
    mismatch: difference,
    difference,
    uncertain,
    confidence: {
      status: uncertain ? 'UNCERTAIN' : 'RESOLVED',
      reasons,
      claim: 'resolved only at/above the declared feature-area floor; not an exact planar-geometry proof',
    },
    resolution: {
      step: finiteRound(step),
      requestedStep: finiteRound(requestedStep),
      grid: { cols: Math.ceil(canvas / step), rows: Math.ceil(canvas / step) },
      phases: phases.map((phase) => [...phase]),
      pixelsPerFeature,
      maxGridSide,
      limitedByGridBudget,
      minimumFeatureArea: finiteRound(minimumFeatureArea),
      minimumFeatureSpan: finiteRound(minimumFeatureSpan),
      vectorGuide: {
        original: {
          ...originalGuide,
          minimumFeatureSpan: finiteRound(originalGuide.minimumFeatureSpan),
          minimumSubpathSpan: finiteRound(originalGuide.minimumSubpathSpan),
          minimumClearance: finiteRound(originalGuide.minimumClearance),
          minimumInternalCycleSpan: finiteRound(originalGuide.minimumInternalCycleSpan),
        },
        candidate: {
          ...candidateGuide,
          minimumFeatureSpan: finiteRound(candidateGuide.minimumFeatureSpan),
          minimumSubpathSpan: finiteRound(candidateGuide.minimumSubpathSpan),
          minimumClearance: finiteRound(candidateGuide.minimumClearance),
          minimumInternalCycleSpan: finiteRound(candidateGuide.minimumInternalCycleSpan),
        },
      },
      phaseSignatures: {
        original: originalReport.signatures,
        candidate: candidateReport.signatures,
      },
    },
  };
}

/**
 * Area/centroid and symmetric-difference facts from two masks.
 * Empty-vs-empty is intentionally undefined rather than a flattering 0%.
 */
export function compareRasterMasks(original, candidate) {
  assertComparableMasks(original, candidate);

  let originalCells = 0;
  let candidateCells = 0;
  let intersectionCells = 0;
  let unionCells = 0;
  let differingCells = 0;
  let originalX = 0;
  let originalY = 0;
  let candidateX = 0;
  let candidateY = 0;

  for (let index = 0; index < original.mask.length; index++) {
    const a = original.mask[index] === 1;
    const b = candidate.mask[index] === 1;
    if (!a && !b) continue;

    const row = Math.floor(index / original.cols);
    const col = index % original.cols;
    const x = (col + original.phase[0]) * original.step;
    const y = (row + original.phase[1]) * original.step;

    if (a) {
      originalCells++;
      originalX += x;
      originalY += y;
    }
    if (b) {
      candidateCells++;
      candidateX += x;
      candidateY += y;
    }
    if (a && b) intersectionCells++;
    if (a || b) unionCells++;
    if (a !== b) differingCells++;
  }

  const cellArea = original.step * original.step;
  const originalArea = originalCells * cellArea;
  const candidateArea = candidateCells * cellArea;
  const originalCentroid =
    originalCells === 0 ? null : { x: originalX / originalCells, y: originalY / originalCells };
  const candidateCentroid =
    candidateCells === 0 ? null : { x: candidateX / candidateCells, y: candidateY / candidateCells };
  const centroidDx =
    originalCentroid && candidateCentroid ? candidateCentroid.x - originalCentroid.x : null;
  const centroidDy =
    originalCentroid && candidateCentroid ? candidateCentroid.y - originalCentroid.y : null;

  return {
    cells: {
      original: originalCells,
      candidate: candidateCells,
      intersection: intersectionCells,
      union: unionCells,
      symmetricDifference: differingCells,
    },
    deviationPct: unionCells === 0 ? null : finiteRound((differingCells / unionCells) * 100),
    differingCanvasPct: finiteRound((differingCells / original.mask.length) * 100),
    ink: {
      area: {
        original: finiteRound(originalArea),
        candidate: finiteRound(candidateArea),
        delta: finiteRound(candidateArea - originalArea),
        deltaPctOriginal:
          originalArea === 0 ? null : finiteRound(((candidateArea - originalArea) / originalArea) * 100),
      },
      centroid: {
        original:
          originalCentroid == null
            ? null
            : { x: finiteRound(originalCentroid.x), y: finiteRound(originalCentroid.y) },
        candidate:
          candidateCentroid == null
            ? null
            : { x: finiteRound(candidateCentroid.x), y: finiteRound(candidateCentroid.y) },
        delta:
          centroidDx == null
            ? null
            : {
                x: finiteRound(centroidDx),
                y: finiteRound(centroidDy),
                distance: finiteRound(Math.hypot(centroidDx, centroidDy)),
              },
      },
    },
  };
}

function boundaryPoints(raster) {
  const points = [];
  for (let row = 0; row < raster.rows; row++) {
    for (let col = 0; col < raster.cols; col++) {
      const index = row * raster.cols + col;
      if (raster.mask[index] !== 1) continue;
      const atEdge = row === 0 || col === 0 || row === raster.rows - 1 || col === raster.cols - 1;
      const touchesNegative =
        atEdge ||
        raster.mask[index - 1] === 0 ||
        raster.mask[index + 1] === 0 ||
        raster.mask[index - raster.cols] === 0 ||
        raster.mask[index + raster.cols] === 0;
      if (touchesNegative) {
        points.push([
          (col + raster.phase[0]) * raster.step,
          (row + raster.phase[1]) * raster.step,
        ]);
      }
    }
  }
  return points;
}

function buildKdTree(points, depth = 0) {
  if (points.length === 0) return null;
  const axis = depth % 2;
  const sorted = points.slice().sort((a, b) => a[axis] - b[axis] || a[1 - axis] - b[1 - axis]);
  const middle = Math.floor(sorted.length / 2);
  return {
    axis,
    point: sorted[middle],
    left: buildKdTree(sorted.slice(0, middle), depth + 1),
    right: buildKdTree(sorted.slice(middle + 1), depth + 1),
  };
}

function nearestDistanceSquared(tree, point, best = Infinity) {
  if (!tree) return best;
  const dx = tree.point[0] - point[0];
  const dy = tree.point[1] - point[1];
  let nextBest = Math.min(best, dx * dx + dy * dy);
  const delta = point[tree.axis] - tree.point[tree.axis];
  const near = delta <= 0 ? tree.left : tree.right;
  const far = delta <= 0 ? tree.right : tree.left;
  nextBest = nearestDistanceSquared(near, point, nextBest);
  if (delta * delta < nextBest) nextBest = nearestDistanceSquared(far, point, nextBest);
  return nextBest;
}

function percentile(sortedValues, p) {
  if (sortedValues.length === 0) return null;
  const index = Math.max(0, Math.ceil(sortedValues.length * p) - 1);
  return sortedValues[Math.min(index, sortedValues.length - 1)];
}

/** Symmetric Chamfer-style boundary distances (both directed sets pooled). */
export function compareMaskBoundaries(original, candidate) {
  assertComparableMasks(original, candidate);
  if (original.mask.every((value, index) => value === candidate.mask[index])) {
    const count = boundaryPoints(original).length;
    return { p95: 0, max: 0, samples: { original: count, candidate: count } };
  }

  const a = boundaryPoints(original);
  const b = boundaryPoints(candidate);
  if (a.length === 0 || b.length === 0) {
    return {
      p95: null,
      max: null,
      samples: { original: a.length, candidate: b.length },
    };
  }

  const aTree = buildKdTree(a);
  const bTree = buildKdTree(b);
  const distances = [];
  for (const point of a) distances.push(Math.sqrt(nearestDistanceSquared(bTree, point)));
  for (const point of b) distances.push(Math.sqrt(nearestDistanceSquared(aTree, point)));
  distances.sort((x, y) => x - y);

  return {
    p95: finiteRound(percentile(distances, 0.95)),
    max: finiteRound(distances[distances.length - 1]),
    samples: { original: a.length, candidate: b.length },
  };
}

function compareRasterTopology(original, candidate) {
  const a = topologySignature(original);
  const b = topologySignature(candidate);
  return {
    original: a,
    candidate: b,
    mismatch: a.components !== b.components || a.holes !== b.holes,
  };
}

/**
 * Complete Observatory comparison.  Entries preserve the per-<path>
 * fill-rule boundary; callers must not concatenate path-data before calling.
 */
export function compareSilhouettes(
  originalEntries,
  candidateEntries,
  {
    canvas = 24,
    analysisStep = 0.12,
    rasterSizes = DEFAULT_OBSERVATORY_RASTER_SIZES,
    stepsPerSeg = 24,
    topologyPixelsPerFeature = DEFAULT_TOPOLOGY_PIXELS_PER_FEATURE,
    topologyMaxGridSide = DEFAULT_TOPOLOGY_MAX_GRID_SIDE,
    topologyMaxSegmentPairs = DEFAULT_TOPOLOGY_MAX_SEGMENT_PAIRS,
    topologyPhases = DEFAULT_RASTER_PHASES,
  } = {},
) {
  if (!Array.isArray(originalEntries) || originalEntries.length === 0) {
    throw new Error('quality-metrics: originalEntries обязан содержать хотя бы один path');
  }
  if (!Array.isArray(candidateEntries) || candidateEntries.length === 0) {
    throw new Error('quality-metrics: candidateEntries обязан содержать хотя бы один path');
  }

  const rasterOptions = {
    width: canvas,
    height: canvas,
    step: analysisStep,
    phaseX: 0.5,
    phaseY: 0.5,
    stepsPerSeg,
  };
  const original = rasterizePathEntries(originalEntries, rasterOptions);
  const candidate = rasterizePathEntries(candidateEntries, rasterOptions);
  const comparison = compareRasterMasks(original, candidate);
  const boundary = compareMaskBoundaries(original, candidate);
  const topology = compareTopologyWithOracle(originalEntries, candidateEntries, {
    canvas,
    analysisStep,
    stepsPerSeg,
    pixelsPerFeature: topologyPixelsPerFeature,
    maxGridSide: topologyMaxGridSide,
    maxSegmentPairs: topologyMaxSegmentPairs,
    phases: topologyPhases,
  });

  const raster = rasterSizes.map((size) => {
    if (!Number.isInteger(size) || size < 1) {
      throw new Error(`quality-metrics: raster size обязан быть положительным целым; найдено ${size}`);
    }
    const options = {
      width: canvas,
      height: canvas,
      step: canvas / size,
      phaseX: 0.5,
      phaseY: 0.5,
      stepsPerSeg,
    };
    const a = rasterizePathEntries(originalEntries, options);
    const b = rasterizePathEntries(candidateEntries, options);
    const diff = compareRasterMasks(a, b);
    return {
      size,
      deviationPct: diff.deviationPct,
      differingPixels: diff.cells.symmetricDifference,
      unionPixels: diff.cells.union,
      originalInkPixels: diff.cells.original,
      candidateInkPixels: diff.cells.candidate,
      topology: compareRasterTopology(a, b),
    };
  });

  return {
    method: {
      silhouette: 'path-aware-binary-occupancy-symmetric-difference-over-union',
      boundary: 'symmetric-boundary-cell-nearest-distance',
      topology: 'adaptive-vector-guided-multiphase-binary-occupancy',
      targetRaster: 'binary-centre-sampled-occupancy; no alpha coverage',
      canvas,
      analysisStep,
      phase: [0.5, 0.5],
      stepsPerSegment: stepsPerSeg,
    },
    deviationPct: comparison.deviationPct,
    silhouette: {
      symmetricDifferenceCells: comparison.cells.symmetricDifference,
      unionCells: comparison.cells.union,
      intersectionCells: comparison.cells.intersection,
    },
    boundary,
    topology,
    ink: comparison.ink,
    raster,
  };
}
