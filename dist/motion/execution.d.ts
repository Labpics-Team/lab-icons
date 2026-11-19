import type { SymbolEffect, SymbolSequenceEffect, SymbolTranslationEffect } from './index.js';
import type { PreparedContourStateEffect, SymbolContourStateEffect } from '../ir/contour-state-types.js';
import type { SymbolStateEffect } from '../ir/state-types.js';
import type { SourceSymbolStateEffect } from '../ir/source-state-types.js';
import type { IconSymbol, RenderIconOptions } from '../render/index.js';
import type { MountedIcon } from './symbol-state.js';

/** The common controls exposed by the public Lab Motion runtime. */
export interface SymbolPlayback {
  readonly finished: Promise<Readonly<{ status: 'finished' | 'stopped' }>>;
  readonly state: 'running' | 'paused' | 'finished' | 'stopped' | 'failed';
  readonly duration: number;
  pause(): void;
  play(): void;
  seek(milliseconds: number): void;
  finish(): void;
  stop(): void;
}
interface MotionOptions {
  readonly duration?: number;
  readonly ease?: 'linear';
  readonly reducedMotion?: 'always' | 'user';
}
type MotionProperties = Readonly<Record<string, number | readonly number[]>>;
type MotionStep = readonly [Element, MotionProperties, MotionOptions & { readonly at?: number }];
/** Structurally implemented by `import * as motion from '@labpics/motion'`. */
export interface SymbolMotionRuntime {
  animate(target: Element, properties: MotionProperties, options: MotionOptions): SymbolPlayback;
  sequence(steps: readonly MotionStep[], options: MotionOptions): SymbolPlayback;
  value(initial: number): {
    get(): number;
    subscribe(listener: (value: number) => void): () => void;
    animate(to: number, options: MotionOptions): SymbolPlayback;
    dispose(): void;
  };
}
export interface SymbolExecutionOptions {
  readonly initialize?: boolean;
  readonly preparedContour?: PreparedContourStateEffect;
  /** Last written pose, suitable for an interrupted successor. */
  readonly onProgress?: (progress: number) => void;
}
export interface SymbolScalarRequest {
  readonly from: number;
  readonly to: number;
  readonly duration: number;
  readonly reducedMotion: boolean;
}
interface ScalarPreparation<T> {
  readonly version: 1;
  readonly renderTarget: Readonly<{ selector: string; attribute: 'd' }>;
  sample(value: number): Readonly<{ ok: true; d: string } & T> |
    Readonly<{ ok: false; reason: Readonly<{ code: string; message: string }> }>;
}
export interface SymbolMotionExecutor {
  mount(root: Element, symbol: IconSymbol, options?: RenderIconOptions): MountedIcon;
  executeSymbolEffect(root: Element,
    effect: SymbolEffect | SymbolSequenceEffect | SymbolTranslationEffect | SymbolStateEffect |
      SourceSymbolStateEffect | SymbolContourStateEffect,
    options?: SymbolExecutionOptions): SymbolPlayback[];
  executePreparedWidth(roots: Element | readonly Element[],
    prepared: ScalarPreparation<{ bodyWidth: number }> & { readonly law: 'capsule.width' },
    request: SymbolScalarRequest, options?: Pick<SymbolExecutionOptions, 'onProgress'>): SymbolPlayback[];
  executePreparedClock(roots: Element | readonly Element[],
    prepared: ScalarPreparation<{ elapsedHours: number }> & {
      readonly law: 'joint.authored-elbow'; readonly parameter: 'elapsed-hours'; readonly reference: 'authored-pose';
    }, request: SymbolScalarRequest, options?: Pick<SymbolExecutionOptions, 'onProgress'>): SymbolPlayback[];
}
/** Creates no clocks or subscriptions until an effect is executed. */
export function createSymbolMotion(runtime: SymbolMotionRuntime): SymbolMotionExecutor;
