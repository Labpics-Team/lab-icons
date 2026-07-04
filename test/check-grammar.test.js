/**
 * test/check-grammar.test.js — грамматика направлений рёбер (v1).
 * Классы: А (синтетика на-шкале и намеренная диагональ — чисто),
 * Д (снос 1–3° от шкалы — ловится).
 */

import { describe, expect, it } from 'vitest';
import { validateGrammar } from '../scripts/check-grammar.js';

const GRID = { ratios: { angleScale: [0, 30, 45, 90, 135], grammarSnapDeg: 4 } };
const wrap = (d) => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;
const run = (d) => validateGrammar({ grid: GRID, files: [{ name: 'demo.svg', content: wrap(d) }] });

describe('check-grammar — направления рёбер', () => {
  it('А: осевой прямоугольник (0°/90°) — чисто', () => {
    expect(run('M4 4H20V20H4Z').report).toEqual([]);
  });

  it('А: ровно 45° диагональ — на шкале, чисто', () => {
    expect(run('M4 4L14 14').report).toEqual([]);
  });

  it('А: намеренная крутая диагональ 20° — вне полосы снапа, не нарушение', () => {
    // dx=10 dy=3.64 → ~20°, дальше 4° от любой ступени
    expect(run('M2 2L12 5.64').report).toEqual([]);
  });

  it('Д: «почти горизонтальное» ребро с наклоном ~2.9° → снап к 0°', () => {
    // dx=10 dy=0.5 → atan≈2.86°
    const r = run('M2 12L12 12.5').report;
    expect(r.length).toBe(1);
    expect(r[0]).toMatch(/~0° со сносом 2\.9°/);
  });

  it('Д: «почти вертикальное» ребро с наклоном ~2° от 90° → снап к 90°', () => {
    // dx=0.42 dy=12 → ~88°
    const r = run('M12 2L12.42 14').report;
    expect(r.some((e) => e.includes('~90°'))).toBe(true);
  });

  it('А: микроребро < 1.0 не несёт направления — игнор', () => {
    // dx=0.6 dy=0.03 → ~2.9° но длина 0.6 < minEdge
    expect(run('M2 12L2.6 12.03').report).toEqual([]);
  });
});
