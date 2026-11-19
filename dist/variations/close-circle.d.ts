import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';
import type { AuthorAnnulusVariationGlyph, AuthorAnnulusVariationCapabilities, AuthorAnnulusVariationGlyphRequest } from '../ir/author-annulus-types.js';
export declare const outline: string;
export declare const filled: string;
export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'close-circle'>;
export declare function glyph(request: AuthorAnnulusVariationGlyphRequest): AuthorAnnulusVariationGlyph<'close-circle'>;
export declare function glyphCapabilities(variant?: 'outline'): AuthorAnnulusVariationCapabilities<'close-circle'>;
export declare function glyphCapabilities(variant: 'filled'): AuthorSourceCapabilities<'close-circle'> & Readonly<{ variant: 'filled' }>;
export declare function glyphCapabilities(variant: 'outline' | 'filled'): AuthorAnnulusVariationCapabilities<'close-circle'> | (AuthorSourceCapabilities<'close-circle'> & Readonly<{ variant: 'filled' }>);
