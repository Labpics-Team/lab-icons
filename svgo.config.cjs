// SVGO config for Lab Icons (CommonJS, works with type:module)
// - preserve viewBox (нужно для адаптивного размера через CSS width/height)
// - сжать числа координат с 5 знаков до 2 (визуально не отличить, файл -30-50%)
// - заменить хардкод #101012 на currentColor (цвет через CSS наследуется)
// - удалить мусор Figma (xmlns:xlink, ids, comments)
// - id-префикс по имени файла (M2, аудит 2026-07-03): иконки шипятся как
//   inline-SVG строки; Figma экспортирует одинаковый id="a" у clipPath —
//   на странице с несколькими иконками url(#a) резолвится в ПЕРВЫЙ #a
//   документа (чужой clipPath). prefixIds делает id уникальными per-icon;
//   cleanupIds.minify выключен, иначе multipass пере-минифицирует префикс
//   обратно в "a".
const { basename } = require('path');

module.exports = {
  multipass: true,
  floatPrecision: 2,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          // SVGO 4 больше не включает removeViewBox в preset-default.
          // Отсутствие отдельного plugin и есть fail-closed сохранение viewBox;
          // попытка override печатает 444 предупреждения и ничего не защищает.
          cleanupIds: { remove: true, minify: false },
          convertPathData: { floatPrecision: 2, transformPrecision: 2 },
        },
      },
    },
    'removeXMLNS',
    'removeDimensions',
    {
      name: 'convertColors',
      params: { currentColor: '#101012' },
    },
    {
      name: 'removeAttrs',
      params: { attrs: ['fill'] },
    },
    {
      name: 'prefixIds',
      params: {
        delim: '_',
        prefixClassNames: false,
        // 'timer_filled.svg' → id="timer_filled_a"; всё вне [\w-] вычищается
        // (id участвует в url(#…)-референсах).
        prefix: (_node, info) =>
          basename(info?.path ?? 'icon', '.svg').replace(/[^\w-]/g, '-'),
      },
    },
    {
      name: 'addAttributesToSVGElement',
      params: {
        attributes: [
          { xmlns: 'http://www.w3.org/2000/svg' },
          { viewBox: '0 0 24 24' },
          { width: '24' },
          { height: '24' },
          { fill: 'currentColor' },
        ],
      },
    },
  ],
};
