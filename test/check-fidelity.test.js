/**
 * test/check-fidelity.test.js — пол узнаваемости генерата (рефрейм).
 * Классы: А (валидные проходят), Д (мутанты: ниже пола / необъяснённое
 * падение / не-число — валятся; grandfather не hard).
 */

import { describe, expect, it } from 'vitest';
import { validateFidelity } from '../scripts/check-fidelity.js';

const glyph = (over = {}) => ({
  status: { outline: 'generated', filled: 'generated' },
  fidelityToHand: { outline: 0.995, filled: 0.994 },
  ...over,
});
const run = (glyphs) => validateFidelity({ anatomy: { glyphs } });

describe('check-fidelity — пол узнаваемости', () => {
  it('А: генерат ≥0.99 на обоих — чисто', () => {
    expect(run({ a: glyph() }).hard).toEqual([]);
  });

  it('А: падение <0.99 С correctionReason — принято', () => {
    const r = run({ a: glyph({ fidelityToHand: { outline: 0.997, filled: 0.982 }, correctionReason: 'дрейф bold' }) });
    expect(r.hard).toEqual([]);
  });

  it('А: hand-статус игнорируется (гейт только про generated)', () => {
    const r = run({ a: { status: { outline: 'hand', filled: 'hand' } } });
    expect(r.hard).toEqual([]);
    expect(r.report).toEqual([]);
  });

  it('Д: fidelity < пол 0.97 — HARD (под угрозой узнаваемость)', () => {
    const r = run({ a: glyph({ fidelityToHand: { outline: 0.995, filled: 0.96 }, correctionReason: 'x' }) });
    expect(r.hard.length).toBe(1);
    expect(r.hard[0]).toMatch(/filled.*< пол/);
  });

  it('Д: падение <0.99 БЕЗ correctionReason — HARD (необъяснённая отсебятина)', () => {
    const r = run({ a: glyph({ fidelityToHand: { outline: 0.998, filled: 0.982 } }) });
    expect(r.hard.length).toBe(1);
    expect(r.hard[0]).toMatch(/без correctionReason/);
  });

  it('Д: fidelityToHand не число — HARD', () => {
    const r = run({ a: glyph({ fidelityToHand: { outline: 0.99, filled: 'x' } }) });
    expect(r.hard.length).toBe(1);
    expect(r.hard[0]).toMatch(/не число/);
  });

  it('Д→report: generated без fidelityToHand — grandfather (report, НЕ hard)', () => {
    const r = run({ a: { status: { outline: 'generated', filled: 'generated' } } });
    expect(r.hard).toEqual([]);
    expect(r.report.length).toBe(1);
    expect(r.report[0]).toMatch(/бэкфилл/);
  });

  it('А: только outline generated — filled-fidelity не требуется', () => {
    const r = run({ a: { status: { outline: 'generated', filled: 'hand' }, fidelityToHand: { outline: 0.995 } } });
    expect(r.hard).toEqual([]);
  });
});

describe('check-fidelity — ярус ниже пола (эскалация владельцу)', () => {
  const belowFloor = (over = {}) => ({
    status: { outline: 'generated', filled: 'generated' },
    fidelityToHand: { outline: 0.99, filled: 0.86 },
    ...over,
  });
  const run = (glyphs) => validateFidelity({ anatomy: { glyphs } });

  it('Д: <0.97 БЕЗ ownerReview — HARD (неэскалированная развилка)', () => {
    const r = run({ a: belowFloor() });
    expect(r.hard.length).toBe(1);
    expect(r.hard[0]).toMatch(/подтвердить\/поправить закон/);
  });

  it('А: <0.97 С ownerReview — report (закон подтверждён), НЕ hard', () => {
    const r = run({ a: belowFloor({ ownerReview: 'крупная чистка — закон подтверждён' }) });
    expect(r.hard).toEqual([]);
    expect(r.report.some((e) => e.includes('закон подтверждён владельцем'))).toBe(true);
  });
});
