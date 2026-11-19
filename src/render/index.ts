import { opticalPathData, sampleOpticalPath,
  type OpticalAxes, type OpticalPath, type OpticalScalar } from './optical-grid.js';
import { resolveIconRequest } from './request.js';
import { renderSymbolParts } from './parts.js';

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
  /** Whole contours of the shared numeric path; omitted means the complete path. */
  readonly contourIndices?: readonly number[];
  readonly geometry?: SymbolPathView;
  readonly pivot?: SymbolPointProjection;
  readonly offsetX?: OpticalScalar;
  readonly anchor: readonly [number, number];
  readonly draw?: Readonly<{ path: SymbolNumericPath; width: number }>;
  /** Parts whose coverage is painted once share an isolated layer, optionally with subtraction. */
  readonly layer?: string;
  readonly negative?: boolean;
}
export interface SymbolPointProjection {
  readonly basis: readonly [number, number, number];
  readonly weights: readonly [number, number, number];
}
export interface SymbolNumericPath {
  readonly commands: string;
  readonly coordinates: readonly number[];
}
/** Direct source-point indices or convex combinations; no second optical coordinate table. */
export interface SymbolPathView {
  readonly commands: string;
  readonly basis: readonly [number, number, number];
  readonly points: readonly (number | readonly [number, number, number])[];
}
export interface SymbolTrack {
  readonly partId: string;
  readonly property: 'opacity' | 'x' | 'y' | 'rotate' | 'draw';
  readonly stops: readonly (readonly [number, number])[];
}
export interface SymbolGesture {
  readonly duration: number;
  readonly rest: number;
  readonly parameter?: 'elapsed-hours';
  readonly tracks: readonly SymbolTrack[];
}
export interface SymbolVariantSemantics {
  readonly parts: readonly SymbolPart[];
  readonly effects: Readonly<Record<string, SymbolGesture>>;
}
export interface SymbolSemantics {
  readonly variants: Readonly<Record<IconVariant, SymbolVariantSemantics>>;
  readonly calendar?: CalendarSymbolData;
  /** A state without data refers to the family's own artwork. */
  readonly states?: Readonly<Record<string, Readonly<{ id: string; data?: SymbolData; semantics?: SymbolSemantics }>>>;
}
export interface CalendarSymbolData {
  readonly key: string;
  readonly digits: readonly OpticalPath[];
  readonly spacing: OpticalScalar;
  readonly shells: Readonly<Record<IconVariant, readonly SymbolPart[]>>;
}
export interface RenderIconOptions {
  readonly variant?: IconVariant;
  /** CSS px on web; native receives the already scaled logical size. */
  readonly size?: number;
  readonly weight?: number;
  readonly opsz?: number | 'auto';
  readonly state?: string;
  /** Explicit instant and named IANA zone. Both are required for a dynamic calendar day. */
  readonly date?: Date;
  readonly timeZone?: string;
}

/** Pure SVG rendering: no DOM, clocks, observers or runtime SVG parser. */
export function renderIcon(symbol: IconSymbol, options: RenderIconOptions = {}): string {
  const { selected, data, variant, size, weight, opsz, position, parts } = resolveIconRequest(symbol, options);
  // The source support at its source size returns the existing SVG literal.
  if (selected[variant] && weight === data.axes.weight[1] && opsz === data.axes.opsz[1] && size === 24) return selected[variant];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="currentColor">`;
  if (parts) return `${svg}${renderSymbolParts(data, variant, parts, position)}</svg>`;
  for (const path of data.variants[variant].paths) {
    svg += `<path d="${opticalPathData(path, sampleOpticalPath(path, position))}" fill-rule="${path.fillRule}"/>`;
  }
  return `${svg}</svg>`;
}
