import { createHash } from 'node:crypto';
import { authorPathEntries, iconGeometry } from '../../src/core/icon-geometry.js';
import { parsePathData } from '../../src/core/path-data.js';
import { projectedContourAreas } from '../../src/core/annulus-content-geometry.js';
import { createAuthorExactArithmetic } from './author-exact-arithmetic.js';

const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => createHash('sha256').update(value).digest('hex');
export class AuthorCapsuleError extends Error {
  constructor(code, message) { super(`author-capsule: ${message}`); this.name = 'AuthorCapsuleError'; this.code = code; }
}
const refuse = (code, message) => { throw new AuthorCapsuleError(code, message); };
const { fraction, rational, add, sub, mul, div, cmp, min, max, square, receipt, directedNumber } =
  createAuthorExactArithmetic(() => refuse('VARIATION_UNREPRESENTABLE', 'Не представим конечный сертификат ширины.'));
const zero = rational(0), one = rational(1), half = rational(.5), u = fraction(1n, 1n << 53n), eta = fraction(1n, 1n << 1075n);
const abs = value => value[0] < 0n ? [-value[0], value[1]] : value;
const COUNTS = { M: 1, L: 1, C: 3, Q: 2, Z: 0 };

function contours(d) {
  let parsed;
  try { parsed = parsePathData(d); } catch { refuse('TOPOLOGY_UNSUPPORTED', 'Нужен корректный закрытый body path.'); }
  const output = [];
  for (const segment of parsed) {
    if (!Object.hasOwn(COUNTS, segment.cmd)) refuse('TOPOLOGY_UNSUPPORTED', 'Capsule width не поддерживает дуги или нераскрытые команды.');
    if (segment.cmd === 'M') output.push({ commands: '', points: [] });
    const contour = output.at(-1);
    if (!contour || contour.commands.endsWith('Z')) refuse('TOPOLOGY_UNSUPPORTED', 'Нарушен порядок закрытых contours.');
    contour.commands += segment.cmd;
    if (segment.cmd !== 'Z') {
      if (segment.cmd === 'C' || segment.cmd === 'Q') contour.points.push([segment.x1, segment.y1]);
      if (segment.cmd === 'C') contour.points.push([segment.x2, segment.y2]);
      contour.points.push([segment.x, segment.y]);
    }
  }
  if (!output.length || output.some(contour => !contour.commands.endsWith('Z') ||
      contour.points.some(point => point.some(value => !Number.isFinite(value))))) {
    refuse('TOPOLOGY_UNSUPPORTED', 'Нужны конечные M/L/C/Q/Z closed contours.');
  }
  return output;
}

const bounds = points => [0, 1].map(axis => [Math.min(...points.map(point => point[axis])), Math.max(...points.map(point => point[axis]))]);

/** Ошибка x + (width - 1)*rate, включая gradual underflow всех трёх операций. */
function coordinateError(x, rate) {
  const R = rational(Math.abs(rate)), X = rational(Math.abs(x));
  const subtraction = add(u, eta);
  const multiplication = add(mul(R, subtraction), add(mul(u, mul(R, add(one, subtraction))), eta));
  return add(multiplication, add(mul(u, add(X, add(R, multiplication))), eta));
}

function curvePieces(contour, minimum, rates = contour.points.map(() => 0)) {
  let index = 0, previous, first;
  const controls = contour.points.map((point, i) => ({ point, rate: rates[i] }));
  const result = [];
  const piece = values => ({ error: max(values.map(value => coordinateError(value.point[0], value.rate))),
    ends: [minimum, 1].map(width => values.map(value => [
      add(rational(value.point[0]), mul(sub(rational(width), one), rational(value.rate))), rational(value.point[1]),
    ])) });
  for (const command of contour.commands) {
    const next = controls.slice(index, index + COUNTS[command]); index += COUNTS[command];
    if (command === 'M') first = previous = next[0];
    else if (command === 'Z') { result.push(piece([previous, first])); previous = first; }
    else { result.push(piece([previous, ...next])); previous = next.at(-1); }
  }
  return result;
}

function splitCurve(curve) {
  const pairs = curve.ends.map(points => {
    const levels = [points];
    while (levels.at(-1).length > 1) {
      const previous = levels.at(-1);
      levels.push(previous.slice(1).map((point, i) => point.map((value, axis) => mul(add(previous[i][axis], value), half))));
    }
    return [levels.map(level => level[0]), levels.map(level => level.at(-1)).reverse()];
  });
  return [0, 1].map(side => ({ error: curve.error, ends: pairs.map(pair => pair[side]) }));
}

/** Tensor Bernstein hull: один и тот же width для обеих границ, не два независимых fit. */
function separationSquared(left, right) {
  const differences = left.ends.flatMap((points, end) => points.flatMap(point => right.ends[end].map(other =>
    point.map((value, axis) => sub(value, other[axis])))));
  return [0, 1].map(axis => {
    const values = differences.map(point => point[axis]), error = axis === 0 ? add(left.error, right.error) : zero;
    const low = sub(min(values), error), high = add(max(values), error);
    return low[0] > 0n ? low : high[0] < 0n ? abs(high) : zero;
  }).map(square).reduce(add);
}

function certifySeparation(left, right, minimumGap, statistics) {
  const pending = [[left, right, 0]], required = square(rational(minimumGap));
  while (pending.length) {
    const [a, b, depth] = pending.pop(); statistics.cells++;
    if (cmp(separationSquared(a, b), required) >= 0) continue;
    if (depth >= 24 || statistics.cells > 250000) {
      refuse('CLEARANCE_UNPROVEN', 'Build certificate не отделяет body от другой границы на всём width-интервале.');
    }
    const chosen = depth % 2 === 0 ? a : b;
    for (const child of splitCurve(chosen)) pending.push(depth % 2 === 0 ? [child, b, depth + 1] : [a, child, depth + 1]);
  }
}

/** Аннотация выбирает смысл body; координаты и ограничение выводятся из master. */
export function compileAuthorCapsule(source, parts, declaration, grid) {
  if (!declaration || Object.keys(declaration).sort().join(',') !== 'bodyPartId,law,parameter' ||
      declaration.law !== 'capsule.width' || declaration.parameter !== 'bodyWidth') {
    refuse('LAW_UNSUPPORTED', 'Нужны capsule.width/bodyWidth и объявленный bodyPartId.');
  }
  if (!source || typeof source.rawSvg !== 'string' || !source.author || !Array.isArray(parts)) {
    refuse('SOURCE_MISMATCH', 'Нужен полный authored source record и объявленные части.');
  }
  let entries;
  try { entries = authorPathEntries(source.artifactSvg); } catch { refuse('SOURCE_MISMATCH', 'Artifact SVG не соответствует supported source контракту.'); }
  if (hash(source.rawSvg) !== source.author.masterSha256 || hash(stableJSON(entries)) !== source.author.pathFingerprintSha256 ||
      entries.length !== parts.length || parts.some((part, index) => part.identity !== 'declared' || part.zIndex !== index) ||
      new Set(parts.map(part => part.id)).size !== parts.length) {
    refuse('SOURCE_MISMATCH', 'Body anatomy не соответствует полному authored master.');
  }
  const index = parts.findIndex(part => part.id === declaration.bodyPartId), body = parts[index];
  if (!body || body.role !== 'content' || entries.length < 2 || entries.length > 16) {
    refuse('PARTS_UNSUPPORTED', 'Body обязан быть отдельной declared content частью.');
  }
  const shape = contours(entries[index].d);
  if (shape.length > 2 || shape.some(contour => !contour.commands.includes('C')) ||
      shape.length === 2 && entries[index].fillRule !== 'evenodd' || shape.length === 1 && entries[index].fillRule !== 'nonzero') {
    refuse('TOPOLOGY_UNSUPPORTED', 'Нужен positive capsule либо capsule с одним самостоятельным evenodd counter.');
  }
  const dimensions = shape.map(contour => bounds(contour.points));
  if (dimensions.some(([x, y]) => x[1] - x[0] <= 0 || y[1] - y[0] <= x[1] - x[0]) ||
      shape.length === 2 && dimensions[1].some((interval, axis) => interval[0] <= dimensions[0][axis][0] || interval[1] >= dimensions[0][axis][1])) {
    refuse('TOPOLOGY_UNSUPPORTED', 'Нужна вертикальная capsule и вложенные axis bounds контрформы.');
  }
  const areas = shape.map(contour => projectedContourAreas(contour.commands, contour.points, [0, 0])[0]);
  if (areas.some(value => !Number.isFinite(value) || value === 0) || shape.length === 2 && Math.sign(areas[0]) === Math.sign(areas[1])) {
    refuse('TOPOLOGY_UNSUPPORTED', 'Counter требует противоположный winding, сохраняемый положительным x-span.');
  }
  const canvas = iconGeometry(source.artifactSvg).viewBox, size = Math.min(canvas.width, canvas.height);
  const gap = size * grid.ratios.clearanceMin, positiveSpan = size * 2 * grid.ratios.strokeWidth.capRadius;
  if (![gap, positiveSpan].every(value => Number.isFinite(value) && value > 0)) refuse('POLICY_INVALID', 'Нужны owner minimum gap и terminal diameter.');
  const outerWidth = dimensions[0][0][1] - dimensions[0][0][0];
  const compiledContours = shape.map((contour, contourIndex) => {
    const [x, y] = dimensions[contourIndex], width = x[1] - x[0], pivot = (x[0] + x[1]) / 2;
    const rates = contour.points.map(point => (point[0] - pivot) * (contourIndex ? outerWidth / width : 1));
    const error = max(contour.points.map((point, i) => coordinateError(point[0], rates[i])));
    const rateSpan = sub(rational(Math.max(...rates)), rational(Math.min(...rates)));
    const minimumSpan = contourIndex ? gap : positiveSpan;
    // Сравнение high-low тоже округляется; certificate оставляет его полный бюджет.
    const spanError = add(mul(rational(2), error), add(mul(u, add(rational(width), mul(rational(2), error))), eta));
    const minimum = sub(one, div(sub(sub(rational(width), rational(minimumSpan)), spanError), rateSpan));
    return { ...contour, rates, minimumSpan, winding: Math.sign(areas[contourIndex]),
      xOrder: [...new Map(contour.points.map((point, i) => [point[0], i]))].sort((a, b) => a[0] - b[0]).map(([, i]) => i),
      minimum, error };
  });
  const minimum = directedNumber(max([zero, ...compiledContours.map(contour => contour.minimum)]), 1);
  if (!(minimum > 0 && minimum < 1)) refuse('DEFAULT_OUTSIDE_DOMAIN', 'Master не даёт ненулевой width-домен при owner span policy.');
  const statistics = { cells: 0 }, curves = compiledContours.map(contour => curvePieces(contour, minimum, contour.rates));
  if (curves.length === 2) for (const outer of curves[0]) for (const inner of curves[1]) certifySeparation(outer, inner, gap, statistics);
  for (const [otherIndex, entry] of entries.entries()) if (otherIndex !== index) {
    for (const contour of contours(entry.d)) for (const other of curvePieces(contour, minimum)) {
      for (const capsule of curves[0]) certifySeparation(capsule, other, gap, statistics);
    }
  }
  const proof = { method: 'exact-tensor-bernstein-separation', parameter: 'shared-width', evaluated: 'materialized-binary64-controls',
    cells: statistics.cells, coordinateErrorUpper: compiledContours.map(contour => receipt(contour.error)) };
  const domain = { kind: 'bounded-capsule-width', minimum, maximum: 1, minimumInclusive: true, maximumInclusive: true,
    policy: { gridVersion: grid.version, gridSha256: hash(stableJSON(grid)), minimumGap: gap, minimumPositiveSpan: positiveSpan },
    certificate: { method: proof.method, sha256: hash(stableJSON(proof)) } };
  const compiled = { version: 1, law: 'capsule.width', source: { masterSha256: source.author.masterSha256,
    pathFingerprintSha256: source.author.pathFingerprintSha256 }, partIds: parts.map(part => part.id),
    body: { id: body.id, index, sourceLiteralSha256: hash(`${body.fillRule}\0${entries[index].d}`),
      contours: compiledContours.map(({ commands, points, rates, minimumSpan, winding, xOrder }) => ({ commands, points, rates, minimumSpan, winding, xOrder })) }, domain };
  const geometry = { ...compiled, geometrySha256: hash(stableJSON(compiled)) };
  return { ...geometry, packetSha256: hash(stableJSON(geometry)), evidence: proof };
}

/** Полные рациональные границы остаются build-only; runtime получает digest. */
export function projectAuthorCapsuleRuntime(compiled) {
  const { evidence: _evidence, ...runtime } = compiled;
  return runtime;
}
