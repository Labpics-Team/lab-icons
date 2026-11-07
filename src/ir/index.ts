/** Полный каталог — явный opt-in; для одного символа используйте ./symbols/<icon>. */
import * as staticIcons from '@labpics/icons';
import anatomy from '../../semantics/anatomy.runtime.json';
import catalog from '../../semantics/catalog.json';
import grid from '../../semantics/grid.json';
import { createGlyphCompilerSession, compileGlyph, readGlyphCapabilities,
  parseGlyphRequestValue, parseIconIdValue, checkIconId,
  registerCandidateAnatomyValue, compileCalendarNumberGlyph } from './compiler.js';
import type { GlyphCompiler } from './compiler.js';
import { ICON_IDS, AXIS_NAMES } from './catalog.generated.js';
export { GlyphModelError, sampleMotionGesture } from './compiler.js';
export type { IconId, AxisName, IconVariant, ModelMode, ModelState, FillRule, PartRole, GlyphRequest, ParsedGlyphRequest, SourcePartProvenance, ModelPartProvenance, RecipePartProvenance, PartProvenance, GlyphPart, SourceGlyphProvenance, ModelGlyphProvenance, RecipeGlyphProvenance, GlyphProvenance, GlyphIR, GlyphComposition, GlyphCapabilities, AxisContract, MotionCapabilityState, MotionGestureTrackContract, MotionGestureContract, MotionGestureSample, MotionTrackContract, MotionCapabilities, IconDesignContract, GlyphModelErrorCode, CalendarNumberGlyphInput } from './compiler.js';
if (Object.keys(catalog.icons).sort().join('\0') !== ICON_IDS.join('\0')) {
  throw new Error('@labpics/icons/ir: type-проекция IconId отстала от каталога');
}
if (Object.keys(catalog.axes).sort().join('\0') !== AXIS_NAMES.join('\0')) {
  throw new Error('@labpics/icons/ir: type-проекция AxisName отстала от каталога');
}
const runtime = createGlyphCompilerSession({ catalog, anatomy, grid, staticIcons });
// Один export замыкает только свой reader; весь фасад не удерживается объектом.
// Объявления удаляются обычным ESM tree shaking даже после сжатия комментариев.
export function glyph(request: Parameters<GlyphCompiler['glyph']>[0]): ReturnType<GlyphCompiler['glyph']> {
  return compileGlyph(runtime, request);
}
export function glyphCapabilities(iconValue: unknown, variantValue: unknown = 'outline'): ReturnType<GlyphCompiler['glyphCapabilities']> {
  return readGlyphCapabilities(runtime, iconValue, variantValue);
}
export function parseGlyphRequest(value: unknown): ReturnType<GlyphCompiler['parseGlyphRequest']> {
  return parseGlyphRequestValue(runtime, value);
}
export function parseIconId(value: unknown): ReturnType<GlyphCompiler['parseIconId']> {
  return parseIconIdValue(runtime, value);
}
export function isIconId(value: unknown): value is ReturnType<GlyphCompiler['parseIconId']> {
  return checkIconId(runtime, value);
}
/** @internal */
export function registerCandidateAnatomy(glyphs: Parameters<typeof registerCandidateAnatomyValue>[1], variants: Parameters<typeof registerCandidateAnatomyValue>[2]): void {
  registerCandidateAnatomyValue(runtime, glyphs, variants);
}
export function calendarNumberGlyph(input: Parameters<GlyphCompiler['calendarNumberGlyph']>[0]): ReturnType<GlyphCompiler['calendarNumberGlyph']> {
  return compileCalendarNumberGlyph(runtime, input);
}
export const iconIds: GlyphCompiler['iconIds'] = runtime.iconIds;
export const axisNames: GlyphCompiler['axisNames'] = runtime.axisNames;
export const axisContracts: GlyphCompiler['axisContracts'] = runtime.axisContracts;
export const iconDesignContract: GlyphCompiler['iconDesignContract'] = runtime.iconDesignContract;
