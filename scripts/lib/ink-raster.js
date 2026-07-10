/**
 * scripts/lib/ink-raster.js — детерминированный path-aware растр чернил.
 *
 * Почему отдельный модуль: SVG применяет fill-rule к каждому <path> отдельно,
 * затем объединяет визуальные чернила элементов. Конкатенация d-строк меняет
 * математику: перекрытие двух самостоятельных path ошибочно вырезается under
 * evenodd. Все видящие гейты должны пользоваться одной моделью рендера.
 */

import { renderedPathEntries } from './icon-geometry.js';
import { samplePolylines } from './curve-sampling.js';

const EPS = 1e-9;
export const DEFAULT_RASTER_PHASES = Object.freeze([
  Object.freeze([0.25, 0.25]),
  Object.freeze([0.75, 0.25]),
  Object.freeze([0.25, 0.75]),
  Object.freeze([0.75, 0.75]),
]);

function assertRasterOptions({ width, height, step, phaseX, phaseY }) {
  if (!(Number.isFinite(width) && width > 0)) throw new Error(`ink-raster: width должен быть > 0; найдено ${width}`);
  if (!(Number.isFinite(height) && height > 0)) throw new Error(`ink-raster: height должен быть > 0; найдено ${height}`);
  if (!(Number.isFinite(step) && step > 0)) throw new Error(`ink-raster: step должен быть > 0; найдено ${step}`);
  for (const [name, value] of [['phaseX', phaseX], ['phaseY', phaseY]]) {
    if (!(Number.isFinite(value) && value >= 0 && value < 1)) {
      throw new Error(`ink-raster: ${name} обязан быть в [0, 1); найдено ${value}`);
    }
  }
}

/** Пересечения горизонтальной scanline со всеми суб-путями одного SVG path. */
function crossingsAt(polys, y) {
  const crossings = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (!a || !b || a[1] === b[1]) continue;
      // Полуоткрытое правило по y не считает вершину дважды.
      if (!((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y))) continue;
      const x = a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0]);
      crossings.push({ x, winding: b[1] > a[1] ? 1 : -1 });
    }
  }
  crossings.sort((a, b) => a.x - b.x);
  return crossings;
}

/** Группировка совпадающих пересечений нужна для касаний и общих вершин. */
function crossingGroups(crossings) {
  const groups = [];
  for (const crossing of crossings) {
    const last = groups[groups.length - 1];
    if (last && Math.abs(last.x - crossing.x) <= EPS) {
      last.count++;
      last.winding += crossing.winding;
    } else {
      groups.push({ x: crossing.x, count: 1, winding: crossing.winding });
    }
  }
  return groups;
}

/** Интервалы чернил одного path на строке y под его собственным fill-rule. */
function inkIntervals(polys, y, fillRule) {
  const groups = crossingGroups(crossingsAt(polys, y));
  if (groups.length < 2) return [];

  const intervals = [];
  let state = 0;
  let previousX = groups[0].x;

  for (const group of groups) {
    const inside = fillRule === 'evenodd' ? state % 2 !== 0 : state !== 0;
    if (inside && group.x - previousX > EPS) intervals.push([previousX, group.x]);
    state = fillRule === 'evenodd' ? (state + group.count) % 2 : state + group.winding;
    previousX = group.x;
  }
  return intervals;
}

function paintIntervals(mask, row, cols, step, phaseX, intervals) {
  for (const [startX, endX] of intervals) {
    // Центры ровно на границе не считаем чернилами: boundary не имеет площади,
    // а четыре фазы ниже выявляют зависимость результата от квантования.
    const first = Math.max(0, Math.ceil(startX / step - phaseX + EPS));
    const afterLast = Math.min(cols, Math.ceil(endX / step - phaseX - EPS));
    for (let col = first; col < afterLast; col++) mask[row * cols + col] = 1;
  }
}

/**
 * Растеризация списка самостоятельных SVG path. Каждый path сначала получает
 * собственную маску по своему fill-rule, затем маски объединяются OR — как
 * source-over у одноцветных непрозрачных элементов.
 *
 * @param {Array<{d:string, fillRule?:'evenodd'|'nonzero'}>} entries
 * @returns {{mask:Uint8Array, cols:number, rows:number, step:number, phase:[number,number]}}
 */
export function rasterizePathEntries(
  entries,
  {
    width = 24,
    height = width,
    step = 0.12,
    phaseX = 0.5,
    phaseY = 0.5,
    stepsPerSeg = 24,
  } = {},
) {
  assertRasterOptions({ width, height, step, phaseX, phaseY });
  if (!Number.isInteger(stepsPerSeg) || stepsPerSeg < 1) {
    throw new Error(`ink-raster: stepsPerSeg обязан быть положительным целым; найдено ${stepsPerSeg}`);
  }

  const cols = Math.ceil(width / step);
  const rows = Math.ceil(height / step);
  const mask = new Uint8Array(cols * rows);
  const sampled = entries.map((entry, index) => {
    if (!entry || typeof entry.d !== 'string' || entry.d.trim() === '') {
      throw new Error(`ink-raster: path ${index} не несёт d`);
    }
    const fillRule = entry.fillRule === 'evenodd' ? 'evenodd' : 'nonzero';
    return {
      fillRule,
      polys: samplePolylines(entry.d, stepsPerSeg).filter((poly) => poly.length > 2),
    };
  });

  for (let row = 0; row < rows; row++) {
    const y = (row + phaseY) * step;
    if (y < 0 || y >= height) continue;
    for (const path of sampled) {
      paintIntervals(mask, row, cols, step, phaseX, inkIntervals(path.polys, y, path.fillRule));
    }
  }

  return { mask, cols, rows, step, phase: [phaseX, phaseY] };
}

/** Растр сырого SVG через единый parser renderedPathEntries(). */
export function rasterizeSvgInk(svgContent, options = {}) {
  return rasterizePathEntries(renderedPathEntries(svgContent), options);
}

function labelFeatures(mask, cols, rows, eightConnected) {
  const labels = new Int32Array(mask.length).fill(-1);
  const stack = new Int32Array(mask.length);
  const features = [];

  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    const id = features.length;
    let cells = 0;
    let touchesFrame = false;
    let top = 0;
    stack[top++] = start;
    labels[start] = id;

    while (top > 0) {
      const index = stack[--top];
      cells++;
      const row = Math.floor(index / cols);
      const col = index % cols;
      if (row === 0 || col === 0 || row === rows - 1 || col === cols - 1) touchesFrame = true;

      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (!eightConnected && dr !== 0 && dc !== 0) continue;
          const rr = row + dr;
          const cc = col + dc;
          if (rr < 0 || cc < 0 || rr >= rows || cc >= cols) continue;
          const next = rr * cols + cc;
          if (mask[next] && labels[next] === -1) {
            labels[next] = id;
            stack[top++] = next;
          }
        }
      }
    }
    features.push({ cells, touchesFrame });
  }
  return features;
}

/**
 * Цифровая топология: чернила 8-связны, негатив 4-связен. Двойственная
 * связность не позволяет диагональному касанию одновременно соединять оба слоя.
 */
export function topologyOfMask({ mask, cols, rows, step }) {
  if (!(mask instanceof Uint8Array) || mask.length !== cols * rows) {
    throw new Error('ink-raster: mask не согласован с cols×rows');
  }
  const cellArea = step * step;
  const components = labelFeatures(mask, cols, rows, true).map((feature) => feature.cells * cellArea);
  const negative = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) negative[i] = mask[i] ? 0 : 1;
  const holes = labelFeatures(negative, cols, rows, false)
    .filter((feature) => !feature.touchesFrame)
    .map((feature) => feature.cells * cellArea);
  return {
    components: components.sort((a, b) => b - a),
    holes: holes.sort((a, b) => b - a),
  };
}

export function topologyOfSvg(svgContent, options = {}) {
  return topologyOfMask(rasterizeSvgInk(svgContent, options));
}

export function significantTopology(topology, minFeatureArea = 0) {
  if (!(Number.isFinite(minFeatureArea) && minFeatureArea >= 0)) {
    throw new Error(`ink-raster: minFeatureArea обязан быть >= 0; найдено ${minFeatureArea}`);
  }
  return {
    components: topology.components.filter((area) => area >= minFeatureArea).length,
    holes: topology.holes.filter((area) => area >= minFeatureArea).length,
  };
}

/**
 * Один topology verdict недостаточен: узкая щель может попасть между центрами
 * клеток. Четыре фиксированные фазы превращают зависимость от растра в явный
 * дефект, а не случайный зелёный результат.
 */
export function topologyAcrossPhases(
  entries,
  { phases = DEFAULT_RASTER_PHASES, minFeatureArea = 0, ...rasterOptions } = {},
) {
  const samples = phases.map(([phaseX, phaseY]) => {
    const raster = rasterizePathEntries(entries, { ...rasterOptions, phaseX, phaseY });
    const topology = topologyOfMask(raster);
    return { phase: [phaseX, phaseY], topology, significant: significantTopology(topology, minFeatureArea) };
  });
  const signatures = samples.map(({ significant }) => `${significant.components}:${significant.holes}`);
  return {
    stable: signatures.every((signature) => signature === signatures[0]),
    signatures,
    samples,
  };
}
