import type { GlyphCapabilities, GlyphIR, GlyphRequest, SourceGlyphProvenance } from './glyph-types.js';
import type { AuthorIconId } from './author-catalog.generated.js';
import type { AuthorSourceProvenance } from './author-provenance.js';

export type AuthorSymbolGlyphRequest = Omit<GlyphRequest, 'icon'> & { readonly variation?: never };

export interface AuthorSourceGlyph<TIcon extends AuthorIconId = AuthorIconId> extends GlyphIR<TIcon> {
  readonly provenance: SourceGlyphProvenance & { readonly author: AuthorSourceProvenance };
}

export interface AuthorSourceCapabilities<TIcon extends AuthorIconId = AuthorIconId> extends Omit<GlyphCapabilities<TIcon>, 'variation'> {
  readonly modelState: null;
  readonly supportedAxes: readonly [];
  readonly axes: Readonly<Record<string, never>>;
  readonly author: AuthorSourceProvenance;
}
