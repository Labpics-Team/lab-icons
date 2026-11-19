import type { IconSymbol, RenderIconOptions, SymbolData, SymbolPart, IconVariant, SymbolVariantSemantics } from './index.js';
import { resolveIconRequest } from './request.js';
import { sampleOpticalPath, sampleOpticalScalar, type OpticalPosition, type OpticalPath } from './optical-grid.js';
import { projectPathView, projectPoint } from '../motion/path-view.js';

export interface PreparedSymbolPart {
  readonly part: SymbolPart;
  readonly path: OpticalPath;
  readonly commands: string;
  readonly coordinates: Float64Array;
  readonly contours: readonly number[] | undefined;
  readonly anchor: readonly [number, number];
  readonly offsetX: number;
  readonly strokeWidth: number | undefined;
}

/** A declared part key supplies correspondence; no geometric matching at runtime. */
export function symbolGeometryTransition(first: PreparedSymbolPart, last: PreparedSymbolPart) {
  if (first.commands !== last.commands || first.coordinates.length !== last.coordinates.length ||
      first.path.fillRule !== last.path.fillRule || (first.strokeWidth === undefined) !== (last.strokeWidth === undefined) ||
      String(first.contours) !== String(last.contours)) throw new TypeError('A shared symbol part requires compatible path topology');
  const different = first.offsetX !== last.offsetX || first.strokeWidth !== last.strokeWidth ||
    first.anchor.some((value, index) => value !== last.anchor[index]) || first.coordinates.some((value, index) => value !== last.coordinates[index]);
  if (!different) return undefined;
  // Capture the last visible geometry once, including an interrupted transition.
  const source = first.coordinates.slice(), target = last.coordinates;
  const startOffset = first.offsetX, startWidth = first.strokeWidth;
  const startAnchor = [...first.anchor], anchor: [number, number] = [...first.anchor];
  const value = { ...last, coordinates: source.slice(), anchor, offsetX: first.offsetX, strokeWidth: first.strokeWidth };
  const mix = (a: number, b: number, progress: number) => progress === 0 ? a : progress === 1 ? b : a + (b - a) * progress;
  return { value, sample(progress: number) {
    for (let index = 0; index < source.length; index++) value.coordinates[index] = mix(source[index]!, target[index]!, progress);
    anchor[0] = mix(startAnchor[0]!, last.anchor[0], progress); anchor[1] = mix(startAnchor[1]!, last.anchor[1], progress);
    value.offsetX = mix(startOffset, last.offsetX, progress);
    if (startWidth !== undefined) value.strokeWidth = mix(startWidth, last.strokeWidth!, progress);
    return value;
  } };
}

/** Source selectors and optical sampling are identical for SVG motion and export. */
export function prepareSymbolParts(data: SymbolData, variant: IconVariant, parts: readonly SymbolPart[], at: OpticalPosition): PreparedSymbolPart[] {
  const sampled = new Map<number, Float64Array>();
  return parts.map(part => {
    const path = data.variants[variant].paths[part.pathIndex]!;
    let source = sampled.get(part.pathIndex);
    if (!source) { source = sampleOpticalPath(path, at); sampled.set(part.pathIndex, source); }
    return { part, path, commands: part.geometry?.commands ?? path.commands,
      coordinates: part.geometry ? projectPathView(part.geometry, source) : source,
      contours: part.geometry ? undefined : part.contourIndices,
      anchor: part.pivot ? projectPoint(source, part.pivot) : part.anchor,
      offsetX: part.offsetX ? sampleOpticalScalar(part.offsetX, at) : 0,
      strokeWidth: path.stroke ? sampleOpticalScalar(path.stroke.width, at) : undefined };
  });
}

export function resolveSymbolPose(symbol: IconSymbol, options: RenderIconOptions) {
  const request = resolveIconRequest(symbol, options);
  const { data, variant, selected, position } = request;
  const semantic: SymbolVariantSemantics = selected.semantics?.variants[variant] ?? {
    effects: {}, parts: data.variants[variant].paths.map((_, pathIndex) =>
      ({ id: `paint-${pathIndex}`, pathIndex, key: `${selected.id}/${variant}/${pathIndex}`, anchor: [12, 12] })) };
  return { ...request, semantic, paints: prepareSymbolParts(data, variant, semantic.parts, position) };
}
