import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';
import type { AuthorContentVariationGlyph, AuthorContentVariationCapabilities, AuthorContentVariationGlyphRequest } from '../ir/author-content-types.js';
export declare const outline: string;
export declare const filled: string;
export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'alert-circle'>;
export declare function glyph(request: AuthorContentVariationGlyphRequest): AuthorContentVariationGlyph<'alert-circle'>;
export declare function glyphCapabilities(variant?: 'outline'): AuthorContentVariationCapabilities<'alert-circle'>;
export declare function glyphCapabilities(variant: 'filled'): AuthorSourceCapabilities<'alert-circle'> & Readonly<{ variant: 'filled' }>;
export declare function glyphCapabilities(variant: 'outline' | 'filled'): AuthorContentVariationCapabilities<'alert-circle'> | (AuthorSourceCapabilities<'alert-circle'> & Readonly<{ variant: 'filled' }>);
