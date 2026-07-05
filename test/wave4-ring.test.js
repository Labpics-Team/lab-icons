/**
 * test/wave4-ring.test.js — тест-бэкфилл мини-Волны-4 (WAVE4-RING-PREP).
 *
 * Три bootstrap-декларации (#6, e1701a1) до сих пор держал ТОЛЬКО корпусный
 * check-anatomy-drift: поломка любой из них валила общий гейт без адресного
 * сигнала. Здесь — дедицированный per-icon регресс (класс Б, characterization):
 * замеренные IoU фиксируются как пол (замер 2026-07-05, шаг 0.12), плюс
 * EO≡NZ-ассерт на генераты (урок №5 препа: кольца наследуют genRing-fix
 * Волны-3 — доказываем чистоту намотки адресно).
 *
 * Пол пер-иконный, НЕ только общий 0.95: chevron-down-circle и minus-circle
 * идут с запасом >99.9% (кандидаты generated), pause-circle 97.22/98.80
 * остаётся hand (капсульные торцы чувствительны).
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

// Пер-иконные полы = замер 2026-07-05 минус ε≈0.2 п.п. (шум сетки),
// но не ниже корпусного hand-порога 0.95.
const FLOORS = {
  'chevron-down-circle': { outline: 0.9990, filled: 0.9990 },
  'minus-circle': { outline: 0.9995, filled: 0.9998 },
  'pause-circle': { outline: 0.9700, filled: 0.9860 },
};

function handFile(name, variant) {
  return variant === 'outline'
    ? join(root, 'svg', 'Outline', `${name}.svg`)
    : join(root, 'svg', 'Filled', `${name}_filled.svg`);
}

/** Чернила под evenodd и nonzero за один проход (как в wave3-play.test.js). */
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

describe('wave4-ring — bootstrap-декларации: пер-иконный IoU-пол', () => {
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

describe('wave4-ring — EO≡NZ на генератах (кольца после genRing-fix)', () => {
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
