/**
 * scripts/build-axis-debt-triage.mjs — генератор semantics/axis-debt-triage.json.
 *
 * Триаж долга осей (AX-01): каждой disabled-записи из semantics/axis-quality.json
 * присваивается класс из закрытого enum. 'unclassified' запрещён — запись без
 * доказанного класса получает консервативный дефолт 'redraw-required' с
 * evidence 'awaiting-measurement': это честная метка «класс не доказан замером»,
 * а не подмена измерения.
 *
 * Черновая эвристика (до перезамеров): rect-перо по списку rect-семей из
 * Issue #43 п.3 (rect-штрихи не масштабируются осью weight — решение за
 * владельцем) → owner-blocked-rect-pen.
 *
 * Артефакт заявляет generatedBy — обязан быть бит-в-бит воспроизводим.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(ROOT, 'semantics', 'axis-quality.json');
const TARGET = join(ROOT, 'semantics', 'axis-debt-triage.json');

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

export function buildTriage(disabled) {
  const entries = {};
  for (const key of Object.keys(disabled).sort()) entries[key] = classifyEntry(key);
  return {
    version: 1,
    generatedBy: 'scripts/build-axis-debt-triage.mjs',
    source: 'semantics/axis-quality.json',
    classes: [...TRIAGE_CLASSES],
    entries,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const quality = JSON.parse(readFileSync(SOURCE, 'utf8'));
  const triage = buildTriage(quality.disabled);
  writeFileSync(TARGET, `${JSON.stringify(triage, null, 1)}\n`);
  console.log(`build-axis-debt-triage: OK — ${Object.keys(triage.entries).length} записей → semantics/axis-debt-triage.json`);
}
