import { createHash } from 'node:crypto';
import { authorPathEntries } from '../../src/core/icon-geometry.js';
import { parsePathData } from '../../src/core/path-data.js';
import { closedSourceContourLiterals } from '../../src/core/source-contours.js';
import { createAuthorExactArithmetic } from './author-exact-arithmetic.js';
import { createAuthorCurveCertificate } from './author-curve-certificate.js';

const hash = value => createHash('sha256').update(value).digest('hex');
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const ID = /^[a-z][a-z0-9-]*$/;
const HASH = /^[a-f0-9]{64}$/;

export class AuthorClockJointError extends Error {
  constructor(code, message) { super(`author-clock-joint: ${message}`); this.name = 'AuthorClockJointError'; this.code = code; }
}
const refuse = (code, message) => { throw new AuthorClockJointError(code, message); };
const A = createAuthorExactArithmetic(() => refuse('GEOMETRY_UNREPRESENTABLE', 'Не представим конечный сертификат стыка.'));
const curves = createAuthorCurveCertificate(refuse);
const zero = A.rational(0), one = A.rational(1), integer = value => A.fraction(BigInt(value), 1n);
const point = p => p.map(A.rational);
const same = (a, b) => a[0] === b[0] && a[1] === b[1];
const vector = (a, b) => [A.sub(b[0], a[0]), A.sub(b[1], a[1])];
const cross = (a, b) => A.sub(A.mul(a[0], b[1]), A.mul(a[1], b[0]));
const dot = (a, b) => A.add(A.mul(a[0], b[0]), A.mul(a[1], b[1]));
const points = edge => [edge.start, ...(edge.controls ?? []), edge.end];

function freezeTree(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeTree); Object.freeze(value); }
  return value;
}

function edgesFromPath(d) {
  let parsed;
  try { parsed = parsePathData(d); } catch { refuse('SOURCE_TOPOLOGY_UNSUPPORTED', 'Contour не соответствует SVG path grammar.'); }
  const edges = [];
  let start, current;
  for (const item of parsed) {
    if (item.cmd === 'M') {
      if (start) refuse('SOURCE_TOPOLOGY_UNSUPPORTED', 'Нужен один явно закрытый contour.');
      start = current = [item.x, item.y];
    } else if (item.cmd === 'Z') {
      if (!start) refuse('SOURCE_TOPOLOGY_UNSUPPORTED', 'Закрытие без начала contour.');
      if (!same(current, start)) edges.push({ kind: 'L', start: current, end: start, index: edges.length });
      current = undefined;
    } else {
      if (!current || !['L', 'C'].includes(item.cmd)) refuse('SOURCE_TOPOLOGY_UNSUPPORTED', 'Нужны закрытые absolute-M/L/C contour operands.');
      const end = [item.x, item.y];
      const controls = item.cmd === 'C' ? [[item.x1, item.y1], [item.x2, item.y2]] : undefined;
      if (points({ start: current, end, controls }).some(p => p.some(value => !Number.isFinite(value)))) {
        refuse('GEOMETRY_UNREPRESENTABLE', 'Contour содержит неограниченную координату.');
      }
      edges.push({ kind: item.cmd, start: current, end, ...(controls && { controls }), index: edges.length });
      current = end;
    }
  }
  if (current || !start || !edges.length) refuse('SOURCE_TOPOLOGY_UNSUPPORTED', 'Нужен непустой закрытый contour.');
  return edges;
}

function reverse(edges) {
  return [...edges].reverse().map(edge => ({ ...edge, start: edge.end, end: edge.start,
    ...(edge.controls && { controls: [...edge.controls].reverse() }) }));
}

function power(edge, axis) {
  const p = points(edge).map(p => A.rational(p[axis]));
  if (edge.kind === 'L') return [p[0], A.sub(p[1], p[0])];
  return [p[0], A.mul(integer(3), A.sub(p[1], p[0])),
    A.mul(integer(3), A.add(A.sub(p[0], A.mul(integer(2), p[1])), p[2])),
    A.add(A.sub(p[3], p[0]), A.mul(integer(3), A.sub(p[1], p[2])))];
}

// Интеграл x dy - y dx вычисляется над точными IEEE operands canonical parser.
function signedArea(edges) {
  let result = zero;
  for (const edge of edges) {
    const x = power(edge, 0), y = power(edge, 1);
    for (let i = 0; i < x.length; i++) for (let j = 1; j < y.length; j++) {
      result = A.add(result, A.div(A.mul(integer(j), A.sub(A.mul(x[i], y[j]), A.mul(y[i], x[j]))), integer(i + j)));
    }
  }
  return A.div(result, integer(2));
}

function monotone(edges, directions) {
  return edges.every(edge => {
    const chain = points(edge);
    return chain.slice(1).every((p, index) => directions.every((direction, axis) =>
      direction * A.cmp(A.rational(p[axis]), A.rational(chain[index][axis])) >= 0));
  });
}

function topology(edges) {
  const candidates = [];
  for (let i = 0; i < edges.length; i++) {
    const previous = edges[(i + edges.length - 1) % edges.length], next = edges[i];
    if (previous.kind === 'L' && next.kind === 'L' && previous.start[0] === previous.end[0] &&
        previous.end[1] > previous.start[1] && next.start[1] === next.end[1] && next.end[0] > next.start[0]) candidates.push(i);
  }
  if (candidates.length !== 1) refuse('JOINT_TOPOLOGY_UNSUPPORTED', 'Нужен один orthogonal внутренний стык верхней и правой стрелок.');
  const insideIndex = candidates[0];
  const ordered = [...edges.slice(insideIndex), ...edges.slice(0, insideIndex)];
  const inside = ordered[0].start;
  const leftCandidates = [];
  for (let i = 1; i < ordered.length - 2; i++) {
    const body = ordered[i], capA = ordered[i + 1], capB = ordered[i + 2];
    if (body.kind === 'L' && body.end[1] < body.start[1] && capA.kind === 'C' && capB.kind === 'C' &&
        monotone([capA], [1, -1]) && monotone([capB], [1, 1]) &&
        capA.end[1] < body.end[1] && capB.end[1] > capA.end[1] &&
        capA.end[0] > body.end[0] && capB.end[0] > capA.end[0] &&
        capB.end[0] === inside[0] && same(ordered[i + 3]?.start ?? ordered[0].start, capB.end)) leftCandidates.push(i);
  }
  if (leftCandidates.length !== 1) refuse('JOINT_TOPOLOGY_UNSUPPORTED', 'Не доказаны отдельный верхний cap и левая сторона длинной стрелки.');
  const leftIndex = leftCandidates[0], leftBody = ordered[leftIndex], left = leftBody.start;
  const elbowCandidates = [];
  for (let i = 1; i < leftIndex; i++) {
    const preceding = ordered[i - 1], next = ordered[i], bottom = next.start;
    if (preceding.kind === 'L' && preceding.start[0] > preceding.end[0] && preceding.end[1] <= preceding.start[1] &&
        next.kind === 'C' && bottom[0] > left[0] && bottom[1] > left[1] &&
        monotone(ordered.slice(i, leftIndex), [-1, -1])) elbowCandidates.push(i);
  }
  if (!elbowCandidates.length) refuse('JOINT_TOPOLOGY_UNSUPPORTED', 'Не найден цельный authored нижний левый elbow.');
  const elbowIndex = elbowCandidates[0], bottom = ordered[elbowIndex].start;
  if (bottom[0] >= inside[0] || left[1] <= inside[1] || leftBody.end[1] >= inside[1]) {
    refuse('JOINT_TOPOLOGY_UNSUPPORTED', 'Части не образуют внутренний L стык с положительными плечами.');
  }
  const tail = ordered.slice(leftIndex);
  if (tail.length !== 4 || tail.at(-1).kind !== 'L' || tail.at(-1).start[0] !== tail.at(-1).end[0] ||
      !same(tail.at(-1).end, inside)) {
    refuse('JOINT_TOPOLOGY_UNSUPPORTED', 'Длинная стрелка требует двух authored cap curves и непрерывной правой стороны.');
  }
  const right = ordered.slice(0, elbowIndex), elbow = ordered.slice(elbowIndex, leftIndex);
  if (right.at(-1).kind !== 'L' || right.at(-1).start[0] < inside[0] || right.at(-1).start[1] < bottom[1] ||
      right.slice(0, -1).some(edge => points(edge).some(p => p[0] < inside[0] || p[1] < inside[1])) ||
      !monotone([leftBody], [1, -1])) {
    refuse('JOINT_CONTAINMENT_UNPROVEN', 'Источник не доказывает свободные прямоугольники за скрытыми окончаниями.');
  }
  return { inside, bottom, left, leftBody, right, elbow, tail, ordered };
}

function transform(edges, transform) {
  return edges.map(edge => ({ ...edge, start: transform(edge.start), end: transform(edge.end),
    ...(edge.controls && { controls: edge.controls.map(transform) }), synthesized: true }));
}

function operand(edges) {
  if (!edges.length || edges.some((edge, i) => i && !same(edge.start, edges[i - 1].end)) ||
      !same(edges[0].start, edges.at(-1).end)) refuse('GEOMETRY_UNREPRESENTABLE', 'Подготовленный limb не замкнулся точно.');
  return { commands: `M${edges.map(edge => edge.kind).join('')}Z`,
    points: [[...edges[0].start], ...edges.flatMap(edge => [...(edge.controls ?? []), edge.end].map(p => [...p]))] };
}

function tangent(edge, end) {
  const chain = points(edge).map(point);
  const origin = end ? chain.at(-1) : chain[0], candidates = end ? chain.slice(0, -1).reverse() : chain.slice(1);
  for (const candidate of candidates) {
    const result = end ? vector(candidate, origin) : vector(origin, candidate);
    if (result.some(value => A.cmp(value, zero) !== 0)) return result;
  }
  refuse('JOINT_TANGENT_UNPROVEN', 'Нулевой terminal tangent не удостоверяет направление соединения.');
}

function tangentReceipt(incoming, outgoing) {
  const c = cross(incoming, outgoing), d = dot(incoming, outgoing);
  return { incoming: incoming.map(A.receipt), outgoing: outgoing.map(A.receipt), cross: A.receipt(c), dot: A.receipt(d),
    collinearForward: A.cmp(c, zero) === 0 && A.cmp(d, zero) > 0 };
}

function chordCertificate(edges, pivot, horizontal, vertical, quadrant) {
  const p = point(pivot);
  let margin;
  for (const item of edges.flatMap(points)) {
    const v = vector(p, point(item));
    const normalized = A.add(A.div(A.mul(integer(quadrant[0]), v[0]), horizontal), A.div(A.mul(integer(quadrant[1]), v[1]), vertical));
    const current = A.sub(normalized, one);
    if (A.cmp(current, zero) < 0) refuse('JOINT_BEARING_UNPROVEN', 'Elbow входит внутрь chord; общая область соединения не доказана.');
    if (!margin || A.cmp(current, margin) < 0) margin = current;
  }
  return { minimumControlMargin: A.receipt(margin), controls: edges.flatMap(points).length };
}

/** Source selectors выбирают смысл. Контакты, hidden closures и bearing выводит один build owner. */
export function compileAuthorClockJoint(source, declaration) {
  if (!declaration || Object.keys(declaration).sort().join(',') !== 'contourIndex,partIds,pathIndex,polarity' ||
      !Number.isSafeInteger(declaration.pathIndex) || declaration.pathIndex < 0 ||
      !Number.isSafeInteger(declaration.contourIndex) || declaration.contourIndex < 0 ||
      !['positive', 'negative'].includes(declaration.polarity) || !declaration.partIds ||
      Object.keys(declaration.partIds).sort().join(',') !== 'hour,minute' ||
      Object.values(declaration.partIds).some(id => typeof id !== 'string' || !ID.test(id)) ||
      declaration.partIds.minute === declaration.partIds.hour) refuse('ANNOTATION_INVALID', 'Нужны точные source selectors, polarity и две различные semantic part IDs.');
  let parents;
  try { parents = authorPathEntries(source?.artifactSvg); } catch { refuse('SOURCE_MISMATCH', 'Нужен authored source artifact.'); }
  if (typeof source?.rawSvg !== 'string' || !HASH.test(source.author?.masterSha256 ?? '') ||
      !HASH.test(source.author?.pathFingerprintSha256 ?? '') || hash(source.rawSvg) !== source.author.masterSha256 ||
      hash(stableJSON(parents)) !== source.author.pathFingerprintSha256) refuse('SOURCE_MISMATCH', 'Artifact и raw master не совпадают с authored receipt.');
  const parent = parents[declaration.pathIndex];
  if (!parent) refuse('ANNOTATION_INVALID', 'Выбранная authored path отсутствует.');
  let fragments;
  try { fragments = closedSourceContourLiterals(parent.d); } catch { refuse('SOURCE_TOPOLOGY_UNSUPPORTED', 'Нужны закрытые самостоятельные absolute-M source contours.'); }
  const original = fragments[declaration.contourIndex];
  if (!original) refuse('ANNOTATION_INVALID', 'Выбранный source contour отсутствует.');
  const negative = declaration.polarity === 'negative';
  if (negative ? parents.length !== 1 || declaration.pathIndex !== 0 || parent.fillRule !== 'evenodd' || fragments.length !== 2 || declaration.contourIndex !== 1
    : parent.fillRule !== 'nonzero' || fragments.length !== 1 || declaration.contourIndex !== 0) {
    refuse('SOURCE_COMPOSITION_UNSUPPORTED', 'Нужен самостоятельный positive contour либо единственный negative hand одного evenodd master.');
  }
  const authoredEdges = edgesFromPath(original), area = signedArea(authoredEdges), winding = A.cmp(area, zero);
  if (!winding) refuse('SOURCE_WINDING_UNSUPPORTED', 'Нулевая ориентированная площадь не задаёт заполненную стрелку.');
  if (negative) {
    const baseWinding = A.cmp(signedArea(edgesFromPath(fragments[0])), zero);
    // evenodd не зависит от направления обхода. Роль hole доказывает вложенность ниже.
    if (!baseWinding) refuse('SOURCE_WINDING_UNSUPPORTED', 'Container обязан иметь ненулевую ориентированную площадь.');
  }
  const canonical = winding > 0 ? authoredEdges : reverse(authoredEdges);
  const { inside, bottom, left, leftBody, right, elbow, tail, ordered } = topology(canonical);
  const bearing = [bottom[0], left[1]], b = point(bearing);
  const radii = { left: A.sub(b[0], A.rational(left[0])), right: A.sub(A.rational(inside[0]), b[0]),
    top: A.sub(b[1], A.rational(inside[1])), bottom: A.sub(A.rational(bottom[1]), b[1]) };
  if (Object.values(radii).some(value => A.cmp(value, zero) <= 0)) refuse('JOINT_TOPOLOGY_UNSUPPORTED', 'Стрелки не имеют положительных контактных размеров.');
  const upperLeft = transform(elbow, p => [p[0], A.directedNumber(A.sub(b[1],
    A.mul(A.sub(A.rational(p[1]), b[1]), A.div(radii.top, radii.bottom))), 1)]);
  const lowerRight = transform(elbow, p => [A.directedNumber(A.sub(b[0],
    A.mul(A.sub(A.rational(p[0]), b[0]), A.div(radii.right, radii.left))), -1), p[1]]);
  const leftLine = vector(point(leftBody.start), point(leftBody.end));
  for (const p of upperLeft.flatMap(points)) {
    if (p[0] < left[0] || p[0] > bearing[0] || p[1] < inside[1] || p[1] > bearing[1] ||
        A.cmp(cross(leftLine, vector(point(leftBody.start), point(p))), zero) < 0) {
      refuse('JOINT_CONTAINMENT_UNPROVEN', 'Скрытый upper-left cap выходит за authored длинную стрелку.');
    }
  }
  if (lowerRight.flatMap(points).some(p => p[0] < bearing[0] || p[0] > inside[0] || p[1] < bearing[1] || p[1] > bottom[1])) {
    refuse('JOINT_CONTAINMENT_UNPROVEN', 'Скрытый lower-right cap выходит за authored короткую стрелку.');
  }
  const chords = { source: chordCertificate(elbow, bearing, radii.left, radii.bottom, [-1, 1]),
    upperLeft: chordCertificate(upperLeft, bearing, radii.left, radii.top, [-1, -1]),
    lowerRight: chordCertificate(lowerRight, bearing, radii.right, radii.bottom, [1, 1]) };
  const r = [inside[0], bearing[1]], t = [bearing[0], inside[1]], line = (start, end) => ({ kind: 'L', start, end, synthesized: true });
  const minuteEdges = [...tail, line(inside, r), ...reverse(lowerRight), ...elbow];
  const hourEdges = [line(t, inside), ...right, ...elbow, ...reverse(upperLeft)];
  const minute = operand(minuteEdges), hour = operand(hourEdges);
  const simplicityStatistics = { cells: 0 };
  const simplicity = [operand(authoredEdges), minute, hour].map(contour =>
    curves.certifyMaterializedContour(contour, 1, contour.points.map(() => 0), simplicityStatistics));
  let counterContainment;
  if (negative) counterContainment = curves.certifySourceContainment(
    curves.contours(fragments[0])[0], curves.contours(original)[0], { cells: 0 });
  const minimumRadius = A.min(Object.values(radii)), diskRadius = A.lowerRoot(A.div(A.square(minimumRadius), integer(2)));
  if (!(diskRadius > 0)) refuse('GEOMETRY_UNREPRESENTABLE', 'Общая область стыка не имеет представимого положительного радиуса.');
  const sourceReceipt = { masterSha256: source.author.masterSha256, pathFingerprintSha256: source.author.pathFingerprintSha256,
    pathIndex: declaration.pathIndex, contourIndex: declaration.contourIndex, contourSha256: hash(original) };
  const evidence = {
    version: 1, arithmetic: 'exact-ieee-operands-directed-hidden-closures', sourceWinding: winding,
    signedArea: A.receipt(area), contacts: { inside, bottom, left }, radii: Object.fromEntries(Object.entries(radii).map(([key, value]) => [key, A.receipt(value)])),
    exterior: { sourceEdgeCount: authoredEdges.length, minuteEdgeIndices: tail.map(edge => edge.index),
      hourEdgeIndices: right.map(edge => edge.index), sharedElbowEdgeIndices: elbow.map(edge => edge.index),
      sourceTraversal: ordered.map(edge => edge.index), reversed: winding < 0 },
    hiddenClosureContainment: { upperLeft: 'source-left-body-half-plane', lowerRight: 'source-right-body-rectangle', controls: upperLeft.flatMap(points).length + lowerRight.flatMap(points).length },
    simplicity: { method: 'materialized-simple-closed-contours', contours: simplicity, cells: simplicityStatistics.cells },
    ...(counterContainment && { counterContainment }),
    connectedBearing: { method: 'common-inscribed-diamond', chords, diskRadiusLowerBound: diskRadius, appliesTo: 'all-independent-rotation-angles-about-bearing' },
    tangents: { sourceLeftJoin: tangentReceipt(tangent(elbow.at(-1), true), tangent(leftBody, false)),
      hourLeftJoin: tangentReceipt(tangent(elbow.at(-1), true), tangent(reverse(upperLeft)[0], false)),
      minuteBottomJoin: tangentReceipt(tangent(reverse(lowerRight).at(-1), true), tangent(elbow[0], false)) },
    scope: 'rest-exterior-preservation-and-limb-attachment',
  };
  return freezeTree({ version: 1, law: 'joint.authored-elbow', source: sourceReceipt, polarity: declaration.polarity,
    original: { d: original, fillRule: parent.fillRule }, bearing,
    limbs: [{ id: declaration.partIds.minute, ...minute }, { id: declaration.partIds.hour, ...hour }],
    composition: { kind: 'nonzero-union', winding: 1 }, evidence });
}
