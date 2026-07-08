/**
 * test/stroke-cross.test.js — примитив stroke-cross (класс ПЕРЕСЕКАЮЩИХСЯ
 * штрихов: close «×», plus «+», будущие add/x-семьи).
 *
 * Закон: union двух пересекающихся капсул печатается СРАЗУ единым суб-путём
 * (4 плеча, полукруглые капы, вогнутые miter-точки между соседними плечами) —
 * стык в пересечении не существует, EO≡NZ тривиально.
 *
 * Классы: А (форма = union капсул, differential IoU; единый суб-путь; EO≡NZ),
 * Б (постоянство пера вдоль плеч), Д (вырождения — понятные ошибки).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { genStrokeCross, genStrokePath, buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { strictSeamReport } from '../scripts/check-eonz-strict.js';
import { samplePolylines } from '../scripts/lib/curve-sampling.js';
import { parsePathData } from '../scripts/lib/path-data.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
const cw = grid.canvas.width;
const pen = grid.ratios.strokeWidth.base * cw; // 1.8

const AX = [[[7.755, 7.755], [16.32, 16.325]], [[16.25, 7.76], [7.685, 16.33]]]; // ≈ close

describe('stroke-cross — конструкция (класс А)', () => {
  it('единый суб-путь: ровно одна M, контур замкнут', () => {
    const d = genStrokeCross(AX, pen);
    expect(d.match(/M/g)).toHaveLength(1);
    expect(d.endsWith('Z')).toBe(true);
  });

  it('EO≡NZ точно и ноль пинчей (нечему стыковаться — один контур)', () => {
    const r = strictSeamReport(genStrokeCross(AX, pen), cw, grid);
    expect(r.coarse).toBe(0);
    expect(r.fine).toBe(0);
    expect(r.seams).toEqual([]);
  });

  it('форма = nonzero-union двух капсул тех же осей (differential, IoU ≥ 0.99)', () => {
    const d = genStrokeCross(AX, pen);
    // референс: union двух капсул genStrokePath ПОД NONZERO (перекрытие в
    // пересечении заливается, как рендерит браузер) — крест обязан совпасть;
    // evenodd-растеризатор для референса не годится: он сам вырезал бы линзу
    const capsules = genStrokePath(AX[0], pen) + genStrokePath(AX[1], pen);
    const crossPolys = samplePolylines(d, 24).filter((p) => p.length > 2);
    const capPolys = samplePolylines(capsules, 24).filter((p) => p.length > 2);
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
    let both = 0;
    let only = 0;
    for (let x = 0.06; x < cw; x += 0.12) {
      for (let y = 0.06; y < cw; y += 0.12) {
        const a = inkNZ(crossPolys, x, y);
        const b = inkNZ(capPolys, x, y);
        if (a && b) both++;
        else if (a || b) only++;
      }
    }
    expect(both / (both + only)).toBeGreaterThanOrEqual(0.99);
  });

  it('перо постоянно: середины прямых рёбер держат перо/2 от оси (класс Б)', () => {
    const d = genStrokeCross(AX, pen);
    const h = pen / 2;
    const distToSeg = (p, a, b) => {
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * abx + (p[1] - a[1]) * aby) / (abx * abx + aby * aby)));
      return Math.hypot(p[0] - (a[0] + abx * t), p[1] - (a[1] + aby * t));
    };
    // прямые рёбра контура = офсет-грани плеч: середина каждого обязана
    // лежать ровно в перо/2 от своей оси (8 рёбер: по два на плечо)
    let prev = null;
    let start = null;
    let edges = 0;
    const checkEdge = (a, b) => {
      const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const dAxis = Math.min(distToSeg(mid, ...AX[0]), distToSeg(mid, ...AX[1]));
      expect(Math.abs(dAxis - h), `ребро с серединой ${mid}`).toBeLessThan(0.01);
      edges++;
    };
    for (const seg of parsePathData(d)) {
      if (seg.cmd === 'M') start = [seg.x, seg.y];
      if (seg.cmd === 'L' && prev) checkEdge(prev, [seg.x, seg.y]);
      if (seg.cmd === 'Z' && prev && start) checkEdge(prev, start); // замыкающее ребро
      if (seg.cmd !== 'Z') prev = [seg.x, seg.y];
    }
    expect(edges).toBe(8); // 4 плеча × 2 грани (7 L + Z-замыкание)
  });
});

describe('stroke-cross — вырождения (класс Д)', () => {
  it('параллельные оси → понятная ошибка', () => {
    expect(() => genStrokeCross([[[4, 8], [20, 8]], [[4, 12], [20, 12]]], pen)).toThrow(/параллельн/);
  });

  it('пересечение вне отрезка → понятная ошибка (T-стык не реализован)', () => {
    expect(() => genStrokeCross([[[4, 12], [20, 12]], [[12, 12], [12, 20]]], pen)).toThrow(/не пересекаются ВНУТРИ/);
  });

  it('перо съедает плечо → понятная ошибка', () => {
    expect(() => genStrokeCross([[[11, 11], [13, 13]], [[13, 11], [11, 13]]], 3)).toThrow(/съедает плечо/);
  });

  it('не две оси → понятная ошибка', () => {
    expect(() => genStrokeCross([[[4, 12], [20, 12]]], pen)).toThrow(/две оси/);
  });
});

describe('stroke-cross — потребители close/plus (класс Б, интеграция)', () => {
  for (const name of ['close', 'plus']) {
    it(`${name}: генерат единым контуром, EO≡NZ точно, пинчей нет`, () => {
      const d = buildGlyph(anatomy.glyphs[name], grid, {}, anatomy.glyphs).outline;
      expect(d.match(/M/g)).toHaveLength(1);
      const r = strictSeamReport(d, cw, grid);
      expect(r.coarse).toBe(0);
      expect(r.fine).toBe(0);
      expect(r.seams).toEqual([]);
    });
  }
});
