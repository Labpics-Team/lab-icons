import type { GlyphIR } from './glyph-types.js';
export interface GlyphSvgInstance {
    /** Владелец экземпляра даёт уникальный в документе ID. */
    readonly instanceId: string;
}
/**
 * Изолирует mask/clip ресурсы экземпляра, сохраняя семантические data-part.
 * Повторный символ может двигаться независимо от соседнего с той же геометрией.
 */
export declare function renderGlyphSvg(glyph: GlyphIR<string>, options: GlyphSvgInstance): string;
