/**
 * test/anatomy-gen-corners.test.js — EC3: ПЕР-ВЕРШИННАЯ КОРНЕР-РОЛЬ.
 *
 * ЗАКОН (N3): скругление берётся из декларации corners[] генератором из
 * ДАННЫХ, а не из одного глобального скаляра. Острый угол руки НИКОГДА не
 * округляется генератом. genRoundedPolygon/genRoundedRect читают роль вершины
 * из corners[], при её отсутствии — глобальный скаляр как дефолт.
 *
 * Классы Фаулера:
 *   А (закон): декларация с РОВНО одним sharp-углом среди скруглённых даёт
 *     замеренный радиус r≈0 (в пределах eps) ровно на той вершине и r>порог
 *     на скруглённых — замер через scripts/lib/corners.js (дифференциальная
 *     мера радиуса Δs/|Δθ| отгружённого пути, тот же примитив, что check-corners).
 *   Б (обратная совместимость): при отсутствии corners[] вывод БАЙТ-В-БАЙТ
 *     идентичен baseline (пустой corners[] ⇒ все вершины на глобальном скаляре).
 *
 * RED-PROOF (до правки генератора): 4-й аргумент corners[] игнорируется, все
 * вершины скругляются глобальным r ⇒ замеренный радиус на «sharp»-вершине ≈ r,
 * а НЕ ≈0 ⇒ ассерт sharp<eps падает. Зеленеет ПОСЛЕ реализации пер-вершинности.
 */

import { describe, expect, it } from 'vitest';
import { genRoundedPolygon, genRoundedRect } from '../scripts/lib/anatomy-gen.js';
import { cornerRadii } from '../scripts/lib/corners.js';

// Радиус скругления, замеренный на вершине пути, ближайшей к точке V.
function radiusNear(d, V) {
  const cs = cornerRadii(d);
  let best = null;
  let bestDist = Infinity;
  for (const c of cs) {
    const dist = Math.hypot(c.x - V[0], c.y - V[1]);
    if (dist < bestDist) { bestDist = dist; best = c; }
  }
  return { radius: best ? best.radius : null, dist: bestDist, count: cs.length };
}

describe('genRoundedPolygon — пер-вершинная корнер-роль (EC3)', () => {
  // Квадрат 12×12: стороны 12 ≫ порога SIDE_RATIO·diag ⇒ 4 чётких угла.
  const square = [[6, 6], [18, 6], [18, 18], [6, 18]];
  const R = 3;
  const EPS = 0.25;      // «острый»: радиус < eps (доля диагонали bbox 16.97)
  const ROUND_MIN = 1.2; // «скруглённый»: замеренный радиус > порога

  it('А: РОВНО один sharp-угол среди скруглённых ⇒ r≈0 там, r>порог на остальных', () => {
    // Вершина 0 [6,6] острая, остальные три скруглены глобальным R.
    const corners = [{ sharp: true }, { r: R }, { r: R }, { r: R }];
    const d = genRoundedPolygon(square, R, 0, corners);
    expect(d).not.toMatch(/NaN|Infinity/);

    const sharp = radiusNear(d, [6, 6]);
    // ЗАКОН: острая вершина НЕ скруглена генератом.
    expect(sharp.radius).not.toBeNull();
    expect(sharp.radius).toBeLessThan(EPS);

    // Остальные три — скруглены на ≈R.
    for (const V of [[18, 6], [18, 18], [6, 18]]) {
      const c = radiusNear(d, V);
      expect(c.radius).toBeGreaterThan(ROUND_MIN);
    }
  });

  it('А: {r:number} задаёт РАЗНЫЕ радиусы пер-вершинно', () => {
    const corners = [{ r: 1 }, { r: 4 }, { r: 1 }, { r: 4 }];
    const d = genRoundedPolygon(square, R, 0, corners);
    const rBig = radiusNear(d, [18, 6]).radius;   // r:4
    const rSmall = radiusNear(d, [6, 6]).radius;   // r:1
    expect(rBig).toBeGreaterThan(rSmall + 1);
  });

  it('Б: обратная совместимость — omitted corners == пустой corners[] (fallback на скаляр)', () => {
    const baseline = genRoundedPolygon(square, R, 0.6);
    const empty = genRoundedPolygon(square, R, 0.6, []);
    expect(empty).toBe(baseline);
  });
});

describe('genRoundedRect — пер-вершинная корнер-роль (EC3)', () => {
  const cx = 12, cy = 12, w = 14, h = 10, R = 2.5;
  // Порядок corners[] у genRoundedRect: [верх-право, низ-право, низ-лево, верх-лево].
  const TR = [cx + w / 2, cy - h / 2]; // 19, 7
  const BR = [cx + w / 2, cy + h / 2]; // 19, 17
  const BL = [cx - w / 2, cy + h / 2]; // 5, 17
  const EPS = 0.25;
  const ROUND_MIN = 1.0;

  it('А: sharp на верх-право ⇒ r≈0 там, r>порог на остальных', () => {
    const corners = [{ sharp: true }, { r: R }, { r: R }, { r: R }];
    const d = genRoundedRect(cx, cy, w, h, R, 0, 0, corners);
    expect(d).not.toMatch(/NaN|Infinity/);

    const sharp = radiusNear(d, TR);
    expect(sharp.radius).not.toBeNull();
    expect(sharp.radius).toBeLessThan(EPS);

    for (const V of [BR, BL]) {
      const c = radiusNear(d, V);
      expect(c.radius).toBeGreaterThan(ROUND_MIN);
    }
  });

  it('Б: обратная совместимость — omitted corners == пустой corners[]', () => {
    const baseline = genRoundedRect(cx, cy, w, h, R, 0.6);
    const empty = genRoundedRect(cx, cy, w, h, R, 0.6, 0, []);
    expect(empty).toBe(baseline);
  });
});
