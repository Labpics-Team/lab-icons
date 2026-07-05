/**
 * test/wave1-decls.test.js — inkIoU-гейт деклараций Волны-1 (WAVE1-DECL-PREP)
 * против рук svg/Outline/<name>.svg.
 *
 * Порог и растеризатор — как в test/stroke-path.test.js (класс А):
 * inkIoU из scripts/check-anatomy-drift.js (шаг 0.12, чётность чернил),
 * IoU ≥ 0.95. Декларации читаются из semantics/anatomy.json — гейт держит
 * именно закоммиченное состояние, не локальные копии сидов.
 *
 * WAVE1 растёт по мере коммитов деклараций (атомарно, по иконке).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { inkIoU } from '../scripts/check-anatomy-drift.js';
import { renderedPathData } from '../scripts/lib/icon-geometry.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
const cw = grid.canvas.width;

const THRESHOLD = 0.95;

// Задекларированные иконки Волны-1 (порядок — WAVE1-DECL-PREP)
const WAVE1 = ['checkmark', 'plus', 'plus-circle', 'checkmark-circle', 'checkmarks', 'checkmarks-circle', 'info-circle'];

describe('wave1-decls — генерат декларации сходится с рукой (IoU ≥ 0.95)', () => {
  for (const name of WAVE1) {
    it(`${name}: IoU против svg/Outline/${name}.svg`, () => {
      const entry = anatomy.glyphs[name];
      expect(entry, `${name} задекларирован в semantics/anatomy.json`).toBeTruthy();
      const { outline } = buildGlyph(entry, grid);
      const hand = renderedPathData(
        readFileSync(join(root, 'svg', 'Outline', `${name}.svg`), 'utf8'),
      ).join('');
      const iou = inkIoU(outline, hand, cw);
      // дрейф печатается для протокола отчёта
      console.log(`${name}: IoU=${(iou * 100).toFixed(2)}% drift=${((1 - iou) * 100).toFixed(2)}%`);
      expect(iou).toBeGreaterThanOrEqual(THRESHOLD);
    });
  }
});
