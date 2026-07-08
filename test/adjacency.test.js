/**
 * test/adjacency.test.js — видящий гейт смежности (check-adjacency) в suite.
 *
 * Закрывает КЛАСС «две части, связные в руке, разорванные в генерате» и
 * РЕГРЕССИЮ промоутнутого флагмана swap-horizontal: если кто-то вернёт зазор
 * (концы палочки 0.141146/0.856875 → до-фиксовые 0.211483/0.788101),
 * findAdjacencyDefects ОБЯЗАН его увидеть, а promoted-allowlist — сделать
 * корпусный CI HARD-красным. Закон стыка: торцевой кап палочки КАСАЕТСЯ
 * вершины шеврона (конец оси = вершина + полуширина штриха вдоль оси).
 *
 * Класс А (unit): fixed → ноль дефектов; broken → дефект (гейт кусается).
 * Класс Д (диверсия): пертурбация ОДНОГО токена (конец палочки) распространяется
 * в разрыв — доказывает, что закон видит генерат, а не хардкод.
 * Класс Б (regression): swap-horizontal остаётся в HARD-allowlist.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { adjacencyDefectsBetween } from '../scripts/check-adjacency.js';
import { renderedPathData } from '../scripts/lib/icon-geometry.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));

/** Per-part outline-генерат глифа как [{name,d}] — как materializeParts гейта. */
function genPartsOf(entry) {
  const out = [];
  for (const part of entry.parts) {
    // partsScope — как materializeParts гейта: изолированная часть видит
    // полный список частей (резолв socket-сиблинга)
    const built = buildGlyph({ ...entry, parts: [part], partsScope: entry.parts }, grid, {}, anatomy.glyphs);
    if (built.outline) out.push({ name: part.name || `part${out.length}`, d: built.outline });
  }
  return out;
}

const handD = renderedPathData(
  readFileSync(join(root, 'svg', 'Outline', 'swap-horizontal.svg'), 'utf8'),
)[0];

describe('check-adjacency — видящий гейт смежности на генерате', () => {
  const entry = anatomy.glyphs['swap-horizontal'];

  it('А: фикс swap-horizontal — палочки смыкаются с наконечниками (ноль дефектов)', () => {
    const defects = adjacencyDefectsBetween(handD, genPartsOf(entry));
    expect(defects).toEqual([]);
  });

  it('Д: возврат зазора (пертурбация конца палочки) → гейт видит разрыв', () => {
    // мутируем ТОЛЬКО концы палочек (outline) обратно к до-фиксовым значениям
    const broken = structuredClone(entry);
    const shaftA = broken.parts.find((p) => p.name === 'shaft-a');
    const shaftB = broken.parts.find((p) => p.name === 'shaft-b');
    shaftA.params.outline.points[1][0] = 0.211483;
    shaftB.params.outline.points[1][0] = 0.788101;
    const defects = adjacencyDefectsBetween(handD, genPartsOf(broken));
    expect(defects.length).toBeGreaterThan(0);
    // разрыв именно палочка↔наконечник, зазор выше ε
    expect(defects.every((d) => d.gap > 0.15)).toBe(true);
  });

  it('Б: swap-horizontal — в HARD-allowlist промоушена (регрессия ловится в CI)', () => {
    const promoted = JSON.parse(
      readFileSync(join(root, 'semantics', 'adjacency-promoted.json'), 'utf8'),
    ).promoted;
    expect(promoted).toContain('swap-horizontal');
  });
});
