/**
 * test/ring-canon.test.js — гейт канонов keyline-кольца (truth-reset).
 *
 * Класс дефекта: система не видела, что корпус несёт два веса кольца
 * (22×1.50 против руки 1.80) — расхождение канонов было невидимым.
 * Тесты фиксируют: измерение, декларацию (closed world), чувствительность
 * к смене канона и к неравномерному кольцу.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  RING_CANONS,
  measureAllRings,
  measureRing,
  nearestCanon,
} from '../scripts/lib/ring-canon.js';
import { validateRingCanons } from '../scripts/check-ring-canon.js';

const root = join(import.meta.dirname, '..');
const read = (rel) => readFileSync(join(root, 'svg', rel), 'utf8');

const ringSvg = (inner, cx = 12, cy = 12) =>
  '<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">' +
  `<path fill-rule="evenodd" d="M1 12a11 11 0 1 0 22 0a11 11 0 1 0 -22 0Z` +
  `M${cx - inner} ${cy}a${inner} ${inner} 0 1 1 ${2 * inner} 0a${inner} ${inner} 0 1 1 -${2 * inner} 0Z"/></svg>`;

describe('measureRing — измерение keyline-кольца', () => {
  it('канон 1.5: alert-circle медиана ≈1.5, разброс мал', () => {
    const m = measureRing(read('Outline/alert-circle.svg'));
    expect(m.found).toBe(true);
    expect(nearestCanon(m.median)).toBe(1.5);
    expect(m.spread).toBeLessThan(0.08);
  });

  it('канон 1.8: ban медиана ≈1.8', () => {
    const m = measureRing(read('Outline/ban.svg'));
    expect(m.found).toBe(true);
    expect(nearestCanon(m.median)).toBe(1.8);
  });

  it('синтетика: кольцо 11→9.5 даёт толщину 1.5', () => {
    const m = measureRing(ringSvg(9.5));
    expect(m.found).toBe(true);
    expect(m.median).toBeCloseTo(1.5, 1);
  });

  it('файл без keyline-кольца — found=false', () => {
    const m = measureRing(read('Outline/checkmark.svg'));
    expect(m.found).toBe(false);
  });
});

describe('measureAllRings — неравномерность (thSpread)', () => {
  it('концентричное кольцо: spread ≈ 0', () => {
    const rings = measureAllRings(ringSvg(9.2));
    expect(rings.length).toBe(1);
    expect(rings[0].spread).toBeLessThan(0.05);
  });

  it('неконцентричное кольцо (внутренняя окружность смещена на 0.3): spread ≈ 0.6', () => {
    const rings = measureAllRings(ringSvg(9.2, 12, 12.3));
    expect(rings.length).toBe(1);
    expect(rings[0].spread).toBeGreaterThan(0.4);
  });
});

describe('validateRingCanons — closed world и чувствительность', () => {
  const files = [{ name: 'Outline/demo.svg', content: ringSvg(9.5) }];

  it('кольцо без декларации — HARD', () => {
    const { hard } = validateRingCanons({
      registry: { version: 1, rings: {}, spreadDebt: {} },
      files,
    });
    expect(hard.some((e) => e.includes('closed world'))).toBe(true);
  });

  it('замер сходится с каноном — PASS', () => {
    const { hard } = validateRingCanons({
      registry: { version: 1, rings: { 'Outline/demo.svg': { canon: 1.5 } }, spreadDebt: {} },
      files,
    });
    expect(hard).toEqual([]);
  });

  it('декларация не сходится с замером — HARD (ловит смену канона файла)', () => {
    const { hard } = validateRingCanons({
      registry: { version: 1, rings: { 'Outline/demo.svg': { canon: 1.8 } }, spreadDebt: {} },
      files,
    });
    expect(hard.some((e) => e.includes('не сходится'))).toBe(true);
  });

  it('расхождение canon≠hand — report (вкус #43), не HARD', () => {
    const { hard, report } = validateRingCanons({
      registry: {
        version: 1,
        rings: { 'Outline/demo.svg': { canon: 1.5, hand: 1.8 } },
        spreadDebt: {},
      },
      files,
    });
    expect(hard).toEqual([]);
    expect(report.some((e) => e.includes('#43'))).toBe(true);
  });

  it('неравномерное кольцо без spreadDebt — HARD; с долгом — PASS', () => {
    const uneven = [{ name: 'Outline/u.svg', content: ringSvg(9.2, 12, 12.3) }];
    const noDebt = validateRingCanons({
      registry: { version: 1, rings: { 'Outline/u.svg': { canon: 1.8 } }, spreadDebt: {} },
      files: uneven,
    });
    expect(noDebt.hard.some((e) => e.includes('spreadDebt'))).toBe(true);
    const withDebt = validateRingCanons({
      registry: {
        version: 1,
        rings: { 'Outline/u.svg': { canon: 1.8 } },
        spreadDebt: { 'Outline/u.svg': 0.7 },
      },
      files: uneven,
    });
    expect(withDebt.hard).toEqual([]);
  });

  it('реестр канонов ограничен легальными весами', () => {
    expect(RING_CANONS).toEqual([1.5, 1.8, 2.4]);
    const { hard } = validateRingCanons({
      registry: { version: 1, rings: { 'Outline/demo.svg': { canon: 2.0 } }, spreadDebt: {} },
      files,
    });
    expect(hard.some((e) => e.includes('вне легальных'))).toBe(true);
  });
});
