/**
 * test/axis-debt-triage.test.js — гейт триажа долга осей (AX-01).
 *
 * Закрывает КЛАСС «долг тихо теряется или размывается»: closed-world против
 * axis-quality.json (усечённый триаж падает), закрытый enum классов (мусорный
 * класс падает), обязательный evidence (пустое обоснование падает).
 * RED-кейсы — на синтетических входах функции: гейт обязан кусаться независимо
 * от текущего содержимого источника. GREEN — живая проекция проходит гейт.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTriage, checkTriage, TRIAGE_CLASSES } from '../scripts/check-axis-triage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const disabled = JSON.parse(readFileSync(join(ROOT, 'semantics', 'axis-quality.json'), 'utf8')).disabled;

/** Синтетический источник: 2 записи, обе не-rect → redraw-required. */
const synthDisabled = { 'alpha/outline/weight': {}, 'beta/outline/weight': {} };

describe('check-axis-triage: RED — гейт кусается (синтетические входы)', () => {
  it('усечённый триаж (потерянная запись) падает', () => {
    const truncated = buildTriage(synthDisabled);
    delete truncated.entries['alpha/outline/weight'];
    const { errors } = checkTriage(truncated, synthDisabled);
    expect(errors.some((e) => e.includes('отсутствуют') && e.includes('alpha/outline/weight'))).toBe(true);
  });

  it('фантомная запись вне axis-quality падает', () => {
    const inflated = buildTriage(synthDisabled);
    inflated.entries['ghost/outline/weight'] = { class: 'law-fix', evidence: 'x' };
    const { errors } = checkTriage(inflated, synthDisabled);
    expect(errors.some((e) => e.includes('фантомные') && e.includes('ghost/outline/weight'))).toBe(true);
  });

  it('класс вне enum падает', () => {
    const bad = buildTriage(synthDisabled);
    bad.entries['alpha/outline/weight'].class = 'unclassified';
    const { errors } = checkTriage(bad, synthDisabled);
    expect(errors.some((e) => e.includes('alpha/outline/weight') && e.includes('вне enum'))).toBe(true);
  });

  it('пустой evidence падает', () => {
    const bad = buildTriage(synthDisabled);
    bad.entries['alpha/outline/weight'].evidence = '  ';
    const { errors } = checkTriage(bad, synthDisabled);
    expect(errors.some((e) => e.includes('alpha/outline/weight') && e.includes('пустой evidence'))).toBe(true);
  });

  it('null-запись падает ошибкой валидации, не TypeError', () => {
    const bad = buildTriage(synthDisabled);
    bad.entries['alpha/outline/weight'] = null;
    const { errors } = checkTriage(bad, synthDisabled);
    expect(errors.some((e) => e.includes('alpha/outline/weight') && e.includes('не является объектом'))).toBe(true);
  });
});

describe('axis-debt-triage: GREEN — живая проекция валидна', () => {
  it('проекция проходит гейт closed-world на всех disabled-записях источника', () => {
    const triage = buildTriage(disabled);
    const { errors, total } = checkTriage(triage, disabled);
    expect(errors).toEqual([]);
    expect(total).toBe(Object.keys(disabled).length);
  });

  it('каждый класс — из закрытого enum, unclassified не существует', () => {
    expect(TRIAGE_CLASSES).not.toContain('unclassified');
    for (const entry of Object.values(buildTriage(disabled).entries)) {
      expect(TRIAGE_CLASSES).toContain(entry.class);
    }
  });

  it('asm02 = доля первых 20 записей в порядке источника без redraw-required', () => {
    const triage = buildTriage(disabled);
    const { asm02 } = checkTriage(triage, disabled);
    const first20 = Object.keys(disabled).slice(0, 20);
    const expected = first20.filter((k) => triage.entries[k].class !== 'redraw-required').length / 20;
    expect(asm02).toBe(expected);
  });
});
