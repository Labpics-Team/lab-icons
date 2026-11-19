import { type NormalizedPoint, type RecipePart, type RecipeResult } from '../ir/recipes.js';
import type { DesignSpecGlyphProvenance, GlyphIR } from '../ir/glyph-types.js';
export type DesignSpecErrorCode = 'UNSUPPORTED_VERSION' | 'UNKNOWN_FIELD' | 'RAW_PATH_FORBIDDEN' | 'ARBITRARY_POINTS_FORBIDDEN' | 'ANONYMOUS_TRANSFORM_FORBIDDEN' | 'DUPLICATE_ID' | 'UNKNOWN_REFERENCE' | 'ANCHOR_CYCLE' | 'INVALID_VALUE' | 'UNDERDEFINED_CONSTRAINT' | 'CONTRADICTORY_CONSTRAINT' | 'UNBOUNDED_RESIDUAL' | 'UNSUPPORTED_COMPOSITION' | 'CONSTRAINT_VIOLATION';
export declare class DesignSpecError extends Error {
    readonly code: DesignSpecErrorCode;
    readonly at: string;
    constructor(code: DesignSpecErrorCode, at: string, message: string);
}
declare const PART_ROLES: readonly ['body', 'content', 'ink', 'counter', 'container', 'control', 'detail', 'decorator'];
declare const CANVAS_ANCHORS: Readonly<{
    readonly center: Readonly<{
        x: 0.5;
        y: 0.5;
    }>;
    readonly north: Readonly<{
        x: 0.5;
        y: 0;
    }>;
    readonly 'north-east': Readonly<{
        x: 1;
        y: 0;
    }>;
    readonly east: Readonly<{
        x: 1;
        y: 0.5;
    }>;
    readonly 'south-east': Readonly<{
        x: 1;
        y: 1;
    }>;
    readonly south: Readonly<{
        x: 0.5;
        y: 1;
    }>;
    readonly 'south-west': Readonly<{
        x: 0;
        y: 1;
    }>;
    readonly west: Readonly<{
        x: 0;
        y: 0.5;
    }>;
    readonly 'north-west': Readonly<{
        x: 0;
        y: 0;
    }>;
}>;
declare const NEGATIVE_SPACE_KINDS: readonly ['exterior-margin', 'gap'];
declare const NEGATIVE_SPACE_MEASUREMENTS: readonly ['ink-bounds-to-canvas', 'axis-aligned-group-bounds-separation'];
export declare const designSpecContract: {
    schema: string;
    version: number;
    canvas: {
        unit: string;
        paintedInkContainment: string;
    };
    primitiveKinds: readonly ["circle", "ellipse", "line", "arc", "capsule", "rect"];
    anchorKinds: readonly ["canvas", "midpoint", "polar", "project"];
    canvasAnchors: string[];
    partRoles: readonly ["body", "content", "ink", "counter", "container", "control", "detail", "decorator"];
    compositionKinds: readonly ["layers", "compound", "mask-subtract"];
    decoratorKinds: readonly ["overlay", "knockout", "enclosure"];
    negativeSpaceKinds: readonly ["exterior-margin", "gap"];
    negativeSpaceMeasurements: readonly ["ink-bounds-to-canvas", "axis-aligned-group-bounds-separation"];
    residualRecipes: {
        superellipse: {
            continuity: string;
            tangency: string;
            domain: {
                rx: {
                    minExclusive: number;
                    max: number;
                };
                ry: {
                    minExclusive: number;
                    max: number;
                };
                exponent: {
                    min: number;
                    max: number;
                };
                rotation: {
                    min: number;
                    max: number;
                };
            };
        };
    };
    forbidden: {
        rawPath: string[];
        arbitraryPoints: string[];
        anonymousTransforms: string[];
    };
};
type CanvasAnchorName = keyof typeof CANVAS_ANCHORS;
type PartRole = (typeof PART_ROLES)[number];
type DesignNegativeSpaceKind = (typeof NEGATIVE_SPACE_KINDS)[number];
type DesignNegativeSpaceMeasurement = (typeof NEGATIVE_SPACE_MEASUREMENTS)[number];
export type DesignAnchor = Readonly<{
    id: string;
    kind: 'canvas';
    at: CanvasAnchorName;
}> | Readonly<{
    id: string;
    kind: 'midpoint';
    between: readonly [string, string];
}> | Readonly<{
    id: string;
    kind: 'polar';
    from: string;
    angle: number;
    distance: number;
}> | Readonly<{
    id: string;
    kind: 'project';
    xFrom: string;
    yFrom: string;
}>;
export type DesignGeometry = Readonly<{
    kind: 'circle';
    center: string;
    radius: number;
}> | Readonly<{
    kind: 'ellipse';
    center: string;
    rx: number;
    ry: number;
    rotation?: number;
}> | Readonly<{
    kind: 'line';
    from: string;
    to: string;
}> | Readonly<{
    kind: 'arc';
    center: string;
    radius: number;
    startAngle: number;
    endAngle: number;
    direction: 'cw' | 'ccw';
}> | Readonly<{
    kind: 'capsule';
    from: string;
    to: string;
    radius: number;
}> | Readonly<{
    kind: 'rect';
    center: string;
    width: number;
    height: number;
    cornerRadius?: number;
}> | Readonly<{
    kind: 'residual';
    recipe: 'superellipse';
    center: string;
    rx: number;
    ry: number;
    exponent: number;
    rotation?: number;
}>;
export type DesignPaint = Readonly<{
    kind: 'fill';
}> | Readonly<{
    kind: 'stroke';
    width: number;
    linecap?: 'round' | 'butt';
}>;
export interface DesignPart {
    readonly id: string;
    readonly role: PartRole;
    readonly geometry: DesignGeometry;
    readonly paint: DesignPaint;
    /** ID опоры в anchors. */
    readonly anchor?: string;
    readonly morphGroup?: string;
}
export type DesignComposition = Readonly<{
    kind: 'layers';
}> | Readonly<{
    kind: 'compound';
    fillRule: 'nonzero' | 'evenodd';
}> | Readonly<{
    kind: 'mask-subtract';
    basePartIds: readonly string[];
    subtractPartIds: readonly string[];
}>;
export interface DesignDecorator {
    readonly id: string;
    readonly kind: 'overlay' | 'knockout' | 'enclosure';
    readonly partId: string;
    readonly targetPartIds: readonly string[];
}
export interface DesignNegativeSpace {
    readonly id: string;
    readonly kind: DesignNegativeSpaceKind;
    readonly minimum: number;
    readonly participants: readonly string[];
    readonly measurement: DesignNegativeSpaceMeasurement;
}
export interface DesignSpec {
    readonly version: 1;
    readonly anchors: readonly DesignAnchor[];
    readonly parts: readonly DesignPart[];
    readonly composition: DesignComposition;
    readonly decorators: readonly DesignDecorator[];
    readonly negativeSpace: readonly DesignNegativeSpace[];
}
export interface LoweredDesignSpec extends RecipeResult {
    readonly kind: 'design-spec';
    readonly parts: readonly LoweredDesignPart[];
    readonly composition: DesignComposition;
    readonly decorators: readonly DesignDecorator[];
    readonly anchors: Readonly<Record<string, NormalizedPoint>>;
    readonly specVersion: 1;
}
export interface LoweredDesignPart extends RecipePart {
    readonly anchor?: string;
    readonly morphGroup: string | null;
}
export interface CompileDesignSpecOptions<TIcon extends string = string> {
    readonly icon: TIcon;
    readonly variant?: 'outline' | 'filled';
    /** Размер SVG в px. */
    readonly size?: number;
}
export interface DesignSpecGlyph<TIcon extends string = string> extends GlyphIR<TIcon> {
    readonly provenance: DesignSpecGlyphProvenance;
    readonly designSpec: Readonly<{
        specVersion: 1;
        specSha256: `sha256:${string}`;
        anchors: LoweredDesignSpec['anchors'];
        decorators: LoweredDesignSpec['decorators'];
        negativeSpace: LoweredDesignSpec['negativeSpace'];
        topologyKey: string;
    }>;
}
export declare function parseDesignSpec(value: unknown): DesignSpec;
export declare function lowerDesignSpec(value: unknown): LoweredDesignSpec;
/** DesignSpec → GlyphIR. */
export declare function compileDesignSpec<TIcon extends string>(value: unknown, options: CompileDesignSpecOptions<TIcon>): DesignSpecGlyph<TIcon>;
export {};
