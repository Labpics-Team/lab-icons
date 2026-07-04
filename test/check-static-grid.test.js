/**
 * test/check-static-grid.test.js — сетка v3: охранный клиренс между
 * элементами (канон 0.8 — дескриптивно из корпуса: ниже только аномалии
 * класса схлопнутой прожилки earth). Классы: А (синтетика) + Д (порог).
 */

import { describe, expect, it } from 'vitest';
import { validateStaticGrid } from '../scripts/check-static-grid.js';

const GRID = {
  canvas: { width: 24, height: 24 },
  ratios: {
    margin: 1 / 24,
    keylines: { circle: 22 / 24 },
    clearanceMin: 0.8 / 24,
    tolerances: {
      canvas: 0.01 / 24,
      marginReport: 0.05 / 24,
      marginHard: 0.7 / 24,
      circleCenter: 0.15 / 24,
    },
  },
};

const wrap = (paths) =>
  '<svg viewBox="0 0 24 24">' + paths.map((d) => `<path d="${d}"/>`).join('') + '</svg>';

const run = (svg) =>
  validateStaticGrid({ grid: GRID, files: [{ name: 'demo.svg', content: svg }] });

describe('static-grid v3 — охранный клиренс', () => {
  it('Д: зазор 0.5 между элементами → находка «охранный зазор»', () => {
    const { report } = run(wrap(['M4 4h6v6H4z', 'M10.5 4h6v6h-6z']));
    expect(report.some((e) => e.includes('охранный'))).toBe(true);
  });

  it('А: зазор 1.5 (в каноне) → чисто', () => {
    const { report } = run(wrap(['M4 4h6v6H4z', 'M11.5 4h6v6h-6z']));
    expect(report.filter((e) => e.includes('охранный'))).toEqual([]);
  });

  it('А: вложенная пара (рамка) — не клиренс, не флагается', () => {
    const { report } = run(wrap(['M4 4h16v16H4z', 'M6 6h12v12H6z']));
    expect(report.filter((e) => e.includes('охранный'))).toEqual([]);
  });

  it('А: нулевой стык — зона гейта швов, клиренс-гейт молчит', () => {
    const { report } = run(wrap(['M4 4h6v6H4z', 'M10 4h6v6h-6z']));
    expect(report.filter((e) => e.includes('охранный'))).toEqual([]);
  });
});
