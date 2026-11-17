import { opticalPathData, opticalPosition, sampleOpticalPath,
  type OpticalAxes, type OpticalPath } from './optical-grid.js';

export type IconVariant = 'outline' | 'filled';
export interface SymbolData {
  readonly version: 1;
  readonly axes: OpticalAxes;
  readonly variants: Readonly<Record<IconVariant, { readonly paths: readonly OpticalPath[] }>>;
}
export interface IconSymbol {
  readonly id: string;
  readonly outline: string;
  readonly filled: string;
  readonly data: SymbolData;
  readonly states?: Readonly<Record<string, IconSymbol>>;
}
export interface RenderIconOptions {
  readonly variant?: IconVariant;
  /** CSS px on web; native receives the already scaled logical size. */
  readonly size?: number;
  readonly weight?: number;
  readonly opsz?: number | 'auto';
  readonly state?: string;
}

/** Pure SVG rendering: no DOM, clocks, observers or runtime SVG parser. */
export function renderIcon(symbol: IconSymbol, options: RenderIconOptions = {}): string {
  if (!options || typeof options !== 'object') throw new TypeError('renderIcon options must be an object');
  let selected = symbol;
  if (options.state !== undefined) {
    if (typeof options.state !== 'string' || !symbol.states || !Object.hasOwn(symbol.states, options.state)) {
      throw new RangeError(`symbol ${symbol.id} does not define state ${String(options.state)}`);
    }
    selected = symbol.states[options.state]!;
  }
  const data = selected.data;
  if (data?.version !== 1) throw new TypeError(`symbol ${selected.id} has no compiled optical masters`);
  const variant = options.variant === undefined ? 'outline' : options.variant;
  if (variant !== 'outline' && variant !== 'filled') throw new RangeError('variant must be outline or filled');
  const size = options.size === undefined ? data.axes.opsz[1] : options.size;
  if (!Number.isFinite(size) || size <= 0) throw new RangeError('size must be a finite positive number of CSS pixels');
  const weight = options.weight === undefined ? data.axes.weight[1] : options.weight;
  const requestedOpsz = options.opsz === undefined ? 'auto' : options.opsz;
  const opsz = requestedOpsz === 'auto'
    ? Math.min(data.axes.opsz[2], Math.max(data.axes.opsz[0], size)) : requestedOpsz;
  const position = opticalPosition(data.axes, weight, opsz);
  // The source support at its source size returns the existing SVG literal.
  if (weight === data.axes.weight[1] && opsz === data.axes.opsz[1] && size === 24) return selected[variant];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">`;
  for (const path of data.variants[variant].paths) {
    svg += `<path d="${opticalPathData(path, sampleOpticalPath(path, position))}" fill-rule="${path.fillRule}"/>`;
  }
  return `${svg}</svg>`;
}
