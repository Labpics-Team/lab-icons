import { GlyphModelError, parseSymbolOptions } from './request.js';
import type { SymbolOptions } from './glyph-types.js';

/** @internal Законы разбирают исходный запрос; getters сохраняют receiver. */
export function parseCompiledGlyphOptions(icon: string, request: unknown, authorVariation = false): SymbolOptions {
  if (!authorVariation && request && typeof request === 'object' && Object.hasOwn(request, 'variation')) {
    throw new GlyphModelError('AUTHOR_VARIATION_UNSUPPORTED',
      `@labpics/icons/symbols: ${icon}: авторская геометрическая вариация не объявлена`);
  }
  const parsed = parseSymbolOptions(request, undefined, authorVariation);
  if (Object.keys(parsed.axes).length || parsed.modelMode === 'allow-candidate') {
    throw new GlyphModelError('AUTHOR_PARITY_REQUIRED',
      `@labpics/icons/symbols: ${icon}/${parsed.variant}: требуется паритет с авторским master`);
  }
  return parsed;
}
