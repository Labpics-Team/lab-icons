import { describe, expect, it } from 'vitest';
import { inkIoU } from '../scripts/check-anatomy-drift.js';
import { samplePolylines } from '../scripts/lib/curve-sampling.js';

// Независимый поточечный эталон из исходной реализации.
function referenceIoU(dA, dB, cw, step) {
  const A = samplePolylines(dA, 24).filter(p => p.length > 2);
  const B = samplePolylines(dB, 24).filter(p => p.length > 2);
  function contains(polys, x, y) {
    let hits = 0;
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i];
        const [x2, y2] = poly[(i + 1) % poly.length];
        if (y1 > y !== y2 > y && x < x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)) hits++;
      }
    }
    return hits % 2 === 1;
  }
  let both = 0, onlyA = 0, onlyB = 0;
  for (let x = step / 2; x < cw; x += step) {
    for (let y = step / 2; y < cw; y += step) {
      const a = contains(A, x, y), b = contains(B, x, y);
      if (a && b) both++;
      else if (a) onlyA++;
      else if (b) onlyB++;
    }
  }
  return both / (both + onlyA + onlyB || 1);
}

const paths = [
  'M0 0H6V6H0Z',
  'M0.06 0.06H5.94V5.94H0.06Z', // центры проб на границах
  'M1 1H5V5H1Z M2 2H4V4H2Z', // отверстие
  'M1 1H5V5H1Z M1 1H5V5H1Z', // совпавшие контуры взаимно исключаются при evenodd
  'M0 0L6 6L0 6L6 0Z', // самопересечение
  'M1 3C1 0 5 0 5 3C5 6 1 6 1 3Z',
  'M1 3A2 2 0 1 1 5 3A2 2 0 1 1 1 3Z',
  'M-4 -4H-2V-2H-4Z', // весь контур вне холста
  'M0 0L1 1', // без полигона
  'M1 1L3 1L5 1Z', // вырожденный горизонтальный полигон
];

describe('IoU по строкам сохраняет каждую пробу', () => {
  for (const step of [0.12, 0.5, 0.7]) {
    it(`совпадает с поточечным эталоном для всех пар при шаге ${step}`, () => {
      for (const a of paths) {
        for (const b of paths) {
          expect(inkIoU(a, b, 6, step), `${a} / ${b}`).toBe(referenceIoU(a, b, 6, step));
        }
      }
    });
  }
});
