/**
 * check-topology.js — видящий гейт СВЯЗНОСТИ контура.
 *
 * КЛАСС дефекта (уникальный — НЕ дублирует check-fill-rule и check-path-quality):
 * РАЗРЫВ НЕЗАКРЫТОГО СУБ-ПУТИ. Контур без команды Z, чья последняя точка далеко
 * от старта — заливка замкнёт его ПРЯМОЙ хордой через тело глифа (ложная
 * топология: срез там, где рисовалась форма). check-fill-rule видит только
 * расхождение evenodd/nonzero (тут его нет); check-path-quality ловит микро-щель
 * ЗАМЫКАНИЯ (subpath С Z) — но НЕ большой разрыв БЕЗ Z. Площадная IoU среза почти
 * не видит (срез мал по площади) — глаз видит «отрезанный угол».
 *
 * Самопересечение суб-пути СОЗНАТЕЛЬНО НЕ гейтится: nonzero-намотка терпит его по
 * определению, 144/222 контуров корпуса легально самопересекаются (замер) —
 * гейт был бы 65% ложных срабатываний. См. lib/topology.js.
 *
 * Строгость по слоям (как check-fill-rule):
 *   • Outline/ — HARD FAIL: срез контура = видимая поломка.
 *   • Filled/  — WARN: у заливок бывают конструкционные незамкнутые слои;
 *     показываем, не валим (латентная хрупкость → в бэклог).
 *
 * CLI: без аргументов — сканирует svg/Outline + svg/Filled корпуса. С аргументами
 * (пути к .svg) — HARD-проверяет ровно их (RED-proof на битой фикстуре).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderedPathData } from './lib/icon-geometry.js';
import { topologyDefects } from './lib/topology.js';

/**
 * @param {Array<{name:string, content:string}>} files
 * @returns {{outlineFails:Array, filledWarns:Array}} каждый элемент
 *   {name, kind:'unclosed', layer:number, detail:string}
 */
export function findTopologyDefects(files) {
  const outlineFails = [];
  const filledWarns = [];
  for (const { name, content } of files) {
    const ds = renderedPathData(content);
    ds.forEach((d, layer) => {
      let defects;
      try {
        defects = topologyDefects(d);
      } catch {
        return; // непарсимость ловит check-path-quality — не наша зона
      }
      const bucket = name.startsWith('Filled/') ? filledWarns : outlineFails;
      for (const u of defects.unclosed) {
        bucket.push({
          name,
          kind: 'unclosed',
          layer,
          detail: `незакрытый суб-путь ${u.sub}: щель ${u.gap.toFixed(2)} (диаг ${u.diag.toFixed(1)})`,
        });
      }
    });
  }
  return { outlineFails, filledWarns };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  let files;
  if (args.length > 0) {
    // RED-proof режим: явные файлы-фикстуры, все как HARD (Outline-строгость).
    files = args.map((p) => ({ name: `Outline/${basename(p)}`, content: readFileSync(p, 'utf8') }));
  } else {
    const root = join(dirname(fileURLToPath(import.meta.url)), '..');
    files = [];
    for (const variant of ['Outline', 'Filled']) {
      for (const f of readdirSync(join(root, 'svg', variant)).filter((f) => f.endsWith('.svg'))) {
        files.push({
          name: `${variant}/${f}`,
          content: readFileSync(join(root, 'svg', variant, f), 'utf8'),
        });
      }
    }
  }

  const { outlineFails, filledWarns } = findTopologyDefects(files);

  for (const w of filledWarns) {
    console.log(`check-topology: WARN — ${w.name} слой ${w.layer}: ${w.detail} (наслоение заливки; в бэклог)`);
  }
  if (outlineFails.length > 0) {
    console.log(`check-topology: FAIL — ${outlineFails.length} топологических дефектов контура:`);
    for (const e of outlineFails) console.log(`  - ${e.name} слой ${e.layer}: ${e.detail}`);
    process.exit(1);
  }
  const scanned = files.filter((f) => f.name.startsWith('Outline/')).length;
  console.log(
    `check-topology: OK — ${scanned} контуров топологически связны` +
      `${filledWarns.length ? ` (${filledWarns.length} filled-предупреждение)` : ''}`,
  );
}
