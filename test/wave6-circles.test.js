/**
 * test/wave6-circles.test.js — per-icon гейты Волны-6 (WAVE6-CIRCLES-PREP):
 * словарь конструктивных окружностей. Полы = замер (шаг 0.12) − ε 0.2 п.п.
 * (шум сетки, прецедент Волны-5). Чтение ТОЛЬКО через buildGlyph.
 *
 * eye: status=hand — fidelity-стоп канона сработал (преп §веки): лучший
 * канон-vesica «1 дуга/веко» 0.9017, структурная G1-цепь руки «2 дуги/веко,
 * перекрещенные центры» 0.9553 — оба < пола промоушена 0.97 (потолок дрожи
 * руки: пер-сегментный rms 0.028–0.037 на пере 1.8). Вопрос Q3 владельцу.
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

// Пер-иконные полы: замер −0.2 п.п.
const FLOORS = {
  eye: { outline: 0.9533 }, // замер .9553
};

function handFile(name, variant) {
  return variant === 'outline'
    ? join(root, 'svg', 'Outline', `${name}.svg`)
    : join(root, 'svg', 'Filled', `${name}_filled.svg`);
}

describe('wave6-circles — генерат декларации сходится с рукой (полы вплотную к замеру)', () => {
  for (const [name, floors] of Object.entries(FLOORS)) {
    for (const [variant, floor] of Object.entries(floors)) {
      it(`${name}/${variant}: IoU против ${handFile(name, variant).includes('Filled') ? 'Filled' : 'Outline'} ≥ ${floor}`, () => {
        const entry = anatomy.glyphs[name];
        expect(entry, `${name} задекларирован в анатомии`).toBeTruthy();
        const dGen = buildGlyph(entry, grid, {}, anatomy.glyphs)[variant];
        const dFile = renderedPathData(readFileSync(handFile(name, variant), 'utf8')).join('');
        expect(inkIoU(dGen, dFile, cw, 0.12)).toBeGreaterThanOrEqual(floor);
      });
    }
  }
});
