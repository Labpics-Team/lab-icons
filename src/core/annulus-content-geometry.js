/** Компиляторная программа, а не parser SVG: команды и operands уже допущены build owner. */
const COUNTS = { M: 1, L: 1, C: 3, Q: 2, Z: 0 };
const CHOOSE = [[1], [1, 1], [1, 2, 1], [1, 3, 3, 1], [1, 4, 6, 4, 1], [1, 5, 10, 10, 5, 1]];
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];

/** Signed area через integral Bernstein; отдельный contour не теряется в общем bbox. */
export function projectedContourAreas(commands, points, center) {
  const local = points.map(point => point.map((value, axis) => value - center[axis]));
  let pointIndex = 0, first, previous, area = 0;
  const result = [];
  for (const command of commands) {
    const count = COUNTS[command], next = local.slice(pointIndex, pointIndex + count);
    pointIndex += count;
    if (command === 'M') { first = previous = next[0]; area = 0; }
    else if (command === 'Z') { area += cross(previous, first); result.push(area); previous = first; }
    else if (command === 'L') { area += cross(previous, next[0]); previous = next[0]; }
    else {
      const controls = [previous, ...next], degree = controls.length - 1;
      for (let i = 0; i <= degree; i++) for (let j = 0; j < degree; j++) {
        const derivative = controls[j + 1].map((value, axis) => value - controls[j][axis]);
        area += CHOOSE[degree][i] * CHOOSE[degree - 1][j] /
          (2 * CHOOSE[2 * degree - 1][i + j]) * cross(controls[i], derivative);
      }
      previous = next.at(-1);
    }
  }
  return result;
}

export function contentScaleParameters(value, refuse) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype ||
      Reflect.ownKeys(value).some(key => key !== 'contentScale' && key !== 'enclosureEmphasis')) {
    refuse('INVALID_VARIATION', 'Нужны только contentScale и enclosureEmphasis.');
  }
  const contentScale = value.contentScale === undefined ? 1 : value.contentScale;
  const enclosureEmphasis = value.enclosureEmphasis === undefined ? 1 : value.enclosureEmphasis;
  if (![contentScale, enclosureEmphasis].every(item => typeof item === 'number' && Number.isFinite(item) && item > 0)) {
    refuse('INVALID_VARIATION', 'Оба параметра обязаны быть конечными положительными числами.');
  }
  return { contentScale, enclosureEmphasis };
}

/** Граница учитывает обе materialization errors и округление самого comparison. */
export function admitJointContentScale(domain, contentScale, enclosureScale, refuse) {
  if (!Number.isFinite(enclosureScale) || enclosureScale <= 0) {
    refuse('VARIATION_UNREPRESENTABLE', 'Контрформа обрамления схлопнулась.');
  }
  if (contentScale < domain.contentScale.minimum) {
    refuse('VARIATION_UNREPRESENTABLE', 'Content scale не сохраняет различимые authored controls.');
  }
  if (contentScale > domain.contentScale.maximum || enclosureScale < domain.enclosureScale.minimum ||
      enclosureScale >= domain.enclosureScale.maximum ||
      enclosureScale - domain.clearance.contentScale * contentScale < domain.clearance.minimum) {
    refuse('VARIATION_OUTSIDE_DOMAIN', 'Совместная контрформа и содержание нарушают доказанный radial clearance.');
  }
}

/** Один affine materializer используется build probe и native/browser runtime. */
export function materializeProjectedContent(compiled, contentScale, refuse) {
  return compiled.parts.map(part => {
    const points = part.points.map(point => point.map((value, axis) =>
      compiled.center[axis] + contentScale * (value - compiled.center[axis])));
    if (points.some(point => point.some(value => !Number.isFinite(value))) || part.coordinateOrder.some((order, axis) =>
      order.slice(1).some((index, position) => points[index][axis] <= points[order[position]][axis]))) {
      refuse('VARIATION_UNREPRESENTABLE', 'Materialization схлопнула порядок authored controls.');
    }
    const areas = projectedContourAreas(part.commands, points, compiled.center);
    if (areas.length !== part.winding.length || areas.some((area, index) => !Number.isFinite(area) ||
        Math.sign(area) !== part.winding[index])) {
      refuse('VARIATION_UNREPRESENTABLE', 'Materialization схлопнула или развернула content contour.');
    }
    let index = 0;
    const d = [...part.commands].map(command => {
      const count = COUNTS[command], operands = points.slice(index, index + count); index += count;
      return command + operands.flat().join(' ');
    }).join('');
    return { index: part.index, d };
  });
}
