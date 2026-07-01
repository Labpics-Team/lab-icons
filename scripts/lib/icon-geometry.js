/**
 * scripts/lib/icon-geometry.js — геометрия слоёв иконки из исходного SVG (zero-dep).
 *
 * Слой анимации = <path> в порядке следования в файле. Для каждого слоя
 * считаем точный bbox (lib/path-data.js) и якорь (центр bbox) — это
 * transform-origin слоя в системе viewBox (transform-box: fill-box даёт
 * тот же центр в рантайме; билд-тайм значение нужно гейтам и хореографии,
 * где якорь смещён семантически, напр. подвес колокольчика).
 */

import { pathBBox } from './path-data.js';

const VIEWBOX_RE = /viewBox="([\d.\s-]+)"/;
const PATH_D_RE = /<path\b[^>]*?\bd="([^"]+)"/g;

/**
 * @param {string} svgContent — содержимое .svg файла
 * @returns {{
 *   viewBox: {x:number, y:number, width:number, height:number},
 *   paths: Array<{ index:number, bbox:{minX:number,minY:number,maxX:number,maxY:number},
 *                  anchor:{x:number,y:number}, width:number, height:number, area:number }>
 * }}
 */
export function iconGeometry(svgContent) {
  const vb = VIEWBOX_RE.exec(svgContent);
  if (!vb) throw new Error('icon-geometry: viewBox не найден');
  const [x, y, width, height] = vb[1].trim().split(/\s+/).map(Number);
  if ([x, y, width, height].some((v) => !Number.isFinite(v))) {
    throw new Error(`icon-geometry: невалидный viewBox "${vb[1]}"`);
  }

  const paths = [];
  let index = 0;
  for (const m of svgContent.matchAll(PATH_D_RE)) {
    const bbox = pathBBox(m[1]);
    const w = bbox.maxX - bbox.minX;
    const h = bbox.maxY - bbox.minY;
    paths.push({
      index,
      bbox,
      anchor: { x: (bbox.minX + bbox.maxX) / 2, y: (bbox.minY + bbox.maxY) / 2 },
      width: w,
      height: h,
      area: w * h,
    });
    index++;
  }
  if (paths.length === 0) throw new Error('icon-geometry: в SVG нет <path>');
  return { viewBox: { x, y, width, height }, paths };
}
