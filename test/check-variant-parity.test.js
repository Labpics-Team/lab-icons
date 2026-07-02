/**
 * test/check-variant-parity.test.js — гейт геометрического контракта пары
 * Outline↔Filled (BL-016). Классы: А (юнит на синтетике), Д-паттерн (каждое
 * правило доказано фикстурой-нарушителем). RED-first.
 *
 * Контракт: кольца/диски держат каноны (Ø = keyline.circle; толщина кольца =
 * базис 1.8 для предметных ИЛИ enclosureRing 1.5 для обрамлений — третьего
 * канона нет); глиф внутри обрамления регистрируется между вариантами.
 */

import { describe, expect, it } from 'vitest';
import { validateVariantParity } from '../scripts/check-variant-parity.js';

const grid = {
  canvas: { width: 24, height: 24 },
  ratios: {
    keylines: { circle: 22 / 24 },
    strokeWidth: { base: 1.8 / 24, enclosureRing: 1.5 / 24 },
    tolerances: {
      ringWeight: 0.12 / 24,
      ringDiameter: 0.2 / 24,
      variantRegistration: 0.15 / 24,
    },
  },
};

/** Кольцо из двух концентрических кругов + опциональный глиф-квадрат. */
function outlineSvg({ rOuter = 11, rInner = 9.5, glyphCy = 12 } = {}) {
  const circle = (r) =>
    `M${12 - r} 12a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  const glyph = `M10 ${glyphCy - 2}h4v4h-4z`;
  return (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
    `<path d="${circle(rOuter)}${circle(rInner)}"/><path d="${glyph}"/></svg>`
  );
}

/** Диск + глиф-дырка (негатив). */
function filledSvg({ rDisc = 11, glyphCy = 12 } = {}) {
  const circle = (r) =>
    `M${12 - r} 12a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  const glyph = `M10 ${glyphCy - 2}h4v4h-4z`;
  return (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
    `<path fill-rule="evenodd" d="${circle(rDisc)}${glyph}"/></svg>`
  );
}

function run(pairs) {
  return validateVariantParity({ grid, pairs });
}

describe('validateVariantParity — каноны колец и регистрация пары', () => {
  it('А: обрамление 1.5 с совпадающей регистрацией → чисто', () => {
    const { hard, report } = run([
      { name: 'demo', outline: outlineSvg(), filled: filledSvg() },
    ]);
    expect(hard).toEqual([]);
    expect(report).toEqual([]);
  });

  it('А: предметное кольцо на базисе 1.8 → легально (второй канон)', () => {
    const { hard, report } = run([
      { name: 'subject', outline: outlineSvg({ rInner: 9.2 }), filled: filledSvg() },
    ]);
    expect(hard).toEqual([]);
    expect(report).toEqual([]);
  });

  it('Д: кольцо 1.65 — между канонами → нарушение веса кольца', () => {
    const { report } = run([
      { name: 'между', outline: outlineSvg({ rInner: 9.35 }), filled: filledSvg() },
    ]);
    expect(report.some((e) => e.includes('между') && e.includes('канон'))).toBe(true);
  });

  it('Д: внешний Ø кольца 21.4 ≠ keyline 22 → нарушение диаметра', () => {
    const { report } = run([
      { name: 'малый', outline: outlineSvg({ rOuter: 10.7, rInner: 9.2 }), filled: filledSvg() },
    ]);
    expect(report.some((e) => e.includes('малый') && e.includes('Ø'))).toBe(true);
  });

  it('Д: глиф в Filled уехал на 0.5 по Y → нарушение регистрации', () => {
    const { report } = run([
      { name: 'сдвиг', outline: outlineSvg(), filled: filledSvg({ glyphCy: 12.5 }) },
    ]);
    expect(report.some((e) => e.includes('сдвиг') && e.includes('регистрац'))).toBe(true);
  });

  it('А: иконка без кольца пропускается молча', () => {
    const plain =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
      '<path d="M4 4h16v16H4z"/></svg>';
    const { hard, report } = run([{ name: 'plain', outline: plain, filled: plain }]);
    expect(hard).toEqual([]);
    expect(report).toEqual([]);
  });
});
