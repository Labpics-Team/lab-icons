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
function outlineSvg({ rOuter = 11, rInner = 9.5, glyphCx = 12, glyphCy = 12 } = {}) {
  const circle = (r) =>
    `M${12 - r} 12a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  const glyph = `M${glyphCx - 2} ${glyphCy - 2}h4v4h-4z`;
  return (
    '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
    `<path d="${circle(rOuter)}${circle(rInner)}"/><path d="${glyph}"/></svg>`
  );
}

/** Диск + глиф-дырка (негатив). */
function filledSvg({ rDisc = 11, glyphCx = 12, glyphCy = 12 } = {}) {
  const circle = (r) =>
    `M${12 - r} 12a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`;
  const glyph = `M${glyphCx - 2} ${glyphCy - 2}h4v4h-4z`;
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

  it('Д: глиф в Filled уехал на 0.5 по X → нарушение регистрации', () => {
    const { report } = run([
      { name: 'сдвиг-x', outline: outlineSvg(), filled: filledSvg({ glyphCx: 12.5 }) },
    ]);
    expect(report.some((e) => e.includes('сдвиг-x') && e.includes('регистрац'))).toBe(true);
  });

  it('Д: Ø диска 21 ≠ keyline 22 в Filled → нарушение диаметра диска', () => {
    const { report } = run([
      { name: 'диск-мал', outline: outlineSvg(), filled: filledSvg({ rDisc: 10.5 }) },
    ]);
    expect(report.some((e) => e.includes('диск-мал') && e.includes('Ø диска'))).toBe(true);
  });

  it('Д: нечитаемый вариант → hard (гейт не молчит)', () => {
    const broken =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path d="M1 X"/></svg>';
    const { hard } = run([{ name: 'битый', outline: outlineSvg(), filled: broken }]);
    expect(hard.some((e) => e.includes('битый') && e.includes('не читается'))).toBe(true);
  });

  it('Д: пропавший токен в grid.json → бросок, не тихий PASS (NaN-защита)', () => {
    const gridNoToken = JSON.parse(JSON.stringify(grid));
    delete gridNoToken.ratios.tolerances.variantRegistration;
    expect(() =>
      validateVariantParity({
        grid: gridNoToken,
        pairs: [{ name: 'demo', outline: outlineSvg(), filled: filledSvg() }],
      }),
    ).toThrow(/variantRegistration|токен/);
  });

  it('А: регистрация меряется и без кольца — по совпавшим контурам', () => {
    const noRingO =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
      '<path d="M10 10h4v4h-4z"/></svg>';
    const noRingF =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
      '<path d="M10 10.5h4v4h-4z"/></svg>';
    const { report } = run([{ name: 'безкольца', outline: noRingO, filled: noRingF }]);
    expect(report.some((e) => e.includes('безкольца') && e.includes('регистрац'))).toBe(true);
  });

  it('А: несопоставимые контуры (структурная разница вариантов) не дают ложного дрейфа', () => {
    // Filled сливает детали: контуров с похожей сигнатурой нет — молчим
    const oSmall =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
      '<path d="M10 10h4v4h-4z"/></svg>';
    const fBig =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
      '<path d="M4 4h16v16H4z"/></svg>';
    const { hard, report } = run([{ name: 'структ', outline: oSmall, filled: fBig }]);
    expect(hard).toEqual([]);
    expect(report).toEqual([]);
  });

  it('А: иконка без кольца и без совпавших контуров пропускается молча', () => {
    const plain =
      '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
      '<path d="M4 4h16v16H4z"/></svg>';
    const { hard, report } = run([{ name: 'plain', outline: plain, filled: plain }]);
    expect(hard).toEqual([]);
    expect(report).toEqual([]);
  });
});
