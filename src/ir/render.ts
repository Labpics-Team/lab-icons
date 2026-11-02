import type { GlyphIR } from './glyph-types.js';

export interface GlyphSvgInstance {
  /** Уникальный в документе идентификатор задаёт владелец mounted instance. */
  readonly instanceId: string;
}

type SvgPart = { readonly chunks: readonly string[] } | { readonly key: string; readonly id: readonly string[] };
type PreparedSvg =
  | { readonly source: string; readonly chunks: readonly string[] | null }
  | { readonly source: string; readonly parts: readonly SvgPart[]; readonly resources: ReadonlySet<string> };

// Подготовка живёт вместе с glyph; новый svg заменяет её, mounted строки не сохраняются.
const preparedGlyphs = new WeakMap<GlyphIR<string>, PreparedSvg>();

function prepareSvg(source: string): PreparedSvg {
  const ids = source.matchAll(/(?<=\s)id="([^"\s]+)"/g);
  const first = ids.next();
  if (first.done) return { source, chunks: null };
  const resources = new Set([first.value[1]!]);
  for (const match of ids) resources.add(match[1]!);
  const ordinals = new Set<string>();
  for (const match of source.matchAll(/lab-symbol-template-(0|[1-9][0-9]*)-/g)) ordinals.add(match[1]!);
  let ordinal = 0;
  while (ordinals.has(String(ordinal))) ordinal++;
  // Первый свободный номер ограничен числом совпадений в единственном проходе.
  const marker = `lab-symbol-template-${ordinal}-`;

  // Порядок прежних проходов важен: ID может сам содержать url(#другой-ID).
  const template = source
    .replace(/(?<=\s)id="([^"\s]+)"/g, (attribute, id: string) => `id="${marker}${id}"`)
    .replace(/url\(#([^\s)]+)\)/g, (attribute, id: string) => resources.has(id) ? `url(#${marker}${id})` : attribute);
  const parts: SvgPart[] = [];
  let literal = '';
  let offset = 0;
  for (const match of template.matchAll(/\b(href|xlink:href)="#([^"\s]+)"/g)) {
    const attribute = match[0];
    const key = match[1]!;
    const id = match[2]!;
    literal += template.slice(offset, match.index);
    if (id.includes(marker)) {
      // После url-прохода legacy href может совпасть с ID только в данном namespace.
      parts.push({ chunks: literal.split(marker) }, { key, id: id.split(marker) });
      literal = '';
    } else {
      literal += resources.has(id) ? `${key}="#${marker}${id}"` : attribute;
    }
    offset = match.index + attribute.length;
  }
  const chunks = (literal + template.slice(offset)).split(marker);
  if (parts.length === 0) return { source, chunks };
  parts.push({ chunks });
  return { source, parts, resources };
}

/**
 * Изолирует mask/clip ресурсы экземпляра, сохраняя семантические data-part.
 * Повторный символ может двигаться независимо от соседнего с той же геометрией.
 */
export function renderGlyphSvg(glyph: GlyphIR<string>, options: GlyphSvgInstance): string {
  if (!options || typeof options.instanceId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(options.instanceId)) {
    throw new TypeError('@labpics/icons/ir/render: instanceId обязан быть безопасным уникальным идентификатором');
  }
  const source = glyph.svg;
  let prepared = preparedGlyphs.get(glyph);
  if (!prepared || prepared.source !== source) {
    prepared = prepareSvg(source);
    preparedGlyphs.set(glyph, prepared);
  }
  if ('chunks' in prepared) {
    return prepared.chunks === null ? source : prepared.chunks.join(`lab-symbol-${options.instanceId}-`);
  }
  const prefix = `lab-symbol-${options.instanceId}-`;
  let svg = '';
  for (const part of prepared.parts) {
    if ('chunks' in part) {
      svg += part.chunks.join(prefix);
    } else {
      const id = part.id.join(prefix);
      svg += `${part.key}="#${prepared.resources.has(id) ? prefix + id : id}"`;
    }
  }
  return svg;
}
