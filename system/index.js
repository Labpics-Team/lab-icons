/**
 * system/index.js — публичный вход системы.
 *
 * Потребитель (labui и его клиенты) получает не набор файлов, а ФУНКЦИЮ от
 * осей. Магазин игрушек ставит крупное скругление и мягкое ζ, юридическая
 * контора — тонкое перо и острый угол, криптостартап — тяжёлый Bold: это одна
 * библиотека в разных начертаниях, а не три библиотеки.
 *
 *   import { icon, tokens, axes, names } from '@labpics/icons/system'
 *   icon('sun', { fill: 0, axes: { ray: 3.4 } })   → строка d
 *   svg('sun', { wght: 1.2 })                      → строка <svg>
 */

import { TOKENS, AXES, DERIVED, resolve, clampAxis, NOMINAL_CANVAS } from './tokens.js';
import { glyphs, buildGlyph, glyphNames, defaultAxes } from './registry.js';
import { toSvg } from './render.js';
import './glyphs/index.js';

export { TOKENS as tokens, AXES as axes, DERIVED as derived, resolve, clampAxis, NOMINAL_CANVAS };
export { glyphs, buildGlyph, toSvg };

/** Список объявленных имён. */
export const names = () => glyphNames();

/** Существует ли декларация. */
export const has = (name) => glyphs.has(name);

/**
 * Данные пути глифа.
 * @param {string} name
 * @param {{variant?:'outline'|'filled', canvas?:number, wght?:number,
 *          crnr?:number, rond?:number, axes?:Record<string,number>}} [opt]
 * @returns {string} значение атрибута d
 */
export function icon(name, opt = {}) {
  const { variant = 'outline', ...rest } = opt;
  return buildGlyph(name, variant, rest).toD();
}

/** Готовый файл SVG. */
export function svg(name, opt = {}) {
  const { variant = 'outline', ...rest } = opt;
  return toSvg(buildGlyph(name, variant, rest), rest.canvas ?? NOMINAL_CANVAS);
}

/**
 * Манифест системы: то, что потребителю нужно знать, чтобы построить
 * собственный интерфейс настройки, не читая исходники.
 */
export function manifest() {
  return {
    canvas: NOMINAL_CANVAS,
    tokens: TOKENS,
    globalAxes: AXES,
    glyphs: [...glyphs.values()].map((g) => ({
      name: g.name,
      family: g.family,
      law: g.law,
      argument: g.argument ?? null,
      variants: g.filled || g.deriveFilled !== 'none' ? ['outline', 'filled'] : ['outline'],
      axes: g.axes ?? null,
      defaults: defaultAxes(g),
    })),
  };
}
