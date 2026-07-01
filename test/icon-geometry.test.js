/**
 * test/icon-geometry.test.js — извлечение геометрии слоёв (t1 ch02, эпик ds-icons).
 *
 * Классы: А (известная иконка), Б (весь корпус парсится, инварианты держатся).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { iconGeometry } from '../scripts/lib/icon-geometry.js';

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
