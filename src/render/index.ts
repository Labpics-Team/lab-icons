import { opticalPathData, sampleOpticalPath,
  type OpticalAxes, type OpticalPath } from './optical-grid.js';
import { resolveIconRequest } from './request.js';

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
  /** Build-time semantic parts and effects; importing an SVG does not retain these data. */
  readonly semantics?: SymbolSemantics;
}
export interface SymbolPart {
  readonly id: string;
  /** Equal keys prove equal geometry at every optical support. */
  readonly key: string;
  readonly pathIndex: number;
  readonly anchor: readonly [number, number];
  readonly draw?: Readonly<{ path: string; width: number }>;
}
export interface SymbolTrack {
  readonly partId: string;
  readonly property: 'opacity' | 'x' | 'y' | 'rotate' | 'draw';
  readonly stops: readonly (readonly [number, number])[];
}
export interface SymbolGesture {
  readonly duration: number;
  readonly rest: number;
  readonly tracks: readonly SymbolTrack[];
}
export interface SymbolVariantSemantics {
  readonly parts: readonly SymbolPart[];
  readonly effects: Readonly<Record<string, SymbolGesture>>;
}
export interface SymbolSemantics {
  readonly variants: Readonly<Record<IconVariant, SymbolVariantSemantics>>;
  /** A state without data refers to the family's own artwork. */
  readonly states?: Readonly<Record<string, Readonly<{ id: string; data?: SymbolData; semantics?: SymbolSemantics }>>>;
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
  const { selected, data, variant, size, weight, opsz, position } = resolveIconRequest(symbol, options);
  // The source support at its source size returns the existing SVG literal.
  if (selected[variant] && weight === data.axes.weight[1] && opsz === data.axes.opsz[1] && size === 24) return selected[variant];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">`;
  for (const path of data.variants[variant].paths) {
    svg += `<path d="${opticalPathData(path, sampleOpticalPath(path, position))}" fill-rule="${path.fillRule}"/>`;
  }
  return `${svg}</svg>`;
}
