/**
 * test/reverse-path.test.js — reversePathD: негатив противо-намотан носителю.
 *
 * КЛАСС: fill-rule-зависимый генерат — вырез, намотанный КАК носитель,
 * под nonzero (браузер) не вычитается: дыра заливается (блоб tablet/cog,
 * отгружались только с fill-rule="evenodd"). Реверс — чисто намоточная
 * операция: EO-чернила неизменны, NZ становится ≡ EO (прецедент genRing).
 *
 * Классы: А (свойства реверса на синтетике), Б (потребители cog/tablet
 * fill-rule-независимы), Д (диверсия: без реверса дыра заливается).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph, genRoundedRect, reversePathD } from '../scripts/lib/anatomy-gen.js';
import { inkIoU } from '../scripts/check-anatomy-drift.js';
import { strictSeamReport } from '../scripts/check-eonz-strict.js';
import { samplePolylines } from '../scripts/lib/curve-sampling.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
const cw = grid.canvas.width;

const inkNZ = (polys, x, y) => {
  let w = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if (y1 > y !== y2 > y && x < x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)) w += y2 > y1 ? 1 : -1;
    }
  }
  return w !== 0;
};

describe('reversePathD — свойства (класс А)', () => {
  const outer = genRoundedRect(12, 12, 14, 14, 2, 0.6);
  const inner = genRoundedRect(12, 12, 10, 10, 1.2, 0.6);

  it('EO-чернила неизменны: рамка с реверс-негативом ≡ рамке без (IoU = 1)', () => {
    expect(inkIoU(outer + inner, outer + reversePathD(inner), cw, 0.12)).toBe(1);
  });

  it('nonzero вычитает реверс-дырку: центр рамки пуст (диверсия: без реверса — залит)', () => {
    const withRev = samplePolylines(outer + reversePathD(inner), 24).filter((p) => p.length > 2);
    const without = samplePolylines(outer + inner, 24).filter((p) => p.length > 2);
    expect(inkNZ(withRev, 12, 12), 'реверс: дыра честна под nonzero').toBe(false);
    expect(inkNZ(without, 12, 12), 'без реверса дыра заливается (класс блоба)').toBe(true);
  });

  it('двойной реверс = исходная намотка (инволюция, с точностью решётки f3)', () => {
    const polys = samplePolylines(reversePathD(reversePathD(inner)), 24).filter((p) => p.length > 2);
    const orig = samplePolylines(inner, 24).filter((p) => p.length > 2);
    // намотка совпала: nonzero-заливка идентична в пробных точках
    for (const pt of [[12, 12], [8, 12], [12, 16.4], [6.8, 6.8]]) {
      expect(inkNZ(polys, ...pt)).toBe(inkNZ(orig, ...pt));
    }
  });
});

describe('reversePathD — потребители (класс Б)', () => {
  for (const name of ['cog', 'tablet-portrait', 'tablet-landscape']) {
    it(`${name}/outline: генерат fill-rule-независим (EO≡NZ точно)`, () => {
      const d = buildGlyph(anatomy.glyphs[name], grid, {}, anatomy.glyphs).outline;
      const r = strictSeamReport(d, cw, grid);
      expect(r.coarse).toBe(0);
      expect(r.fine).toBe(0);
    });
  }
});
