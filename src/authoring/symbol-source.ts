/** Authoring data; coordinates are stored in immutable SVG masters or explicit optical masters. */
export interface SymbolSource {
  readonly id: string;
  readonly calendar?: Readonly<{ profile: string; contentScale: number;
    viewport: Readonly<{ variant: 'outline' | 'filled'; partId: string; contourIndex: number }> }>;
  readonly variants: Readonly<Record<'outline' | 'filled', SymbolVariantSource>>;
  readonly draw?: Partial<Readonly<Record<'outline' | 'filled', Readonly<Record<string, Readonly<{ path: string; width: number }>>>>>>;
}
export interface SymbolVariantSource {
  readonly provenance: {
    readonly style: 'Outline' | 'Filled';
    readonly nodeId: string;
    readonly master: string;
    readonly sha256: string;
  };
  readonly anatomy: {
    readonly classification: 'declared' | 'semantic' | 'unclassified';
    readonly parts: readonly SymbolSourcePart[];
  };
}
export interface SymbolSourcePart {
  readonly id: string;
  readonly pathIndex: number;
  readonly contourIndices?: readonly number[];
  readonly role?: string;
  readonly component?: string;
}
