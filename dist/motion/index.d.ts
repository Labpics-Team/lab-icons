import type { GlyphCapabilities, GlyphIR } from '../ir/glyph-types.js';
import type { PreparedContourStateEffect, SymbolContourStateEffect } from '../ir/contour-state-types.js';
export { createSymbolMotion } from './execution.js';
export type { MountedIcon, IconEffectOptions, IconTransitionOptions } from './symbol-state.js';
export type { SymbolMotionRuntime, SymbolMotionExecutor, SymbolPlayback, SymbolExecutionOptions, SymbolScalarRequest } from './execution.js';
export type { SymbolContourStateEffect, PreparedContourStateEffect, ContourStatePoseResult } from '../ir/contour-state-types.js';
/** Подготовка контура без каталога и часов. */
export declare function prepareContourStateEffect(effect: SymbolContourStateEffect): PreparedContourStateEffect;
export type SymbolEffectRefusalCode = 'INVALID_REQUEST' | 'CAPABILITY_MISMATCH' | 'SEMANTIC_MOTION_UNAVAILABLE' | 'GESTURE_UNSUPPORTED' | 'INVALID_GESTURE' | 'COMPOSITION_NOT_ADDRESSABLE';
export interface SymbolEffectRequest {
    readonly duration: number;
    readonly from?: number;
    readonly to?: number;
    readonly reducedMotion?: boolean;
}
export interface SymbolEffectTarget {
    readonly partId: string;
    readonly rotation: Readonly<{
        from: number;
        to: number;
        unit: 'degrees';
    }>;
    readonly style: Readonly<{
        transformBox: 'view-box';
        transformOrigin: string;
    }>;
    readonly keyframes: readonly [
        Readonly<{
            offset: 0;
            transform: string;
        }>,
        Readonly<{
            offset: 1;
            transform: string;
        }>
    ];
}
export interface SymbolEffect {
    readonly version: 1;
    readonly icon: string;
    readonly variant: GlyphIR['variant'];
    readonly gesture: string;
    readonly from: number;
    readonly to: number;
    readonly targets: readonly SymbolEffectTarget[];
    readonly unchangedPartIds: readonly string[];
    /** Форма может выходить за viewBox при движении. */
    readonly viewport: Readonly<{
        overflow: 'visible';
    }>;
    readonly options: Readonly<{
        duration: number;
        easing: 'linear';
        fill: 'both';
    }>;
}
export interface SymbolOpacityStage {
    readonly partId: string;
    readonly property: 'opacity';
    /** Первый этап подхватывает текущую позу. */
    readonly to: number;
    /** От начала эффекта, мс. */
    readonly at: number;
    readonly duration: number;
}
export interface SymbolSequenceEffect {
    readonly version: 2;
    readonly icon: string;
    readonly variant: GlyphIR['variant'];
    readonly gesture: string;
    readonly from: number;
    readonly to: number;
    readonly targets: readonly Readonly<{
        partId: string;
        property: 'opacity';
        from: number;
        to: number;
    }>[];
    readonly stages: readonly SymbolOpacityStage[];
    readonly unchangedPartIds: readonly string[];
    readonly viewport: Readonly<{
        overflow: 'visible';
    }>;
    readonly options: Readonly<{
        duration: number;
        easing: 'linear';
        fill: 'both';
    }>;
}
export interface SymbolTranslationStage {
    readonly partId: string;
    readonly property: 'x' | 'y';
    readonly unit: 'viewBox';
    readonly to: number;
    readonly at: number;
    readonly duration: number;
}
export interface SymbolTranslationEffect {
    readonly version: 3;
    readonly icon: string;
    readonly variant: GlyphIR['variant'];
    readonly gesture: string;
    readonly from: number;
    readonly to: number;
    readonly targets: readonly Readonly<{
        partId: string;
        property: 'x' | 'y';
        unit: 'viewBox';
        from: number;
        to: number;
    }>[];
    readonly stages: readonly SymbolTranslationStage[];
    readonly unchangedPartIds: readonly string[];
    readonly viewport: Readonly<{
        overflow: 'visible';
    }>;
    readonly options: Readonly<{
        duration: number;
        easing: 'linear';
        fill: 'both';
    }>;
}
export type SymbolEffectResult = Readonly<{
    ok: true;
    effect: SymbolEffect | SymbolSequenceEffect | SymbolTranslationEffect;
}> | Readonly<{
    ok: false;
    reason: Readonly<{
        code: SymbolEffectRefusalCode;
        message: string;
    }>;
}>;
/**
 * Компилирует объявленный жест в обычные keyframes без каталога и разбора path.
 * from задаёт уже видимый прогресс: прерывание не возвращает символ к началу.
 */
export declare function compileSymbolEffect(glyph: GlyphIR<string>, capabilities: GlyphCapabilities<string>, gestureId: string, request: SymbolEffectRequest): SymbolEffectResult;
