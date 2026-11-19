import type { GlyphIR, SourcePartProvenance } from './glyph-types.js';
import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from './author-source.js';
import type { AuthorSourceProvenance, AuthorAnatomyReceipt } from './author-provenance.js';
import type { AuthorIconId } from './author-catalog.generated.js';

/** Масштаб всего содержания вокруг центра обрамления меняет extent, stroke и gaps вместе. */
export interface AuthoredContentVariation {
  readonly contentScale?: number;
  readonly enclosureEmphasis?: number;
}

export type AuthorContentVariationGlyphRequest = Omit<AuthorSymbolGlyphRequest, 'variant' | 'variation'> &
  Readonly<{ variant?: 'outline'; variation?: AuthoredContentVariation }>;

export interface AuthorContentVariationReceipt {
  readonly version: 1;
  readonly law: 'annulus.content-counter-scale';
  readonly geometrySha256: string;
  readonly parameters: Readonly<{ contentScale: number; enclosureEmphasis: number }>;
  readonly scale: number;
}

export interface AuthorContentVariationProvenance {
  readonly kind: 'authored-variation';
  readonly file: string;
  readonly author: AuthorSourceProvenance;
  readonly anatomy: AuthorAnatomyReceipt;
  readonly variation: AuthorContentVariationReceipt;
}

export interface AuthorContentVariationPartProvenance {
  readonly kind: 'authored-variation';
  readonly identity: 'declared';
  readonly source: SourcePartProvenance;
  readonly variation: AuthorContentVariationReceipt;
  readonly fingerprintBasis: 'literal-path';
  readonly artifactFingerprint: `sha256:${string}`;
}

export interface AuthorContentVariationDomain {
  readonly kind: 'joint-radial-bernstein';
  readonly evaluated: 'actual-binary64-scales';
  readonly positive: readonly ['contentScale', 'enclosureEmphasis'];
  readonly contentScale: Readonly<{ minimum: number; minimumInclusive: true; maximum: number; maximumInclusive: true }>;
  readonly enclosureScale: Readonly<{ minimum: number; minimumInclusive: true; maximum: number; maximumInclusive: false }>;
  readonly clearance: Readonly<{ contentScale: number; minimum: number;
    comparison: 'enclosureScale-contentScale*rate>=minimum' }>;
}

export interface AuthorContentVariationCapability {
  readonly version: 1;
  readonly law: 'annulus.content-counter-scale';
  readonly geometrySha256: string;
  readonly defaults: Readonly<{ contentScale: 1; enclosureEmphasis: 1 }>;
  readonly domain: AuthorContentVariationDomain;
  readonly targets: Readonly<{ svg: 'supported'; webEffect: 'existing-part-gestures'; lottie: 'not-exported'; sfSymbols: 'not-exported' }>;
}

export interface AuthorContentVariationGlyph<TIcon extends AuthorIconId = AuthorIconId> extends GlyphIR<TIcon> {
  readonly variant: 'outline';
  readonly provenance: AuthorSourceGlyph<TIcon>['provenance'] | AuthorContentVariationProvenance;
}

export interface AuthorContentVariationCapabilities<TIcon extends AuthorIconId = AuthorIconId> extends AuthorSourceCapabilities<TIcon> {
  readonly variant: 'outline';
  readonly variation: AuthorContentVariationCapability;
}
