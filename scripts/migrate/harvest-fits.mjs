/**
 * harvest-fits.mjs — сборщик результатов пакетного фита (tmp/fit-out/*.log).
 *
 * Каждый лог fit-decl без --merge заканчивается строкой
 *   «финал (сетка 0.12, после q6): outline=98.21% [...]»
 * и полным JSON-ом подогнанного глифа. Сборщик:
 *   1. парсит per-variant IoU из строки финала;
 *   2. вытаскивает хвостовой JSON;
 *   3. если ВСЕ фитованные варианты ≥ порога (0.97) — вливает глиф в
 *      semantics/anatomy.json и проставляет fidelityToHand (статус НЕ трогаем:
 *      промоушен — отдельный осознанный шаг после верификации);
 *   4. печатает таблицу: имя, IoU по вариантам, вердикт.
 *
 * Запуск:
 *   node scripts/migrate/harvest-fits.mjs            # dry-run, только таблица
 *   node scripts/migrate/harvest-fits.mjs --apply    # запись в anatomy.json
 *   node scripts/migrate/harvest-fits.mjs --floor 0.97
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const LOGS = join(REPO, 'tmp', 'fit-out');
const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const fi = args.indexOf('--floor');
const FLOOR = fi >= 0 ? Number(args[fi + 1]) : 0.97;

const anatomyPath = join(REPO, 'semantics', 'anatomy.json');
const anatomy = JSON.parse(readFileSync(anatomyPath, 'utf8'));

const rows = [];
let merged = 0;
for (const f of readdirSync(LOGS).filter((x) => x.endsWith('.log')).sort()) {
  const name = basename(f, '.log');
  const text = readFileSync(join(LOGS, f), 'utf8');
  const lines = text.split(/\r?\n/);
  const finIdx = lines.findLastIndex((l) => l.includes('финал (сетка'));
  if (finIdx < 0) {
    rows.push({ name, verdict: 'НЕТ ФИНАЛА (упал/не дошёл)' });
    continue;
  }
  const ious = {};
  for (const m of lines[finIdx].matchAll(/(\w+)=([\d.]+)%/g)) {
    ious[m[1]] = Number(m[2]) / 100;
  }
  const jsonStart = lines.findIndex((l, i) => i > finIdx && l.trim() === '{');
  let entry = null;
  if (jsonStart >= 0) {
    try {
      entry = JSON.parse(lines.slice(jsonStart).join('\n'));
    } catch {
      /* повреждённый хвост — считаем несобираемым */
    }
  }
  const worst = Math.min(...Object.values(ious));
  const pass = worst >= FLOOR && entry;
  if (pass && APPLY) {
    // статус сохраняем исходный (из живой анатомии, не из лога)
    const prevStatus = anatomy.glyphs[name]?.status;
    if (prevStatus) entry.status = prevStatus;
    entry.fidelityToHand = { ...(entry.fidelityToHand ?? {}) };
    for (const [v, iou] of Object.entries(ious)) {
      entry.fidelityToHand[v] = Number(iou.toFixed(4));
    }
    anatomy.glyphs[name] = entry;
    merged++;
  }
  rows.push({
    name,
    iou: Object.entries(ious).map(([v, x]) => `${v}=${(x * 100).toFixed(2)}%`).join(' '),
    verdict: pass ? (APPLY ? 'ВЛИТ' : 'ПРОЙДЕТ') : `НИЖЕ ПОЛА ${FLOOR}`,
  });
}

const w = Math.max(...rows.map((r) => r.name.length));
for (const r of rows) {
  console.log(`${r.name.padEnd(w)}  ${(r.iou ?? '').padEnd(34)}  ${r.verdict}`);
}
console.log(`\nитого: ${rows.length} логов, порог ${FLOOR}, ` +
  (APPLY ? `влито ${merged}` : `прошло бы ${rows.filter((r) => r.verdict === 'ПРОЙДЕТ').length}`));

if (APPLY && merged) {
  writeFileSync(anatomyPath, JSON.stringify(anatomy, null, 1));
  console.log(`записано: semantics/anatomy.json (${merged} глифов, статусы не тронуты)`);
}
