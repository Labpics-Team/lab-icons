/**
 * test/rounded-polygon.test.js — примитив скруглённого многоугольника
 * (play-треугольник, ромб, media). verts = ВИРТУАЛЬНЫЕ вершины (пересечения
 * граней); Filled = масса, Outline-ring = внешний+внутр.офсет (miter-кламп).
 * Классы: А (валидность/замкнутость/кольцо-дырка), Д (ζ меняет форму).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph, genRoundedPolygon, genRoundedPolygonRing } from '../scripts/lib/anatomy-gen.js';
import { samplePolylines } from '../scripts/lib/curve-sampling.js';

const square = [[6, 6], [18, 6], [18, 18], [6, 18]];
const tri = [[20, 12], [5, 21], [5, 3]];
const area = (d) => {
  let A = 0;
  for (const p of samplePolylines(d, 48)) {
    let a = 0;
    for (let i = 0; i < p.length; i++) { const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length]; a += x1 * y2 - x2 * y1; }
    A += Math.abs(a / 2);
  }
  return A;
};

describe('genRoundedPolygon — масса', () => {
  it('А: квадрат — 1 замкнутый контур, без NaN', () => {
    const d = genRoundedPolygon(square, 3, 0.6);
    expect(d).not.toMatch(/NaN|Infinity/);
    expect(d.endsWith('Z')).toBe(true);
    expect(samplePolylines(d, 32).length).toBe(1);
  });

  it('А: треугольник (острый) — валиден, площадь в разумных пределах', () => {
    const d = genRoundedPolygon(tri, 3, 0.6);
    expect(d).not.toMatch(/NaN|Infinity/);
    const a = area(d);
    expect(a).toBeGreaterThan(80);
    expect(a).toBeLessThan(180);
  });

  it('Д: ζ=0 vs ζ=0.6 — разные формы (сглаживание работает)', () => {
    const sharp = genRoundedPolygon(square, 3, 0);
    const smooth = genRoundedPolygon(square, 3, 0.6);
    expect(sharp).not.toBe(smooth);
  });
});

describe('genRoundedPolygonRing — Outline-кольцо', () => {
  it('А: квадрат-кольцо — 2 контура (внешний+внутренний), без NaN', () => {
    const d = genRoundedPolygonRing(square, 3, 0.6, 1.8);
    expect(d).not.toMatch(/NaN|Infinity/);
    expect(samplePolylines(d, 32).length).toBe(2);
  });

  it('А: внутренний офсет вложен во внешний (bbox меньше)', () => {
    const ring = genRoundedPolygonRing(square, 3, 0.6, 1.8);
    const [outer, inner] = samplePolylines(ring, 32);
    const bb = (p) => { let a = 1e9, b = 1e9, x = -1e9, y = -1e9; for (const [px, py] of p) { a = Math.min(a, px); b = Math.min(b, py); x = Math.max(x, px); y = Math.max(y, py); } return { w: x - a, h: y - b }; };
    expect(bb(inner).w).toBeLessThan(bb(outer).w);
    expect(bb(inner).h).toBeLessThan(bb(outer).h);
  });

  it('А: miter-кламп острого носа — inner-вершина не переполняется (без NaN, замкнут)', () => {
    const d = genRoundedPolygonRing(tri, 3, 0.6, 1.9);
    expect(d).not.toMatch(/NaN|Infinity/);
    expect(samplePolylines(d, 32).length).toBe(2);
  });
});

describe('rounded-polygon как composite-часть (Волна-3, обязательство №3 Волны-2)', () => {
  const grid = JSON.parse(readFileSync(join(import.meta.dirname, '..', 'semantics', 'grid.json'), 'utf8'));
  const cw = grid.canvas.width;
  const frac = (pts) => pts.map(([x, y]) => [x / cw, y / cw]);
  const SQ = [[6, 6], [18, 6], [18, 18], [6, 18]];
  const TRI = [[20, 12], [5, 21], [5, 3]]; // виртуальные вершины, НЕ bbox
  const entry = (mode, params, weight) => ({
    archetype: 'composite',
    status: { outline: 'hand' },
    parts: [{
      primitive: 'rounded-polygon',
      mode: { outline: mode },
      ...(weight ? { weight } : {}),
      params: { outline: params },
    }],
  });

  it('solid байт-в-байт равен standalone genRoundedPolygon (резолв долей и токен-ζ из сетки)', () => {
    const { outline } = buildGlyph(entry('solid', { vertices: frac(SQ), r: 3 / cw }), grid);
    expect(outline).toBe(genRoundedPolygon(SQ, 3, grid.ratios.cornerSmoothing));
  });

  it('frame — кольцо из 2 контуров, без NaN, равно genRoundedPolygonRing с пером-токеном', () => {
    const { outline } = buildGlyph(entry('frame', { vertices: frac(SQ), r: 3 / cw }, 'base'), grid);
    expect(outline).not.toMatch(/NaN|Infinity/);
    expect(samplePolylines(outline, 32).length).toBe(2);
    expect(outline).toBe(
      genRoundedPolygonRing(SQ, 3, grid.ratios.cornerSmoothing, grid.ratios.strokeWidth.base * cw),
    );
  });

  it('ζ-override в params действует, включая граничный ζ=0 (nullish, не falsy)', () => {
    const token = buildGlyph(entry('solid', { vertices: frac(TRI), r: 3 / cw }), grid).outline;
    const sharp = buildGlyph(entry('solid', { vertices: frac(TRI), r: 3 / cw, zeta: 0 }), grid).outline;
    expect(sharp).not.toBe(token);
    expect(sharp).toBe(genRoundedPolygon(TRI, 3, 0));
  });
});
