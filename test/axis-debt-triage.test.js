/**
 * test/axis-debt-triage.test.js — гейт триажа долга осей (AX-01).
 *
 * Закрывает КЛАСС «долг тихо теряется или размывается»: closed-world против
 * axis-quality.json (усечённый триаж падает), закрытый enum классов (мусорный
 * класс падает), обязательный evidence (пустое обоснование падает).
 * GREEN — сгенерированный артефакт проходит гейт и воспроизводим генератором.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildTriage, TRIAGE_CLASSES } from '../scripts/build-axis-debt-triage.mjs';
import { checkTriage } from '../scripts/check-axis-triage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const disabled = JSON.parse(readFileSync(join(ROOT, 'semantics', 'axis-quality.json'), 'utf8')).disabled;
const committed = JSON.parse(readFileSync(join(ROOT, 'semantics', 'axis-debt-triage.json'), 'utf8'));

describe('check-axis-triage: RED — гейт кусается', () => {
  it('усечённый триаж (потерянная запись) падает', () => {
    const truncated = structuredClone(committed);
    const firstKey = Object.keys(truncated.entries)[0];
    delete truncated.entries[firstKey];
    const { errors } = checkTriage(truncated, disabled);
    expect(errors.some((e) => e.includes('отсутствуют') && e.includes(firstKey))).toBe(true);
  });

  it('фантомная запись вне axis-quality падает', () => {
    const inflated = structuredClone(committed);
    inflated.entries['ghost/outline/weight'] = { class: 'law-fix', evidence: 'x' };
    const { errors } = checkTriage(inflated, disabled);
    expect(errors.some((e) => e.includes('фантомные'))).toBe(true);
  });

  it('класс вне enum падает', () => {
    const bad = structuredClone(committed);
    const key = Object.keys(bad.entries)[0];
    bad.entries[key].class = 'unclassified';
    const { errors } = checkTriage(bad, disabled);
    expect(errors.some((e) => e.includes(key) && e.includes('вне enum'))).toBe(true);
  });

  it('пустой evidence падает', () => {
    const bad = structuredClone(committed);
    const key = Object.keys(bad.entries)[0];
    bad.entries[key].evidence = '  ';
    const { errors } = checkTriage(bad, disabled);
    expect(errors.some((e) => e.includes(key) && e.includes('пустой evidence'))).toBe(true);
  });
});

describe('axis-debt-triage: GREEN — артефакт валиден', () => {
  it('закоммиченный артефакт проходит гейт closed-world на 66 записях', () => {
    const { errors, total } = checkTriage(committed, disabled);
    expect(errors).toEqual([]);
    expect(total).toBe(66);
  });

  it('артефакт бит-в-бит воспроизводим генератором', () => {
    expect(buildTriage(disabled)).toEqual(committed);
  });

  it('каждый класс — из закрытого enum, unclassified не существует', () => {
    expect(TRIAGE_CLASSES).not.toContain('unclassified');
    for (const entry of Object.values(committed.entries)) {
      expect(TRIAGE_CLASSES).toContain(entry.class);
    }
  });

  it('asm02 = доля первых 20 без redraw-required', () => {
    const { asm02 } = checkTriage(committed, disabled);
    const first20 = Object.keys(committed.entries).sort().slice(0, 20);
    const expected = first20.filter((k) => committed.entries[k].class !== 'redraw-required').length / 20;
    expect(asm02).toBe(expected);
  });
});
