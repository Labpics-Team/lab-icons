/**
 * check-anim-ready.js — гейт ГОТОВНОСТИ КОНСТРУКЦИИ К АНИМАЦИИ.
 *
 * КЛАСС дефекта (уникальный — НЕ дублирует соседей): СВАРЕННАЯ ПОДВИЖНАЯ
 * ЧАСТЬ. Сами анимации отложены, но конструкция обязана быть готова:
 * подвижная деталь (стрелка часов, …), сваренная с соседями в один
 * примитив или суб-путь, не анимируется transform'ом без разрезания на
 * рантайме; деталь без оси вращения не знает, вокруг чего вращаться.
 * check-anatomy-drift видит дрейф геометрии (тут его нет), check-topology —
 * разрывы контура: это ЛИНТ ДЕКЛАРАЦИИ + счёт суб-путей генерата,
 * не геометрия.
 *
 * Контракт подвижной части (по прецеденту time, fix/flagship-taste):
 *   (а) отдельная part с примитивом из словаря MOVABLE_PRIMITIVES и
 *       ОБЯЗАТЕЛЬНЫМ anchor:[x,y] — осью вращения в долях канвы 0..1
 *       (transform-origin будущей анимации);
 *   (б) ровно ОДИН собственный суб-путь генерата на деталь, и склейка
 *       частей не сваривает суб-пути (Σ суб-путей частей = суб-пути целого).
 *
 * Словарь РАСШИРЯЕМЫЙ: сейчас стрелки часов (clock-hand); по мере миграции
 * подвижной семантики (reload — стрелка-дуга, sun — лучи) сюда добавляются
 * их примитивы, сварные формы — в WELDED_PRIMITIVES.
 *
 * Режимы: report / --strict (как у соседей). CLI: без аргументов —
 * semantics/anatomy.json корпуса; с аргументом — путь к anatomy-JSON
 * (RED-proof на фикстуре test/fixtures/anim-welded-time-master.json).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGlyph } from './lib/anatomy-gen.js';

/** Примитивы с подвижной семантикой: обязателен anchor:[x,y] (доли канвы 0..1). */
export const MOVABLE_PRIMITIVES = new Set(['clock-hand']);

/**
 * Сварные формы: примитив склеивает несколько подвижных деталей в один
 * суб-путь — декларация обязана распасться на раздельные части словаря.
 * primitive → { splitInto } (чем обязан стать).
 */
export const WELDED_PRIMITIVES = new Map([['clock-hands', { splitInto: 'clock-hand' }]]);

/** Число суб-путей в path data (каждый начинается командой M/m). */
const countSubpaths = (d) => (d.match(/[Mm]/g) ?? []).length;

const validAnchor = (a) =>
  Array.isArray(a) && a.length === 2 && a.every((v) => typeof v === 'number' && v >= 0 && v <= 1);

/**
 * @param {{grid:any, anatomy:any, movable?:Set<string>, welded?:Map<string,{splitInto:string}>}} input
 * @returns {{hard:string[], report:string[], checkedParts:number}} report-слой
 *   зарезервирован под миграционные наблюдения (reload/sun) — --strict его валит.
 */
export function checkAnimReadiness({
  grid,
  anatomy,
  movable = MOVABLE_PRIMITIVES,
  welded = WELDED_PRIMITIVES,
}) {
  const hard = [];
  const report = [];
  let checkedParts = 0;
  for (const [name, entry] of Object.entries(anatomy.glyphs)) {
    if (entry.archetype !== 'composite') continue; // подвижные части живут только в композициях
    const parts = entry.parts ?? [];
    // (а) структурный линт декларации: сварка и оси вращения
    let declarationOk = true;
    let movableCount = 0;
    parts.forEach((part, i) => {
      const label = part.name ?? `часть #${i}`;
      if (welded.has(part.primitive)) {
        const { splitInto } = welded.get(part.primitive);
        hard.push(
          `${name}: ${label} — сварной примитив «${part.primitive}»: подвижные детали обязаны быть раздельными «${splitInto}» (по одной на деталь) с anchor`,
        );
        declarationOk = false;
        return;
      }
      if (!movable.has(part.primitive)) return;
      movableCount++;
      if (!validAnchor(part.anchor)) {
        hard.push(
          `${name}: подвижная ${label} («${part.primitive}») без валидного anchor — обязан быть [x,y] в долях канвы 0..1 (ось вращения будущей анимации)`,
        );
        declarationOk = false;
      }
    });
    if (movableCount === 0 || !declarationOk) continue;
    // (б) раздельность суб-путей генерата: каждая часть строится соло,
    // подвижная обязана дать ровно 1 суб-путь; целое = Σ частей (склейка
    // не сваривает). Декларация уже валидна — падение генератора тут дефект.
    for (const variant of ['outline', 'filled']) {
      if (!entry.status?.[variant]) continue;
      try {
        const solo = (part) =>
          buildGlyph(
            { archetype: 'composite', status: { [variant]: entry.status[variant] }, parts: [part] },
            grid,
            {},
            anatomy.glyphs,
          )[variant];
        let sum = 0;
        for (const [i, part] of parts.entries()) {
          const n = countSubpaths(solo(part));
          sum += n;
          if (!movable.has(part.primitive)) continue;
          checkedParts++;
          if (n !== 1) {
            hard.push(
              `${name}/${variant}: подвижная ${part.name ?? `часть #${i}`} даёт ${n} суб-путей вместо 1 — transform не адресует деталь отдельно`,
            );
          }
        }
        const whole = countSubpaths(buildGlyph(entry, grid, {}, anatomy.glyphs)[variant]);
        if (whole !== sum) {
          hard.push(
            `${name}/${variant}: склейка сваривает суб-пути — целое ${whole} ≠ Σ частей ${sum}`,
          );
        }
      } catch (cause) {
        hard.push(`${name}/${variant}: генерат не собрался (${cause.message}) — готовность недоказуема`);
      }
    }
  }
  return { hard, report, checkedParts };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const anatomyPath = args[0] ?? join(root, 'semantics', 'anatomy.json');
  const anatomy = JSON.parse(readFileSync(anatomyPath, 'utf8'));
  const strict = process.argv.includes('--strict');
  const { hard, report, checkedParts } = checkAnimReadiness({ grid, anatomy });
  if (hard.length > 0) {
    console.error(`check-anim-ready: HARD — ${hard.length} нарушений готовности к анимации:`);
    for (const e of hard) console.error('  - ' + e);
  }
  if (report.length > 0) {
    console.log(`check-anim-ready: REPORT — ${report.length} миграционных наблюдений:`);
    for (const e of report) console.log('  - ' + e);
  }
  if (hard.length === 0 && report.length === 0) {
    console.log(
      `check-anim-ready: OK — ${checkedParts} подвижных частей готовы к анимации (anchor + раздельные суб-пути)`,
    );
  }
  if (hard.length > 0 || (strict && report.length > 0)) process.exit(1);
}
