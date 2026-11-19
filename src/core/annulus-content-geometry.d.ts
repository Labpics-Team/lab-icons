/** Типы единственного чистого JS owner; этот файл не добавляет runtime bytes. */
type Point = readonly [number, number];
type Refuse = (code: 'INVALID_VARIATION' | 'VARIATION_OUTSIDE_DOMAIN' | 'VARIATION_UNREPRESENTABLE' | 'VARIATION_SOURCE_MISMATCH', message: string) => never;
export declare function projectedContourAreas(commands: string, points: readonly Point[], center: Point): number[];
export declare function contentScaleParameters(value: unknown, refuse: Refuse): { contentScale: number; enclosureEmphasis: number };
export declare function admitJointContentScale(domain: Readonly<{
  contentScale: Readonly<{ minimum: number; maximum: number }>;
  enclosureScale: Readonly<{ minimum: number; maximum: number }>;
  clearance: Readonly<{ contentScale: number; minimum: number }>;
}>, contentScale: number, enclosureScale: number, refuse: Refuse): void;
export declare function materializeProjectedContent(compiled: Readonly<{ center: Point; parts: readonly Readonly<{
  index: number; commands: string; points: readonly Point[];
  coordinateOrder: readonly (readonly number[])[]; winding: readonly number[];
}>[] }>, contentScale: number, refuse: Refuse): { index: number; d: string }[];
