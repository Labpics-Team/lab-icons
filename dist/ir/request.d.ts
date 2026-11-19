import type { AxisContract, AxisName, IconVariant, SymbolOptions } from './glyph-types.js';
export type { SymbolOptions };
export type GlyphModelErrorCode = 'CANDIDATES_REQUIRED' | 'AUTHOR_PARITY_REQUIRED' | 'AUTHOR_VARIATION_UNSUPPORTED';
/** Потребитель проверяет code; сообщение не является машинным контрактом. */
export declare class GlyphModelError extends Error {
    readonly code: GlyphModelErrorCode;
    constructor(code: GlyphModelErrorCode, message: string);
}
export declare function parseSymbolVariant(value: unknown): IconVariant;
/** Общая граница запроса для полного каталога и предварительно собранного символа. */
export declare function parseSymbolOptions(value: unknown, contracts?: Readonly<Record<AxisName, AxisContract>>, authorVariation?: boolean): SymbolOptions;
