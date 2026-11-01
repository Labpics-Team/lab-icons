import type { AuthorSourceProvenance } from '../ir/author-provenance.js';

export type StateRefusalCode =
  | 'INVALID_REQUEST'
  | 'STATE_UNSUPPORTED'
  | 'VARIANT_UNSUPPORTED'
  | 'FORMAT_UNSUPPORTED';

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
