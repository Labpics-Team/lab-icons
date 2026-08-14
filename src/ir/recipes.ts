/**
 * Публичные recipe-kernels. Их path — редактируемая centerline/primitive
 * геометрия; target compiler обязан expand stroke перед font/filled-SVG export.
 */

// @ts-ignore — zero-IO JS functional core; публичную границу типизируем здесь.
import * as operators from '../../scripts/lib/glyph-operators.js';
// @ts-ignore — zero-IO JS functional core; публичную границу типизируем здесь.
import * as calendar from '../../scripts/lib/calendar-geometry.js';

export interface NormalizedPoint {
  readonly x: number;
  readonly y: number;
}

export interface NormalizedBBox extends NormalizedPoint {
  readonly width: number;
  readonly height: number;
}

export interface ViewBoxBBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface RecipePathGeometry {
  readonly kind: 'path';
  readonly d: string;
}

export interface RecipeStrokePaint {
  readonly kind: 'stroke';
  readonly fill: 'none';
  readonly stroke: 'currentColor';
  readonly strokeWidth: number;
  readonly linecap: 'round' | 'butt';
  readonly linejoin: 'round';
}

export interface RecipeFillPaint {
  readonly kind: 'fill';
  readonly fill: 'currentColor';
}

export interface RecipePart {
  readonly id: string;
  readonly role: string;
  readonly geometry: RecipePathGeometry;
  readonly paint: RecipeStrokePaint | RecipeFillPaint;
  readonly bbox: Readonly<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  }>;
  readonly topologySignature: string;
  readonly angle?: number;
  readonly weld?: Readonly<{ to: string; at: NormalizedPoint }>;
}

export interface RecipeJoin {
  readonly id: string;
  readonly at: NormalizedPoint;
  readonly members: readonly string[];
  readonly lowering: 'expand-strokes-then-union';
}

export type NegativeSpaceKind = 'exterior-margin' | 'aperture' | 'gap' | 'knockout';

export type NegativeSpaceMeasurementMethod =
  | 'ink-bounds-to-canvas'
  | 'polyline-endpoint-distance-minus-stroke'
  | 'radial-farthest-corner-to-inner-stroke'
  | 'concentric-stroke-half-width-difference'
  | 'corner-to-ellipse-radial-distance'
  | 'radial-centerline-to-body-minus-half-stroke'
  | 'adjacent-inner-endpoint-chord-minus-stroke'
  | 'axis-aligned-group-bounds-separation'
  | 'horizontal-ink-bounds-separation';

/**
 * Успешный proof без boolean verdict: если measured ниже requiredMinimum,
 * recipe не возвращается и построение завершается RangeError.
 */
export interface NegativeSpaceConstraint {
  readonly unit: 'normalized-canvas';
  readonly kind: NegativeSpaceKind;
  readonly requiredMinimum: number;
  readonly measured: number;
  readonly measurementMethod: NegativeSpaceMeasurementMethod;
  readonly participants: readonly string[];
}

export interface NegativeSpaceContract {
  readonly constraints: readonly NegativeSpaceConstraint[];
}

export interface RecipeResult {
  readonly kind: string;
  readonly canvas: Readonly<NormalizedBBox>;
  readonly parts: readonly RecipePart[];
  readonly negativeSpace: NegativeSpaceContract;
  readonly metrics?: Readonly<Record<string, unknown>>;
  readonly topologyKey?: string;
  readonly joins?: readonly RecipeJoin[];
}

export interface OpticalOptions {
  readonly opsz?: number;
}

export interface OpticalLimits {
  readonly opsz: number;
  readonly minStroke: number;
  readonly minClearance: number;
  readonly minDetail: number;
  readonly raster: Readonly<{
    strokePixels: number;
    clearancePixels: number;
    detailPixels: number;
  }>;
}

export interface DirectionalOptions extends OpticalOptions {
  readonly orientation?: 'up' | 'down' | 'back' | 'forward';
  readonly center?: NormalizedPoint;
  readonly margin?: number;
  readonly weight?: number;
  readonly clearance?: number;
  readonly headLength?: number;
  readonly headSpan?: number;
}

export interface DirectionalArrowOptions extends DirectionalOptions {
  readonly shaftLength?: number;
}

export interface EnclosureOptions extends OpticalOptions {
  readonly contentKeyline: NormalizedBBox;
  readonly weight?: number;
  readonly clearance?: number;
  readonly margin?: number;
}

export interface StrikeOptions extends OpticalOptions {
  readonly targetBBox: NormalizedBBox;
  readonly weight?: number;
  readonly clearance?: number;
  readonly margin?: number;
  readonly overshoot?: number;
  readonly angle?: number;
}

export interface NotificationBadgeOptions extends OpticalOptions {
  readonly targetBBox: NormalizedBBox;
  readonly clearance?: number;
  readonly radius?: number;
  readonly margin?: number;
}

export interface RadialRaysOptions extends OpticalOptions {
  readonly weight?: number;
  readonly clearance?: number;
  readonly margin?: number;
  readonly center?: NormalizedPoint;
  readonly bodyRadius?: number;
  /** Дискретная topology: 4..16. */
  readonly count?: number;
  /** Непрерывная координата sun-low→sun: 0..1. */
  readonly length?: number;
  readonly rotation?: number;
}

export interface MusicalNoteOptions extends OpticalOptions {
  readonly id?: string;
  readonly weight?: number;
  readonly margin?: number;
  readonly headCenter?: NormalizedPoint;
  readonly headRadiusX?: number;
  readonly headRadiusY?: number;
  readonly headAngle?: number;
  readonly stemDirection?: 'up' | 'down';
  readonly stemLength?: number;
  readonly flag?: boolean;
}

export interface MusicalNotesItem extends MusicalNoteOptions {
  readonly id: string;
}

export interface MusicalNotesOptions extends Omit<MusicalNoteOptions, 'id' | 'headCenter' | 'flag'> {
  readonly notes: readonly MusicalNotesItem[];
  readonly beam?: boolean;
  readonly beamThickness?: number;
}

export const glyphOpszRange = operators.GLYPH_OPSZ_RANGE as Readonly<{
  min: 16;
  default: 24;
  max: 48;
}>;

export const glyphRasterPolicy = operators.GLYPH_RASTER_POLICY as Readonly<Record<string, unknown>>;
export const glyphOperatorTokens = operators.GLYPH_OPERATOR_TOKENS as Readonly<Record<string, unknown>>;
export const opticalLimits = operators.opticalLimits as (options?: OpticalOptions) => OpticalLimits;
export const buildDirectionalChevron = operators.buildDirectionalChevron as (
  options?: DirectionalOptions,
) => RecipeResult;
export const buildDirectionalArrow = operators.buildDirectionalArrow as (
  options?: DirectionalArrowOptions,
) => RecipeResult;
export const decorateCircleEnclosure = operators.decorateCircleEnclosure as (
  options: EnclosureOptions,
) => RecipeResult;
export const decorateStrike = operators.decorateStrike as (
  options: StrikeOptions,
) => RecipeResult & Readonly<{ masks: readonly unknown[]; compositionOrder: readonly string[] }>;
export const placeNotificationBadge = operators.placeNotificationBadge as (
  options: NotificationBadgeOptions,
) => RecipeResult;
export const generateRadialRays = operators.generateRadialRays as (
  options?: RadialRaysOptions,
) => RecipeResult;
export const buildMusicalNote = operators.buildMusicalNote as (
  options?: MusicalNoteOptions,
) => RecipeResult;
export const buildMusicalNotes = operators.buildMusicalNotes as (
  options: MusicalNotesOptions,
) => RecipeResult;

export type CalendarPrimitive =
  | Readonly<{ kind: 'move' | 'line'; x: number; y: number }>
  | Readonly<{
      kind: 'cubic';
      x1: number;
      y1: number;
      x2: number;
      y2: number;
      x: number;
      y: number;
    }>
  | Readonly<{ kind: 'close' }>;

export interface CalendarCell {
  readonly centerX: number;
  readonly centerY: number;
  readonly width: number;
  readonly height: number;
}

export interface RoundedDigitGeometry {
  readonly digit: number;
  readonly d: string;
  readonly primitives: readonly CalendarPrimitive[];
  readonly topologySignature: string;
  readonly advanceWidth: number;
  readonly cell: Readonly<CalendarCell>;
  readonly paint: Readonly<{
    fill: 'none';
    stroke: 'currentColor';
    strokeWidth: number;
    linecap: 'round';
    linejoin: 'round';
  }>;
  readonly axis: Readonly<{
    opsz: number;
    masterInterval: string;
    topologyStable: true;
  }>;
}

export interface CalendarDayInput {
  readonly date: Date;
  readonly timeZone: string;
}

export interface CalendarNumberInput extends CalendarDayInput {
  readonly opsz?: number;
  readonly aperture?: Readonly<ViewBoxBBox>;
}

export const calendarOpszRange = calendar.CALENDAR_OPSZ_RANGE as Readonly<{
  min: 16;
  default: 24;
  max: 48;
}>;
export const calendarCanvasSize = calendar.CALENDAR_CANVAS_SIZE as 24;
export const calendarApertureRatio = calendar.CALENDAR_APERTURE_RATIO as Readonly<ViewBoxBBox>;
export const defaultCalendarAperture = calendar.DEFAULT_CALENDAR_APERTURE as Readonly<ViewBoxBBox>;
export const roundedDigitGeometry = calendar.roundedDigitGeometry as (
  digit: number,
  options?: Readonly<{ opsz?: number; cell?: CalendarCell }>,
) => RoundedDigitGeometry;
export const resolveCalendarDay = calendar.resolveCalendarDay as (
  input: CalendarDayInput,
) => Readonly<{ day: number; epochMilliseconds: number; timeZone: string }>;
export const buildCalendarNumberGeometry = calendar.buildCalendarNumberGeometry as (
  input: CalendarNumberInput,
) => Readonly<{
  day: number;
  timeZone: string;
  epochMilliseconds: number;
  parts: readonly (RoundedDigitGeometry & Readonly<{
    id: 'calendar.date.tens' | 'calendar.date.ones';
    role: 'calendar-date-digit';
    slot: 'tens' | 'ones';
  }>)[];
  negativeSpace: NegativeSpaceContract;
  axis: Readonly<{
    opsz: number;
    masterInterval: string;
    topologyStableWithinInterval: true;
    profile: Readonly<Record<string, number>>;
  }>;
  layout: Readonly<Record<string, unknown>>;
}>;
