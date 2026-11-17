/** Shared optical arithmetic for the offline compiler and runtime renderers. */
function termFactor(term, at) {
  return term < 2 ? term === at.weightSide ? at.weight : 0 : term < 4 ? term === 2 + at.opszSide ? at.opsz : 0 : term === 4 + at.weightSide * 2 + at.opszSide ? at.weight * at.opsz : 0;
}
function sampleOpticalScalar(scalar, at) {
  let value = scalar.base;
  for (const [term, delta] of scalar.terms) value += delta * termFactor(term, at);
  return value;
}
function axisPosition(axis, value, name) {
  if (!Number.isFinite(value) || value < axis[0] || value > axis[2]) {
    throw new RangeError(`${name} must be between ${axis[0]} and ${axis[2]}`);
  }
  return value < axis[1] ? [0, (axis[1] - value) / (axis[1] - axis[0])] : [1, (value - axis[1]) / (axis[2] - axis[1])];
}
function opticalPosition(axes, weight, opsz) {
  const [weightSide, weightPosition] = axisPosition(axes.weight, weight, "weight");
  const [opszSide, opszPosition] = axisPosition(axes.opsz, opsz, "opsz");
  return { weightSide, opszSide, weight: weightPosition, opsz: opszPosition };
}
function sampleOpticalPath(path, at, target = new Float64Array(path.coordinates.length)) {
  if (target.length !== path.coordinates.length) throw new RangeError("optical target has a different coordinate count");
  target.set(path.coordinates);
  for (const [term, delta] of path.terms) {
    const factor = termFactor(term, at);
    if (factor === 0) continue;
    for (let i = 0; i < delta.length; i += 2) {
      const index = delta[i];
      target[index] = target[index] + delta[i + 1] * factor;
    }
  }
  return target;
}
function opticalPathData(path, coordinates, contours) {
  if (coordinates.length !== path.coordinates.length) throw new RangeError("optical path has a different coordinate count");
  let result = "", index = 0, contour = -1;
  for (const command of path.commands) {
    if (command === "M") contour++;
    const count = command === "C" ? 6 : command === "Z" ? 0 : 2;
    if (contours && !contours.includes(contour)) {
      index += count;
      continue;
    }
    result += command;
    for (let i = 0; i < count; i++) result += `${i ? " " : ""}${coordinates[index++]}`;
  }
  return result;
}
export {
  opticalPathData,
  opticalPosition,
  sampleOpticalPath,
  sampleOpticalScalar
};
