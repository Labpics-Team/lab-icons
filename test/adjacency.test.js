/**
 * Видящий гейт смежности: полный SVG baseline × per-variant части генерата.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  adjacencyDefectsBetween,
  checkGlyphVariant,
  handPathData,
  materializeParts,
  splitSubpaths,
} from '../scripts/check-adjacency.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));

function genPartsOf(entry, variant) {
  return materializeParts(entry, grid, anatomy.glyphs, variant);
}

const outlineSvg = readFileSync(
  join(root, 'svg', 'Outline', 'swap-horizontal.svg'),
  'utf8',
);
const outlineHandD = handPathData(outlineSvg);

describe('check-adjacency — вариантная смежность по неизменяемой руке', () => {
  const entry = anatomy.glyphs['swap-horizontal'];

  it('фикс swap-horizontal: Outline-палочки смыкаются с наконечниками', () => {
    expect(adjacencyDefectsBetween(outlineHandD, genPartsOf(entry, 'outline'))).toEqual([]);
  });

  it('возврат капа без socket и коротких концов обнаруживается как разрыв', () => {
    const broken = structuredClone(entry);
    const shaftA = broken.parts.find((part) => part.name === 'shaft-a');
    const shaftB = broken.parts.find((part) => part.name === 'shaft-b');
    delete shaftA.socket;
    delete shaftB.socket;
    shaftA.params.outline.points[1][0] = 0.211483;
    shaftB.params.outline.points[1][0] = 0.788101;

    const defects = adjacencyDefectsBetween(outlineHandD, genPartsOf(broken, 'outline'));
    expect(defects.length).toBeGreaterThan(0);
    expect(defects.every((defect) => defect.gap > 0.15)).toBe(true);
  });

  it('складывает все path руки: дефект во втором path больше нельзя потерять', () => {
    const multiPathSvg =
      '<svg>' +
      '<path d="M0 0H2V2H0Z"/>' +
      '<path d="M10 0H14V2H10Z"/>' +
      '</svg>';
    const handD = handPathData(multiPathSvg);
    expect(splitSubpaths(handD)).toHaveLength(2);

    const defects = adjacencyDefectsBetween(handD, [
      { name: 'left', d: 'M10 0H11V2H10Z' },
      { name: 'right', d: 'M13 0H14V2H13Z' },
    ]);
    expect(defects).toHaveLength(1);
    expect(defects[0]).toMatchObject({ a: 'left', b: 'right' });
  });

  it('generated Filled получает baseline из истории и реально материализуется', () => {
    const filledSvg = readFileSync(
      join(root, 'svg', 'Filled', 'swap-horizontal_filled.svg'),
      'utf8',
    );
    const handFromHistory = vi.fn(() => ({
      svg: filledSvg,
      sha: 'a'.repeat(40),
      shortSha: 'aaaaaaa',
      date: '2026-07-01',
      path: 'svg/Filled/swap-horizontal_filled.svg',
    }));

    const result = checkGlyphVariant({
      name: 'swap-horizontal',
      entry,
      variant: 'filled',
      grid,
      allGlyphs: anatomy.glyphs,
      repo: root,
      history: { handFromHistory },
    });

    expect(handFromHistory).toHaveBeenCalledWith(
      'svg/Filled/swap-horizontal_filled.svg',
      'swap-horizontal',
      'filled',
    );
    expect(result.errors).toEqual([]);
    expect(result.checked).toBe(true);
    expect(Array.isArray(result.defects)).toBe(true);
  });

  it('не подменяет отсутствующий historical baseline текущим генератом', () => {
    const result = checkGlyphVariant({
      name: 'swap-horizontal',
      entry,
      variant: 'outline',
      grid,
      allGlyphs: anatomy.glyphs,
      repo: root,
      history: { handFromHistory: () => null },
    });
    expect(result.checked).toBe(false);
    expect(result.errors[0]).toContain('historical hand baseline не найден');
  });

  it('swap-horizontal остаётся защищённым HARD-списком', () => {
    const promoted = JSON.parse(
      readFileSync(join(root, 'semantics', 'adjacency-promoted.json'), 'utf8'),
    ).promoted;
    expect(promoted).toContain('swap-horizontal');
  });
});
