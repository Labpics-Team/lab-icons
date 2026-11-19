import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';
import type { AuthorAnnulusVariationGlyph, AuthorAnnulusVariationCapabilities, AuthorAnnulusVariationGlyphRequest } from '../ir/author-annulus-types.js';
export declare const outline: string;
export declare const filled: string;
export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'plus-circle'>;
export declare function glyph(request: AuthorAnnulusVariationGlyphRequest): AuthorAnnulusVariationGlyph<'plus-circle'>;
export declare function glyphCapabilities(variant?: 'outline'): AuthorAnnulusVariationCapabilities<'plus-circle'>;
export declare function glyphCapabilities(variant: 'filled'): AuthorSourceCapabilities<'plus-circle'> & Readonly<{ variant: 'filled' }>;
export declare function glyphCapabilities(variant: 'outline' | 'filled'): AuthorAnnulusVariationCapabilities<'plus-circle'> | (AuthorSourceCapabilities<'plus-circle'> & Readonly<{ variant: 'filled' }>);
