/**
 * test/check-anatomy.test.js — гейт дрейфа «анатомия ↔ файл» (BL-015).
 * Классы: А (интеграция на реальных semantics+svg), Д (мутанты параметров).
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { validateAnatomy } from '../scripts/check-anatomy-drift.js';

const root = join(import.meta.dirname, '..');
const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
const readSvg = (variant, name) => {
  const file =
    variant === 'outline'
      ? join(root, 'svg', 'Outline', `${name}.svg`)
      : join(root, 'svg', 'Filled', `${name}_filled.svg`);
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
};

describe('validateAnatomy — декларация сходится с файлами', () => {
  it('А: реальная анатомия — ноль hard; report только документированные отступления от руки', () => {
    const { hard, report, checked } = validateAnatomy({ grid, anatomy, readSvg });
    expect(hard).toEqual([]);
    // допустимые report-строки: КАЖДАЯ несёт документацию в декларации —
    // reload/filled (дефект руки), swap-horizontal (закон смежности поверх
    // пустого раскрыва руки: lawOverHand + correctionReason в anatomy.json)
    const documented = ['reload/filled', 'swap-horizontal/outline', 'swap-horizontal/filled'];
    expect(report.filter((e) => !documented.some((p) => e.startsWith(p)))).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(6);
  });

  it('Д: мутант параметра generated-глифа (rTip +5%) → hard-дрейф', () => {
    const mutant = JSON.parse(JSON.stringify(anatomy));
    mutant.glyphs.cog.params.rTip *= 1.05;
    // force generated для теста (cog может быть demoted в реальной анатомии после гейтов)
    if (!mutant.glyphs.cog.status) mutant.glyphs.cog.status = {};
    mutant.glyphs.cog.status.outline = 'generated';
    const { hard } = validateAnatomy({ grid, anatomy: mutant, readSvg });
    expect(hard.some((e) => e.includes('cog') && e.includes('дрейф'))).toBe(true);
  });

  it('Д: мутант якоря hand-глифа (сдвиг 1.5) → report-расхождение', () => {
    const mutant = JSON.parse(JSON.stringify(anatomy));
    // Образец делается hand ПО ПОСТРОЕНИЮ: статус глифа в корпусе меняется
    // волнами промоушена (chevron-down стал generated), а тест проверяет
    // ветку report ДЛЯ hand-статуса — фиксация статуса в мутанте отвязывает
    // тест от текущего состояния корпуса, не меняя ни ветку, ни порог.
    mutant.glyphs['chevron-down'].status = { outline: 'hand', filled: 'hand' };
    mutant.glyphs['chevron-down'].inkAnchors.endL[1] += 1.5 / grid.canvas.width;
    mutant.glyphs['chevron-down'].inkAnchors.innerL[1] += 1.5 / grid.canvas.width;
    const { report } = validateAnatomy({ grid, anatomy: mutant, readSvg });
    expect(report.some((e) => e.includes('chevron-down/'))).toBe(true);
  });

  it('Д: заявленный вариант без файла → hard', () => {
    const { hard } = validateAnatomy({
      grid,
      anatomy,
      readSvg: (v, n) => (n === 'cog' ? null : readSvg(v, n)),
    });
    expect(hard.some((e) => e.includes('cog') && e.includes('файла нет'))).toBe(true);
  });
});
