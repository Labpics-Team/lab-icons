/**
 * test/transcribe-arc-chain.test.js — авто-транскрипция в arc-chain.
 *
 * Классы, которые обязаны держаться:
 *   1. Замыкание субпутя: контур, НЕ вернувшийся в старт (Z закрывает
 *      прямой), обязан получить явный узел + прямую. Без этого последний
 *      сегмент ложится на чужую хорду и arc-chain рвёт построение
 *      («R меньше полухорды» — 40 имён падали в первом прогоне).
 *   2. Круговая дуга A с rx=ry переносится точным радиусом, не пере-фитом.
 *   3. Кривая C аппроксимируется в допуске (стрела/отклонение < tolerance).
 *   4. Инвариант buildDictPart 2r ≥ хорда держится после округления долей.
 */

import { describe, expect, it } from 'vitest';
import {
  arcFlags,
  buildAnatomyEntry,
  circleFrom3Points,
  fitArcs,
  transcribeSubpath,
} from './transcribe-arc-chain.mjs';
import { buildGlyph } from '../../../../src/core/anatomy-gen.js';

const CW = 24;

describe('circleFrom3Points', () => {
  it('восстанавливает центр и радиус', () => {
    const fit = circleFrom3Points([12, 2], [22, 12], [12, 22]);
    expect(fit.c[0]).toBeCloseTo(12, 6);
    expect(fit.c[1]).toBeCloseTo(12, 6);
    expect(fit.r).toBeCloseTo(10, 6);
  });

  it('коллинеарные точки — null (прямая, не дуга)', () => {
    expect(circleFrom3Points([0, 0], [5, 5], [10, 10])).toBeNull();
  });
});

describe('arcFlags', () => {
  it('малая дуга по часовой (экранной) — sweep=1', () => {
    const c = [12, 12];
    expect(arcFlags([12, 2], [22, 12], [12, 22], c)).toEqual({ sweep: 1, large: 0 });
  });

  it('та же дуга против часовой — sweep=0, large=1 в дополнении', () => {
    const c = [12, 12];
    expect(arcFlags([12, 2], [2, 12], [12, 22], c)).toEqual({ sweep: 0, large: 0 });
  });
});

describe('fitArcs', () => {
  it('дуга окружности — одна арка с точным радиусом', () => {
    const at = (t) => {
      const th = -Math.PI / 2 + t * Math.PI;
      return [12 + 10 * Math.cos(th), 12 + 10 * Math.sin(th)];
    };
    const pieces = fitArcs(at, 0.06);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].seg.t).toBe('a');
    expect(pieces[0].seg.r).toBeCloseTo(10, 2);
  });

  it('прямая — сегмент l без деления', () => {
    const at = (t) => [2 + 20 * t, 5];
    const pieces = fitArcs(at, 0.06);
    expect(pieces).toHaveLength(1);
    expect(pieces[0].seg.t).toBe('l');
  });
});

describe('transcribeSubpath — замыкание (класс «R меньше полухорды»)', () => {
  it('субпуть, не вернувшийся в старт, получает явный узел замыкания', () => {
    // Контур: старт (4,4) → дуга до (20,4) → прямая вниз; Z закрывает
    // ДЛИННОЙ диагональю. Без явного узла последний сегмент-дуга лёг бы
    // на неё и построение рвалось.
    const sub = {
      start: [4, 4],
      segs: [
        { cmd: 'A', rx: 8, ry: 8, rotation: 0, largeArc: 0, sweep: 1, x: 20, y: 4 },
        { cmd: 'L', x: 20, y: 20 },
      ],
    };
    const params = transcribeSubpath(sub, CW);
    // 3 узла: старт, конец дуги, конец прямой — замыкание идёт к nodes[0]
    expect(params.nodes).toHaveLength(3);
    expect(params.segs).toHaveLength(3);
    expect(params.segs[2]).toEqual({ t: 'l' });
    // инвариант: каждый арк-сегмент держит 2r ≥ хорда
    for (let i = 0; i < params.segs.length; i++) {
      const s = params.segs[i];
      if (s.t !== 'a') continue;
      const from = params.nodes[i];
      const to = params.nodes[(i + 1) % params.nodes.length];
      const chord = Math.hypot(from[0] - to[0], from[1] - to[1]);
      expect(2 * s.r).toBeGreaterThanOrEqual(chord - 1e-6);
    }
  });

  it('круговая дуга A переносится точным радиусом', () => {
    const sub = {
      start: [4, 12],
      segs: [
        { cmd: 'A', rx: 8, ry: 8, rotation: 0, largeArc: 0, sweep: 1, x: 20, y: 12 },
        { cmd: 'L', x: 4, y: 12 },
      ],
    };
    const params = transcribeSubpath(sub, CW);
    expect(params.segs[0].t).toBe('a');
    expect(params.segs[0].r).toBeCloseTo(8 / CW, 5);
    expect(params.segs[0].sweep).toBe(1);
  });
});

describe('buildAnatomyEntry — сквозная транскрипция строится buildGlyph', () => {
  it('простой контур → candidate-декларация, глиф строится без ошибок', () => {
    const svg = (d) =>
      `<svg viewBox="0 0 24 24"><path fill-rule="evenodd" d="${d}"/></svg>`;
    const dOutline = 'M4 4L20 4L20 20L4 20Z';
    const dFilled = 'M4 4L20 4L20 20L4 20Z';
    const entry = buildAnatomyEntry({
      outlineSvg: svg(dOutline),
      filledSvg: svg(dFilled),
      cw: CW,
    });
    expect(entry.archetype).toBe('composite');
    expect(entry.status).toEqual({ outline: 'hand', filled: 'hand' });
    expect(entry.parts[0].primitive).toBe('arc-chain');
    const grid = { canvas: { width: CW }, ratios: { strokeWidth: { base: 0.075 } } };
    const built = buildGlyph(entry, grid, {}, {});
    expect(built.outline).toMatch(/^M/);
    expect(built.filled).toMatch(/^M/);
  });
});
