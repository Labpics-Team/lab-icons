import { parsePathData } from '../../src/core/path-data.js';
import { createAuthorExactArithmetic } from './author-exact-arithmetic.js';

/** Общий build-only владелец Bézier hull proofs для source anatomy и width. */
export function createAuthorCurveCertificate(refuse) {
  const { fraction, rational, add, sub, mul, cmp, min, max, square } = createAuthorExactArithmetic(() =>
    refuse('VARIATION_UNREPRESENTABLE', 'Не представим конечный сертификат controls.'));
  const zero = rational(0), one = rational(1), half = rational(.5), u = fraction(1n, 1n << 53n), eta = fraction(1n, 1n << 1075n);
  const abs = value => value[0] < 0n ? [-value[0], value[1]] : value;
  const counts = { M: 1, L: 1, C: 3, Q: 2, Z: 0 };
  function contours(d) {
    let parsed;
    try { parsed = parsePathData(d); } catch { refuse('TOPOLOGY_UNSUPPORTED', 'Нужен корректный закрытый source path.'); }
    const output = [];
    for (const segment of parsed) {
      if (!Object.hasOwn(counts, segment.cmd)) refuse('TOPOLOGY_UNSUPPORTED', 'Certificate не поддерживает дуги или нераскрытые команды.');
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
  /** Ошибка x + (width - 1)*rate, включая gradual underflow трёх операций. */
  function coordinateError(x, rate) {
    const R = rational(Math.abs(rate)), X = rational(Math.abs(x)), subtraction = add(u, eta);
    const multiplication = add(mul(R, subtraction), add(mul(u, mul(R, add(one, subtraction))), eta));
    return add(multiplication, add(mul(u, add(X, add(R, multiplication))), eta));
  }
  function curvePieces(contour, minimum, rates = contour.points.map(() => 0)) {
    let index = 0, previous, first;
    const controls = contour.points.map((point, i) => ({ point, rate: rates[i] })), result = [];
    const piece = values => ({ error: max(values.map(value => coordinateError(value.point[0], value.rate))),
      ends: [minimum, 1].map(width => values.map(value => [
        add(rational(value.point[0]), mul(sub(rational(width), one), rational(value.rate))), rational(value.point[1]),
      ])) });
    for (const command of contour.commands) {
      const next = controls.slice(index, index + counts[command]); index += counts[command];
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
  /** Tensor hull использует один и тот же width на обеих границах. */
  function separationSquared(left, right) {
    const differences = left.ends.flatMap((points, end) => points.flatMap(point => right.ends[end].map(other =>
      point.map((value, axis) => sub(value, other[axis])))));
    return [0, 1].map(axis => {
      const values = differences.map(point => point[axis]), error = axis === 0 ? add(left.error, right.error) : zero;
      const low = sub(min(values), error), high = add(max(values), error);
      return low[0] > 0n ? low : high[0] < 0n ? abs(high) : zero;
    }).map(square).reduce(add);
  }
  function certifySeparation(left, right, minimumGap, statistics, strict = false) {
    const pending = [[left, right, 0]], required = square(rational(minimumGap));
    while (pending.length) {
      const [a, b, depth] = pending.pop(); statistics.cells++;
      const order = cmp(separationSquared(a, b), required);
      if (strict ? order > 0 : order >= 0) continue;
      if (depth >= 24 || statistics.cells > 250000) {
        refuse(strict ? 'SELF_INTERSECTION_UNPROVEN' : 'CLEARANCE_UNPROVEN', 'Build certificate не отделяет две границы на всём параметрическом интервале.');
      }
      const chosen = depth % 2 === 0 ? a : b;
      for (const child of splitCurve(chosen)) pending.push(depth % 2 === 0 ? [child, b, depth + 1] : [a, child, depth + 1]);
    }
  }
  const dot = (point, direction) => point.map((value, axis) => mul(value, direction[axis])).reduce(add);
  const cross = (a, b) => sub(mul(a[0], b[1]), mul(a[1], b[0]));
  const difference = (a, b) => a.map((value, axis) => sub(value, b[axis]));
  const samePoint = (a, b) => a.every((value, axis) => cmp(value, b[axis]) === 0);
  const sign = value => value[0] > 0n ? 1 : value[0] < 0n ? -1 : 0;
  function joinedOnlyAtEndpoint(a, b) {
    const common = a.at(-1);
    if (!samePoint(common, b[0])) return false;
    const left = a.slice(0, -1).map(point => difference(point, common));
    const right = b.slice(1).map(point => difference(point, common));
    const edges = [[one, zero], [zero, one], ...[...left, ...right].map(point => [point[1], [-point[0][0], point[0][1]]])];
    // Разделяющая прямая может лежать между двумя support normals, например
    // на прямоугольном углу. Проверяются сами normals и их внутренние суммы.
    const directions = [...edges, ...edges.flatMap(a => edges.flatMap(b => [
      a.map((value, axis) => add(value, b[axis])), a.map((value, axis) => sub(value, b[axis])),
    ]))];
    return directions.some(direction => {
      const lhs = left.map(point => dot(point, direction)), rhs = right.map(point => dot(point, direction));
      return [1, -1].some(directionSign => lhs.every(value => directionSign * sign(value) <= 0) &&
        rhs.every(value => directionSign * sign(value) >= 0) &&
        lhs.some(value => directionSign * sign(value) < 0) && rhs.some(value => directionSign * sign(value) > 0));
    });
  }
  function certifySimpleContour(contour, statistics) {
    // В source proof controls точны; variation error budget применяется отдельно.
    const pieces = curvePieces(contour, 1).map(curve => ({ ...curve, error: zero }))
      .filter(curve => !curve.ends[0].every(point => samePoint(point, curve.ends[0][0])));
    if (pieces.length < 3) refuse('TOPOLOGY_UNSUPPORTED', 'Нужен самостоятельный замкнутый contour.');
    for (const [index, curve] of pieces.entries()) {
      // Один Bézier тоже может пересечь себя. Строгая монотонная проекция
      // controls даёт инъективную кривую; кривые вне этого языка отказывают.
      const points = curve.ends[0];
      if (![0, 1].some(axis => [1, -1].some(sign => points.slice(1).every((point, i) =>
        sign * cmp(point[axis], points[i][axis]) >= 0) && cmp(points[0][axis], points.at(-1)[axis]) !== 0))) {
        refuse('SELF_INTERSECTION_UNPROVEN', 'Contour содержит Bézier без доказанной монотонной проекции.');
      }
      for (let other = index + 1; other < pieces.length; other++) {
        if (other === index + 1 || index === 0 && other === pieces.length - 1) {
          const [a, b] = other === index + 1 ? [curve, pieces[other]] : [pieces[other], curve];
          if (!joinedOnlyAtEndpoint(a.ends[0], b.ends[0])) refuse('SELF_INTERSECTION_UNPROVEN', 'Соседние curves не имеют доказанного единственного общего endpoint.');
        } else certifySeparation(curve, pieces[other], 0, statistics, true);
      }
    }
    return pieces;
  }
  function certifyKnockouts(shape, statistics) {
    const enclosure = shape[0], enclosing = certifySimpleContour(enclosure, statistics);
    if (enclosure.commands !== 'MCCCCZ' || enclosing.length !== 4 || enclosing.some(curve => curve.ends[0].length !== 4) ||
        !samePoint(enclosing[3].ends[0].at(-1), enclosing[0].ends[0][0])) {
      refuse('COMPOSITION_UNPROVEN', 'Knockouts требуют ровно четыре монотонные cubic стороны без дополнительного closing edge.');
    }
    const vertices = enclosing.map(curve => curve.ends[0][0]);
    const [top, right, bottom, left] = vertices;
    if (cmp(top[0], bottom[0]) || cmp(right[1], left[1]) || cmp(top[1], right[1]) >= 0 || cmp(bottom[1], right[1]) <= 0 ||
        cmp(left[0], top[0]) >= 0 || cmp(right[0], top[0]) <= 0) {
      refuse('COMPOSITION_UNPROVEN', 'Нужны упорядоченные top/right/bottom/left endpoints оболочки.');
    }
    for (const [i, curve] of enclosing.entries()) {
      const a = vertices[i], b = vertices[(i + 1) % 4], edge = difference(b, a);
      if (![0, 1].every(axis => {
        const direction = cmp(b[axis], a[axis]), controls = curve.ends[0];
        return controls.slice(1).every((point, j) => direction * cmp(point[axis], controls[j][axis]) >= 0);
      })) refuse('COMPOSITION_UNPROVEN', 'Оболочка требует монотонные controls обоих координат внутри своего quadrant.');
      if (curve.ends[0].some(point => cmp(cross(edge, difference(point, a)), zero) > 0)) {
        refuse('COMPOSITION_UNPROVEN', 'Control hull оболочки заходит внутрь её endpoint polygon.');
      }
    }
    for (const contour of shape.slice(1)) {
      certifySimpleContour(contour, statistics);
      for (const point of contour.points.map(point => point.map(rational))) {
        if (vertices.some((a, i) => cmp(cross(difference(vertices[(i + 1) % 4], a), difference(point, a)), zero) <= 0)) {
          refuse('COMPOSITION_UNPROVEN', 'Knockout controls обязаны быть строго внутри вписанного endpoint polygon.');
        }
      }
    }
    for (let i = 1; i < shape.length; i++) for (let j = i + 1; j < shape.length; j++) {
      // Endpoint вне чужого control bbox доказывает отсутствие вложенности
      // после отдельного доказательства простоты и непересечения границ.
      const outside = (a, b) => {
        const hull = [0, 1].map(axis => [min(b.points.map(point => rational(point[axis]))), max(b.points.map(point => rational(point[axis])))]);
        const endpoints = curvePieces(a, 1).map(curve => curve.ends[0][0]);
        return endpoints.some(point => hull.some(([low, high], axis) => cmp(point[axis], low) < 0 || cmp(point[axis], high) > 0));
      };
      if (!outside(shape[i], shape[j]) || !outside(shape[j], shape[i])) refuse('COMPOSITION_UNPROVEN', 'Вложенные или недоказанные knockout contours запрещены.');
      for (const a of curvePieces(shape[i], 1)) for (const b of curvePieces(shape[j], 1)) certifySeparation(a, b, 0, statistics, true);
    }
    return { method: 'simple-disjoint-knockouts-in-inscribed-polygon', cells: statistics.cells };
  }
  return { contours, coordinateError, curvePieces, certifySeparation, certifyKnockouts };
}
