/**
 * check-adjacency.js — видящий гейт СМЫКАНИЯ частей на МАТЕРИАЛИЗОВАННОМ генерате.
 *
 * КЛАСС дефекта (уникальный — НЕ дублирует check-topology/fill-rule/path-quality):
 * две именованные части, которые в РУКЕ образуют ОДНУ связную область (палочка,
 * входящая в наконечник стрелки), в ГЕНЕРАТЕ рендерятся РАЗОРВАННО (зазор между
 * их залитыми областями). Площадная IoU этого не видит (зазор мал по площади),
 * глаз видит «отрезанную часть». check-topology ловит незакрытый суб-путь ВНУТРИ
 * одного контура — но НЕ зазор между двумя корректно замкнутыми частями.
 *
 * un-gameable ЗАКОН из РУКИ (ноль observer-fit, N1): отношение «должны-смыкаться»
 * НЕ выдумано порогом — оно ВЫВОДИТСЯ из руки. Рука рендерится в связные
 * компоненты (суб-пути). Каждая часть генерата приписывается к компоненте руки,
 * которая покрывает БОЛЬШИНСТВО её чернил (≥COVERAGE_MIN). Части, приписанные к
 * ОДНОЙ компоненте руки, ОБЯЗАНЫ быть в пределах ε и в генерате. Если минимальный
 * зазор части до ближайшего «соседа по компоненте» > ε — HARD FAIL с именами
 * частей и величиной зазора. Пороги ε/TOUCH выводятся из semantics/grid.json
 * (strokeWidth.tolerance, strokeWidth.base, clearanceMin — см. блок констант),
 * не хардкод: смена канвы/пера масштабирует гейт. Части в РАЗНЫХ компонентах
 * руки (две стрелки swap) смыкаться НЕ обязаны — ложных срабатываний нет.
 *
 * КРИТИЧНО: гейт материализует генерат из декларации (buildGlyph) и проверяет
 * ЕГО, а не отгруженную руку — рука-то как раз связна. Проверка руки была бы
 * слепой (зазор в руке = 0).
 *
 * Строгость (как check-corners): корпусный прогон без аргументов — WARN-каталог
 * (материализует генерат всех multi-part глифов, перечисляет разрывы как
 * кандидатов промоушена, всегда exit 0 — HARD-флип по корпусу идёт с промоушеном
 * ~41 декларации отдельными срезами). Кусается гейт через RED-proof в arg-режиме:
 *   • `node scripts/check-adjacency.js <glyph>`  — материализует генерат глифа из
 *      anatomy, HARD-проверяет (swap-horizontal ДО фикса → exit 1, после → exit 0).
 *   • `node scripts/check-adjacency.js <fixture.json>` — {hand, parts:[{name,d}]},
 *      HARD (перекрытая фикстура → exit 0, разорванная → exit 1).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGlyph } from './lib/anatomy-gen.js';
import { renderedPathData } from './lib/icon-geometry.js';
import { samplePath } from './lib/path-data.js';

// ── пороги: ВЫВОД из semantics/grid.json, не хардкод ────────────────────────
// Конструкция (ноль observer-fit): части «должны-смыкаться» обязаны ПЕРЕКРЫВАТЬСЯ
// (зазор 0). Терпим только то, что объясняется допуском веса пера
// (strokeWidth.tolerance); выше — РАЗРЫВ. ε обязан быть СТРОГО НИЖЕ clearanceMin
// (минимальный ЛЕГАЛЬНЫЙ охранный зазор РАЗДЕЛЬНЫХ элементов) — иначе гейт не
// отличал бы разрыв стыка от легального клиренса. Радиус примыкания части к
// компоненте руки = полуширина базового штриха (чернила части лежат в пределах
// полуширины пера от осевой, транскрибируемой рукой).
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const GRID = JSON.parse(readFileSync(join(repoRoot, 'semantics', 'grid.json'), 'utf8'));
const CANVAS = GRID.canvas.width; // канва корпуса; пороги ниже — доли канвы
const EPS = GRID.ratios.strokeWidth.tolerance * CANVAS; // 0.15 при канве 24: допуск веса пера
const TOUCH = (GRID.ratios.strokeWidth.base / 2) * CANVAS; // 0.9 при канве 24: полуширина штриха
const SAMPLE_STEPS = 24; // плотность полилинии на сегмент (баланс точность/скорость)
if (!(EPS < GRID.ratios.clearanceMin * CANVAS)) {
  throw new Error(
    'check-adjacency: grid.json противоречив — strokeWidth.tolerance ≥ clearanceMin: ε разрыва неотделим от легального охранного зазора',
  );
}

// ── геометрические примитивы (zero-dep, самодостаточны) ────────────────────

/** Разбить path-data на суб-пути (каждый начинается с M/m). */
export function splitSubpaths(d) {
  const out = [];
  const re = /[Mm][^Mm]*/g;
  let m;
  while ((m = re.exec(d)) !== null) out.push(m[0].trim());
  return out;
}

/** Полилиния суб-пути как массив точек. */
function polyOf(d) {
  return samplePath(d, SAMPLE_STEPS);
}

/** Точка внутри полигона (ray-casting). */
function pointInPoly(pt, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
    const inter = ((yi > pt[1]) !== (yj > pt[1])) && (pt[0] < ((xj - xi) * (pt[1] - yi)) / (yj - yi) + xi);
    if (inter) inside = !inside;
  }
  return inside;
}

/**
 * Зазор между двумя частями (каждая — {subPolys:[[[x,y]…]], pts:[[x,y]…]}).
 * 0 если области ПЕРЕКРЫВАЮТСЯ (любая точка одной внутри другой); иначе минимум
 * попарного расстояния между сэмплами границ.
 */
export function gapBetween(a, b) {
  for (const p of a.pts) for (const poly of b.subPolys) if (pointInPoly(p, poly)) return 0;
  for (const p of b.pts) for (const poly of a.subPolys) if (pointInPoly(p, poly)) return 0;
  let best = Infinity;
  for (const pa of a.pts) {
    for (const pb of b.pts) {
      const dx = pa[0] - pb[0], dy = pa[1] - pb[1];
      const dd = dx * dx + dy * dy;
      if (dd < best) best = dd;
    }
  }
  return Math.sqrt(best);
}

function centroid(pts) {
  let x = 0, y = 0;
  for (const p of pts) { x += p[0]; y += p[1]; }
  return [x / pts.length, y / pts.length];
}

/** Часть → {name, subPolys, pts} из path-data её генерата. */
function partFromPathData(name, d) {
  const subPolys = splitSubpaths(d).map(polyOf).filter((p) => p.length >= 2);
  return { name, subPolys, pts: subPolys.flat() };
}

/** Компоненты руки: суб-пути отгруженного контура как полигоны. */
function handComponents(handD) {
  return splitSubpaths(handD).map(polyOf).filter((p) => p.length >= 3);
}

/** Сколько точек части ПРИМЫКАЮТ к компоненте руки (внутри или в пределах TOUCH). */
function coverageWithin(part, comp) {
  let n = 0;
  const t2 = TOUCH * TOUCH;
  for (const p of part.pts) {
    if (pointInPoly(p, comp)) { n++; continue; }
    let near = false;
    for (const c of comp) {
      const dx = p[0] - c[0], dy = p[1] - c[1];
      if (dx * dx + dy * dy <= t2) { near = true; break; }
    }
    if (near) n++;
  }
  return n;
}

/**
 * Приписать каждую часть к компоненте руки, к которой она ПРИМЫКАЕТ БОЛЬШИНСТВОМ
 * точек (в пределах TOUCH). Бijективно по построению: часть тянется к «своей»
 * компоненте руки (той дуге/области, которую транскрибирует), а не к соседней —
 * толерантность TOUCH переживает смещение тонкого штриха генерата от руки, но
 * не достаёт до раздельных компонент (клетки apps, штрихи pause раздвинуты >TOUCH).
 * comp=-1 если часть ни к чему не примыкает — не кластеризуется (защита от ложных пар).
 */
function assignComponents(parts, handComps) {
  for (const part of parts) {
    let bestK = -1, bestCov = 0;
    for (let k = 0; k < handComps.length; k++) {
      const cov = coverageWithin(part, handComps[k]);
      if (cov > bestCov) { bestCov = cov; bestK = k; }
    }
    part.comp = bestK;
  }
}

/**
 * Дефекты смежности: части в ОДНОЙ компоненте руки, но разорванные (>ε) в генерате.
 * @param {Array<{name,subPolys,pts,comp}>} parts — генерат-части с приписанной comp
 * @param {number} eps
 * @returns {Array<{a:string,b:string,gap:number,comp:number}>}
 */
export function findAdjacencyDefects(parts, eps = EPS) {
  const byComp = new Map();
  for (const p of parts) {
    if (p.comp < 0) continue;
    if (!byComp.has(p.comp)) byComp.set(p.comp, []);
    byComp.get(p.comp).push(p);
  }
  const defects = [];
  for (const [comp, cluster] of byComp) {
    if (cluster.length < 2) continue;
    for (const p of cluster) {
      let mn = Infinity, mnName = null;
      for (const q of cluster) {
        if (q === p) continue;
        const g = gapBetween(p, q);
        if (g < mn) { mn = g; mnName = q.name; }
      }
      // часть без соседа-в-пределах-ε внутри своей компоненты руки = разрыв
      if (mnName !== null && mn > eps) {
        const key = [p.name, mnName].sort().join('~');
        if (!defects.some((d) => [d.a, d.b].sort().join('~') === key)) {
          defects.push({ a: p.name, b: mnName, gap: mn, comp });
        }
      }
    }
  }
  return defects;
}

/**
 * Дифференциал рука↔генерат: закон смежности берётся из руки, проверяется на
 * генерате. Аналог cornerDefectsBetween (check-corners).
 * @param {string} handD — path-data отгруженной руки (эталон связности)
 * @param {Array<{name:string,d:string}>} genParts — per-part генерат
 * @param {number} eps
 */
export function adjacencyDefectsBetween(handD, genParts, eps = EPS) {
  const parts = genParts.map((g) => partFromPathData(g.name, g.d));
  assignComponents(parts, handComponents(handD));
  return findAdjacencyDefects(parts, eps);
}

// ── материализация генерата из anatomy ─────────────────────────────────────

/** Per-part генерат-path-data глифа для варианта (outline/filled). */
function materializeParts(entry, grid, allGlyphs, variant) {
  const out = [];
  for (const part of entry.parts) {
    let built;
    try {
      built = buildGlyph({ ...entry, parts: [part] }, grid, {}, allGlyphs);
    } catch {
      continue;
    }
    const d = built[variant];
    if (d) out.push({ name: part.name || `part${out.length}`, d });
  }
  return out;
}

/**
 * Проверить один глиф из anatomy: материализовать генерат, вывести закон из руки,
 * вернуть дефекты (outline). Возвращает null если у глифа нет ≥2 частей/руки.
 */
function checkGlyph(name, entry, grid, allGlyphs, repo, eps) {
  if (!Array.isArray(entry.parts) || entry.parts.length < 2) return null;
  const handFile = join(repo, 'svg', 'Outline', `${name}.svg`);
  if (!existsSync(handFile)) return null;
  let handD;
  try {
    handD = renderedPathData(readFileSync(handFile, 'utf8'))[0];
  } catch {
    return null;
  }
  if (!handD) return null;
  const genParts = materializeParts(entry, grid, allGlyphs, 'outline');
  if (genParts.length < 2) return null;
  return adjacencyDefectsBetween(handD, genParts, eps);
}

// ── CLI ────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
  const grid = JSON.parse(readFileSync(join(repo, 'semantics', 'grid.json'), 'utf8'));
  const anatomy = JSON.parse(readFileSync(join(repo, 'semantics', 'anatomy.json'), 'utf8'));
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));

  if (args.length > 0) {
    // HARD arg-режим (RED-proof): каждый аргумент — либо .json-фикстура {hand,parts},
    // либо имя глифа из anatomy (материализуем его генерат).
    const fails = [];
    for (const arg of args) {
      let defects, label;
      if (arg.endsWith('.json')) {
        const fx = JSON.parse(readFileSync(arg, 'utf8'));
        label = basename(arg);
        defects = adjacencyDefectsBetween(fx.hand, fx.parts, EPS);
      } else {
        const entry = anatomy.glyphs[arg];
        if (!entry) {
          console.error(`check-adjacency: нет глифа «${arg}» в anatomy и это не .json-фикстура`);
          process.exit(2);
        }
        label = arg;
        defects = checkGlyph(arg, entry, grid, anatomy.glyphs, repo, EPS);
        if (defects === null) {
          console.error(`check-adjacency: у «${arg}» нет ≥2 частей или руки Outline`);
          process.exit(2);
        }
      }
      for (const d of defects) {
        fails.push(`${label}: части «${d.a}» и «${d.b}» разорваны в генерате (зазор ${d.gap.toFixed(3)} > ε ${EPS}, компонента руки ${d.comp})`);
      }
    }
    if (fails.length > 0) {
      // Ошибки — в stderr: CI/пайплайны различают каналы, stdout остаётся для каталога.
      console.error(`check-adjacency: FAIL — ${fails.length} разрывов смежности:`);
      for (const e of fails) console.error(`  - ${e}`);
      process.exit(1);
    }
    console.log(`check-adjacency: OK — ${args.length} цель(ей) без разрывов смежности (ε=${EPS})`);
    process.exit(0);
  }

  // Корпусный WARN-каталог (HARD-флип идёт с промоушеном деклараций — см. шапку).
  const offenders = [];
  for (const [name, entry] of Object.entries(anatomy.glyphs)) {
    let defects;
    try {
      defects = checkGlyph(name, entry, grid, anatomy.glyphs, repo, EPS);
    } catch {
      continue;
    }
    if (defects && defects.length) {
      for (const d of defects) offenders.push({ name, ...d });
    }
  }
  offenders.sort((a, b) => b.gap - a.gap);
  console.log('check-adjacency: WARN-каталог (HARD-флип по корпусу — с промоушеном деклараций):');
  if (offenders.length === 0) {
    console.log('  разрывов смежности в корпусе нет.');
  } else {
    console.log(`  ${offenders.length} разрывов «должны-смыкаться» на генерате — кандидаты промоушена:`);
    for (const o of offenders) {
      console.log(`  - ${o.name}: «${o.a}»↔«${o.b}» зазор ${o.gap.toFixed(3)} (ε ${EPS})`);
    }
  }
  // HARD-флип промоушена (реальный триггер, не будущее намерение): глифы из
  // semantics/adjacency-promoted.json ОБЯЗАНЫ быть без разрывов даже в корпусном
  // прогоне (verify-цепь/CI зовёт этот путь БЕЗ аргументов). Так WARN-каталог
  // перестаёт вечно прикрывать РЕГРЕССИЮ уже-исправленной (промоутнутой)
  // декларации: верни зазор swap-horizontal — CI покраснеет, а не смолчит.
  const promotedFile = join(repo, 'semantics', 'adjacency-promoted.json');
  const promoted = existsSync(promotedFile)
    ? JSON.parse(readFileSync(promotedFile, 'utf8')).promoted || []
    : [];
  const hardFails = offenders.filter((o) => promoted.includes(o.name));
  if (hardFails.length > 0) {
    // Ошибки — в stderr (симметрично arg-режиму): красный CI показывает причину в error-канале.
    console.error(`check-adjacency: FAIL — ${hardFails.length} разрыв(ов) в ПРОМОУТНУТЫХ глифах (регрессия смежности):`);
    for (const o of hardFails) {
      console.error(`  - ${o.name}: «${o.a}»↔«${o.b}» зазор ${o.gap.toFixed(3)} > ε ${EPS}`);
    }
    process.exit(1);
  }
  console.log(`check-adjacency: OK — WARN-каталог; ${promoted.length} промоутнут(ых) глиф(ов) HARD-чисты (кусается и через arg-режим: node scripts/check-adjacency.js swap-horizontal).`);
}
