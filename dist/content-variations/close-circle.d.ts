import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';
import type { AuthorContentVariationGlyph, AuthorContentVariationCapabilities, AuthorContentVariationGlyphRequest } from '../ir/author-content-types.js';
export declare const outline: string;
export declare const filled: string;
export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'close-circle'>;
export declare function glyph(request: AuthorContentVariationGlyphRequest): AuthorContentVariationGlyph<'close-circle'>;
export declare function glyphCapabilities(variant?: 'outline'): AuthorContentVariationCapabilities<'close-circle'>;
export declare function glyphCapabilities(variant: 'filled'): AuthorSourceCapabilities<'close-circle'> & Readonly<{ variant: 'filled' }>;
export declare function glyphCapabilities(variant: 'outline' | 'filled'): AuthorContentVariationCapabilities<'close-circle'> | (AuthorSourceCapabilities<'close-circle'> & Readonly<{ variant: 'filled' }>);
