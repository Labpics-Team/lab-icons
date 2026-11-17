/** The middle support preserves the source master. Runtime never parses SVG. */
export type OpticalAxis = readonly [number, number, number];
export interface OpticalAxes {
  readonly weight: OpticalAxis;
  readonly opsz: OpticalAxis;
}

/** [coordinate index, delta, ...]; absent terms have exactly zero coefficients. */
export type SparseOpticalDelta = readonly number[];
export interface OpticalPath {
  readonly commands: string;
  readonly coordinates: readonly number[];
  readonly fillRule: 'nonzero' | 'evenodd';
  /** 0/1 weight, 2/3 opsz, 4..7 weight-side × opsz-side interactions. */
  readonly terms: readonly (readonly [number, SparseOpticalDelta])[];
}

export interface OpticalPosition {
  readonly weightSide: number;
  readonly opszSide: number;
  readonly weight: number;
  readonly opsz: number;
}

function axisPosition(axis: OpticalAxis, value: number, name: string): readonly [number, number] {
  if (!Number.isFinite(value) || value < axis[0] || value > axis[2]) {
    throw new RangeError(`${name} must be between ${axis[0]} and ${axis[2]}`);
  }
  return value < axis[1]
    ? [0, (axis[1] - value) / (axis[1] - axis[0])]
    : [1, (value - axis[1]) / (axis[2] - axis[1])];
}

/** Resolve once for the symbol, then reuse for all its paths. */
export function opticalPosition(axes: OpticalAxes, weight: number, opsz: number): OpticalPosition {
  const [weightSide, weightPosition] = axisPosition(axes.weight, weight, 'weight');
  const [opszSide, opszPosition] = axisPosition(axes.opsz, opsz, 'opsz');
  return { weightSide, opszSide, weight: weightPosition, opsz: opszPosition };
}

/** A caller can reuse the same buffer across frames; the immutable base never drifts. */
export function sampleOpticalPath(path: OpticalPath, at: OpticalPosition,
  target = new Float64Array(path.coordinates.length)): Float64Array {
  if (target.length !== path.coordinates.length) throw new RangeError('optical target has a different coordinate count');
  target.set(path.coordinates);
  const cross = 4 + at.weightSide * 2 + at.opszSide;
  for (const [term, delta] of path.terms) {
    const factor = term < 2 ? (term === at.weightSide ? at.weight : 0)
      : term < 4 ? (term === 2 + at.opszSide ? at.opsz : 0)
        : term === cross ? at.weight * at.opsz : 0;
    if (factor === 0) continue;
    for (let i = 0; i < delta.length; i += 2) {
      const index = delta[i]!;
      target[index] = target[index]! + delta[i + 1]! * factor;
    }
  }
  return target;
}

/** Emits precompiled M/L/C/Z opcodes, with no tokenization or geometric inference. */
export function opticalPathData(path: { readonly commands: string; readonly coordinates: ArrayLike<number> },
  coordinates: ArrayLike<number>, contours?: readonly number[]): string {
  if (coordinates.length !== path.coordinates.length) throw new RangeError('optical path has a different coordinate count');
  let result = '', index = 0, contour = -1;
  for (const command of path.commands) {
    if (command === 'M') contour++;
    const count = command === 'C' ? 6 : command === 'Z' ? 0 : 2;
    if (contours && !contours.includes(contour)) { index += count; continue; }
    result += command;
    for (let i = 0; i < count; i++) result += `${i ? ' ' : ''}${coordinates[index++]}`;
  }
  return result;
}
