/** Полный каталог — явный opt-in; для одного символа используйте ./symbols/<icon>. */
import * as staticIcons from '@labpics/icons';
import anatomy from '../../semantics/anatomy.runtime.json';
import catalog from '../../semantics/catalog.json';
import grid from '../../semantics/grid.json';
import { createGlyphCompiler } from './compiler.js';
import { ICON_IDS, AXIS_NAMES } from './catalog.generated.js';
export { GlyphModelError, sampleMotionGesture } from './compiler.js';
export type { IconId, AxisName, IconVariant, ModelMode, ModelState, FillRule, PartRole, GlyphRequest, ParsedGlyphRequest, SourcePartProvenance, ModelPartProvenance, RecipePartProvenance, PartProvenance, GlyphPart, SourceGlyphProvenance, ModelGlyphProvenance, RecipeGlyphProvenance, GlyphProvenance, GlyphIR, GlyphComposition, GlyphCapabilities, AxisContract, MotionCapabilityState, MotionGestureTrackContract, MotionGestureContract, MotionGestureSample, MotionTrackContract, MotionCapabilities, IconDesignContract, GlyphModelErrorCode, CalendarNumberGlyphInput } from './compiler.js';
if (Object.keys(catalog.icons).sort().join('\0') !== ICON_IDS.join('\0')) {
  throw new Error('@labpics/icons/ir: type-проекция IconId отстала от каталога');
}
if (Object.keys(catalog.axes).sort().join('\0') !== AXIS_NAMES.join('\0')) {
  throw new Error('@labpics/icons/ir: type-проекция AxisName отстала от каталога');
}
const runtime = createGlyphCompiler({ catalog, anatomy, grid, staticIcons });
export const glyph = runtime.glyph;
export const glyphCapabilities = runtime.glyphCapabilities;
export const parseGlyphRequest = runtime.parseGlyphRequest;
export const parseIconId = runtime.parseIconId;
export const isIconId = runtime.isIconId;
/** @internal */
export const registerCandidateAnatomy = runtime.registerCandidateAnatomy;
export const calendarNumberGlyph = runtime.calendarNumberGlyph;
export const iconIds = runtime.iconIds;
export const axisNames = runtime.axisNames;
export const axisContracts = runtime.axisContracts;
export const iconDesignContract = runtime.iconDesignContract;
