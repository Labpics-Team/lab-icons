/**
 * check-dry-coverage.js — ФУНДАМЕНТ-ГЕЙТ РАЗДЕЛЯЕМОСТИ примитивов (DRY).
 *
 * Операционализирует northInvariant «переиспользуемые примитивы» как КУСАЮЩИЙСЯ
 * гейт: каждая помеченная ФЛАГМАНСКАЯ иконка обязана быть собрана из общих
 * примитивов (использованных ≥2 глифами), а не из one-off геометрии/транскрипции.
 * Класс дефекта и обоснование порога=1.0 — см. lib/dry-coverage.js.
 *
 * ЮРИСДИКЦИЯ: гейт бьёт ТОЛЬКО флагманы (semantics/flagships.json ∪ inline
 * tier:"flagship"). Остальной корпус вне юрисдикции до вкусовой приёмки владельца
 * (N7) — one-off не-флагман (cog/reload/component/cloud) НЕ валит цепочку.
 *
 * CLI:
 *   без аргументов        — корпус: semantics/anatomy.json + semantics/flagships.json
 *   <anatomy.json>        — RED-proof: явная анатомия-фикстура (флагманы из inline tier)
 *   <anatomy> <flagships> — фикстура + явный манифест флагманов
 * exit 0 = все флагманы DRY-чисты; exit 1 = хотя бы один < порога или zero-shared.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluateDry } from './lib/dry-coverage.js';

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const tryJson = (p) => {
  try {
    return readJson(p);
  } catch {
    return null;
  }
};

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');

  let anatomy;
  let manifest;
  if (args.length > 0) {
    anatomy = readJson(args[0]); // RED-proof режим: явная фикстура
    manifest = args[1] ? readJson(args[1]) : null; // иначе флагманы из inline tier
  } else {
    anatomy = readJson(join(root, 'semantics', 'anatomy.json'));
    manifest = tryJson(join(root, 'semantics', 'flagships.json'));
  }

  const { ok, threshold, flagships, belowThreshold, zeroShared, missing } = evaluateDry({
    anatomy,
    manifest,
  });

  if (flagships.length === 0) {
    console.log('check-dry-coverage: OK — флагманы не помечены, юрисдикция пуста (нечего мерить)');
    process.exit(0);
  }

  if (ok) {
    console.log(
      `check-dry-coverage: OK — ${flagships.length} флагманов, все ${(threshold * 100).toFixed(0)}%+ ` +
        'построены из общих примитивов (≥2 потребителя); one-off геометрии нет',
    );
    process.exit(0);
  }

  console.log('check-dry-coverage: FAIL — нарушен закон переиспользуемых примитивов:');
  for (const n of missing) {
    console.log(`  - флагман "${n}" помечен, но отсутствует в анатомии`);
  }
  for (const f of zeroShared) {
    console.log(
      `  - "${f.name}": НОЛЬ общих примитивов (${f.unitCount} блоков, все one-off: ` +
        `${f.oneOff.join(', ') || '—'}) — мешок one-off геометрии, не конструкция по закону`,
    );
  }
  for (const f of belowThreshold) {
    if (f.sharedCount === 0) continue; // уже показан в zeroShared
    console.log(
      `  - "${f.name}": покрытие ${(f.coverage * 100).toFixed(0)}% < ${(threshold * 100).toFixed(0)}% ` +
        `(one-off блоки: ${f.oneOff.join(', ')})`,
    );
  }
  process.exit(1);
}
