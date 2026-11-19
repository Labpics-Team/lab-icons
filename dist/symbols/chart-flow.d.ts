import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';
import type { IconSymbol } from '../render/index.js';
export declare const outline: string;
export declare const filled: string;
export declare const symbol: IconSymbol & Readonly<{ id: 'chart-flow' }>;
export default symbol;
export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'chart-flow'>;
export declare function glyphCapabilities(variant?: AuthorSourceCapabilities['variant']): AuthorSourceCapabilities<'chart-flow'>;
