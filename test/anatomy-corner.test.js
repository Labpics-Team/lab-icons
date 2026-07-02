/**
 * test/anatomy-corner.test.js — суперэллипсное скругление ζ (BL-014, токен
 * grid.cornerSmoothing=0.6, утверждён владельцем). Классы:
 *   B (golden): дифференциал против эталона figma-squircle (реверс Figma,
 *     которым рисовалась рука) — фикстуры сгенерены пакетом один раз;
 *   А (инварианты): ζ=0 → чистая дуга; концы фрагмента на гранях в ±p;
 *   Д (мутант): порча формулы валит golden-сравнение.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { cornerParams, smoothCorner90 } from '../scripts/lib/anatomy-gen.js';
import { inkIoU } from '../scripts/check-anatomy.js';

const golden = JSON.parse(
  readFileSync(join(import.meta.dirname, 'fixtures-squircle-golden.json'), 'utf8'),
);

/** Квадрат 16×16 в (0,0) из четырёх smoothCorner90 (обход по часовой). */
function square(R, zeta) {
  const f3 = (v) => v.toFixed(3);
  const corners = [
    { V: [16, 0], u: [1, 0], w: [0, 1] },   // верх-право
    { V: [16, 16], u: [0, 1], w: [-1, 0] }, // низ-право
    { V: [0, 16], u: [-1, 0], w: [0, -1] }, // низ-лево
    { V: [0, 0], u: [0, -1], w: [1, 0] },   // верх-лево
  ].map(({ V, u, w }) => smoothCorner90(V, u, w, R, zeta));
  return (
    `M${f3(corners[3].end[0])} ${f3(corners[3].end[1])}` +
    corners.map((c) => `L${f3(c.start[0])} ${f3(c.start[1])}${c.d}`).join('') +
    'Z'
  );
}

describe('smoothCorner90 — профиль ζ (радиус фиксирован, сглаживается вход)', () => {
  it('B: дифференциал с эталоном figma-squircle — IoU ≥ 99.9% на трёх (R, ζ)', () => {
    for (const [key, dGolden] of Object.entries(golden)) {
      const [R, z] = key.replace('R', '').split('_z').map(Number);
      const iou = inkIoU(square(R, z), dGolden, 16, 0.08);
      expect(iou, key).toBeGreaterThan(0.999);
    }
  });

  it('А: ζ=0 — фрагмент вырождается в чистую дугу (p = R, кубики нулевой длины)', () => {
    const { p, arcLen, a, b, c, d } = cornerParams(4, 0);
    expect(p).toBeCloseTo(4, 9);
    expect(arcLen).toBeCloseTo(4 * Math.SQRT2 * Math.sin(Math.PI / 4), 6);
    expect(a + b + c + d).toBeCloseTo(p - arcLen, 9);
  });

  it('А: концы фрагмента лежат на гранях в ±p от вершины', () => {
    const { p } = cornerParams(4.5, 0.6);
    const { start, end } = smoothCorner90([16, 0], [1, 0], [0, 1], 4.5, 0.6);
    expect(start[0]).toBeCloseTo(16 - p, 9);
    expect(start[1]).toBeCloseTo(0, 9);
    expect(end[0]).toBeCloseTo(16, 9);
    expect(end[1]).toBeCloseTo(p, 9);
  });

  it('Д: мутант (ζ занижен вдвое) — golden-сравнение падает ниже порога', () => {
    const iou = inkIoU(square(4.5, 0.3), golden['R4.5_z0.6'], 16, 0.08);
    expect(iou).toBeLessThan(0.9995);
  });
});
