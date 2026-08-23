/**
 * offline-cov00/measure.test.js — метрики COV-00 обязаны уметь падать.
 *
 * Классы:
 *   1. Хаусдорф = 0 на идентичных масках; растёт при сдвиге (sabotage).
 *   2. IoU падает при сдвиге, а Хаусдорф ловит выброс, который IoU прощает
 *      (тонкий штрих: класс из памяти «IoU непригоден для тонких штрихов»).
 *   3. Пустая маска → Infinity, не ложный 0.
 */

import { describe, expect, it } from 'vitest';
import { maskOf, iouOfMasks, hausdorffCells } from './measure.mjs';

const rect = (x, y, w, h) => `M${x} ${y}L${x + w} ${y}L${x + w} ${y + h}L${x} ${y + h}Z`;
const entry = (d) => [{ d, fillRule: 'nonzero' }];

describe('hausdorffCells', () => {
  it('идентичные маски → 0', () => {
    const A = maskOf(entry(rect(4, 4, 16, 16)));
    expect(hausdorffCells(A, A)).toBe(0);
  });

  it('sabotage: сдвиг на 1.2 юнита (10 клеток) ловится', () => {
    const A = maskOf(entry(rect(4, 4, 12, 12)));
    const B = maskOf(entry(rect(5.2, 4, 12, 12)));
    expect(hausdorffCells(A, B)).toBeGreaterThanOrEqual(9);
  });

  it('тонкий штрих: маленький выброс, который IoU прощает, Хаусдорф ловит', () => {
    // Основная площадь 16×16 + далёкий хвост 0.3×3 у кандидата.
    const A = maskOf(entry(rect(4, 4, 16, 16)));
    const B = maskOf([...entry(rect(4, 4, 16, 16)), { d: rect(22, 20, 0.6, 3), fillRule: 'nonzero' }]);
    expect(iouOfMasks(A, B)).toBeGreaterThan(0.99); // IoU почти не видит
    expect(hausdorffCells(A, B)).toBeGreaterThan(1); // Хаусдорф видит
  });

  it('пустая маска → Infinity', () => {
    const A = maskOf(entry(rect(4, 4, 16, 16)));
    const empty = { mask: new Uint8Array(A.mask.length), cols: A.cols, rows: A.rows };
    expect(hausdorffCells(A, empty)).toBe(Infinity);
  });
});

describe('iouOfMasks', () => {
  it('идентичные → 1; непересекающиеся → 0', () => {
    const A = maskOf(entry(rect(2, 2, 8, 8)));
    const B = maskOf(entry(rect(14, 14, 8, 8)));
    expect(iouOfMasks(A, A)).toBe(1);
    expect(iouOfMasks(A, B)).toBe(0);
  });
});
