import type { GlyphIR, SourcePartProvenance } from './glyph-types.js';
import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from './author-source.js';
import type { AuthorSourceProvenance, AuthorAnatomyReceipt } from './author-provenance.js';
import type { AuthorIconId } from './author-catalog.generated.js';
export interface AuthoredDotVariation {
    readonly dotScale?: number;
    readonly spacingScale?: number;
}
export type AuthorVariationGlyphRequest = Omit<AuthorSymbolGlyphRequest, 'variation'> & Readonly<{
    variation?: AuthoredDotVariation;
}>;
export interface AuthorVariationReceipt {
    readonly version: 1;
    readonly law: 'dots.affine';
    readonly geometrySha256: string;
    readonly parameters: Readonly<{
        dotScale: number;
        spacingScale: number;
    }>;
}
export interface AuthorVariationProvenance {
    readonly kind: 'authored-variation';
    readonly file: string;
    readonly author: AuthorSourceProvenance;
    readonly anatomy: AuthorAnatomyReceipt;
    readonly variation: AuthorVariationReceipt;
}
export interface AuthorVariationPartProvenance {
    readonly kind: 'authored-variation';
    readonly identity: 'declared';
    readonly source: SourcePartProvenance;
    readonly variation: AuthorVariationReceipt;
    readonly artifactFingerprint: `sha256:${string}`;
}
export interface AuthoredVariationDomain {
    readonly kind: 'convex-linear';
    readonly bound: 'control-hull';
    readonly positive: readonly ['dotScale', 'spacingScale'];
    /** a*dotScale + b*spacingScale >= minimum; положительность проверяется отдельно. */
    readonly constraints: readonly Readonly<{
        kind: 'margin' | 'gap';
        dotScale: number;
        spacingScale: number;
        minimum: number;
    }>[];
    readonly policy: Readonly<{
        gridVersion: number;
        gridSha256: string;
        marginRatio: number;
        minimumGapRatio: number;
    }>;
}
export interface AuthorVariationCapability {
    readonly version: 1;
    readonly law: 'dots.affine';
    readonly geometrySha256: string;
    readonly defaults: Readonly<{
        dotScale: 1;
        spacingScale: 1;
    }>;
    readonly domain: AuthoredVariationDomain;
    readonly targets: Readonly<{
        svg: 'supported';
        webEffect: 'existing-part-gestures';
        lottie: 'not-exported';
        sfSymbols: 'not-exported';
    }>;
}
export interface AuthorVariationGlyph<TIcon extends AuthorIconId = AuthorIconId> extends GlyphIR<TIcon> {
    readonly provenance: AuthorSourceGlyph<TIcon>['provenance'] | AuthorVariationProvenance;
}
export interface AuthorVariationCapabilities<TIcon extends AuthorIconId = AuthorIconId> extends AuthorSourceCapabilities<TIcon> {
    readonly variation: AuthorVariationCapability;
}
/** Машинный код не зависит от текста ошибки. */
export declare class AuthoredVariationError extends RangeError {
    readonly code: 'INVALID_VARIATION' | 'VARIATION_OUTSIDE_DOMAIN' | 'VARIATION_UNREPRESENTABLE' | 'VARIATION_SOURCE_MISMATCH';
    constructor(code: AuthoredVariationError['code'], message: string);
}
