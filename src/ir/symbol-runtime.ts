import { GlyphModelError, parseSymbolOptions, parseSymbolVariant } from './request.js';
import type { GlyphCapabilities, GlyphIR, GlyphRequest, IconId, IconVariant } from './compiler.js';

export type SymbolGlyphRequest = Omit<GlyphRequest, 'icon'>;

interface CompiledSymbolData<TIcon extends string> {
  readonly icon: TIcon;
  readonly source: Readonly<Record<IconVariant, GlyphIR<TIcon>>>;
  readonly capabilities: Readonly<Record<IconVariant, GlyphCapabilities<TIcon>>>;
}

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

/** @internal Сборка даёт только проверенные данные одного символа. */
export function createCompiledSymbol<TIcon extends string = IconId>(
  input: CompiledSymbolData<TIcon>,
) {
  const data = freezeTree(input);

  function glyph(request?: SymbolGlyphRequest): GlyphIR<TIcon> {
    // Отсутствующий запрос — самый частый статический путь: без разбора,
    // geometry generation, хеширования и новых объектов на каждый render.
    if (request === undefined) return data.source.outline;
    const parsed = parseSymbolOptions(request);
    if (Object.keys(parsed.axes).length || parsed.modelMode === 'allow-candidate') {
      throw new GlyphModelError('AUTHOR_PARITY_REQUIRED',
        `@labpics/icons/symbols: ${data.icon}/${parsed.variant} сохраняет текущий авторский master; оси и candidate-модель требуют доказательства его паритета`);
    }
    return data.source[parsed.variant];
  }

  function glyphCapabilities(variant: IconVariant = 'outline'): GlyphCapabilities<TIcon> {
    return data.capabilities[parseSymbolVariant(variant)];
  }

  return Object.freeze({ glyph, glyphCapabilities });
}
