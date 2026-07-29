/**
 * system/render.js — путь → файл.
 *
 * Один <path>, fill-rule по умолчанию (nonzero), дырки развёрнуты. Ни одного
 * цветового атрибута: чернила наследуются от контекста (currentColor у
 * потребителя). Ни одной группы, ни одной трансформации — трансформация в
 * файле означала бы, что геометрия не досчитана.
 */

const HEAD = '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">';

/** @param {import('./core/path.js').Path} path */
export function toSvg(path, canvas = 24) {
  const d = path.toD();
  const head =
    canvas === 24
      ? HEAD
      : `<svg viewBox="0 0 ${canvas} ${canvas}" xmlns="http://www.w3.org/2000/svg" width="${canvas}" height="${canvas}">`;
  return `${head}<path d="${d}"/></svg>`;
}

/**
 * Скелет глифа в машинночитаемом виде — для анимации.
 * Экспортируется отдельно от файла: в SVG ему делать нечего, а lab-motion без
 * него вынужден угадывать оси обратно из контура.
 */
export function skeleton(parts) {
  return parts.map((p) => ({
    id: p.id,
    kind: p.kind,
    pivot: p.pivot ?? null,
    axis: p.axis ?? null,
    /** Параметр, по которому часть «растёт» (луч, хвост стрелки, стрелка часов). */
    grow: p.grow ?? null,
  }));
}
