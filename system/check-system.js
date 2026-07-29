/**
 * system/check-system.js — гейт токенной системы.
 *
 * Ловит ровно то, ради чего система написана:
 *   1. декларация не строится;
 *   2. в выводе грязь (NaN, evenodd, чернила за канвой, вырожденные сегменты);
 *   3. расхождение с оригиналом больше порога БЕЗ письменного аргумента —
 *      это и есть «выдумал и промолчал», главный запрещённый сценарий;
 *   4. закон-лозунг вместо закона.
 *
 * Гейт НЕ требует сходимости: он требует, чтобы несходимость была объяснена.
 */

import { buildAll, summarize, ARGUE_AT } from './build.js';
import { glyphs, buildGlyph } from './registry.js';
import { ductusDiff } from './ductus.js';
import { maskFromSvg, maskFromPath } from './metrics.js';
import { readFileSync, existsSync } from 'node:fs';

const MIN_LAW = 24;
const BAD_WORDS = [/как в оригинале/i, /красив/i, /на глаз/i, /подобран/i, /примерно так/i];

const rows = buildAll();
const problems = [];

for (const r of rows) {
  const id = `${r.name}/${r.variant}`;
  if (r.error) {
    problems.push(`${id}: декларация не строится — ${r.error}`);
    continue;
  }
  if (/NaN|Infinity|undefined/.test(r.d)) problems.push(`${id}: в d есть NaN/Infinity`);
  if (/fill-rule/.test(r.svg)) problems.push(`${id}: evenodd — система живёт на nonzero, дырки разворачиваются`);
  if (!r.d || r.d.length < 8) problems.push(`${id}: пустой путь`);
  if ((r.law ?? '').length < MIN_LAW) problems.push(`${id}: закон короче ${MIN_LAW} символов — это лозунг, а не закон`);
  for (const w of BAD_WORDS) {
    if (w.test(r.law ?? '')) problems.push(`${id}: закон ссылается на вкус («${w.source}»), а не на конструкцию`);
  }
  if (r.deviation != null && r.deviation > ARGUE_AT) {
    const arg = (glyphs.get(r.name)?.argument ?? '').trim();
    if (arg.length < 40) {
      problems.push(
        `${id}: отклонение ${(r.deviation * 100).toFixed(2)}% выше порога ${(ARGUE_AT * 100).toFixed(0)}%, ` +
          'а письменного аргумента нет — предъяви геометрическую причину в поле argument',
      );
    }
  }
}

// Чернила не имеют права вылезать за канву.
for (const r of rows) {
  if (r.error) continue;
  // Через reduce, а не Math.max(...nums): у составного глифа координат тысячи,
  // и spread такой длины кладёт стек — гейт падал бы на самых сложных глифах,
  // то есть ровно там, где он нужнее всего.
  let max = 0;
  for (const m of r.d.matchAll(/-?\d*\.?\d+/g)) {
    const v = Math.abs(Number(m[0]));
    if (v > max) max = v;
  }
  if (max > 200) problems.push(`${r.name}/${r.variant}: координата ${max} — геометрия уехала за пределы канвы`);
}

// СВЕРКА ДУКТУСОВ (по флагу --ductus): совпала ли КОНСТРУКЦИЯ, а не площадь.
// Считается дорого (карта расстояний на каждый глиф), поэтому по требованию.
if (process.argv.includes('--ductus')) {
  const notes = [];
  for (const r of rows) {
    if (r.error || !r.hasReference) continue;
    const file = `reference/${r.variant === 'filled' ? 'Filled' : 'Outline'}/${r.name}${r.variant === 'filled' ? '_filled' : ''}.svg`;
    if (!existsSync(file)) continue;
    const ref = maskFromSvg(readFileSync(file, 'utf8'), 24, 10);
    const gen = maskFromPath(buildGlyph(r.name, r.variant, glyphs.get(r.name).refAxes ? { axes: glyphs.get(r.name).refAxes } : {}), 24, 10, 0.01);
    for (const q of ductusDiff(ref, gen, { canvas: 24, ss: 10 }).issues) notes.push(`${r.name}/${r.variant}: ${q}`);
  }
  console.log(`\nдуктус: ${notes.length} структурных расхождений`);
  for (const n of notes) console.log('  · ' + n);
}

const sum = summarize(rows);
const converged = rows.filter((r) => r.deviation != null && (r.deviation <= ARGUE_AT || r.verdict?.kind === 'registration')).length;

console.log(
  `check-system: ${sum.declared} имён · ${sum.rendered} вариантов · сошлось ${converged}/${sum.measured} ` +
    `· медиана ${(sum.median * 100).toFixed(2)}% · p90 ${(sum.p90 * 100).toFixed(2)}%`,
);

if (problems.length) {
  console.error(`\ncheck-system: ${problems.length} нарушений контракта\n`);
  for (const p of problems) console.error('  • ' + p);
  process.exit(1);
}
console.log('check-system: OK — каждая декларация строится, вывод чист, всякое расхождение объяснено');
