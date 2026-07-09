/**
 * check-corners.js — ВИДЯЩИЙ дифференциальный гейт ПЕР-ВЕРШИННОГО СКРУГЛЕНИЯ.
 *
 * КЛАСС дефекта (уникальный — см. lib/corners.js): вершина ОСТРАЯ у РУКИ
 * (r_hand≈0), но СКРУГЛЁННАЯ генератом (r_gen>порог). Un-gameable площадной
 * IoU: скругление 0.3px смещает контур на доли пикселя, IoU его «не видит»,
 * а глаз видит «зализанный угол». НЕ дублирует check-path-quality (микро-узлы/
 * почти-гладкие изломы), check-fill-rule (evenodd/nonzero блоб), check-topology
 * (разрыв незакрытого суб-пути).
 *
 * Строгость по слоям (как check-topology / check-fill-rule):
 *   • Outline/ — HARD FAIL: зализанный острый угол = видимая поломка формы.
 *   • Filled/  — WARN.
 *
 * ┌─ КОРПУСНЫЙ HARD-ФЛИП ОТЛОЖЕН до EC3 ────────────────────────────────────┐
 * │ genRoundedPolygon/genRoundedRect сейчас скругляют ВСЕ вершины одним      │
 * │ глобальным скаляром (blanket-round). Пока роль вершины (sharp|r) не      │
 * │ читается ПЕР-ВЕРШИННО из декларации (EC3), генерат МАССОВО скругляет     │
 * │ острые углы руки — включить HARD по корпусу сейчас = корпусный регресс   │
 * │ verify. Поэтому БЕЗ аргументов гейт идёт в WARN/report: каталогизирует   │
 * │ скруглённые углы генерата (вход для EC3) и ВСЕГДА exit 0. Кусается гейт  │
 * │ через RED-proof на фикстуре (аргументы-режим, HARD). HARD-флип по        │
 * │ корпусу включится ПОСЛЕ замены blanket-round на пер-вершинные corners[]. │
 * └─────────────────────────────────────────────────────────────────────────┘
 *
 * CLI: без аргументов — WARN-каталог по svg/Outline + svg/Filled. С аргументами
 * (.svg-фикстуры) — HARD-режим: path[0]=РУКА (эталон), path[1]=ГЕНЕРАТ; острый
 * угол руки, скруглённый генератом, валит exit 1 (RED-proof).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderedPathData } from './lib/icon-geometry.js';
import { cornerRadii } from './lib/corners.js';

// Пороги на канве 24 (viewBox корпуса). Относительность формы уже внутри
// cornerRadii (порог стороны = доля диагонали bbox); здесь — семантика ролей.
const SHARP_MAX = 0.6; // r ниже → вершина РУКИ считается острой
const ROUND_MIN = 1.0; // r_gen выше → генерат вершину СКРУГЛИЛ
const MATCH_DIST = 5.0; // допуск сопоставления угла руки ↔ угла генерата

/**
 * Дефекты «острый-у-руки → скруглён-генератом» между двумя контурами.
 * @param {string} handD path-data руки (эталон)
 * @param {string} genD  path-data генерата
 * @returns {Array<{x:number,y:number,rHand:number,rGen:number,dist:number}>}
 */
export function cornerDefectsBetween(handD, genD) {
  const hand = cornerRadii(handD);
  const gen = cornerRadii(genD);
  const defects = [];
  for (const h of hand) {
    if (h.radius > SHARP_MAX) continue; // угол руки не острый — не наша забота
    let best = null;
    let bestDist = MATCH_DIST;
    for (const g of gen) {
      const d = Math.hypot(g.x - h.x, g.y - h.y);
      if (d <= bestDist) {
        bestDist = d;
        best = g;
      }
    }
    if (best && best.radius >= ROUND_MIN) {
      defects.push({ x: h.x, y: h.y, rHand: h.radius, rGen: best.radius, dist: bestDist });
    }
  }
  return defects;
}

/**
 * Дифференциал по парам файлов генерат↔рука (сопоставление по имени, послойно).
 * @param {Array<{name:string, content:string}>} genFiles
 * @param {Array<{name:string, content:string}>} handFiles
 * @returns {{outlineFails:Array, filledWarns:Array}}
 */
export function findCornerDefects(genFiles, handFiles) {
  const handByName = new Map(handFiles.map((f) => [f.name, f.content]));
  const outlineFails = [];
  const filledWarns = [];
  for (const { name, content } of genFiles) {
    const handContent = handByName.get(name);
    if (handContent === undefined) continue;
    let genLayers;
    let handLayers;
    try {
      genLayers = renderedPathData(content);
      handLayers = renderedPathData(handContent);
    } catch {
      continue; // непарсимость — зона check-path-quality
    }
    const bucket = name.startsWith('Filled/') ? filledWarns : outlineFails;
    const layers = Math.min(genLayers.length, handLayers.length);
    for (let layer = 0; layer < layers; layer++) {
      let defects;
      try {
        defects = cornerDefectsBetween(handLayers[layer], genLayers[layer]);
      } catch {
        continue;
      }
      for (const d of defects) {
        bucket.push({
          name,
          layer,
          detail: `вершина (${d.x.toFixed(1)},${d.y.toFixed(1)}) острая у руки (r≈${d.rHand.toFixed(2)}), скруглена генератом (r=${d.rGen.toFixed(2)})`,
        });
      }
    }
  }
  return { outlineFails, filledWarns };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));

  if (args.length > 0) {
    // RED-proof HARD-режим: каждая фикстура несёт path[0]=рука, path[1]=генерат.
    const fails = [];
    for (const p of args) {
      let defects;
      try {
        const ds = renderedPathData(readFileSync(p, 'utf8'));
        if (ds.length < 2) {
          console.error(`check-corners: фикстуре ${basename(p)} нужно ≥2 path (path[0]=рука, path[1]=генерат)`);
          process.exit(2);
        }
        defects = cornerDefectsBetween(ds[0], ds[1]);
      } catch (err) {
        // Непарсимая/битая фикстура — это ошибка ТЕСТ-СЕТАПА, не дефект формы:
        // чистый именованный exit 2 (как ветка ds.length<2), а не сырой стек.
        console.error(`check-corners: фикстура ${basename(p)} непарсима: ${err.message}`);
        process.exit(2);
      }
      for (const d of defects) {
        fails.push(`${basename(p)}: вершина (${d.x.toFixed(1)},${d.y.toFixed(1)}) острая у руки (r≈${d.rHand.toFixed(2)}), скруглена генератом (r=${d.rGen.toFixed(2)})`);
      }
    }
    if (fails.length > 0) {
      console.log(`check-corners: FAIL — ${fails.length} зализанных острых углов:`);
      for (const e of fails) console.log(`  - ${e}`);
      process.exit(1);
    }
    console.log(`check-corners: OK — ${args.length} фикстур(а) без зализанных острых углов`);
    process.exit(0);
  }

  // Корпусный WARN-каталог (HARD-флип отложен до EC3 — см. шапку файла).
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  let glyphsWithRound = 0;
  let roundedCorners = 0;
  const topOffenders = [];
  for (const variant of ['Outline', 'Filled']) {
    const dir = join(root, 'svg', variant);
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.svg'))) {
      let n = 0;
      try {
        for (const d of renderedPathData(readFileSync(join(dir, f), 'utf8'))) {
          for (const c of cornerRadii(d)) if (c.radius >= ROUND_MIN) n++;
        }
      } catch {
        continue;
      }
      if (n > 0) {
        glyphsWithRound++;
        roundedCorners += n;
        topOffenders.push({ name: `${variant}/${f}`, n });
      }
    }
  }
  topOffenders.sort((a, b) => b.n - a.n);
  console.log(
    `check-corners: WARN-каталог (HARD-флип по корпусу отложен до EC3, пер-вершинные corners[]):`,
  );
  console.log(
    `  ${roundedCorners} скруглённых углов в ${glyphsWithRound} глифах — кандидаты в blanket-round-жертвы (EC3 рассудит острые-vs-легально-круглые).`,
  );
  for (const o of topOffenders.slice(0, 10)) console.log(`  - ${o.name}: ${o.n}`);
  console.log('check-corners: OK — WARN-режим, корпус не валится (кусается через RED-proof на фикстуре).');
}
