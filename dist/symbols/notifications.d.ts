import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';
import type { IconSymbol } from '../render/index.js';
export declare const outline: string;
export declare const filled: string;
export declare const symbol: IconSymbol & Readonly<{ id: 'notifications' }>;
export default symbol;
export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'notifications'>;
export declare function glyphCapabilities(variant?: AuthorSourceCapabilities['variant']): AuthorSourceCapabilities<'notifications'>;
