/**
 * check-adjacency.test.js — юнит на КЛАСС «разрыв смежности на генерате».
 * TDD-класс А (unit) + Б (характеризация фикстур). Закон смежности выводится
 * из руки; тест доказывает, что зазор→FAIL, перекрытие→PASS, и что легально
 * раздельные части (разные компоненты руки) НЕ дают ложных срабатываний.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  adjacencyDefectsBetween,
  findAdjacencyDefects,
  gapBetween,
  splitSubpaths,
} from '../scripts/check-adjacency.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (n) => JSON.parse(readFileSync(join(here, 'fixtures', 'adjacency', n), 'utf8'));

describe('splitSubpaths', () => {
  it('разбивает path на суб-пути по M', () => {
    expect(splitSubpaths('M0 0L1 0Z M2 2L3 2Z')).toHaveLength(2);
  });
});

describe('gapBetween', () => {
  const mk = (d) => {
    const subPolys = splitSubpaths(d).map((s) => require_sample(s));
    return { subPolys, pts: subPolys.flat() };
  };
  // локальный сэмплер через публичный splitSubpaths + прямые точки прямоугольника
  function require_sample(d) {
    // грубая полилиния из явных L-вершин фикстур (прямоугольники) достаточна
    return [...d.matchAll(/(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)/g)].map((m) => [
      Number(m[1]),
      Number(m[2]),
    ]);
  }
  it('перекрытие → 0', () => {
    expect(gapBetween(mk('M2 6L6 6L6 10L2 10Z'), mk('M5 6L20 6L20 10L5 10Z'))).toBe(0);
  });
  it('разрыв → положительное расстояние', () => {
    expect(gapBetween(mk('M2 6L6 6L6 10L2 10Z'), mk('M9 6L20 6L20 10L9 10Z'))).toBeGreaterThan(2);
  });
});

describe('adjacencyDefectsBetween (закон из руки, проверка на генерате)', () => {
  it('перекрытая фикстура → ноль дефектов (PASS)', () => {
    const f = fx('overlap.json');
    expect(adjacencyDefectsBetween(f.hand, f.parts)).toHaveLength(0);
  });

  it('разорванная фикстура → дефект с именами частей и зазором (FAIL)', () => {
    const f = fx('gap.json');
    const defects = adjacencyDefectsBetween(f.hand, f.parts);
    expect(defects).toHaveLength(1);
    expect([defects[0].a, defects[0].b].sort()).toEqual(['partA', 'partB']);
    expect(defects[0].gap).toBeGreaterThan(0.15);
  });

  it('части в РАЗНЫХ компонентах руки не обязаны смыкаться (нет ложных срабатываний)', () => {
    // рука = ДВЕ раздельные области; по одной части в каждой → разные comp → 0 дефектов
    const hand = 'M1 1L5 1L5 5L1 5Z M15 1L19 1L19 5L15 5Z';
    const parts = [
      { name: 'left', d: 'M2 2L4 2L4 4L2 4Z' },
      { name: 'right', d: 'M16 2L18 2L18 4L16 4Z' },
    ];
    expect(adjacencyDefectsBetween(hand, parts)).toHaveLength(0);
  });
});

describe('findAdjacencyDefects — часть вне компоненты руки (comp<0) не кластеризуется', () => {
  it('unassigned часть игнорируется', () => {
    const parts = [
      { name: 'a', comp: -1, subPolys: [[[0, 0]]], pts: [[0, 0]] },
      { name: 'b', comp: 0, subPolys: [[[10, 10]]], pts: [[10, 10]] },
    ];
    expect(findAdjacencyDefects(parts)).toHaveLength(0);
  });
});
