import type { GlyphIR, IconVariant, SourcePartProvenance } from './glyph-types.js';
import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from './author-source.js';
import type { AuthorSourceProvenance, AuthorAnatomyReceipt } from './author-provenance.js';
import type { AuthorIconId } from './author-catalog.generated.js';

/** Горизонтальный span тела при неизменной высоте, стойке и обрамлении. */
export interface AuthoredCapsuleVariation { readonly bodyWidth?: number }
export type AuthorCapsuleVariationGlyphRequest<TVariant extends IconVariant = IconVariant> =
  Omit<AuthorSymbolGlyphRequest, 'variant' | 'variation'> & Readonly<{ variant?: TVariant; variation?: AuthoredCapsuleVariation }>;
export interface AuthorCapsuleVariationReceipt {
  readonly version: 1;
  readonly law: 'capsule.width';
  readonly geometrySha256: string;
  readonly parameters: Readonly<{ bodyWidth: number }>;
}
export interface AuthorCapsuleVariationProvenance {
  readonly kind: 'authored-variation';
  readonly file: string;
  readonly author: AuthorSourceProvenance;
  readonly anatomy: AuthorAnatomyReceipt;
  readonly variation: AuthorCapsuleVariationReceipt;
}
export interface AuthorCapsuleVariationPartProvenance {
  readonly kind: 'authored-variation';
  readonly identity: 'declared';
  readonly source: SourcePartProvenance;
  readonly variation: AuthorCapsuleVariationReceipt;
  readonly fingerprintBasis: 'literal-path';
  readonly artifactFingerprint: `sha256:${string}`;
}
export interface AuthorCapsuleVariationDomain {
  readonly kind: 'bounded-capsule-width';
  readonly minimum: number;
  readonly maximum: 1;
  readonly minimumInclusive: true;
  readonly maximumInclusive: true;
  readonly policy: Readonly<{ gridVersion: number; gridSha256: string; minimumGap: number; minimumPositiveSpan: number }>;
  readonly certificate: Readonly<{ method: 'exact-tensor-bernstein-separation'; sha256: string }>;
}
export interface AuthorCapsuleVariationCapability {
  readonly version: 1;
  readonly law: 'capsule.width';
  readonly geometrySha256: string;
  readonly defaults: Readonly<{ bodyWidth: 1 }>;
  readonly domain: AuthorCapsuleVariationDomain;
  readonly targets: Readonly<{ svg: 'supported'; webEffect: 'not-exported'; lottie: 'not-exported'; sfSymbols: 'not-exported' }>;
}
export interface AuthorCapsuleVariationGlyph<TIcon extends AuthorIconId = AuthorIconId, TVariant extends IconVariant = IconVariant> extends GlyphIR<TIcon> {
  readonly variant: TVariant;
  readonly provenance: AuthorSourceGlyph<TIcon>['provenance'] | AuthorCapsuleVariationProvenance;
}
export interface AuthorCapsuleVariationCapabilities<TIcon extends AuthorIconId = AuthorIconId, TVariant extends IconVariant = IconVariant> extends AuthorSourceCapabilities<TIcon> {
  readonly variant: TVariant;
  readonly variation: AuthorCapsuleVariationCapability;
}
