import type { IconVariant } from './compiler.js';
import type { AuthorIconId } from './author-catalog.generated.js';
import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from './author-source.js';

/** Общий callable-контракт; статический consumer не импортирует variation. */
export interface AuthorSymbolApi<TIcon extends AuthorIconId = AuthorIconId> {
  readonly glyph: (request?: AuthorSymbolGlyphRequest) => AuthorSourceGlyph<TIcon>;
  readonly glyphCapabilities: (variant?: IconVariant) => AuthorSourceCapabilities<TIcon>;
}
