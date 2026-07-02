/**
 * test/motion-geometry.test.js — математика гейтов моушна (BL-006).
 *
 * Контракты: разбор transform-строк генерата, применение вокруг якоря
 * (transform-box: view-box семантика), интерполяция кейфреймов во времени
 * (delay/стаггер/fill both), ink-overlap (even-odd, кольцо с дыркой).
 * Классы: А (юниты чистой математики). RED-first.
 */

import { describe, expect, it } from 'vitest';
import {
  inkOverlap,
  parseTransformString,
  samplePolylines,
  transformAt,
  transformPoint,
} from '../scripts/lib/motion-geometry.js';

const close = (a, b) => expect(a).toBeCloseTo(b, 6);

describe('parseTransformString', () => {
  it('А: rotate + scale + translate с единицами', () => {
    expect(parseTransformString('rotate(90deg) scale(1, 2) translate(-2.5px, 0px)')).toEqual([
      { fn: 'rotate', args: [90] },
      { fn: 'scale', args: [1, 2] },
      { fn: 'translate', args: [-2.5, 0] },
    ]);
  });

  it('А: пустая строка/undefined → пусто (кадр без transform)', () => {
    expect(parseTransformString(undefined)).toEqual([]);
    expect(parseTransformString('')).toEqual([]);
  });
});

describe('transformPoint — вокруг якоря, порядок функций CSS (слева — внешняя)', () => {
  it('А: rotate(90deg) вокруг (12,12): (12,2) → (22,12)', () => {
    const [x, y] = transformPoint([12, 2], parseTransformString('rotate(90deg)'), [12, 12]);
    close(x, 22);
    close(y, 12);
  });

  it('А: scale(2,1) вокруг (10,10): (11,13) → (12,13)', () => {
    const [x, y] = transformPoint([11, 13], parseTransformString('scale(2, 1)'), [10, 10]);
    close(x, 12);
    close(y, 13);
  });

  it('А: scaleY вокруг якоря (12,12): (12,18) при 0.5 → (12,15)', () => {
    const [x, y] = transformPoint([12, 18], parseTransformString('scaleY(0.5)'), [12, 12]);
    close(x, 12);
    close(y, 15);
  });

  it('А: translate не зависит от якоря', () => {
    const [x, y] = transformPoint([5, 5], parseTransformString('translate(3px, -1px)'), [12, 12]);
    close(x, 8);
    close(y, 4);
  });

  it('А: rotate(90) scale(0.5) вокруг (0,0): (10,0) → сначала сжатие, потом поворот → (0,5)', () => {
    const [x, y] = transformPoint(
      [10, 0],
      parseTransformString('rotate(90deg) scale(0.5, 0.5)'),
      [0, 0],
    );
    close(x, 0);
    close(y, 5);
  });
});

describe('transformAt — значение transform части в момент времени', () => {
  const part = {
    keyframes: [
      { offset: 0, transform: 'rotate(0deg)' },
      { offset: 0.5, transform: 'rotate(180deg)' },
      { offset: 1, transform: 'rotate(360deg)' },
    ],
    timing: { duration: 1000, delay: 200, iterations: 1 },
  };

  it('А: до delay (fill both) → первый кадр', () => {
    expect(transformAt(part, 0, 0)).toEqual([{ fn: 'rotate', args: [0] }]);
  });

  it('А: середина активной фазы → линейная интерполяция аргументов', () => {
    // t=700 → активная доля (700-200)/1000 = 0.5 → ровно кадр rotate(180)
    expect(transformAt(part, 700, 0)).toEqual([{ fn: 'rotate', args: [180] }]);
    // t=450 → доля 0.25 → между 0 и 180 → 90
    expect(transformAt(part, 450, 0)).toEqual([{ fn: 'rotate', args: [90] }]);
  });

  it('А: после конца (fill both) → последний кадр; стаггер сдвигает фазу', () => {
    expect(transformAt(part, 5000, 0)).toEqual([{ fn: 'rotate', args: [360] }]);
    // стаггер 300мс: t=750 → доля (750-200-300)/1000=0.25 → 90
    expect(transformAt(part, 750, 300)).toEqual([{ fn: 'rotate', args: [90] }]);
  });
});

describe('samplePolylines — суб-пути раздельно', () => {
  it('А: два квадрата в одном d → две замкнутые полилинии', () => {
    const polys = samplePolylines('M0 0h2v2H0zM10 10h2v2h-2z', 4);
    expect(polys).toHaveLength(2);
    const xs0 = polys[0].map((p) => p[0]);
    const xs1 = polys[1].map((p) => p[0]);
    expect(Math.max(...xs0)).toBeLessThanOrEqual(2);
    expect(Math.min(...xs1)).toBeGreaterThanOrEqual(10);
  });
});

describe('inkOverlap — пересечение чернил (even-odd)', () => {
  const square = (x, y, s) => [
    [x, y],
    [x + s, y],
    [x + s, y + s],
    [x, y + s],
    [x, y],
  ];

  it('А: раздельные фигуры → false', () => {
    expect(inkOverlap([square(0, 0, 2)], [square(10, 10, 2)])).toBe(false);
  });

  it('А: пересекающиеся контуры → true', () => {
    expect(inkOverlap([square(0, 0, 4)], [square(2, 2, 4)])).toBe(true);
  });

  it('А: фигура целиком ВНУТРИ сплошной фигуры → true (наслоение без пересечения рёбер)', () => {
    expect(inkOverlap([square(4, 4, 2)], [square(0, 0, 10)])).toBe(true);
  });

  it('А: фигура в ДЫРКЕ кольца (even-odd) → false (язычок в окне колокола — не наслоение)', () => {
    const ring = [square(0, 0, 10), square(2, 2, 6)]; // внешний контур + дырка
    expect(inkOverlap([square(4, 4, 2)], ring)).toBe(false);
  });
});
