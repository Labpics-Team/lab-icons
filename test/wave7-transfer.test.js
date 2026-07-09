/**
 * test/wave7-transfer.test.js — per-icon гейты Волны-7 (WAVE7-PREP):
 * семья «transfer/manipulate» (resize, далее move → download → upload →
 * push → share), composite stroke-path per-variant weight — прямое
 * переиспользование машинерии Волны-5 (стыки тангенс-солвером БЕЗ
 * перекрытия — отсюда адресный EO≡NZ-ассерт).
 *
 * Полы = замер 2026-07-09 (шаг 0.12) минус ε≈0.2 п.п. (шум сетки).
 * Все иконки hand (< промоушен-порога 0.995): рука кладёт filled-капы
 * диагоналей с заступом на кромки скобок (перекрытие ~0.4 px), генерат
 * обязан тангенс-касание — прецедент Волны-5. Чтение ТОЛЬКО через
 * buildGlyph — без захардкоженных контуров.
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
  resize: { outline: 0.977, filled: 0.9657 }, // замер .9790/.9677 (оба варианта — тангенс-кламп капов диагонали, запас 0.02px под мелкосеточный корпусный скан)
  move: { outline: 0.9546, filled: 0.9664 }, // замер .9566/.9684 (крест: полная вертикаль + 2 полуоси, 6 тангенс-стыков — прецедент close из WAVE7-PREP)
  download: { outline: 0.998 }, // замер 1.0000 (регенерат заменил руку: файл ≡ buildGlyph; стык палочка↔наконечник — сокет-встык, класс time)
  upload: { outline: 0.998 }, // замер 1.0000 (регенерат заменил руку после фикса донца: терминалы дуг startA/endA=90 вместо деген-стабов, сокет-встык стрелки)
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

describe('wave7-transfer — семья transfer/manipulate: пер-иконный IoU-пол', () => {
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

describe('wave7-transfer — EO≡NZ на генератах (стыки без перекрытия)', () => {
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
