import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';
import type { AuthorAnnulusVariationGlyph, AuthorAnnulusVariationCapabilities, AuthorAnnulusVariationGlyphRequest } from '../ir/author-annulus-types.js';
export declare const outline: string;
export declare const filled: string;
export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'minus-circle'>;
export declare function glyph(request: AuthorAnnulusVariationGlyphRequest): AuthorAnnulusVariationGlyph<'minus-circle'>;
export declare function glyphCapabilities(variant?: 'outline'): AuthorAnnulusVariationCapabilities<'minus-circle'>;
export declare function glyphCapabilities(variant: 'filled'): AuthorSourceCapabilities<'minus-circle'> & Readonly<{ variant: 'filled' }>;
export declare function glyphCapabilities(variant: 'outline' | 'filled'): AuthorAnnulusVariationCapabilities<'minus-circle'> | (AuthorSourceCapabilities<'minus-circle'> & Readonly<{ variant: 'filled' }>);
