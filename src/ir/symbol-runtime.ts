import { GlyphModelError, parseSymbolOptions, parseSymbolVariant } from './request.js';
import type { AxisContract, AxisName, GlyphCapabilities, GlyphIR, GlyphRequest, IconId, IconVariant, ParsedGlyphRequest } from './compiler.js';

export type SymbolGlyphRequest = Omit<GlyphRequest, 'icon'>;

interface CompiledSymbolData {
  readonly icon: IconId;
  readonly axes: Readonly<Record<AxisName, AxisContract>>;
  readonly source: Readonly<Record<IconVariant, GlyphIR>>;
  readonly defaults: Readonly<Record<IconVariant, GlyphIR>>;
  readonly capabilities: Readonly<Record<IconVariant, GlyphCapabilities>>;
}

function freezeTree<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

/** @internal Сборка даёт только проверенные данные одного символа. */
export function createCompiledSymbol(
  input: CompiledSymbolData,
  compileAxes?: (request: ParsedGlyphRequest) => GlyphIR,
) {
  const data = freezeTree(input);

  function glyph(request?: SymbolGlyphRequest): GlyphIR {
    // Отсутствующий запрос — самый частый статический путь: без разбора,
    // geometry generation, хеширования и новых объектов на каждый render.
    if (request === undefined) return data.defaults.outline;
    const parsed = parseSymbolOptions(request, data.axes);
    const capabilities = data.capabilities[parsed.variant];
    if (parsed.modelMode === 'source-only') {
      if (Object.keys(parsed.axes).length) {
        throw new RangeError(`@labpics/icons/ir: ${data.icon}/${parsed.variant} не имеет разрешённой модели для осей ${Object.keys(parsed.axes).join(', ')}`);
      }
      return data.source[parsed.variant];
    }
    if (parsed.modelMode === 'allow-candidate' && capabilities.modelState === 'candidate') {
      throw new GlyphModelError('CANDIDATES_REQUIRED', `@labpics/icons/ir: candidate-модель ${data.icon}/${parsed.variant} требует регистрации через @labpics/icons/ir/candidates и полный ./ir`);
    }
    const requested = Object.keys(parsed.axes) as AxisName[];
    if (requested.length) {
      if (capabilities.modelState !== 'accepted') {
        throw new RangeError(`@labpics/icons/ir: ${data.icon}/${parsed.variant} не имеет разрешённой модели для осей ${requested.join(', ')}`);
      }
      for (const axis of requested) {
        if (!capabilities.supportedAxes.includes(axis)) {
          throw new RangeError(`@labpics/icons/ir: модель не поддерживает ось ${axis}`);
        }
      }
      if (requested.some(axis => parsed.axes[axis] !== data.axes[axis].default)) {
        if (!compileAxes) throw new Error(`@labpics/icons/ir: компилятор осей ${data.icon} отсутствует`);
        return compileAxes(Object.freeze({ icon: data.icon, ...parsed }));
      }
    }
    return data.defaults[parsed.variant];
  }

  function glyphCapabilities(variant: IconVariant = 'outline'): GlyphCapabilities {
    return data.capabilities[parseSymbolVariant(variant)];
  }

  return Object.freeze({ glyph, glyphCapabilities });
}
