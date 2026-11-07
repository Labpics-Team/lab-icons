import type { SymbolEffect, SymbolEffectRefusalCode } from './index.js';
import type { AuthorSourceProvenance, AuthorAnatomyReceipt } from '../ir/author-provenance.js';

export interface MotionEffectRequest {
  readonly duration: number;
  readonly from?: number;
  readonly to?: number;
  readonly reducedMotion?: boolean;
  readonly variant?: 'outline' | 'filled';
}

export type MotionRefusal = Readonly<{ ok: false; reason: Readonly<{
  code: SymbolEffectRefusalCode | 'VARIANT_UNSUPPORTED'; message: string;
}> }>;
export type MotionEffectResult = Readonly<{ ok: true; effect: SymbolEffect }> | MotionRefusal;
export type MotionSvgResult = Readonly<{ ok: true; svg: string }> | MotionRefusal;
export interface MotionSymbolCapabilities {
  readonly icon: string;
  readonly variant: 'outline' | 'filled';
  readonly gestures: readonly Readonly<{ id: string; kind: 'cycle' | 'state'; meaning: string }>[];
  readonly formats: readonly ['svg', 'web-effect'];
  readonly author: AuthorSourceProvenance;
  readonly anatomy: AuthorAnatomyReceipt;
}
export type MotionCapabilitiesResult = Readonly<{ ok: true; capabilities: MotionSymbolCapabilities }> | MotionRefusal;
