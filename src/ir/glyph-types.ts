/** Данные Glyph IR доступны compiler, motion и экспортёрам без функций компиляции. */

import type { CatalogAxisName, CatalogIconId } from './catalog.generated.js';

import type { AuthorAnatomyReceipt, AuthorSourceProvenance } from './author-provenance.js';

import type { AuthorVariationCapability, AuthorVariationPartProvenance, AuthorVariationProvenance } from './authored-variation.js';
import type { AuthorAnnulusVariationCapability, AuthorAnnulusVariationPartProvenance, AuthorAnnulusVariationProvenance } from './author-annulus-types.js';

import type { RecipeFillPaint, RecipeStrokePaint } from './paint-types.js';

export type IconId = CatalogIconId;

export type AxisName = CatalogAxisName;

export type IconVariant = 'outline' | 'filled';

export type ModelMode = 'accepted-only' | 'allow-candidate' | 'source-only';

export type ModelState = 'accepted' | 'candidate';

export type FillRule = 'nonzero' | 'evenodd';

export type PartRole =
  | 'body'
  | 'content'
  | 'ink'
  | 'counter'
  | 'container'
  | 'control'
  | 'detail'
  | 'decorator'
  | 'unclassified';

export type AxisValues = Readonly<Partial<Record<AxisName, number>>>;

export interface SymbolOptions {
  readonly variant: IconVariant;
  readonly modelMode: ModelMode;
  readonly axes: AxisValues;
}

export interface GlyphRequest<TIcon extends string = IconId> {
  readonly icon: TIcon;
  readonly variant?: IconVariant;
  readonly modelMode?: ModelMode;
  readonly axes?: AxisValues;
}

export interface SourcePartProvenance {
  readonly kind: 'source';
  readonly identity: 'geometry-derived' | 'declared';
  readonly file: string;
  /** Fingerprint авторского source-path до build-оптимизации. */
  readonly sourceFingerprint: `sha256:${string}`;
  /** Fingerprint реально установленного root export после deterministic SVGO. */
  readonly artifactFingerprint: `sha256:${string}`;
}

export interface ModelPartProvenance {
  readonly kind: 'model';
  readonly identity: 'declared';
  readonly declaration: IconId;
  readonly state: ModelState;
}

export interface RecipePartProvenance {
  readonly kind: 'recipe';
  readonly identity: 'declared';
  readonly recipe: string;
  readonly sourceDependency?: IconId;
}

export type PartProvenance = SourcePartProvenance | ModelPartProvenance | RecipePartProvenance | AuthorVariationPartProvenance | AuthorAnnulusVariationPartProvenance;

export interface GlyphPart {
  readonly id: string;
  readonly role: PartRole;
  readonly zIndex: number;
  readonly d: string;
  /** null означает: часть имеет смысл только внутри GlyphIR.composition. */
  readonly fillRule: FillRule | null;
  readonly paint: RecipeFillPaint | RecipeStrokePaint;
  /** Нормализованный якорь в долях viewBox, а не экранные пиксели. */
  readonly anchor: readonly [number, number];
  readonly anchorSource: 'declared' | 'geometry-bbox-center';
  readonly topologySignature: string;
  readonly morphGroup: string | null;
  readonly provenance: PartProvenance;
}

export interface SourceGlyphProvenance {
  readonly kind: 'source';
  readonly file: string;
  readonly author?: AuthorSourceProvenance;
  readonly anatomy?: AuthorAnatomyReceipt;
}

export interface ModelGlyphProvenance {
  readonly kind: 'model';
  readonly declaration: IconId;
  readonly archetype: string;
  readonly state: ModelState;
  /** Эффективные значения только реально поддержанных моделью осей. */
  readonly axes: AxisValues;
}

export interface RecipeGlyphProvenance {
  readonly kind: 'recipe';
  readonly recipe: string;
  readonly state: 'candidate';
  readonly sourceDependencies: readonly IconId[];
  readonly axes: Readonly<{ opsz: number }>;
  readonly context: Readonly<{
    day: number;
    epochMilliseconds: number;
    timeZone: string;
  }>;
}

export interface DesignSpecGlyphProvenance {
  readonly kind: 'design-spec';
  readonly specVersion: 1;
  readonly specSha256: `sha256:${string}`;
  readonly state: 'candidate';
}

export type GlyphProvenance = SourceGlyphProvenance | ModelGlyphProvenance | RecipeGlyphProvenance | DesignSpecGlyphProvenance | AuthorVariationProvenance | AuthorAnnulusVariationProvenance;

export interface GlyphIR<TIcon extends string = IconId> {
  readonly icon: TIcon;
  readonly variant: IconVariant;
  readonly viewBox: readonly [number, number, number, number];
  readonly parts: readonly GlyphPart[];
  /** Удобная сборка геометрии; способ paint задаёт composition, не порядок parts. */
  readonly d: string;
  readonly svg: string;
  readonly composition: GlyphComposition;
  readonly provenance: GlyphProvenance;
}

export type GlyphComposition =
  | Readonly<{ kind: 'layers' }>
  | Readonly<{ kind: 'compound'; fillRule: FillRule }>
  | Readonly<{
      kind: 'mask-subtract';
      basePartIds: readonly string[];
      subtractPartIds: readonly string[];
    }>;

export interface GlyphCapabilities<TIcon extends string = IconId> {
  readonly icon: TIcon;
  readonly variant: IconVariant;
  readonly modelState: ModelState | null;
  readonly supportedAxes: readonly AxisName[];
  readonly axes: Readonly<Partial<Record<AxisName, AxisContract>>>;
  readonly motion: MotionCapabilities;
  readonly author?: AuthorSourceProvenance;
  readonly anatomy?: AuthorAnatomyReceipt;
  readonly variation?: AuthorVariationCapability | AuthorAnnulusVariationCapability;
}

export interface AxisContract {
  readonly kind: 'continuous';
  readonly min: number;
  readonly default: number;
  readonly max: number;
  readonly lifecycle: string;
}

export type MotionCapabilityState =
  | 'source-only'
  | 'candidate'
  | 'semantic-parts'
  | 'anchored-parts'
  | 'gesture-ready';

export interface MotionGestureRotationTrackContract {
  readonly partId: string;
  readonly kind: 'rotate';
  readonly anchor: readonly [number, number];
  readonly from: number;
  readonly to: number;
  readonly unit: 'degrees';
  readonly interpolation: 'linear';
}

export interface MotionGestureOpacityTrackContract {
  readonly partId: string;
  readonly kind: 'opacity';
  readonly unit: 'fraction';
  readonly interpolation: 'linear';
  readonly stops: readonly Readonly<{ at: number; value: number }>[];
}

export interface MotionGestureTranslationTrackContract {
  readonly partId: string;
  readonly kind: 'translate';
  readonly axis: 'x' | 'y';
  readonly unit: 'viewBox';
  readonly interpolation: 'linear';
  readonly stops: readonly Readonly<{ at: number; value: number }>[];
}

export type MotionGestureTrackContract = MotionGestureRotationTrackContract | MotionGestureOpacityTrackContract | MotionGestureTranslationTrackContract;

export interface MotionGestureContract {
  readonly id: string;
  readonly kind: string;
  readonly partIds: readonly string[];
  readonly meaning: string;
  readonly progress: 'normalized-0-to-1';
  /** Поза неподвижного мастера; отсутствие сохраняет прежний прогресс 0. */
  readonly restProgress?: number;
  readonly tracks: readonly MotionGestureTrackContract[];
}

export interface MotionGestureRotationSample {
  readonly partId: string;
  readonly kind: 'rotate';
  readonly anchor: readonly [number, number];
  readonly rotation: number;
}

export type MotionGestureSample = MotionGestureRotationSample |
  Readonly<{ partId: string; kind: 'opacity'; opacity: number }> |
  Readonly<{ partId: string; kind: 'translate'; axis: 'x' | 'y'; unit: 'viewBox'; translation: number }>;

export interface MotionRotationTrackContract {
  readonly id: string;
  readonly kind: 'rotate';
  readonly partIds: readonly string[];
  readonly anchor: readonly [number, number];
}

export type MotionTrackContract = MotionRotationTrackContract |
  Readonly<{ id: string; kind: 'opacity'; partIds: readonly string[] }> |
  Readonly<{ id: string; kind: 'translate'; partIds: readonly string[]; axis: 'x' | 'y'; unit: 'viewBox' }>;

export interface MotionCapabilities {
  readonly state: MotionCapabilityState;
  readonly partIds: readonly string[];
  readonly tracks: readonly MotionTrackContract[];
  readonly gestures: readonly MotionGestureContract[];
  readonly adapters: Readonly<{
    readonly lottie: 'not-exported' | 'lottie-web-svg-5.13';
    readonly sfSymbols: 'not-exported';
  }>;
}
