// SVGO config for Lab Icons (CommonJS, works with type:module)
// - preserve viewBox (нужно для адаптивного размера через CSS width/height)
// - сжать числа координат с 5 знаков до 2 (визуально не отличить, файл -30-50%)
// - заменить хардкод #101012 на currentColor (цвет через CSS наследуется)
// - удалить мусор Figma (xmlns:xlink, ids, comments)
module.exports = {
  multipass: true,
  floatPrecision: 2,
  plugins: [
    {
      name: 'preset-default',
      params: {
        overrides: {
          removeViewBox: false,
          cleanupIds: { remove: true },
          convertPathData: { floatPrecision: 2, transformPrecision: 2 },
        },
      },
    },
    'removeXMLNS',
    'removeDimensions',
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
    {
      name: 'convertColors',
      params: { currentColor: '#101012' },
    },
    {
      name: 'removeAttrs',
      params: { attrs: ['fill'] },
    },
  ],
};
