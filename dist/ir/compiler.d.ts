/**
 * Публичный Glyph IR: строгая граница между точным SVG-источником и
 * доказанной параметрической моделью. Модуль не читает файлы, часы и DOM:
 * все данные попадают в браузер как статические импорты сборщика.
 */
import { type CalendarNumberInput } from './recipes.js';
import type * as IR from './glyph-types.js';
export type { IconId, AxisName, IconVariant, ModelMode, ModelState, FillRule, PartRole, GlyphRequest, SourcePartProvenance, ModelPartProvenance, RecipePartProvenance, PartProvenance, GlyphPart, SourceGlyphProvenance, ModelGlyphProvenance, RecipeGlyphProvenance, DesignSpecGlyphProvenance, GlyphProvenance, GlyphIR, GlyphComposition, GlyphCapabilities, AxisContract, MotionCapabilityState, MotionGestureRotationTrackContract, MotionGestureOpacityTrackContract, MotionGestureTranslationTrackContract, MotionGestureTrackContract, MotionGestureContract, MotionGestureRotationSample, MotionGestureSample, MotionRotationTrackContract, MotionTrackContract, MotionCapabilities } from './glyph-types.js';
export { GlyphModelError } from './request.js';
export type { GlyphModelErrorCode } from './request.js';
export interface ParsedGlyphRequest<TIcon extends string = IR.IconId> {
    readonly icon: TIcon;
    readonly variant: IR.IconVariant;
    readonly modelMode: IR.ModelMode;
    readonly axes: IR.AxisValues;
}
export declare function sampleMotionGesture(gesture: IR.MotionGestureContract, progress: number): readonly IR.MotionGestureSample[];
export interface IconDesignContract {
    readonly version: 1;
    readonly canvas: Readonly<{
        readonly viewBox: readonly [number, number, number, number];
        readonly declarationUnits: 'fraction-of-canvas';
    }>;
    readonly variants: readonly IR.IconVariant[];
    readonly source: Readonly<{
        readonly paint: 'currentColor';
        readonly geometry: 'path-only';
        readonly intake: 'figma-import';
    }>;
    readonly constraints: Readonly<{
        readonly margin: number;
        readonly clearanceMin: number;
        readonly opticalCenterBias: number;
        readonly angleScale: readonly number[];
    }>;
    readonly axes: Readonly<Record<IR.AxisName, IR.AxisContract>>;
    readonly lifecycle: Readonly<{
        readonly sourceOnly: 'exact-source-fallback';
        readonly candidate: 'research-only';
        readonly accepted: 'public-after-proof';
    }>;
    readonly targets: Readonly<{
        readonly staticSvg: 'supported';
        readonly glyphIr: 'supported';
        readonly lottie: 'not-exported';
        readonly sfSymbols: 'not-exported';
    }>;
    readonly agent: Readonly<{
        readonly proposalCommand: 'pnpm validate:proposal';
        readonly promotionCommand: 'pnpm import:figma --write';
        readonly finalGate: 'pnpm verify';
    }>;
}
export interface CalendarNumberGlyphInput extends Omit<CalendarNumberInput, 'aperture'> {
    readonly variant?: IR.IconVariant;
}
/** Контракт значений runtime; constructor и его входные данные остаются внутренними. */
export interface GlyphCompiler {
    readonly glyph: (request: IR.GlyphRequest) => IR.GlyphIR;
    readonly glyphCapabilities: (iconValue: unknown, variantValue?: unknown) => IR.GlyphCapabilities;
    readonly parseGlyphRequest: (value: unknown) => ParsedGlyphRequest;
    readonly parseIconId: (value: unknown) => IR.IconId;
    readonly isIconId: (value: unknown) => value is IR.IconId;
    readonly calendarNumberGlyph: (input: CalendarNumberGlyphInput) => IR.GlyphIR;
    readonly iconIds: readonly IR.IconId[];
    readonly axisNames: readonly IR.AxisName[];
    readonly axisContracts: Readonly<Record<IR.AxisName, IR.AxisContract>>;
    readonly iconDesignContract: IconDesignContract;
}
declare const sessionIdentity: unique symbol;
/** Entry point видит только опубликованные снимки, а не устройство реестра. */
interface GlyphCompilerSession extends Pick<GlyphCompiler, 'iconIds' | 'axisNames' | 'axisContracts' | 'iconDesignContract'> {
    readonly [sessionIdentity]: true;
}
export declare function checkIconId(context: GlyphCompilerSession, value: unknown): value is IR.IconId;
export declare function parseIconIdValue(context: GlyphCompilerSession, value: unknown): IR.IconId;
/**
 * Единственная граница для недоверенного JSON/DOM-ввода. После неё неверные
 * variant/modelMode/axes уже не представлены в функциональном ядре.
 */
export declare function parseGlyphRequestValue(context: GlyphCompilerSession, value: unknown): ParsedGlyphRequest;
/**
 * Динамический calendar-number: точная shell-геометрия корпуса + собственные
 * tabular digits. Функция ничего не планирует и не читает часы сама.
 */
export declare function compileCalendarNumberGlyph(context: GlyphCompilerSession, input: CalendarNumberGlyphInput): IR.GlyphIR;
