/**
 * scripts/lib/motion-scan.js — покадровый прогон per-icon анимации (BL-006).
 *
 * Воспроизводит модель рантайма на чистых данных: слои из svg-файла
 * (полилинии суб-путей), части из генерата (кейфреймы + delay + стаггер),
 * равномерная сетка времени по всей длительности. Потребители: гейты
 * check-motion-bounds (вылет за канву) и check-motion-collision (наслоения).
 */

import { parseTransformString, samplePolylines, transformAt, transformPoint } from './motion-geometry.js';

const VIEWBOX_RE = /viewBox="([\d.\s-]+)"/;
const PATH_D_RE = /<path\b[^>]*?\bd="([^"]+)"/g;

/**
 * @param {{parts: Array<any>}} entry — запись иконки/варианта из генерата
 * @param {string} svgContent
 * @param {{stepsPerSeg?: number, samples?: number}} [opts]
 * @returns {{
 *   viewBox: {x:number,y:number,width:number,height:number},
 *   rest: Array<Array<Array<[number,number]>>>,
 *   frames: Array<{tMs:number, layers: Array<{
 *     index:number, polys:Array<Array<[number,number]>>,
 *     moving:boolean, partIdx:number, delayMs:number }>}>,
 * }}
 */
export function scanEntry(entry, svgContent, { stepsPerSeg = 4, samples = 48 } = {}) {
  const vb = VIEWBOX_RE.exec(svgContent);
  if (!vb) throw new Error('motion-scan: viewBox не найден');
  const [x, y, width, height] = vb[1].trim().split(/\s+/).map(Number);

  const rest = [...svgContent.matchAll(PATH_D_RE)].map((m) => samplePolylines(m[1], stepsPerSeg));

  /** @type {Map<number, {part:any, delayMs:number, partIdx:number}>} */
  const assign = new Map();
  entry.parts.forEach((part, partIdx) => {
    part.paths.forEach((idx, i) => {
      assign.set(idx, { part, delayMs: (part.staggerGapMs ?? 0) * i, partIdx });
    });
  });

  let totalMs = 0;
  for (const { part, delayMs } of assign.values()) {
    totalMs = Math.max(totalMs, part.timing.delay + delayMs + part.timing.duration);
  }

  const frames = [];
  for (let s = 0; s <= samples; s++) {
    const tMs = (totalMs * s) / samples;
    const layers = rest.map((polys, index) => {
      const a = assign.get(index);
      if (!a) return { index, polys, moving: false, partIdx: -1, delayMs: 0 };
      const fns = transformAt(a.part, tMs, a.delayMs);
      const anchor = a.part.anchor;
      const moved = polys.map((poly) => poly.map((p) => transformPoint(p, fns, anchor)));
      return { index, polys: moved, moving: true, partIdx: a.partIdx, delayMs: a.delayMs };
    });
    frames.push({ tMs, layers });
  }
  return { viewBox: { x, y, width, height }, rest, frames };
}

/** Итератор по всем записям генерата: (name, variant, entry). */
export function* generatedEntries(generated) {
  for (const [name, variants] of Object.entries(generated.icons ?? {})) {
    for (const [variant, entry] of Object.entries(variants)) {
      yield { name, variant, entry };
    }
  }
}

export { parseTransformString };
