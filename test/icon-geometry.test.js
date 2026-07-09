/**
 * test/icon-geometry.test.js — извлечение геометрии слоёв (t1 ch02, эпик ds-icons).
 *
 * Классы: А (известная иконка), Б (весь корпус парсится, инварианты держатся).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iconGeometry, renderedPathData } from '../scripts/lib/icon-geometry.js';
import { samplePolylines } from '../scripts/lib/curve-sampling.js';

const root = join(import.meta.dirname, '..', 'svg');

describe('icon-geometry — известная иконка notifications (колокольчик)', () => {
  const svg = readFileSync(join(root, 'Outline', 'notifications.svg'), 'utf8');
  const g = iconGeometry(svg);

  it('А: viewBox 24×24, два слоя-path (язычок + корпус)', () => {
    expect(g.viewBox).toEqual({ x: 0, y: 0, width: 24, height: 24 });
    expect(g.paths).toHaveLength(2);
  });

  it('А: слой 0 (язычок) существенно меньше слоя 1 (корпус); якорь = центр bbox', () => {
    const [clapper, body] = g.paths;
    expect(clapper.area).toBeLessThan(body.area / 5);
    // Язычок внизу по центру: якорь около x=12, y≈21-22
    expect(clapper.anchor.x).toBeCloseTo(12, 0);
    expect(clapper.anchor.y).toBeGreaterThan(19);
    for (const p of g.paths) {
      expect(p.anchor.x).toBeCloseTo((p.bbox.minX + p.bbox.maxX) / 2, 12);
      expect(p.anchor.y).toBeCloseTo((p.bbox.minY + p.bbox.maxY) / 2, 12);
    }
  });
});

describe('icon-geometry — path внутри <defs> не геометрия (класс clipPath-фантома)', () => {
  // 8 иконок корпуса (scan/timer/headphone/cog…) несут служебный clipPath
  // с прямоугольником во всю канву — он числил их «руинами с нулевыми полями»
  const withClip =
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
    '<g clip-path="url(#a)"><path d="M8 8h8v8H8z"/></g>' +
    '<defs><clipPath id="a"><path d="M0 0h24v24H0z"/></clipPath></defs></svg>';

  it('Д: renderedPathData видит только рендерящийся глиф', () => {
    expect(renderedPathData(withClip)).toEqual(['M8 8h8v8H8z']);
  });

  it('Д: iconGeometry не отдаёт фантомный слой во всю канву', () => {
    const g = iconGeometry(withClip);
    expect(g.paths).toHaveLength(1);
    expect(g.paths[0].bbox).toEqual({ minX: 8, minY: 8, maxX: 16, maxY: 16 });
  });

  it('Д: реальный scan_filled — ни один слой не лежит на краю канвы', () => {
    const g = iconGeometry(readFileSync(join(root, 'Filled', 'scan_filled.svg'), 'utf8'));
    for (const p of g.paths) {
      expect(p.bbox.minX).toBeGreaterThan(0.5);
      expect(p.bbox.minY).toBeGreaterThan(0.5);
      expect(p.bbox.maxX).toBeLessThan(23.5);
      expect(p.bbox.maxY).toBeLessThan(23.5);
    }
  });
});

describe('icon-geometry — join-безопасность d-строк (класс фантома за канвой)', () => {
  // первый moveto path-элемента абсолютен по спеке даже при «m»; при
  // join('') он продолжался от конца предыдущего path — у 6 файлов
  // корпуса это давало фантомную «геометрию за канвой» (35..42 юнита)
  const twoPaths =
    '<svg viewBox="0 0 24 24"><path d="M2 2h4v4H2z"/>' +
    '<path d="m10 10 2 0 0 2-2 0z"/></svg>';

  it('Д: головы нормализованы — m→M с явной l перед неявным хвостом', () => {
    const ds = renderedPathData(twoPaths);
    expect(ds[1]).toMatch(/^M10 10/);
  });

  it('Д: join двух d даёт ту же геометрию, что path по отдельности', () => {
    const ds = renderedPathData(twoPaths);
    const joined = samplePolylines(ds.join(''), 16).filter((p) => p.length > 2);
    for (const poly of joined) {
      for (const [x, y] of poly) {
        expect(x).toBeGreaterThan(1);
        expect(x).toBeLessThan(15); // без нормализации второй квадрат уезжал к (16,16)+
        expect(y).toBeLessThan(15);
      }
    }
  });

  it('Д: слитные SVG-числа в голове — «m6.5 7.57.62.5a…» не склеивается (класс radio)', () => {
    // жадный [\d.]+ съедал «7.57.62.5» как одно «число» → клин в канве
    const ds = renderedPathData('<svg viewBox="0 0 24 24"><path d="m6.5 7.57.62.5a1 1 0 0 1 1 1z"/></svg>');
    expect(ds[0]).toMatch(/^M6\.5 7\.57l\.62/);
  });

  it('Д: radio через renderedPathData — все точки в канве (не битые, не за канвой)', () => {
    const ds = renderedPathData(readFileSync(join(root, 'Outline', 'radio.svg'), 'utf8'));
    const polys = samplePolylines(ds.join(''), 16).filter((p) => p.length > 2);
    for (const poly of polys) {
      for (const [x, y] of poly) {
        expect(x).toBeGreaterThan(-0.5);
        expect(x).toBeLessThan(24.5);
        expect(y).toBeGreaterThan(-0.5);
        expect(y).toBeLessThan(24.5);
      }
    }
  });

  it('Д: реальный headphone_filled — join без фантомов за канвой', () => {
    const ds = renderedPathData(readFileSync(join(root, 'Filled', 'headphone_filled.svg'), 'utf8'));
    const polys = samplePolylines(ds.join(''), 16).filter((p) => p.length > 2);
    for (const poly of polys) {
      for (const [x, y] of poly) {
        expect(x).toBeLessThan(24.5);
        expect(y).toBeLessThan(24.5);
      }
    }
  });
});

describe('icon-geometry — весь корпус 444', () => {
  it('Б: каждый файл парсится; у каждого слоя якорь внутри viewBox, площадь > 0', () => {
    let files = 0;
    for (const variant of ['Outline', 'Filled']) {
      for (const f of readdirSync(join(root, variant))) {
        if (!f.endsWith('.svg')) continue;
        files++;
        const g = iconGeometry(readFileSync(join(root, variant, f), 'utf8'));
        expect(g.paths.length, f).toBeGreaterThan(0);
        for (const p of g.paths) {
          expect(p.anchor.x, f).toBeGreaterThanOrEqual(-0.5);
          expect(p.anchor.x, f).toBeLessThanOrEqual(24.5);
          expect(p.anchor.y, f).toBeGreaterThanOrEqual(-0.5);
          expect(p.anchor.y, f).toBeLessThanOrEqual(24.5);
          expect(p.area, f).toBeGreaterThan(0);
        }
      }
    }
    expect(files).toBe(444);
  });
});
