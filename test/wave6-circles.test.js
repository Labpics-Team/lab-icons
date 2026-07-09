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
import { resolveTangentChain } from '../scripts/lib/circle-dictionary.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
const cw = grid.canvas.width;

// Пер-иконные полы: замер −0.2 п.п.
const FLOORS = {
  eye: { outline: 0.9533 }, // замер .9553
  // cloud задекларирован generated: полы = fidelityToHand до промоушена − ε
  // (файлы перегенерены из декларации, гейт дублирует drift как регресс-страж)
  cloud: { outline: 0.9722, filled: 0.9933 }, // замер .9742/.9953
  // paw + arrow-redo/undo: ВОЗВРАЩЕНЫ в руку (revert wave6, awaiting owner
  // taste — конструктив-круги увели форму < пола 97%). Полы удалены до
  // вкусовой приёмки Даниилом; резюм миссией восстановит при промоушене.
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

describe('circle-dictionary/kiss — точка внутреннего касания (регресс FIRE-PREP §4)', () => {
  // Баг fire-разведки: при внутреннем kiss с МАЛОЙ окружностью первой в паре
  // точка бралась как cA + û·rA — антипод истинного касания (дуги наматывали
  // 324–358°, parity-flip заливки). Истина: точка на линии центров, на
  // ДАЛЬНЕЙ стороне малой окружности: cA − û·rA.
  const ptOnArc = (seg, a) => [seg.c[0] + seg.r * Math.cos(a), seg.c[1] + seg.r * Math.sin(a)];
  const dist = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);

  function junctionOf(elements) {
    const { chain } = resolveTangentChain(elements, [{ type: 'kiss' }], false);
    expect(chain).toHaveLength(2);
    return { j: ptOnArc(chain[0], chain[0].a1), chain };
  }

  it('внутреннее касание, малый круг ПЕРВЫМ: стык на дальней стороне малого', () => {
    const { j, chain } = junctionOf([
      { circle: { c: [10, 12], r: 2, startA: 90 } },
      { circle: { c: [12, 12], r: 4, endA: 90 } },
    ]);
    expect(j[0]).toBeCloseTo(8, 9);
    expect(j[1]).toBeCloseTo(12, 9);
    // стык обязан лежать на ОБЕИХ окружностях (антипод не лежит на большой)
    expect(dist(j, chain[0].c)).toBeCloseTo(chain[0].r, 9);
    expect(dist(j, chain[1].c)).toBeCloseTo(chain[1].r, 9);
  });

  it('внутреннее касание, большой круг первым: та же точка (инвариант порядка)', () => {
    const { j } = junctionOf([
      { circle: { c: [12, 12], r: 4, startA: 90 } },
      { circle: { c: [10, 12], r: 2, endA: 90 } },
    ]);
    expect(j[0]).toBeCloseTo(8, 9);
    expect(j[1]).toBeCloseTo(12, 9);
  });

  it('внешнее касание не задето правкой: стык между центрами', () => {
    const { j, chain } = junctionOf([
      { circle: { c: [10, 12], r: 2, startA: 90 } },
      { circle: { c: [16, 12], r: 4, endA: 90 } },
    ]);
    expect(j[0]).toBeCloseTo(12, 9);
    expect(j[1]).toBeCloseTo(12, 9);
    expect(dist(j, chain[1].c)).toBeCloseTo(chain[1].r, 9);
  });
});
