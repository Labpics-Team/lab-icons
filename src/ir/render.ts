import type { GlyphIR } from './compiler.js';

export interface GlyphSvgInstance {
  /** Уникальный в документе идентификатор задаёт владелец mounted instance. */
  readonly instanceId: string;
}

/**
 * Изолирует mask/clip ресурсы экземпляра, сохраняя семантические data-part.
 * Повторный символ может двигаться независимо от соседнего с той же геометрией.
 */
export function renderGlyphSvg(glyph: GlyphIR, options: GlyphSvgInstance): string {
  if (!options || typeof options.instanceId !== 'string' || !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(options.instanceId)) {
    throw new TypeError('@labpics/icons/ir/render: instanceId обязан быть безопасным уникальным идентификатором');
  }
  const resources = [...glyph.svg.matchAll(/(?<=\s)id="([^"\s]+)"/g)].map(match => match[1]);
  if (resources.length === 0) return glyph.svg;
  const mapping = new Map(resources.map(id => [id, `lab-symbol-${options.instanceId}-${id}`]));
  return glyph.svg
    .replace(/(?<=\s)id="([^"\s]+)"/g, (attribute, id: string) => `id="${mapping.get(id)}"`)
    .replace(/url\(#([^\s)]+)\)/g, (attribute, id: string) => mapping.has(id) ? `url(#${mapping.get(id)})` : attribute)
    .replace(/\b(href|xlink:href)="#([^"\s]+)"/g, (attribute, key: string, id: string) => mapping.has(id) ? `${key}="#${mapping.get(id)}"` : attribute);
}
