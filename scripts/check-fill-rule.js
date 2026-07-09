/**
 * check-fill-rule.js — видящий гейт против «чёрного блоба».
 *
 * КЛАСС дефекта: контурная иконка со сквозной дырой (кольцо, лицо-в-круге),
 * чьи контуры намотаны ОДИНАКОВО и файл не объявил fill-rule=evenodd. Браузер
 * по умолчанию применяет nonzero → дыра заливается → сплошной чёрный силуэт.
 * Площадная IoU этого НЕ видит (форма «на месте»), а глаз — сразу.
 *
 * Инвариант: контурная иконка обязана быть fill-rule-НЕЗАВИСИМОЙ — рендериться
 * одинаково под evenodd и nonzero (eoNzDisagree≈0). Чистые контуры набора = 0.0%,
 * блобы были 63–68% — промежутка нет, порог разделяет без ложных срабатываний.
 *
 * Строгость по слоям:
 *   • Outline/ — HARD FAIL: контур ОБЯЗАН быть полым, блоб = видимая поломка.
 *   • Filled/  — WARN: заливка сплошная по замыслу; расхождение evenodd/nonzero
 *     на перекрытиях суб-путей визуально безвредно под nonzero (штатный режим),
 *     но это латентная хрупкость к принудительному evenodd. Показываем, не валим.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { fillRuleBlobBug } from './lib/seeing-gates.js';

/** @returns {{outlineFails:{name:string,pct:number}[], filledWarns:{name:string,pct:number}[]}} */
export function findBlobBugs(files) {
  const outlineFails = [];
  const filledWarns = [];
  for (const { name, content } of files) {
    const r = fillRuleBlobBug(content);
    if (!r.isBlobBug) continue;
    (name.startsWith('Filled/') ? filledWarns : outlineFails).push({ name, pct: r.disagreePct });
  }
  const byPct = (a, b) => b.pct - a.pct;
  return { outlineFails: outlineFails.sort(byPct), filledWarns: filledWarns.sort(byPct) };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const files = [];
  for (const variant of ['Outline', 'Filled']) {
    for (const f of readdirSync(join(root, 'svg', variant)).filter((f) => f.endsWith('.svg'))) {
      files.push({ name: `${variant}/${f}`, content: readFileSync(join(root, 'svg', variant, f), 'utf8') });
    }
  }
  const { outlineFails, filledWarns } = findBlobBugs(files);

  for (const w of filledWarns) {
    console.log(`check-fill-rule: WARN — ${w.name} (${w.pct.toFixed(1)}% evenodd≠nonzero, хрупок к принудительному evenodd; hand-арт, в бэклог)`);
  }
  if (outlineFails.length > 0) {
    console.log(`check-fill-rule: FAIL — ${outlineFails.length} контурных иконок рендерятся ЧЁРНЫМ БЛОБОМ под nonzero (браузер по умолчанию):`);
    for (const e of outlineFails) console.log(`  - ${e.name} (${e.pct.toFixed(1)}% дыры залиты)`);
    process.exit(1);
  }
  console.log(`check-fill-rule: OK — все ${files.filter((f) => f.name.startsWith('Outline/')).length} контурных иконок fill-rule-независимы${filledWarns.length ? ` (${filledWarns.length} filled-предупреждение)` : ''}`);
}
