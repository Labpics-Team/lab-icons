import type { GlyphIR, SourcePartProvenance } from './glyph-types.js';
import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from './author-source.js';
import type { AuthorSourceProvenance, AuthorAnatomyReceipt } from './author-provenance.js';
import type { AuthorIconId } from './author-catalog.generated.js';

/** Изменяется только контрформа обрамления; это не общая ось веса. */
export interface AuthoredAnnulusVariation {
  readonly enclosureEmphasis?: number;
}

export type AuthorAnnulusVariationGlyphRequest = Omit<AuthorSymbolGlyphRequest, 'variant' | 'variation'> &
  Readonly<{ variant?: 'outline'; variation?: AuthoredAnnulusVariation }>;

export interface AuthorAnnulusVariationReceipt {
  readonly version: 1;
  readonly law: 'annulus.counter-scale';
  readonly geometrySha256: string;
  readonly parameters: Readonly<{ enclosureEmphasis: number }>;
  readonly scale: number;
}

export interface AuthorAnnulusVariationProvenance {
  readonly kind: 'authored-variation';
  readonly file: string;
  readonly author: AuthorSourceProvenance;
  readonly anatomy: AuthorAnatomyReceipt;
  readonly variation: AuthorAnnulusVariationReceipt;
}

export interface AuthorAnnulusVariationPartProvenance {
  readonly kind: 'authored-variation';
  readonly identity: 'declared';
  readonly source: SourcePartProvenance;
  readonly variation: AuthorAnnulusVariationReceipt;
  readonly fingerprintBasis: 'literal-path';
  /** SHA-256 точного материализованного d и fillRule; parser на запросе не нужен. */
  readonly artifactFingerprint: `sha256:${string}`;
}

export interface AuthorAnnulusVariationDomain {
  readonly kind: 'radial-bernstein';
  readonly parameter: 'enclosureEmphasis';
  readonly evaluated: 'actual-binary64-scale';
  readonly scale: Readonly<{ minimum: number; minimumInclusive: true; maximum: number; maximumInclusive: false }>;
}

export interface AuthorAnnulusVariationCapability {
  readonly version: 1;
  readonly law: 'annulus.counter-scale';
  readonly geometrySha256: string;
  readonly defaults: Readonly<{ enclosureEmphasis: 1 }>;
  readonly domain: AuthorAnnulusVariationDomain;
  readonly targets: Readonly<{ svg: 'supported'; webEffect: 'not-declared'; lottie: 'not-exported'; sfSymbols: 'not-exported' }>;
}

export interface AuthorAnnulusVariationGlyph<TIcon extends AuthorIconId = AuthorIconId> extends GlyphIR<TIcon> {
  readonly variant: 'outline';
  readonly provenance: AuthorSourceGlyph<TIcon>['provenance'] | AuthorAnnulusVariationProvenance;
}

export interface AuthorAnnulusVariationCapabilities<TIcon extends AuthorIconId = AuthorIconId> extends AuthorSourceCapabilities<TIcon> {
  readonly variant: 'outline';
  readonly variation: AuthorAnnulusVariationCapability;
}
