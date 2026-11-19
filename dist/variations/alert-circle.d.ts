import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';
import type { AuthorAnnulusVariationGlyph, AuthorAnnulusVariationCapabilities, AuthorAnnulusVariationGlyphRequest } from '../ir/author-annulus-types.js';
export declare const outline: string;
export declare const filled: string;
export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'alert-circle'>;
export declare function glyph(request: AuthorAnnulusVariationGlyphRequest): AuthorAnnulusVariationGlyph<'alert-circle'>;
export declare function glyphCapabilities(variant?: 'outline'): AuthorAnnulusVariationCapabilities<'alert-circle'>;
export declare function glyphCapabilities(variant: 'filled'): AuthorSourceCapabilities<'alert-circle'> & Readonly<{ variant: 'filled' }>;
export declare function glyphCapabilities(variant: 'outline' | 'filled'): AuthorAnnulusVariationCapabilities<'alert-circle'> | (AuthorSourceCapabilities<'alert-circle'> & Readonly<{ variant: 'filled' }>);
