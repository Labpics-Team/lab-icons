import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';
import type { AuthorContentVariationGlyph, AuthorContentVariationCapabilities, AuthorContentVariationGlyphRequest } from '../ir/author-content-types.js';
export declare const outline: string;
export declare const filled: string;
export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'minus-circle'>;
export declare function glyph(request: AuthorContentVariationGlyphRequest): AuthorContentVariationGlyph<'minus-circle'>;
export declare function glyphCapabilities(variant?: 'outline'): AuthorContentVariationCapabilities<'minus-circle'>;
export declare function glyphCapabilities(variant: 'filled'): AuthorSourceCapabilities<'minus-circle'> & Readonly<{ variant: 'filled' }>;
export declare function glyphCapabilities(variant: 'outline' | 'filled'): AuthorContentVariationCapabilities<'minus-circle'> | (AuthorSourceCapabilities<'minus-circle'> & Readonly<{ variant: 'filled' }>);
