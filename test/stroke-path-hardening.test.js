/**
 * test/stroke-path-hardening.test.js — закрытие дыр stroke-path после
 * двойной верификации (BL-014/017 hardening):
 *
 *   1) СОВМЕСТНОЕ съедание: каждый стык по отдельности короче плеч
 *      (старый guard проходит), но trim[i-1]+trim[i] ≥ len[i] съедает
 *      внутренний сегмент → раньше строилось самопересечение, теперь throw;
 *   2) разворот оси 180° — собственное сообщение вместо tan(π/2)-мусора
 *      («стык 14698115417875834.000 ≥ плечо»);
 *   3) свойства нормального пути на зигзаге (постоянное перо, один суб-путь,
 *      0 самопересечений) и позитив числового weight (typeof number → L(ratio)).
 *
 * Паттерны/хелперы — по образцу test/stroke-path.test.js (его НЕ трогаем).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { samplePolylines } from '../scripts/lib/curve-sampling.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const cw = grid.canvas.width;

// точки задаём в юнитах канвы 24 и делим — как доли (0..1), контракт примитива
const q24 = (pts) => pts.map(([x, y]) => [x / 24, y / 24]);

const glyphFor = (points, weight = 'base', outlineExtra = {}) => ({
  archetype: 'composite',
  status: { outline: 'hand' },
  parts: [
    {
      primitive: 'stroke-path',
      mode: { outline: 'solid' },
      weight,
      params: { outline: { points, closed: false, ...outlineExtra } },
    },
  ],
});

const distToSeg = (p, a, b) => {
  const abx = b[0] - a[0];
  const aby = b[1] - a[1];
  const t = Math.max(
    0,
    Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby)),
  );
  return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
};

// склейка флоат-пыли: последовательные точки ближе 1e-6 — одна точка;
// замыкающая точка ≈ стартовой (кап начала) — тоже пыль, снимаем,
// иначе вырожденное микро-ребро даёт ложное самопересечение на старт/финише
const dedupe = (poly) => {
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) <= 1e-6;
  const out = [];
  for (const p of poly) {
    if (out.length === 0 || !near(p, out[out.length - 1])) out.push(p);
  }
  while (out.length > 1 && near(out[0], out[out.length - 1])) out.pop();
  return out;
};

// строгие (внутренние) пересечения рёбер замкнутой полилинии; смежные
// рёбра (общая вершина, вкл. пару последнее/первое) не считаются
const properSelfIntersections = (polyRaw) => {
  const poly = dedupe(polyRaw);
  const n = poly.length;
  let count = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = poly[i];
      const b = poly[(i + 1) % n];
      const c = poly[j];
      const d = poly[(j + 1) % n];
      const d1x = b[0] - a[0];
      const d1y = b[1] - a[1];
      const d2x = d[0] - c[0];
      const d2y = d[1] - c[1];
      const den = d1x * d2y - d1y * d2x;
      if (Math.abs(den) < 1e-12) continue;
      const t = ((c[0] - a[0]) * d2y - (c[1] - a[1]) * d2x) / den;
      const s = ((c[0] - a[0]) * d1y - (c[1] - a[1]) * d1x) / den;
      const eps = 1e-9;
      if (t > eps && t < 1 - eps && s > eps && s < 1 - eps) count++;
    }
  }
  return count;
};

describe('stroke-path hardening — guards офсет-вырождений', () => {
  it('а: closed=true → «замкнутые оси … не реализованы»', () => {
    const g = glyphFor(q24([[6, 6], [18, 6], [12, 18]]), 'base', { closed: true });
    expect(() => buildGlyph(g, grid)).toThrow(/замкнутые оси.*не реализованы/);
  });

  it('б: нулевой сегмент оси (две совпадающие точки) → детерминированный throw', () => {
    const g = glyphFor(q24([[6, 12], [6, 12], [18, 12]]));
    expect(() => buildGlyph(g, grid)).toThrow(/нулевой сегмент оси 0→1/);
  });

  it('в: разворот 180° → собственное сообщение, без tan(π/2)-гиганта', () => {
    const g = glyphFor(q24([[4, 12], [16, 12], [8, 12]]));
    expect(() => buildGlyph(g, grid)).toThrow(/разворот оси на 180°/);
    let msg = '';
    try {
      buildGlyph(g, grid);
    } catch (e) {
      msg = e.message;
    }
    expect(msg).not.toMatch(/\d{7,}/); // никакого «14698115417875834.000»
    expect(msg).not.toMatch(/≥ плечо/); // не общий guard съедания
  });

  it('г: зигзаг 5 точек — постоянное перо, один суб-путь, 0 самопересечений', () => {
    const axisU = [[4, 8], [8, 16], [12, 8], [16, 16], [20, 8]]; // юниты, 3 излома ±
    const { outline } = buildGlyph(glyphFor(q24(axisU)), grid);
    const h = (grid.ratios.strokeWidth.base * cw) / 2;
    const polys = samplePolylines(outline, 32).filter((p) => p.length > 2);
    expect(polys.length).toBe(1); // ровно один суб-путь
    let checkedPts = 0;
    for (const p of polys[0]) {
      let d = Infinity;
      for (let i = 0; i + 1 < axisU.length; i++) {
        d = Math.min(d, distToSeg(p, axisU[i], axisU[i + 1]));
      }
      expect(Math.abs(d - h)).toBeLessThan(0.02);
      checkedPts++;
    }
    expect(checkedPts).toBeGreaterThan(50);
    expect(properSelfIntersections(polys[0])).toBe(0);
  });

  it('д: адверсариальная ось — соседние стыки совместно съедают сегмент → throw', () => {
    // раньше проходило оба одиночных guard и строило самопересечение
    const g = glyphFor(q24([[2, 12], [10, 12], [12, 10], [4, 10]]), 2.2 / 24);
    expect(() => buildGlyph(g, grid)).toThrow(/совместно съедает внутренний сегмент/);
  });

  it('е: диспетчер — mode ≠ solid → «режим … не поддержан»', () => {
    const g = glyphFor(q24([[6, 12], [18, 12]]));
    g.parts[0].mode.outline = 'frame';
    expect(() => buildGlyph(g, grid)).toThrow(/режим «frame» не поддержан/);
  });

  it('ж: числовой weight (2.0/24) резолвится через L(ratio) — перо в d соответствует', () => {
    const axisU = [[5, 12], [19, 12]];
    const { outline } = buildGlyph(glyphFor(q24(axisU), 2.0 / 24), grid);
    const h = 1.0; // (2.0/24)·24 / 2
    const pts = samplePolylines(outline, 32).filter((p) => p.length > 2)[0];
    for (const p of pts) {
      expect(Math.abs(distToSeg(p, axisU[0], axisU[1]) - h)).toBeLessThan(0.02);
    }
    const ys = pts.map((p) => p[1]);
    expect(Math.max(...ys) - Math.min(...ys)).toBeCloseTo(2.0, 1); // габарит = перо
  });
});
