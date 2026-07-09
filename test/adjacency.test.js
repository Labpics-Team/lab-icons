/**
 * test/adjacency.test.js — видящий гейт смежности (check-adjacency) в suite.
 *
 * Закрывает КЛАСС «две части, связные в руке, разорванные в генерате» и
 * РЕГРЕССИЮ промоутнутого флагмана swap-horizontal. Закон стыка (2026-07-09):
 * торец палочки — СОКЕТ-ВСТЫК по граням вогнутого miter-клина шеврона
 * (genStrokePath socket, класс time): касание без щели и без перекрытия
 * (перекрытие давало белый полумесяц под evenodd — скриншот владельца).
 *
 * Класс А (unit): fixed → ноль дефектов; broken → дефект (гейт кусается).
 * Класс Д (диверсия): возврат до-фиксовой конструкции (кап-торец без сокета,
 * короткие концы палочек) → гейт видит разрыв — закон смотрит генерат, не хардкод.
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

/** Per-part outline-генерат глифа как [{name,d}] — как materializeParts гейта.
 * partsScope отдаёт изолированной части полный список частей декларации —
 * сокет-торец конструируется от сиблинга-шеврона (см. buildGlyph). */
function genPartsOf(entry) {
  const out = [];
  for (const part of entry.parts) {
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

  it('Д: возврат до-фиксовой конструкции (кап без сокета, короткие концы) → гейт видит разрыв', () => {
    // до-фиксовая транскрипция руки: торец — круглый кап, конец оси не доходит
    // до клина шеврона (щель раскрыва). Сокет снят + концы возвращены.
    const broken = structuredClone(entry);
    const shaftA = broken.parts.find((p) => p.name === 'shaft-a');
    const shaftB = broken.parts.find((p) => p.name === 'shaft-b');
    delete shaftA.socket;
    delete shaftB.socket;
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
