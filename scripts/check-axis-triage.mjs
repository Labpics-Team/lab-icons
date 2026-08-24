/**
 * scripts/check-axis-triage.mjs — гейт триажа долга осей (AX-01).
 *
 * Триаж — вычислимая проекция semantics/axis-quality.json, а не данные:
 * файл-артефакт не коммитится. Каждой disabled-записи присваивается класс
 * из закрытого enum. 'unclassified' запрещён — запись без доказанного класса
 * получает консервативный дефолт 'redraw-required' с evidence
 * 'awaiting-measurement': честная метка «класс не доказан замером»,
 * а не подмена измерения. Когда появятся реальные замеры, они станут
 * данными (файлом) — тогда проекция уступит место writer'у замеров.
 *
 * Гейт: closed-world (триаж покрывает РОВНО множество disabled — ни
 * усечения, ни фантомов), класс строго из enum, evidence непустой.
 *
 * asm02 — доля первых 20 записей В ПОРЯДКЕ ИСТОЧНИКА (порядок ключей
 * disabled в axis-quality.json) с классом, отличным от redraw-required.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const TRIAGE_CLASSES = Object.freeze([
  'oracle-defect',
  'law-fix',
  'redraw-required',
  'owner-blocked-rect-pen',
]);

/** Rect-семьи из Issue #43 п.3: rect-штрихи не масштабируются осью weight. */
export const RECT_FAMILIES = Object.freeze(['plus', 'minus', 'list', 'menu', 'filter']);

/** Имя иконки принадлежит rect-семье: точное совпадение или композит `<family>-*`. */
export function isRectFamily(iconName) {
  return RECT_FAMILIES.some((f) => iconName === f || iconName.startsWith(`${f}-`));
}

/** key вида "plus-circle/outline/weight" → детерминированная триаж-запись. */
export function classifyEntry(key) {
  const iconName = key.split('/')[0];
  if (isRectFamily(iconName)) {
    return {
      class: 'owner-blocked-rect-pen',
      evidence: `rect-семья '${iconName}' из Issue #43 п.3: rect-штрихи не масштабируются осью weight, решение за владельцем`,
    };
  }
  return { class: 'redraw-required', evidence: 'awaiting-measurement' };
}

/** Проекция триажа на лету: порядок записей = порядок ключей disabled в источнике. */
export function buildTriage(disabled) {
  const entries = {};
  for (const key of Object.keys(disabled)) entries[key] = classifyEntry(key);
  return { classes: [...TRIAGE_CLASSES], entries };
}

export function checkTriage(triage, disabled) {
  const errors = [];
  const expected = new Set(Object.keys(disabled));
  const actualKeys = Object.keys(triage.entries ?? {});
  const actual = new Set(actualKeys);

  const missing = [...expected].filter((k) => !actual.has(k));
  const phantom = actualKeys.filter((k) => !expected.has(k));
  if (missing.length) errors.push(`отсутствуют записи (${missing.length}): ${missing.join(', ')}`);
  if (phantom.length) errors.push(`фантомные записи вне axis-quality (${phantom.length}): ${phantom.join(', ')}`);

  for (const [key, entry] of Object.entries(triage.entries ?? {})) {
    if (entry === null || typeof entry !== 'object') {
      errors.push(`${key}: запись не является объектом триажа`);
      continue;
    }
    if (!TRIAGE_CLASSES.includes(entry.class)) {
      errors.push(`${key}: класс '${entry.class}' вне enum [${TRIAGE_CLASSES.join(', ')}]`);
    }
    if (typeof entry.evidence !== 'string' || entry.evidence.trim() === '') {
      errors.push(`${key}: пустой evidence`);
    }
  }

  // asm02 — по порядку источника (ключи disabled), не по алфавиту и не по триажу.
  const first20 = Object.keys(disabled).slice(0, 20);
  const nonRedraw = first20.filter((k) => triage.entries?.[k]?.class !== 'redraw-required').length;
  const asm02 = first20.length ? nonRedraw / first20.length : 0;

  return { errors, asm02, total: actualKeys.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const quality = JSON.parse(readFileSync(join(ROOT, 'semantics', 'axis-quality.json'), 'utf8'));
  const triage = buildTriage(quality.disabled);
  const { errors, asm02, total } = checkTriage(triage, quality.disabled);
  if (errors.length) {
    console.error(`check-axis-triage: HARD — ${errors.length} дефект(ов):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`check-axis-triage: OK — ${total} записей closed-world, enum и evidence валидны; asm02=${asm02}`);
}
