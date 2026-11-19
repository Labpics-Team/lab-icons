import type { AuthorSourceGlyph, AuthorSymbolGlyphRequest } from '../ir/author-source.js';
import type { AuthorVariationGlyph, AuthorVariationCapabilities, AuthorVariationGlyphRequest } from '../ir/authored-variation.js';
export declare const outline: string;
export declare const filled: string;
export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'ellipsis-vertical'>;
export declare function glyph(request: AuthorVariationGlyphRequest): AuthorVariationGlyph<'ellipsis-vertical'>;
export declare function glyphCapabilities(variant?: AuthorVariationCapabilities['variant']): AuthorVariationCapabilities<'ellipsis-vertical'>;
