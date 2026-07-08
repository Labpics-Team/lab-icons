/**
 * scripts/check-fidelity.js — пол УЗНАВАЕМОСТИ генерата (рефрейм).
 *
 * МОДЕЛЬ (уточнена владельцем 2026-07-04): рука — ЧЕРНОВИК намерения, НЕ
 * истина. Истина — законы; генерат по закону = настоящая иконка. «Вернуть
 * к руке» НЕ существует как исход: это значило бы нарочно оставить систему
 * грязной. fidelityToHand — НЕ мера «насколько похоже на руку» (близость к
 * черновику не самоцель), а РАСТЯЖКА СЕМАНТИЧЕСКОЙ ИДЕНТИЧНОСТИ: «это всё
 * ещё та же иконка, что изображал черновик, или закон исказил её в другую?».
 *
 * Метод: генерат строится к КОРРЕКТНОСТИ (грамматика/гладкость/вес/ζ —
 * держат check-grammar, check-path-quality, check-variant-parity). Дрейф-гейт
 * (check-anatomy-drift, ≥99.5) сверяет файл↔декларацию ПОСЛЕ регенерации —
 * идентичность им не защищена (рука уже перезаписана). Этот гейт закрывает
 * дыру: fidelityToHand фиксируется В ДЕКЛАРАЦИИ при миграции (до перезаписи).
 *
 * Ярусы generated-глифа:
 *   A) ПОЛ ИДЕНТИЧНОСТИ: fidelityToHand.{outline,filled} ≥ 0.97 на ОБОИХ —
 *      ниже IoU уже не отличает «чище» от «другая иконка».
 *   D) ОБЪЯСНЁННОСТЬ: падение любого варианта < 0.99 обязано нести
 *      correctionReason (именованный выигрыш корректности) — падение без
 *      причины = закон-без-обоснования (HARD).
 *   E) НИЖЕ ПОЛА (< 0.97) — ПИВОТ Гип-1 (владелец, 2026-07-04): пол
 *      узнаваемости = ГЛАЗ владельца, не число. Отклонение ~10% ДОПУСТИМО,
 *      если генерат ЧИЩЕ руки и владелец утвердил глазом. Fidelity ниже пола
 *      — СИГНАЛ, не hard-блок: есть ownerReview → report (закон подтверждён);
 *      НЕТ → ownerBatch (owner-review БАТЧ: очередь на глаз владельца,
 *      приёмка БАТЧЕМ, не per-icon 97%). Исход по-прежнему НЕ «вернуть
 *      черновик», а подтвердить/поправить закон — но решает глаз, не гейт.
 *      HARD остаётся только за дисциплиной данных (не-число; необъяснённое
 *      падение [0.97,0.99) без correctionReason) — корректность самих файлов
 *      держат check-grammar/path-quality (грамматика обязана быть чистой).
 *   Grandfather: generated-глиф без fidelityToHand → report (бэкфилл), не hard.
 * (Условие C «не-регресс корректности» держат грамматика/path-quality на
 * самих файлах — генерат обязан быть 0-снос/0-изломов.)
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const FLOOR = 0.97; // пол узнаваемости
const EXPLAIN_BELOW = 0.99; // ниже — обязателен correctionReason

export function validateFidelity({ anatomy }) {
  const hard = [];
  const report = [];
  const ownerBatch = []; // <пола БЕЗ ownerReview — очередь на глаз владельца (сигнал, не блок)
  for (const [name, g] of Object.entries(anatomy.glyphs)) {
    const gen = g.status?.outline === 'generated' || g.status?.filled === 'generated';
    if (!gen) continue;
    const f = g.fidelityToHand;
    if (!f) {
      report.push(`${name}: generated без fidelityToHand — бэкфилл (записать IoU к руке из истории)`);
      continue;
    }
    for (const v of ['outline', 'filled']) {
      if (g.status?.[v] !== 'generated') continue;
      const val = f[v];
      if (typeof val !== 'number' || Number.isNaN(val)) {
        hard.push(`${name}.${v}: fidelityToHand не число`);
        continue;
      }
      if (val < FLOOR) {
        if (g.ownerReview) {
          report.push(`${name}.${v}: fidelity ${(val * 100).toFixed(2)}% < пол ${FLOOR * 100}% — закон подтверждён владельцем (${g.ownerReview})`);
        } else {
          ownerBatch.push(`${name}.${v}: fidelity ${(val * 100).toFixed(2)}% < пол ${FLOOR * 100}% — ждёт глаза владельца (owner-review батч): подтвердить/поправить закон, НЕ вернуть черновик`);
        }
      } else if (val < EXPLAIN_BELOW && !g.correctionReason) {
        hard.push(`${name}.${v}: fidelity ${(val * 100).toFixed(2)}% < ${EXPLAIN_BELOW * 100}% без correctionReason — падение обязано быть списано на именованный выигрыш корректности`);
      }
    }
  }
  return { hard, report, ownerBatch };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
  const { hard, report, ownerBatch } = validateFidelity({ anatomy });
  if (report.length) {
    console.log(`check-fidelity: REPORT — ${report.length} на приёмку/бэкфилл (не блокирует):`);
    for (const e of report) console.log('  - ' + e);
  }
  if (ownerBatch.length) {
    console.log(`check-fidelity: OWNER-REVIEW БАТЧ — ${ownerBatch.length} ждут глаза владельца (сигнал, не блок; приёмка батчем):`);
    for (const e of ownerBatch) console.log('  - ' + e);
  }
  if (hard.length) {
    console.error(`check-fidelity: HARD — ${hard.length} нарушений дисциплины fidelity:`);
    for (const e of hard) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`check-fidelity: OK — fidelity-сигнал чист (падения <${EXPLAIN_BELOW * 100}% объяснены; <${FLOOR * 100}% — в owner-review батче, пол = глаз владельца)`);
}
