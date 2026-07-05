/**
 * test/wave5-arrows.test.js — per-icon гейты Волны-5 (WAVE5-COMPOSITE-PREP):
 * стрелковая семья ×6 (arrow-up/down/back/forward, swap-horizontal/vertical),
 * composite stroke-path (head 3т + shaft 2т, стык тангенс-солвером БЕЗ
 * перекрытия — отсюда адресный EO≡NZ-ассерт).
 *
 * Полы = замер 2026-07-08 (шаг 0.12) минус ε≈0.2 п.п. (шум сетки), зазор
 * ≤0.3 п.п.; все иконки hand (максимум 98.54% < промоушен-порога 0.995:
 * апекс руки ζ-сглажен, генерат даёт круглый стык R=перо/2 — прецедент
 * Волны-2). Чтение ТОЛЬКО через buildGlyph — без захардкоженных контуров.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { inkIoU } from '../scripts/check-anatomy-drift.js';
import { samplePolylines } from '../scripts/lib/curve-sampling.js';
import { renderedPathData } from '../scripts/lib/icon-geometry.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
const cw = grid.canvas.width;

// Пер-иконные полы: замер (outline/filled) −0.2 п.п.
const FLOORS = {
  'arrow-up': { outline: 0.9833, filled: 0.9828 }, // замер .9853/.9848
  'arrow-down': { outline: 0.983, filled: 0.9821 }, // замер .9850/.9841
  'arrow-back': { outline: 0.9801, filled: 0.9825 }, // замер .9821/.9845
  'arrow-forward': { outline: 0.9811, filled: 0.9823 }, // замер .9831/.9843
  'swap-horizontal': { outline: 0.9805, filled: 0.9798 }, // замер .9825/.9818
  'swap-vertical': { outline: 0.9807, filled: 0.9805 }, // замер .9827/.9825
};

function handFile(name, variant) {
  return variant === 'outline'
    ? join(root, 'svg', 'Outline', `${name}.svg`)
    : join(root, 'svg', 'Filled', `${name}_filled.svg`);
}

/** Чернила под evenodd и nonzero за один проход (как в wave4-ring.test.js). */
function inkBoth(polys, x, y) {
  let hits = 0;
  let wind = 0;
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

function eoNzMismatch(pathData, step) {
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

describe('wave5-arrows — стрелковая семья: пер-иконный IoU-пол', () => {
  for (const [name, floors] of Object.entries(FLOORS)) {
    it(`${name}: IoU против рук не ниже замороженного пола`, () => {
      const entry = anatomy.glyphs[name];
      expect(entry, `${name} задекларирован в semantics/anatomy.json`).toBeTruthy();
      const built = buildGlyph(entry, grid);
      for (const [variant, floor] of Object.entries(floors)) {
        expect(entry.status?.[variant], `${name}/${variant} имеет status`).toBeTruthy();
        const hand = renderedPathData(readFileSync(handFile(name, variant), 'utf8')).join('');
        const iou = inkIoU(built[variant], hand, cw);
        console.log(`${name}/${variant}: IoU=${(iou * 100).toFixed(2)}% (пол ${(floor * 100).toFixed(2)}%)`);
        expect(iou, `${name}/${variant}: пол characterization`).toBeGreaterThanOrEqual(floor);
        expect(iou, `${name}/${variant}: корпусный hand-порог`).toBeGreaterThanOrEqual(0.95);
      }
    });
  }
});

describe('wave5-arrows — EO≡NZ на генератах (стык head+shaft без перекрытия)', () => {
  for (const name of Object.keys(FLOORS)) {
    it(`${name}: ТОЧНОЕ равенство EO≡NZ по всем вариантам (шаг 0.12)`, () => {
      const entry = anatomy.glyphs[name];
      const built = buildGlyph(entry, grid);
      for (const [variant, d] of Object.entries(built)) {
        if (!entry.status?.[variant]) continue;
        expect(eoNzMismatch(d, 0.12), `${name}/${variant}: точек EO≠NZ`).toBe(0);
      }
    });
  }
});
