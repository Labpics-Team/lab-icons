import type { AuthorSourceProvenance } from '../ir/author-provenance.js';

export type StateRefusalCode =
  | 'INVALID_REQUEST'
  | 'STATE_UNSUPPORTED'
  | 'VARIANT_UNSUPPORTED'
  | 'FORMAT_UNSUPPORTED'
  | 'VARIATION_UNSUPPORTED'
  | 'EFFECT_UNSUPPORTED'
  | 'POSE_UNREPRESENTABLE';

export interface StateRenderRequest {
  readonly variant?: 'outline' | 'filled';
}

export interface StateEffectRequest extends StateRenderRequest {
  readonly duration: number;
  readonly reducedMotion?: boolean;
}

export interface StateTransitionExportRequest extends StateEffectRequest {
  readonly format: 'web-effect' | 'lottie' | 'dotlottie' | 'sf-symbols';
}

export interface StateRefusal {
  readonly ok: false;
  readonly reason: Readonly<{ code: StateRefusalCode; message: string }>;
}

export type StateSvgResult = Readonly<{ ok: true; svg: string }> | StateRefusal;

/** Стандартные opacity-стадии; consumer связывает их с видимым началом. */
export interface SymbolStateEffect {
  readonly contract: 'labpics.symbol-state-effect/1';
  readonly version: 1;
  readonly kind: 'enclosure-replacement';
  readonly group: string;
  readonly variant: 'outline' | 'filled';
  readonly targetState: string;
  readonly stages: readonly Readonly<{
    partId: string;
    property: 'opacity';
    to: number;
    at: 0;
    duration: number;
  }>[];
  readonly unchangedPartIds: readonly string[];
  readonly options: Readonly<{ duration: number; easing: 'linear'; fill: 'both' }>;
}

export type StateEffectResult = Readonly<{ ok: true; effect: SymbolStateEffect }> | StateRefusal;

export interface StateGroupCapabilities<TState extends string = string> {
  readonly group: string;
  readonly variant: 'outline' | 'filled';
  readonly defaultState: TState;
  readonly transition: 'enclosure-replacement';
  readonly morph: 'unavailable';
  readonly enclosurePartId: string;
  readonly sharedPartIds: readonly string[];
  readonly states: readonly Readonly<{
    id: TState;
    partId: string;
    icon: string;
    contentPartIds: readonly string[];
    author: AuthorSourceProvenance;
  }>[];
  readonly formats: Readonly<{
    static: readonly ['svg'];
    transition: readonly ['web-effect'];
  }>;
  readonly proof: Readonly<{
    law: 'enclosure.replace';
    source: Readonly<{ fileKey: string; version: string }>;
    enclosureSha256: string;
    sharedPartsSha256: string;
    specSha256: string;
  }>;
}

export interface ContourStateRenderRequest extends StateRenderRequest {
  readonly variation?: Readonly<{ dotScale?: number; spacingScale?: number }>;
}
export interface ContourStateEffectRequest extends ContourStateRenderRequest {
  readonly duration: number;
  readonly from?: number;
  readonly reducedMotion?: boolean;
}
export interface ContourStateExportRequest extends ContourStateEffectRequest {
  readonly format: 'web-effect' | 'lottie' | 'dotlottie' | 'sf-symbols';
}

/** Численные operands проверенной закрытой topology; не произвольный SVG parser. */
export interface ContourStateTarget {
  readonly partId: string;
  readonly property: 'd';
  readonly commands: readonly ['M', 'C', 'C', 'C', 'C', 'Z'];
  readonly vectors: readonly [readonly number[], readonly number[]];
  /** Точные исходные строки, численно согласованные с vectors. */
  readonly endpoints: readonly [string, string];
}
export interface SymbolContourStateEffect {
  readonly contract: 'labpics.symbol-state-effect/1';
  readonly version: 1;
  readonly kind: 'contour-interpolation';
  readonly group: string;
  readonly variant: 'outline' | 'filled';
  readonly targetState: string;
  readonly from: number;
  readonly to: number;
  readonly targets: readonly ContourStateTarget[];
  readonly unchangedPartIds: readonly string[];
  readonly options: Readonly<{ duration: number; easing: 'linear'; fill: 'both' }>;
}
export type ContourStateEffectResult = Readonly<{ ok: true; effect: SymbolContourStateEffect }> | StateRefusal;
export type ContourStatePoseResult = Readonly<{ ok: true; parts: readonly Readonly<{ partId: string; d: string }>[] }> | StateRefusal;
/** Подготовка копирует данные; frame-путь только интерполирует и сериализует. */
export type PreparedContourStateEffect = Readonly<{ ok: true; sample(progress: number): ContourStatePoseResult }> | StateRefusal;

export interface ContourStateCapabilities<TState extends string = string> {
  readonly group: string;
  readonly variant: 'outline' | 'filled';
  readonly defaultState: TState;
  readonly transition: 'contour-interpolation';
  readonly morph: 'topology-proven';
  readonly partIds: readonly string[];
  readonly states: readonly Readonly<{ id: TState; icon: string; author: AuthorSourceProvenance }>[];
  readonly formats: Readonly<{ static: readonly ['svg']; transition: readonly ['web-effect'] }>;
  readonly variation: 'exact-default-only';
  readonly proof: Readonly<{
    law: 'dots.orient';
    source: Readonly<{ fileKey: string; version: string }>;
    specSha256: string;
    geometrySha256: string;
    topology: 'ordered-monotone-cardinal-quarters';
    interval: 'control-hull-disks';
    gridVersion: number;
    gridSha256: string;
    roundingUpper: Readonly<{ numerator: string; denominator: string }>;
    roundingNormUpper: Readonly<{ numerator: string; denominator: string }>;
    separation: readonly Readonly<{
      pair: readonly [string, string];
      minimumCenterDistanceSquared: Readonly<{ numerator: string; denominator: string }>;
      requiredDistanceSquared: Readonly<{ numerator: string; denominator: string }>;
    }>[];
  }>;
}
