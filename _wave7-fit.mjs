// _wave7-fit.mjs — НЕТРЕКАЕМЫЙ фиттинг-харнесс Волны-7 (transfer/manipulate).
// Растровая методика прошлых волн: inkIoU(buildGlyph, рука) + координатный
// спуск по числовым координатам частей, отдельно на вариант. Удалить до merge.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGlyph } from './scripts/lib/anatomy-gen.js';
import { inkIoU } from './scripts/check-anatomy-drift.js';
import { renderedPathData } from './scripts/lib/icon-geometry.js';
import { samplePolylines } from './scripts/lib/curve-sampling.js';

const root = import.meta.dirname;
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const cw = grid.canvas.width;

export function hand(name, variant) {
  const f = variant === 'outline'
    ? join(root, 'svg', 'Outline', `${name}.svg`)
    : join(root, 'svg', 'Filled', `${name}_filled.svg`);
  return renderedPathData(readFileSync(f, 'utf8')).join('');
}

export function measure(entry, name, step = 0.12) {
  const built = buildGlyph(entry, grid);
  const out = {};
  for (const v of ['outline', 'filled']) {
    if (!entry.status?.[v]) continue;
    out[v] = inkIoU(built[v], hand(name, v), cw, step);
  }
  return out;
}

// EO≡NZ (как в test/wave5-arrows.test.js)
function inkBoth(polys, x, y) {
  let hits = 0, wind = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if (y1 > y !== y2 > y && x < x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)) {
        hits++;
        wind += y2 > y1 ? 1 : -1;
      }
    }
  }
  return [hits % 2 === 1, wind !== 0];
}
export function eoNzMismatch(pathData, step = 0.12) {
  const polys = samplePolylines(pathData, 24).filter((p) => p.length > 2);
  let mismatch = 0;
  for (let x = step / 2; x < cw; x += step) {
    for (let y = step / 2; y < cw; y += step) {
      const [eo, nz] = inkBoth(polys, x, y);
      if (eo !== nz) mismatch++;
    }
  }
  return mismatch;
}

/**
 * Координатный спуск по всем координатам points данного варианта.
 * refs: массив ссылок вида {arr, i} на числа (доли канвы) — мутируем на месте.
 * Шаги в ЮНИТАХ канвы (px при 24), сходимся уменьшением вдвое.
 */
export function optimizeVariant(entry, name, variant, opts = {}) {
  const { steps = [0.5, 0.25, 0.12, 0.06, 0.03], stepIoU = 0.12, frozen = new Set() } = opts;
  const handD = hand(name, variant);
  const refs = [];
  entry.parts.forEach((part, pi) => {
    const pts = part.params?.[variant]?.points;
    if (!pts) return;
    pts.forEach((pt, qi) => {
      for (const k of [0, 1]) {
        if (!frozen.has(`${pi}.${qi}.${k}`)) refs.push({ arr: pt, i: k });
      }
    });
  });
  const evalIoU = () => inkIoU(buildGlyph(entry, grid)[variant], handD, cw, stepIoU);
  let best = evalIoU();
  for (const st of steps) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const r of refs) {
        for (const dir of [1, -1]) {
          const old = r.arr[r.i];
          r.arr[r.i] = old + (dir * st) / cw;
          const iou = evalIoU();
          if (iou > best + 1e-6) { best = iou; improved = true; break; }
          r.arr[r.i] = old;
        }
      }
    }
  }
  return best;
}

export function q6(entry) {
  // q6-кванты: все доли — 6 знаков
  const walk = (o) => {
    if (Array.isArray(o)) o.forEach((v, i) => {
      if (typeof v === 'number') o[i] = Number(v.toFixed(6));
      else walk(v);
    });
    else if (o && typeof o === 'object') for (const k of Object.keys(o)) {
      if (typeof o[k] === 'number') o[k] = Number(o[k].toFixed(6));
      else walk(o[k]);
    }
  };
  walk(entry);
  return entry;
}

export function report(entry, name) {
  q6(entry);
  const m = measure(entry, name);
  const built = buildGlyph(entry, grid);
  const eo = {};
  for (const v of Object.keys(m)) eo[v] = eoNzMismatch(built[v]);
  console.log(name, JSON.stringify({
    iou: Object.fromEntries(Object.entries(m).map(([k, v]) => [k, +(v * 100).toFixed(2)])),
    eoNz: eo,
  }));
  return { m, eo };
}

export { grid, cw };
