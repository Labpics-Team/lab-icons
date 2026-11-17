export type OpticalAxis = readonly [number, number, number];
export interface OpticalAxes { readonly weight: OpticalAxis; readonly opsz: OpticalAxis }
export type SparseOpticalDelta = readonly number[];
export interface OpticalScalar {
  readonly base: number;
  readonly terms: readonly (readonly [number, number])[];
}
export interface OpticalPath {
  readonly commands: string;
  readonly coordinates: readonly number[];
  readonly fillRule: 'nonzero' | 'evenodd';
  /** 0/1 weight, 2/3 opsz, 4..7 weight-side × opsz-side interactions. */
  readonly terms: readonly (readonly [number, SparseOpticalDelta])[];
  /** An explicit rounded centerline; absent means the authored filled contour. */
  readonly stroke?: Readonly<{ width: OpticalScalar }>;
}
export interface OpticalPosition {
  readonly weightSide: number;
  readonly opszSide: number;
  readonly weight: number;
  readonly opsz: number;
}
export declare function opticalPosition(axes: OpticalAxes, weight: number, opsz: number): OpticalPosition;
export declare function sampleOpticalScalar(scalar: OpticalScalar, at: OpticalPosition): number;
export declare function sampleOpticalPath(path: OpticalPath, at: OpticalPosition, target?: Float64Array): Float64Array;
export declare function opticalPathData(path: { readonly commands: string; readonly coordinates: ArrayLike<number> },
  coordinates: ArrayLike<number>, contours?: readonly number[]): string;
