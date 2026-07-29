/**
 * system/promote.js — перенос сошедшегося генерата в поставку.
 *
 * Промоушен — отдельная, ЯВНАЯ операция, а не побочный эффект сборки. Прошлая
 * итерация промотировала всё подряд и подменила чистые рисунки руки генератом
 * втрое большего объёма с вырожденными сегментами вида `C12 5.1 12 5.1 12 5.1`.
 * Здесь такое невозможно по построению:
 *
 *   • промотируется только то, что СОШЛОСЬ (≤ порога площади либо вердикт
 *     registration — совпало по форме, разошлось по посадке в пределах
 *     точности руки);
 *   • и только то, что СТАЛО НЕ ХУЖЕ по объёму данных: генерат, который
 *     длиннее оригинала, отвергается — это признак кривой конструкции;
 *   • по умолчанию режим сухого прогона, файлы не трогаются.
 *
 *   node system/promote.js            # что было бы промотировано
 *   node system/promote.js --write    # промотировать
 *   node system/promote.js --write --only chevron-down,plus
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { buildAll, ROOT, ARGUE_AT } from './build.js';

const argv = process.argv.slice(2);
const WRITE = argv.includes('--write');
const only = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;
/**
 * Допуск на рост СЛОЖНОСТИ. Считаются команды пути, а не символы: файлы
 * поставки прошли через SVGO (относительные команды, опущенные разделители),
 * и сравнение по длине строки наказывало бы генерат за то, что он ещё не
 * сжат. Команда — честная мера: узлов стало больше или меньше.
 */
const CMD_TOLERANCE = 1.2;
const cmdCount = (svgOrD) => (svgOrD.match(/[MmLlHhVvCcSsQqTtAaZz]/g) ?? []).length;
const allD = (svg) => [...svg.matchAll(/\sd="([^"]*)"/g)].map((m) => m[1]).join('');

const target = (variant, name) =>
  `${ROOT}/svg/${variant === 'filled' ? 'Filled' : 'Outline'}/${name}${variant === 'filled' ? '_filled' : ''}.svg`;

const rows = buildAll().filter((r) => !r.error && r.hasReference);
const promoted = [];
const rejected = [];

for (const r of rows) {
  if (only && !only.has(r.name)) continue;
  const file = target(r.variant, r.name);
  if (!existsSync(file)) {
    rejected.push([r, 'нет файла в поставке']);
    continue;
  }
  const converged = r.deviation <= ARGUE_AT || r.verdict?.kind === 'registration';
  if (!converged) {
    rejected.push([r, `не сошлось: ${(r.deviation * 100).toFixed(2)}%, вердикт ${r.verdict?.kind}`]);
    continue;
  }
  const cur = readFileSync(file, 'utf8');
  const was = cmdCount(allD(cur));
  const now = cmdCount(r.d);
  if (was > 0 && now > was * CMD_TOLERANCE) {
    rejected.push([r, `генерат сложнее оригинала: ${now} команд пути против ${was}`]);
    continue;
  }
  promoted.push([r, file, was, now]);
}

for (const [r, file, was, now] of promoted) {
  if (WRITE) writeFileSync(file, r.svg + '\n');
  console.log(
    `${WRITE ? '→' : '·'} ${(r.name + '/' + r.variant).padEnd(30)} ` +
      `${(r.deviation * 100).toFixed(2).padStart(6)}%  команд пути: ${was} → ${now}`,
  );
}
if (rejected.length) {
  console.log(`\nотклонено (${rejected.length}):`);
  for (const [r, why] of rejected) console.log(`  · ${(r.name + '/' + r.variant).padEnd(30)} ${why}`);
}
console.log(
  `\n${WRITE ? 'промотировано' : 'сухой прогон — промотировалось бы'} ${promoted.length} из ${rows.length}` +
    (WRITE ? '' : '\nдля записи: node system/promote.js --write'),
);
