/**
 * scripts/check-axis-triage.mjs — гейт целостности semantics/axis-debt-triage.json.
 *
 * Closed-world против semantics/axis-quality.json: триаж покрывает РОВНО
 * множество disabled-записей (ни усечения, ни фантомов) — иначе долг тихо
 * теряется или изобретается. Класс — строго из закрытого enum, evidence
 * непустой: запись без обоснования не является триажем.
 *
 * asm02 — вычисляемое поле: доля первых 20 записей (в отсортированном
 * порядке ключей) с классом, отличным от redraw-required.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TRIAGE_CLASSES } from './build-axis-debt-triage.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function checkTriage(triage, disabled) {
  const errors = [];
  const expected = Object.keys(disabled).sort();
  const actual = Object.keys(triage.entries ?? {}).sort();

  const missing = expected.filter((k) => !actual.includes(k));
  const phantom = actual.filter((k) => !expected.includes(k));
  if (missing.length) errors.push(`отсутствуют записи (${missing.length}): ${missing.join(', ')}`);
  if (phantom.length) errors.push(`фантомные записи вне axis-quality (${phantom.length}): ${phantom.join(', ')}`);

  for (const [key, entry] of Object.entries(triage.entries ?? {})) {
    if (!TRIAGE_CLASSES.includes(entry.class)) {
      errors.push(`${key}: класс '${entry.class}' вне enum [${TRIAGE_CLASSES.join(', ')}]`);
    }
    if (typeof entry.evidence !== 'string' || entry.evidence.trim() === '') {
      errors.push(`${key}: пустой evidence`);
    }
  }

  const first20 = actual.slice(0, 20);
  const nonRedraw = first20.filter((k) => triage.entries[k]?.class !== 'redraw-required').length;
  const asm02 = first20.length ? nonRedraw / first20.length : 0;

  return { errors, asm02, total: actual.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const triage = JSON.parse(readFileSync(join(ROOT, 'semantics', 'axis-debt-triage.json'), 'utf8'));
  const quality = JSON.parse(readFileSync(join(ROOT, 'semantics', 'axis-quality.json'), 'utf8'));
  const { errors, asm02, total } = checkTriage(triage, quality.disabled);
  if (errors.length) {
    console.error(`check-axis-triage: HARD — ${errors.length} дефект(ов):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`check-axis-triage: OK — ${total} записей closed-world, enum и evidence валидны; asm02=${asm02}`);
}
