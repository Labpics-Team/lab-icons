#!/usr/bin/env node
/**
 * scripts/check-ring-canon.js — гейт канонов keyline-кольца.
 *
 * Закон (труth-reset 2026-08-15, рекомендация владельца): корпус легально
 * несёт ДВА канона веса кольца (1.50 контейнер / 1.80 предметный круг,
 * BL-017), но каждый файл с кольцом ОБЯЗАН его явно декларировать в
 * semantics/ring-canons.json, и замер обязан сходиться с декларацией.
 *
 * HARD:
 *   - файл с измеримым кольцом отсутствует в реестре (closed world);
 *   - реестр ссылается на файл без измеримого кольца (устаревшая запись);
 *   - |median − canon| > CANON_TOLERANCE (кольцо уехало от декларации);
 *   - thSpread > SPREAD_LIMIT без записи в spreadDebt, либо рост против
 *     записанного долга (долг может только уменьшаться).
 *
 * Расхождение canon ≠ hand НЕ гейтится: это задокументированный вопрос
 * вкуса владельца (#43), реестр делает его видимым, решение — не здесь.
 */

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  CANON_TOLERANCE,
  RING_CANONS,
  SPREAD_LIMIT,
  measureAllRings,
  measureRing,
} from './lib/ring-canon.js';

export function validateRingCanons({ registry, files }) {
  const hard = [];
  const report = [];
  if (!registry || typeof registry !== 'object' || registry.version !== 1 ||
      !registry.rings || typeof registry.rings !== 'object' ||
      !registry.spreadDebt || typeof registry.spreadDebt !== 'object') {
    throw new Error('check-ring-canon: реестр обязан иметь version=1, rings, spreadDebt');
  }
  const seen = new Set();
  for (const { name, content } of files) {
    const m = measureRing(content);
    const declared = registry.rings[name];
    if (!m.found) {
      if (declared) hard.push(`${name}: в реестре, но измеримого кольца нет — запись устарела`);
      continue;
    }
    seen.add(name);
    if (!declared) {
      hard.push(`${name}: кольцо ${m.median} без декларации канона — closed world нарушен`);
      continue;
    }
    if (!RING_CANONS.includes(declared.canon)) {
      hard.push(`${name}: канон ${declared.canon} вне легальных ${RING_CANONS.join('/')}`);
      continue;
    }
    if (Math.abs(m.median - declared.canon) > CANON_TOLERANCE) {
      hard.push(
        `${name}: замер ${m.median} не сходится с каноном ${declared.canon} ` +
          `(допуск ${CANON_TOLERANCE})`,
      );
    }
    if (declared.hand !== undefined && declared.hand !== declared.canon) {
      report.push(`${name}: canon ${declared.canon} ≠ hand ${declared.hand} — вкусовой вопрос #43`);
    }
  }
  for (const name of Object.keys(registry.rings)) {
    if (!seen.has(name)) hard.push(`${name}: запись реестра без файла с кольцом`);
  }
  // Равномерность ВСЕХ колец (не только keyline): неконцентричная пара
  // окружностей = неравномерная толщина. Долг фиксируется per-file и может
  // только уменьшаться.
  for (const { name, content } of files) {
    const worst = Math.max(0, ...measureAllRings(content).map((r) => r.spread));
    const debt = registry.spreadDebt[name];
    if (worst > SPREAD_LIMIT) {
      if (debt === undefined) {
        hard.push(`${name}: thSpread ${worst} > ${SPREAD_LIMIT} без записи в spreadDebt`);
      } else if (worst > debt + 1e-9) {
        hard.push(`${name}: thSpread ${worst} вырос против долга ${debt}`);
      }
    } else if (debt !== undefined) {
      hard.push(`${name}: spreadDebt ${debt} устарел — замер ${worst} уже в норме`);
    }
  }
  return { hard, report, measured: seen.size };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const registry = JSON.parse(readFileSync(join(root, 'semantics', 'ring-canons.json'), 'utf8'));
  const files = [];
  for (const variant of ['Outline', 'Filled']) {
    for (const f of readdirSync(join(root, 'svg', variant))) {
      files.push({
        name: `${variant}/${f}`,
        content: readFileSync(join(root, 'svg', variant, f), 'utf8'),
      });
    }
  }
  const { hard, report, measured } = validateRingCanons({ registry, files });
  if (report.length > 0) {
    console.log(`check-ring-canon: REPORT — ${report.length} расхождений с рукой (вкус, #43):`);
    for (const e of report) console.log('  - ' + e);
  }
  if (hard.length > 0) {
    console.error(`check-ring-canon: HARD — ${hard.length} нарушений канона колец:`);
    for (const e of hard) console.error('  - ' + e);
    process.exit(1);
  }
  console.log(
    `check-ring-canon: OK — ${measured} колец сходятся со своими канонами ` +
      `(легальные веса: ${RING_CANONS.join('/')})`,
  );
}
