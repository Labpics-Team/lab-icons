import type { StateRefusal, StateGroupCapabilities, StateRenderRequest, StateEffectRequest,
  StateTransitionExportRequest, SymbolStateEffect } from './types.js';
export type { StateSvgResult } from './types.js';

type Variant = 'outline' | 'filled';
export interface SourceStateRenderRequest<TVariant extends Variant = Variant> extends Omit<StateRenderRequest, 'variant'> {
  readonly variant?: TVariant;
}
export interface SourceStateEffectRequest<TVariant extends Variant = Variant> extends Omit<StateEffectRequest, 'variant'> {
  readonly variant?: TVariant;
}
export interface SourceStateTransitionExportRequest<TVariant extends Variant = Variant> extends Omit<StateTransitionExportRequest, 'variant'> {
  readonly variant?: TVariant;
}

/** Два самостоятельных авторских рисунка, без обещания совпадающей оболочки. */
export interface SourceSymbolStateEffect<TVariant extends Variant = Variant> extends Omit<SymbolStateEffect, 'kind' | 'variant'> {
  readonly kind: 'source-replacement';
  readonly variant: TVariant;
}
export type SourceStateEffectResult<TVariant extends Variant = Variant> = Readonly<{ ok: true; effect: SourceSymbolStateEffect<TVariant> }> | StateRefusal;

export interface SourceStateGroupCapabilities<TState extends string = string, TVariant extends Variant = Variant>
  extends Omit<StateGroupCapabilities<TState>, 'variant' | 'transition' | 'enclosurePartId' | 'proof'> {
  readonly variant: TVariant;
  readonly transition: 'source-replacement';
  readonly enclosurePartId: null;
  readonly proof: Omit<StateGroupCapabilities['proof'], 'law' | 'enclosureSha256'> & Readonly<{
    law: 'source.replace';
    enclosureSha256: null;
  }>;
}
