#!/usr/bin/env node
/**
 * scripts/check-fidelity.js — пол УЗНАВАЕМОСТИ генерата (рефрейм).
 *
 * Метод: генерат строится к КОРРЕКТНОСТИ (грамматика/гладкость/вес/ζ —
 * держат check-grammar, check-path-quality, check-variant-parity), а IoU
 * к прежней руке — это FIDELITY-ПОЛ (глиф остаётся УЗНАВАЕМЫМ, генерат не
 * уполз в «отсебятину»). Дрейф-гейт (check-anatomy-drift, ≥99.5) сверяет
 * файл↔декларацию ПОСЛЕ регенерации — узнаваемость им не защищена (рука уже
 * перезаписана). Этот гейт закрывает дыру: fidelityToHand фиксируется В
 * ДЕКЛАРАЦИИ при миграции (до перезаписи руки) и здесь проверяется.
 *
 * Законы приёмки generated-глифа:
 *   A) FIDELITY-ПОЛ: fidelityToHand.{outline,filled} ≥ 0.97 на ОБОИХ —
 *      ниже IoU уже не отличает «чище» от «другая иконка».
 *   D) ОБЪЯСНЁННОСТЬ: падение любого варианта < 0.99 обязано нести
 *      correctionReason (именованный выигрыш корректности) — падение без
 *      причины = отсебятина (HARD).
 *   E) НИЖЕ ПОЛА (< 0.97): это дизайн-развилка, не инженерная (генерат
 *      слишком далёк от руки — «другая иконка»?). ОБЯЗАН нести ownerReview
 *      (эскалация владельцу на глаз). Есть ownerReview → report (вынесено
 *      на приёмку); НЕТ → HARD (неэскалированная отсебятина).
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
          report.push(`${name}.${v}: fidelity ${(val * 100).toFixed(2)}% < пол ${FLOOR * 100}% — вынесено на приёмку владельцу (${g.ownerReview})`);
        } else {
          hard.push(`${name}.${v}: fidelity ${(val * 100).toFixed(2)}% < пол ${FLOOR * 100}% — дизайн-развилка, HARD STOP: нужен ownerReview (эскалация владельцу на глаз)`);
        }
      } else if (val < EXPLAIN_BELOW && !g.correctionReason) {
        hard.push(`${name}.${v}: fidelity ${(val * 100).toFixed(2)}% < ${EXPLAIN_BELOW * 100}% без correctionReason — падение обязано быть списано на именованный выигрыш корректности`);
      }
    }
  }
  return { hard, report };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
  const { hard, report } = validateFidelity({ anatomy });
  if (report.length) {
    console.log(`check-fidelity: REPORT — ${report.length} на приёмку/бэкфилл (не блокирует):`);
    for (const e of report) console.log('  - ' + e);
  }
  if (hard.length) {
    console.error(`check-fidelity: HARD — ${hard.length} нарушений пола узнаваемости:`);
    for (const e of hard) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(`check-fidelity: OK — пол узнаваемости держится (generated-глифы ≥ ${FLOOR * 100}%, падения <${EXPLAIN_BELOW * 100}% объяснены)`);
}
