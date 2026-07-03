/**
 * test/path-bbox.test.js — парсер SVG path `d` + точный bbox (t1 ch02, эпик ds-icons).
 *
 * Контракт scripts/lib/path-data.js:
 *   - parsePathData(d) → массив сегментов абсолютных команд (M/L/C/Q/A/Z),
 *     H/V/S/T/relative нормализованы; арк-флаги парсятся и в сжатой форме («011»).
 *   - pathBBox(d) → { minX, minY, maxX, maxY } ТОЧНЫЙ: экстремумы кубиков/
 *     квадратиков через корни производной, дуг — через центральную
 *     параметризацию (W3C B.2.4) и осевые углы; НЕ приближение контрольными точками.
 *   - samplePath(d, stepsPerSeg) → плотная полилиния (независимая оценка:
 *     де Кастельжо / шаг по углу) — оракл для дифференциального теста.
 *
 * TDD RED-proof: написан до scripts/lib/path-data.js → импорт падает.
 * Классы: А (известные фигуры), В (дифференциал по ВСЕМ 444 реальным SVG:
 * каждый сэмпл ⊆ bbox и каждая грань bbox касается сэмпла).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parsePathData, pathBBox, samplePath } from '../scripts/lib/path-data.js';

describe('path-data — parsePathData: токенизация', () => {
  it('А: компактные числа svgo («.5.5», «1-1», экспоненты)', () => {
    const segs = parsePathData('M.5.5L1-1l2e1 .5');
    expect(segs[0]).toEqual({ cmd: 'M', x: 0.5, y: 0.5 });
    expect(segs[1]).toEqual({ cmd: 'L', x: 1, y: -1 });
    expect(segs[2]).toEqual({ cmd: 'L', x: 21, y: -0.5 });
  });

  it('А: сжатые арк-флаги «a1 1 0 011-1» (флаги без разделителей)', () => {
    const segs = parsePathData('M0 0a1 1 0 011-1');
    expect(segs[1].cmd).toBe('A');
    expect(segs[1].largeArc).toBe(0);
    expect(segs[1].sweep).toBe(1);
    expect(segs[1].x).toBeCloseTo(1, 12);
    expect(segs[1].y).toBeCloseTo(-1, 12);
  });

  it('А: H/V/S/T и relative нормализуются в абсолютные M/L/C/Q/A/Z', () => {
    const segs = parsePathData('M1 1h2v3s1 1 2 2t1 1z');
    const cmds = segs.map((s) => s.cmd).join('');
    expect(cmds).toBe('MLLCQZ');
    expect(segs[1]).toEqual({ cmd: 'L', x: 3, y: 1 });
    expect(segs[2]).toEqual({ cmd: 'L', x: 3, y: 4 });
  });

  it('А: повтор координат после M — неявный L (SVG-грамматика)', () => {
    const segs = parsePathData('M0 0 5 5 10 0');
    expect(segs.map((s) => s.cmd).join('')).toBe('MLL');
    expect(segs[2]).toEqual({ cmd: 'L', x: 10, y: 0 });
  });
});

describe('path-bbox — известные фигуры (ручной расчёт)', () => {
  it('А: прямоугольник из линий', () => {
    expect(pathBBox('M1 2L9 2L9 8L1 8Z')).toEqual({ minX: 1, minY: 2, maxX: 9, maxY: 8 });
  });

  it('А: кубик с экстремумом выше опорных точек: M0,0 C0,10 10,10 10,0 → maxY=7.5', () => {
    // Экстремум кубика Безье с P1y=P2y=10: y(0.5)=0.125·0+0.375·10+0.375·10+0.125·0=7.5.
    // Mutation proof: заменить экстремум-корни на bbox контрольных точек → maxY=10 → RED.
    const b = pathBBox('M0 0C0 10 10 10 10 0');
    expect(b.minX).toBeCloseTo(0, 9);
    expect(b.maxX).toBeCloseTo(10, 9);
    expect(b.minY).toBeCloseTo(0, 9);
    expect(b.maxY).toBeCloseTo(7.5, 9);
  });

  it('А: квадратик: M0,0 Q5,10 10,0 → maxY=5', () => {
    const b = pathBBox('M0 0Q5 10 10 0');
    expect(b.maxY).toBeCloseTo(5, 9);
  });

  it('А: полный круг двумя дугами: bbox = квадрат диаметра', () => {
    const b = pathBBox('M0 5A5 5 0 1 1 10 5A5 5 0 1 1 0 5Z');
    expect(b.minX).toBeCloseTo(0, 9);
    expect(b.minY).toBeCloseTo(0, 9);
    expect(b.maxX).toBeCloseTo(10, 9);
    expect(b.maxY).toBeCloseTo(10, 9);
  });

  it('А: полуокружность (sweep вниз): нижний экстремум внутри дуги', () => {
    // M0,0 A5 5 0 0 0 10,0 : sweep=0 → дуга через (5,5)... направление по спеке:
    // sweep=0 = против часовой в системе y-вниз → дуга уходит в y>0 через (5,5).
    const b = pathBBox('M0 0A5 5 0 0 0 10 0');
    expect(b.minX).toBeCloseTo(0, 9);
    expect(b.maxX).toBeCloseTo(10, 9);
    expect(b.maxY).toBeCloseTo(5, 9);
    expect(b.minY).toBeCloseTo(0, 9);
  });

  it('А: повёрнутый эллипс-дуга — bbox совпадает с плотным сэмплом', () => {
    const d = 'M0 0A10 4 30 1 1 3 2';
    const b = pathBBox(d);
    const pts = samplePath(d, 2048);
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
    expect(b.minX).toBeCloseTo(minX, 3);
    expect(b.minY).toBeCloseTo(minY, 3);
    expect(b.maxX).toBeCloseTo(maxX, 3);
    expect(b.maxY).toBeCloseTo(maxY, 3);
  });

  it('А: вырожденная дуга (rx=0) трактуется как линия (спека F.6.6)', () => {
    expect(pathBBox('M0 0A0 5 0 0 1 10 3')).toEqual({ minX: 0, minY: 0, maxX: 10, maxY: 3 });
  });
});

describe('path-bbox — дифференциал по ВСЕМ реальным иконкам (444 SVG)', () => {
  const root = join(import.meta.dirname, '..', 'svg');
  const files = [];
  for (const variant of ['Outline', 'Filled']) {
    for (const f of readdirSync(join(root, variant))) {
      if (f.endsWith('.svg')) files.push(join(root, variant, f));
    }
  }

  it('В: 444 файла найдены', () => {
    expect(files.length).toBe(444);
  });

  it('В: каждый path каждого файла — сэмплы ⊆ bbox (равенство краёв точное) и bbox плотный', () => {
    // Mutation proof: сломать экстремумы дуг (пропустить осевые углы) →
    // «bbox плотный» падает на круглых иконках; сломать знак корня в центре
    // дуги → «сэмплы ⊆ bbox» падает массово.
    const CONTAIN_EPS = 1e-6; // сэмплы строго внутри (экстремумы точнее сэмплов)
    const TOUCH_EPS = 0.02;   // каждая грань должна быть достигнута сэмплом
    let paths = 0;
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      const ds = [...content.matchAll(/ d="([^"]+)"/g)].map((m) => m[1]);
      expect(ds.length, file).toBeGreaterThan(0);
      for (const d of ds) {
        paths++;
        const b = pathBBox(d);
        expect(Number.isFinite(b.minX + b.minY + b.maxX + b.maxY), `${file} finite`).toBe(true);
        const pts = samplePath(d, 512);
        let sMinX = Infinity, sMinY = Infinity, sMaxX = -Infinity, sMaxY = -Infinity;
        for (const [x, y] of pts) {
          expect(x >= b.minX - CONTAIN_EPS && x <= b.maxX + CONTAIN_EPS, `${file} x=${x} vs [${b.minX},${b.maxX}]`).toBe(true);
          expect(y >= b.minY - CONTAIN_EPS && y <= b.maxY + CONTAIN_EPS, `${file} y=${y} vs [${b.minY},${b.maxY}]`).toBe(true);
          if (x < sMinX) sMinX = x;
          if (y < sMinY) sMinY = y;
          if (x > sMaxX) sMaxX = x;
          if (y > sMaxY) sMaxY = y;
        }
        expect(sMinX - b.minX, `${file} тугость minX`).toBeLessThan(TOUCH_EPS);
        expect(sMinY - b.minY, `${file} тугость minY`).toBeLessThan(TOUCH_EPS);
        expect(b.maxX - sMaxX, `${file} тугость maxX`).toBeLessThan(TOUCH_EPS);
        expect(b.maxY - sMaxY, `${file} тугость maxY`).toBeLessThan(TOUCH_EPS);
      }
    }
    expect(paths).toBeGreaterThan(600); // 444 файла, многие мульти-path
  });

  it('В: все bbox внутри viewBox 24×24 (с полем на сглаживание 0.5)', () => {
    for (const file of files) {
      const content = readFileSync(file, 'utf8');
      for (const m of content.matchAll(/ d="([^"]+)"/g)) {
        const b = pathBBox(m[1]);
        expect(b.minX, file).toBeGreaterThanOrEqual(-0.5);
        expect(b.minY, file).toBeGreaterThanOrEqual(-0.5);
        expect(b.maxX, file).toBeLessThanOrEqual(24.5);
        expect(b.maxY, file).toBeLessThanOrEqual(24.5);
      }
    }
  });
});
