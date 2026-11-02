import { GlyphModelError, parseSymbolOptions, parseSymbolVariant } from './request.js';
import type { GlyphCapabilities, GlyphIR, GlyphRequest, IconId, IconVariant, SymbolOptions } from './glyph-types.js';

export type SymbolGlyphRequest = Omit<GlyphRequest, 'icon'>;

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

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

/** @internal Сборка передаёт только проверенные авторские формы одного символа. */
export function createCompiledGlyph<TIcon extends string = IconId>(
  icon: TIcon,
  input: Readonly<Record<IconVariant, GlyphIR<TIcon>>>,
): (request?: SymbolGlyphRequest) => GlyphIR<TIcon> {
  const source = freezeTree(input);

  return function glyph(request?: SymbolGlyphRequest): GlyphIR<TIcon> {
    // Отсутствующий запрос — самый частый статический путь: без разбора,
    // geometry generation, хеширования и новых объектов на каждый render.
    if (request === undefined) return source.outline;
    const parsed = parseCompiledGlyphOptions(icon, request);
    return source[parsed.variant];
  };
}

/** @internal Потребитель возможностей не удерживает геометрию авторских форм. */
export function createCompiledCapabilities<TIcon extends string = IconId>(
  input: Readonly<Record<IconVariant, GlyphCapabilities<TIcon>>>,
): (variant?: IconVariant) => GlyphCapabilities<TIcon> {
  const capabilities = freezeTree(input);
  return function glyphCapabilities(variant?: IconVariant): GlyphCapabilities<TIcon> {
    return capabilities[parseSymbolVariant(variant === undefined ? 'outline' : variant)];
  };
}
