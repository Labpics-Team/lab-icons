import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';
import type { AuthorContentVariationGlyph, AuthorContentVariationCapabilities, AuthorContentVariationGlyphRequest } from '../ir/author-content-types.js';
export declare const outline: string;
export declare const filled: string;
export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'checkmark-circle'>;
export declare function glyph(request: AuthorContentVariationGlyphRequest): AuthorContentVariationGlyph<'checkmark-circle'>;
export declare function glyphCapabilities(variant?: 'outline'): AuthorContentVariationCapabilities<'checkmark-circle'>;
export declare function glyphCapabilities(variant: 'filled'): AuthorSourceCapabilities<'checkmark-circle'> & Readonly<{ variant: 'filled' }>;
export declare function glyphCapabilities(variant: 'outline' | 'filled'): AuthorContentVariationCapabilities<'checkmark-circle'> | (AuthorSourceCapabilities<'checkmark-circle'> & Readonly<{ variant: 'filled' }>);
