/**
 * test/check-ink-topology.test.js — движок счёта чернильной топологии.
 *
 * Класс А (unit): инварианты счёта компонентов/дыр на синтетических фигурах —
 * закрывают КЛАСС ошибок счёта (связность, рамка, порог осколка), а не кейсы
 * владельца (те — RED-proof arg-режима CLI, их чинит демоут-прогон и держит
 * allowlist semantics/ink-topology-promoted.json).
 */

import { describe, expect, it } from 'vitest';
import {
  MIN_FEATURE_AREA,
  inkTopologyOf,
  topologyDefectsBetween,
} from '../scripts/check-ink-topology.js';

const CW = 24;

// Синтетика: прямоугольники path-data на канве 24.
const rect = (x, y, w, h) => `M${x} ${y}h${w}v${h}h${-w}Z`;

describe('inkTopologyOf — счёт компонентов и дыр', () => {
  it('один квадрат: 1 компонент, 0 дыр', () => {
    const t = inkTopologyOf(rect(4, 4, 8, 8), CW);
    expect(t.components.length).toBe(1);
    expect(t.holes.length).toBe(0);
  });

  it('квадрат с дырой (even-odd): 1 компонент, 1 дыра', () => {
    const t = inkTopologyOf(rect(4, 4, 12, 12) + rect(8, 8, 4, 4), CW);
    expect(t.components.length).toBe(1);
    expect(t.holes.length).toBe(1);
  });

  it('два раздельных квадрата: 2 компонента', () => {
    const t = inkTopologyOf(rect(2, 2, 6, 6) + rect(14, 14, 6, 6), CW);
    expect(t.components.length).toBe(2);
    expect(t.holes.length).toBe(0);
  });

  it('негатив, открытый к рамке (C-форма), — НЕ дыра', () => {
    // Рамка-квадрат с щелью справа: внутренний негатив сообщается с внешним.
    const c = 'M4 4h16v4h-12v8h12v4H4Z';
    const t = inkTopologyOf(c, CW);
    expect(t.holes.length).toBe(0);
  });

  it('касание только по диагонали: 8-связность чернил склеивает (1 компонент)', () => {
    const t = inkTopologyOf(rect(4, 4, 6, 6) + rect(10, 10, 6, 6), CW);
    expect(t.components.length).toBe(1);
  });

  it('осколок мельче порога виден в списке с малой площадью', () => {
    const t = inkTopologyOf(rect(2, 2, 10, 10) + rect(20, 20, 0.5, 0.5), CW);
    expect(t.components.length).toBe(2);
    expect(Math.min(...t.components)).toBeLessThan(MIN_FEATURE_AREA);
  });
});

describe('topologyDefectsBetween — инвариант рука==генерат', () => {
  it('идентичные фигуры: дефектов нет', () => {
    const d = rect(4, 4, 12, 12) + rect(8, 8, 4, 4);
    expect(topologyDefectsBetween(d, d, CW)).toEqual([]);
  });

  it('рука 1 компонент, генерат разрезан на 2 — дефект счёта компонентов', () => {
    const hand = rect(4, 10, 16, 4); // единая палочка
    const gen = rect(4, 10, 7, 4) + rect(13, 10, 7, 4); // разрез со щелью 2px
    const defects = topologyDefectsBetween(hand, gen, CW);
    expect(defects.some((s) => s.includes('компонент') && s.includes('1') && s.includes('2'))).toBe(true);
  });

  it('рука без дыры, генерат с дырой — дефект счёта дыр', () => {
    const hand = rect(4, 4, 12, 12);
    const gen = rect(4, 4, 12, 12) + rect(8, 8, 4, 4);
    const defects = topologyDefectsBetween(hand, gen, CW);
    expect(defects.some((s) => s.includes('дыр'))).toBe(true);
  });

  it('осколок в генерате — дефект «осколок», даже при равных счётах структуры', () => {
    const hand = rect(4, 4, 12, 12);
    const gen = rect(4, 4, 12, 12) + rect(20, 20, 0.5, 0.5);
    const defects = topologyDefectsBetween(hand, gen, CW);
    expect(defects.some((s) => s.includes('осколок'))).toBe(true);
  });

  it('грязь в РУКЕ не заставляет генерат её воспроизводить (счёт — по значимым)', () => {
    const hand = rect(4, 4, 12, 12) + rect(20, 20, 0.5, 0.5);
    const gen = rect(4, 4, 12, 12);
    expect(topologyDefectsBetween(hand, gen, CW)).toEqual([]);
  });
});

describe('порог осколка — вывод из grid, не хардкод', () => {
  it('MIN_FEATURE_AREA = (capRadius·канва)² из semantics/grid.json', () => {
    expect(MIN_FEATURE_AREA).toBeCloseTo((0.0375 * 24) ** 2, 10);
  });
});
