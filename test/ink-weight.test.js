/**
 * test/ink-weight.test.js — гейт веса чернил (BL-021).
 * Классы: А (слепой замер точен на синтетике; инварианты (а)(б)(в) кусаются),
 * Б (RED-числа chevron-down-circle забетонированы; кламп оси = формула),
 * Д (мутант: битые веса обязаны падать — гейт не театр).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import {
  axesSweepGlyph,
  axesWeightRange,
  gridInkTokens,
  inkWeightDefects,
  measureStrokes,
} from '../scripts/check-ink-weight.js';

const grid = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'semantics', 'anatomy.json'), 'utf8'));
const G = (n) => anatomy.glyphs[n];

const T = gridInkTokens(grid, 1);
const OPTS = { cw: T.cw, scale: 16, stepsPerSeg: 32, tolU: T.tolU, capU: T.capU, keylineR: T.keylineR, boldU: T.canons.bold };

/** Горизонтальная полоса толщиной w через канву (синтетический штрих). */
const band = (w) => `M2 ${12 - w / 2}H22V${12 + w / 2}H2Z`;
/** Кольцо keyline-диаметра толщиной w (генератор genRing руками). */
const ring = (w) => {
  const rOut = 11;
  const rIn = 11 - w;
  const c = (r, sw) => `M${12 - r} 12a${r} ${r} 0 1 ${sw} ${2 * r} 0a${r} ${r} 0 1 ${sw} ${-2 * r} 0Z`;
  return c(rOut, 0) + c(rIn, 1);
};

describe('слепой замер толщины (А: точность на синтетике)', () => {
  it('полосы канонов меряются точно (±0.01), ровно один штрих', () => {
    for (const w of [1.5, 1.8, 2.0, 2.4]) {
      const { strokes } = measureStrokes(band(w), OPTS);
      expect(strokes.length, `полоса ${w}`).toBe(1);
      expect(Math.abs(strokes[0].w - w), `полоса ${w}`).toBeLessThan(0.01);
    }
  });

  it('диагональная полоса 45° меряется так же точно (замер не осевой)', () => {
    const h = 0.9;
    const k = Math.SQRT1_2 * h;
    const d = `M${3 - k} ${3 + k}L${20 - k} ${20 + k}L${20 + k} ${20 - k}L${3 + k} ${3 - k}Z`;
    const { strokes } = measureStrokes(d, OPTS);
    expect(strokes.length).toBe(1);
    expect(Math.abs(strokes[0].w - 1.8)).toBeLessThan(0.01);
  });

  it('масса (диск) — не штрих: ноль замеров, ноль дефектов', () => {
    const d = 'M4 12a8 8 0 1 0 16 0a8 8 0 1 0 -16 0Z';
    const { strokes } = measureStrokes(d, OPTS);
    expect(strokes.length).toBe(0);
    expect(inkWeightDefects({ grid, d }).defects.length).toBe(0);
  });

  it('кольцо-обрамление распознаётся кольцом на каноне', () => {
    const { strokes } = measureStrokes(ring(1.5), OPTS);
    expect(strokes.length).toBe(1);
    expect(strokes[0].isRing).toBe(true);
    expect(Math.abs(strokes[0].w - 1.5)).toBeLessThan(0.02);
  });
});

describe('инварианты весов кусаются (Д: мутанты падают)', () => {
  it('(а) ничейный вес 2.2 (между канонами) → orphan с координатой', () => {
    const { defects } = inkWeightDefects({ grid, d: band(2.2) });
    expect(defects.map((x) => x.type)).toContain('orphan');
    expect(defects.find((x) => x.type === 'orphan').msg).toMatch(/2\.20.*@\(/);
  });

  it('(в) супертонкая линия 1.0 → thin', () => {
    const { defects } = inkWeightDefects({ grid, d: band(1.0) });
    expect(defects.map((x) => x.type)).toContain('thin');
  });

  it('(б) обрамление не легче глифа (кольцо 1.5 + глиф 1.5) → container-heavier', () => {
    const glyph15 = `M11.25 7H12.75V17H11.25Z`;
    const { defects } = inkWeightDefects({ grid, d: ring(1.5) + glyph15 });
    expect(defects.map((x) => x.type)).toContain('container-heavier');
  });

  it('(б) канонный контейнер (кольцо 1.5 + глиф 2.0) — чисто', () => {
    const glyph20 = `M11 7H13V17H11Z`;
    const { defects } = inkWeightDefects({ grid, d: ring(1.5) + glyph20 });
    expect(defects.length).toBe(0);
  });

  it('канонные полосы — ноль дефектов (инварианты не пере-кусывают)', () => {
    for (const w of [1.5, 1.8, 2.0, 2.4]) {
      expect(inkWeightDefects({ grid, d: band(w) }).defects.length, `полоса ${w}`).toBe(0);
    }
  });
});

describe('RED-протокол BL-021 забетонирован (Б: числа замера)', () => {
  it('chevron-down-circle: кольцо ≈1.5, шеврон ≈2.0 (containerGlyph) — как рука (2.003)', () => {
    const d = buildGlyph(G('chevron-down-circle'), grid, {}, anatomy.glyphs).outline;
    const { strokes } = measureStrokes(d, OPTS);
    const ringS = strokes.find((s) => s.isRing);
    const glyphS = strokes.filter((s) => !s.isRing);
    expect(ringS).toBeTruthy();
    expect(Math.abs(ringS.w - 1.5)).toBeLessThan(0.02);
    expect(glyphS.length).toBeGreaterThan(0);
    for (const s of glyphS) expect(Math.abs(s.w - 2.0), 'шеврон = канон containerGlyph').toBeLessThan(0.02);
    expect(inkWeightDefects({ grid, d }).defects.length).toBe(0);
  });

  it('ось веса масштабирует кольцо контейнера (RED: было 1.498 при w=1.2, GREEN: 1.798)', () => {
    const d = buildGlyph(G('chevron-down-circle'), grid, { weight: 1.2 }, anatomy.glyphs).outline;
    const { strokes } = measureStrokes(d, OPTS);
    const ringS = strokes.find((s) => s.isRing);
    expect(ringS).toBeTruthy();
    expect(Math.abs(ringS.w - 1.5 * 1.2)).toBeLessThan(0.03);
  });

  it('ось веса масштабирует clock-hand и arc-band (RED: стрелки/волны не масштабировались)', () => {
    const dTime = buildGlyph(G('time'), grid, { weight: 1.2 }, anatomy.glyphs).outline;
    const tStrokes = measureStrokes(dTime, OPTS).strokes;
    // все штрихи time (циферблат 1.8 + стрелки 1.8) обязаны стать ≈2.16
    expect(tStrokes.length).toBeGreaterThan(0);
    for (const s of tStrokes) expect(Math.abs(s.w - 1.8 * 1.2), 'time@1.2').toBeLessThan(0.03);
    const dRadio = buildGlyph(G('radio'), grid, { weight: 1.2 }, anatomy.glyphs).outline;
    for (const s of measureStrokes(dRadio, OPTS).strokes) {
      expect(Math.abs(s.w - 1.6 * 1.2), 'волна radio@1.2').toBeLessThan(0.03);
    }
  });

  it('свип осей чист для промоутнутого контейнера (пропорция + клиренс на всей сетке)', () => {
    const findings = axesSweepGlyph({ grid, entry: G('chevron-down-circle'), allGlyphs: anatomy.glyphs });
    expect(findings).toEqual([]);
  });
});

describe('кламп оси веса (grid.axes.weight)', () => {
  it('литералы grid = формула от токенов: min=capRadius/enclosureRing, max=1+(enclosureRing−clearanceMin)/bold', () => {
    const r = axesWeightRange(grid);
    expect(Math.abs(grid.axes.weight.min - r.min)).toBeLessThan(1e-6);
    expect(Math.abs(grid.axes.weight.max - r.max)).toBeLessThan(1e-6);
    // выведенные значения (не с потолка): 0.6 и ≈1.29167
    expect(r.min).toBeCloseTo(0.6, 9);
    expect(r.max).toBeCloseTo(1.29167, 5);
  });

  it('buildGlyph клампит: weight за пределами ≡ weight на границе', () => {
    const e = G('chevron-down');
    const over = buildGlyph(e, grid, { weight: 99 }, anatomy.glyphs);
    const atMax = buildGlyph(e, grid, { weight: grid.axes.weight.max }, anatomy.glyphs);
    expect(JSON.stringify(over)).toBe(JSON.stringify(atMax));
    const under = buildGlyph(e, grid, { weight: 0.01 }, anatomy.glyphs);
    const atMin = buildGlyph(e, grid, { weight: grid.axes.weight.min }, anatomy.glyphs);
    expect(JSON.stringify(under)).toBe(JSON.stringify(atMin));
  });

  it('дефолт бит-в-бит не изменился (кламп не сдвигает identity)', () => {
    const e = G('chevron-down-circle');
    expect(JSON.stringify(buildGlyph(e, grid, {}, anatomy.glyphs))).toBe(
      JSON.stringify(buildGlyph(e, grid, { weight: 1 }, anatomy.glyphs)),
    );
  });
});
