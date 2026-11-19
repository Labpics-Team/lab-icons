import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';
import type { AuthorAnnulusVariationGlyph, AuthorAnnulusVariationCapabilities, AuthorAnnulusVariationGlyphRequest } from '../ir/author-annulus-types.js';
export declare const outline: string;
export declare const filled: string;
export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'pause-circle'>;
export declare function glyph(request: AuthorAnnulusVariationGlyphRequest): AuthorAnnulusVariationGlyph<'pause-circle'>;
export declare function glyphCapabilities(variant?: 'outline'): AuthorAnnulusVariationCapabilities<'pause-circle'>;
export declare function glyphCapabilities(variant: 'filled'): AuthorSourceCapabilities<'pause-circle'> & Readonly<{ variant: 'filled' }>;
export declare function glyphCapabilities(variant: 'outline' | 'filled'): AuthorAnnulusVariationCapabilities<'pause-circle'> | (AuthorSourceCapabilities<'pause-circle'> & Readonly<{ variant: 'filled' }>);
