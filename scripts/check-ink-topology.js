/**
 * check-ink-topology.js — видящий гейт ЧЕРНИЛЬНОЙ ТОПОЛОГИИ генерата против руки.
 *
 * North-инвариант (достроен: check-topology выродился в «незакрытый суб-путь»):
 * ЧИСЛО РАЗДЕЛЬНЫХ ФОРМ И ДЫР ГЕНЕРАТА == РУКИ. Обе фигуры растеризуются как
 * ЧЕРНИЛА (even-odd, шаг растра как у inkIoU-гейтов), flood-fill считает
 * компоненты чернил и дыры — числа обязаны совпасть.
 *
 * КЛАСС дефекта (уникальный — НЕ дублируют соседи):
 *   • check-topology     — незакрытый суб-путь ВНУТРИ контура; но разрез ОДНОЙ
 *     части на корректно замкнутые куски (close: вторая палочка = 2 куска со
 *     щелями) для него легален.
 *   • check-adjacency    — разрыв стыка ДВУХ именованных частей; но СЛИПАНИЕ
 *     раздельных форм (play-forward-circle: два клина слиты в массу) и разрез
 *     внутри одной части для него невидимы.
 *   • inkIoU (drift)     — площадь; щель/залип малы по площади (98%+ IoU),
 *     глаз видит сломанную метафору.
 * Плюс ОСКОЛОЧНЫЙ детектор: компонент чернил или дыра генерата мельче порога
 * = вырожденная грязь (залип под наконечником arrow-back-circle, полумесяц в
 * стыке) — FAIL независимо от равенства счётов.
 *
 * ПОРОГИ — вывод из semantics/grid.json, не хардкод:
 *   • Шаг растра 0.12 (паттерн inkIoU/wave1/wave3): минимальный легальный
 *     зазор clearanceMin=0.8px ≥ 6 клеток — вся легальная структура видима.
 *   • MIN_FEATURE_AREA = (capRadius·канва)² = 0.81px² при канве 24: наименьший
 *     НАМЕРЕННЫЙ элемент чернил в дисциплине пера — точка/торец радиуса
 *     capRadius (0.9px), его площадь π·r² ≈ 2.54px²; порог r² в π раз ниже ⇒
 *     ложных срабатываний на легальной геометрии нет по построению, а
 *     вырожденные клинья-залипы и полумесяцы стыков (доли px²) ловятся.
 *     Счёт СТРУКТУРЫ (инвариант) — по значимым (≥ порога) формам обеих фигур:
 *     грязь руки не «канонизируется» требованием её воспроизвести.
 *
 * РУКА: status:hand — текущий svg; status:generated — рука из git-истории
 * (последний hand-коммит, scripts/lib/hand-history.js — прецедент
 * build-preview.mjs). Руки в истории нет (глиф рождён законом) — инвариант
 * счёта не выводится, работает только осколочный детектор.
 *
 * СВЯЗНОСТЬ: чернила 8-связны, негатив 4-связен — двойственная связность
 * цифровой топологии (Розенфельд): одинаковая связность на обоих слоях даёт
 * парадокс Жордана (диагональная перемычка «соединяет» и чернила, и негатив
 * сквозь неё). 8 у чернил консервативна к растру: диагональное касание не
 * рвёт форму.
 *
 * Строгость (паттерн check-adjacency): корпусный прогон без аргументов —
 * REPORT-каталог (кандидаты демоута, всегда exit 0) + HARD для глифов из
 * semantics/ink-topology-promoted.json (регрессия чистого = exit 1);
 * --strict — любое нарушение = exit 1. HARD-флип по корпусу включается
 * демоут-прогоном отдельным срезом. Кусается через arg-режим (RED-proof):
 *   node scripts/check-ink-topology.js close play-forward-circle — HARD ровно
 *   по этим глифам (имя или имя/вариант), exit 1 с числами.
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGlyph } from './lib/anatomy-gen.js';
import { createHandHistory } from './lib/hand-history.js';
import { renderedPathData } from './lib/icon-geometry.js';
import { samplePolylines } from './lib/curve-sampling.js';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const GRID = JSON.parse(readFileSync(join(repoRoot, 'semantics', 'grid.json'), 'utf8'));
const CANVAS = GRID.canvas.width;

export const STEP = 0.12; // шаг растра inkIoU-гейтов (wave1/wave3)
export const MIN_FEATURE_AREA = (GRID.ratios.strokeWidth.capRadius * CANVAS) ** 2; // px²
const SAMPLE_STEPS = 24; // плотность полилиний — как у inkIoU

// ── растеризация чернил (scanline even-odd, семантика inkAt из drift-гейта) ──

/** @returns {{grid:Uint8Array, n:number}} клетка=1 ⇔ центр клетки в чернилах */
export function rasterizeInk(d, cw = CANVAS, step = STEP) {
  const polys = samplePolylines(d, SAMPLE_STEPS).filter((p) => p.length > 2);
  const n = Math.round(cw / step);
  const grid = new Uint8Array(n * n);
  const edges = [];
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if (y1 !== y2) edges.push([x1, y1, x2, y2]);
    }
  }
  for (let r = 0; r < n; r++) {
    const y = (r + 0.5) * step;
    const xs = [];
    for (const [x1, y1, x2, y2] of edges) {
      if (y1 > y !== y2 > y) xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    // чётность: чернила между парами пересечений (строго внутри — как x<хорда в inkAt)
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const c0 = Math.max(0, Math.floor(xs[k] / step - 0.5) + 1);
      const c1 = Math.min(n - 1, Math.ceil(xs[k + 1] / step - 0.5) - 1);
      for (let c = c0; c <= c1; c++) grid[r * n + c] = 1;
    }
  }
  return { grid, n };
}

/** Flood-fill компоненты маски. @returns {Array<{area:number, frame:boolean}>} */
function labelFeatures(mask, n, eightConnected) {
  const label = new Int32Array(n * n).fill(-1);
  const stack = new Int32Array(n * n);
  const feats = [];
  for (let start = 0; start < n * n; start++) {
    if (!mask[start] || label[start] !== -1) continue;
    const id = feats.length;
    let area = 0;
    let frame = false;
    let top = 0;
    stack[top++] = start;
    label[start] = id;
    while (top > 0) {
      const i = stack[--top];
      area++;
      const r = (i / n) | 0;
      const c = i % n;
      if (r === 0 || c === 0 || r === n - 1 || c === n - 1) frame = true;
      for (let dr = -1; dr <= 1; dr++) {
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          if (!eightConnected && dr !== 0 && dc !== 0) continue;
          const rr = r + dr;
          const cc = c + dc;
          if (rr < 0 || cc < 0 || rr >= n || cc >= n) continue;
          const j = rr * n + cc;
          if (mask[j] && label[j] === -1) {
            label[j] = id;
            stack[top++] = j;
          }
        }
      }
    }
    feats.push({ area, frame });
  }
  return feats;
}

/**
 * Топология чернил фигуры.
 * @returns {{components:number[], holes:number[]}} площади в px², по убыванию;
 *   дыры = компоненты негатива, НЕ касающиеся рамки растра.
 */
export function inkTopologyOf(d, cw = CANVAS, step = STEP) {
  const { grid, n } = rasterizeInk(d, cw, step);
  const cellArea = step * step;
  const components = labelFeatures(grid, n, true).map((f) => f.area * cellArea);
  const neg = new Uint8Array(n * n);
  for (let i = 0; i < n * n; i++) neg[i] = grid[i] ? 0 : 1;
  const holes = labelFeatures(neg, n, false)
    .filter((f) => !f.frame)
    .map((f) => f.area * cellArea);
  return {
    components: components.sort((a, b) => b - a),
    holes: holes.sort((a, b) => b - a),
  };
}

/** Счёт значимой структуры (≥ порога осколка). */
const structureOf = (t) => ({
  comps: t.components.filter((a) => a >= MIN_FEATURE_AREA).length,
  holes: t.holes.filter((a) => a >= MIN_FEATURE_AREA).length,
});

/** Осколочные дефекты генерата (грязь/вырожденная геометрия). */
export function fragmentDefects(genTopology) {
  const out = [];
  for (const a of genTopology.components) {
    if (a < MIN_FEATURE_AREA) {
      out.push(`осколок чернил в генерате: ${a.toFixed(3)}px² < порога ${MIN_FEATURE_AREA.toFixed(2)}px²`);
    }
  }
  for (const a of genTopology.holes) {
    if (a < MIN_FEATURE_AREA) {
      out.push(`осколок-дыра (грязь) в генерате: ${a.toFixed(3)}px² < порога ${MIN_FEATURE_AREA.toFixed(2)}px²`);
    }
  }
  return out;
}

/**
 * Дефекты топологии: инвариант счёта (рука==генерат по значимым формам/дырам)
 * + осколки генерата.
 * @returns {string[]}
 */
export function topologyDefectsBetween(handD, genD, cw = CANVAS, step = STEP) {
  const hand = structureOf(inkTopologyOf(handD, cw, step));
  const genT = inkTopologyOf(genD, cw, step);
  const gen = structureOf(genT);
  const defects = [];
  if (hand.comps !== gen.comps) {
    defects.push(`компоненты чернил: рука ${hand.comps} vs генерат ${gen.comps}`);
  }
  if (hand.holes !== gen.holes) {
    defects.push(`дыры: рука ${hand.holes} vs генерат ${gen.holes}`);
  }
  defects.push(...fragmentDefects(genT));
  return defects;
}

// ── CLI ────────────────────────────────────────────────────────────────────

const shippedPath = (name, v) =>
  v === 'outline' ? join('svg', 'Outline', `${name}.svg`) : join('svg', 'Filled', `${name}_filled.svg`);
const shippedRel = (name, v) =>
  v === 'outline' ? `svg/Outline/${name}.svg` : `svg/Filled/${name}_filled.svg`;

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const anatomy = JSON.parse(readFileSync(join(repoRoot, 'semantics', 'anatomy.json'), 'utf8'));
  const history = createHandHistory(repoRoot);
  const strict = process.argv.includes('--strict');
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-'));

  /**
   * Проверить один вариант глифа.
   * @returns {{defects:string[], handSource:string}|null} null = вариант не задекларирован
   */
  function checkVariant(name, variant) {
    const entry = anatomy.glyphs[name];
    const status = entry?.status?.[variant];
    if (!status) return null;
    let built;
    try {
      built = buildGlyph(entry, GRID, {}, anatomy.glyphs);
    } catch (cause) {
      return { defects: [`генератор упал (${cause.message})`], handSource: '—' };
    }
    const genD = built[variant];
    if (!genD) return { defects: ['вариант задекларирован, но генерат не строится'], handSource: '—' };

    let handSvg = null;
    let handSource;
    if (status === 'hand') {
      const file = join(repoRoot, shippedPath(name, variant));
      if (!existsSync(file)) return { defects: ['status:hand, но файла нет на диске'], handSource: '—' };
      handSvg = readFileSync(file, 'utf8');
      handSource = 'рука — текущая отгрузка';
    } else {
      const h = history.handFromHistory(shippedRel(name, variant), name, variant);
      if (h) {
        handSvg = h.svg;
        handSource = `рука@${h.sha} (${h.date})`;
      } else {
        handSource = 'руки в истории нет — только осколочный детектор';
      }
    }

    if (!handSvg) {
      return { defects: fragmentDefects(inkTopologyOf(genD)), handSource };
    }
    const handD = renderedPathData(handSvg).join(' ');
    return { defects: topologyDefectsBetween(handD, genD), handSource };
  }

  // Цели: имя глифа (все задекларированные варианты) или имя/вариант.
  function resolveTargets(arg) {
    const [name, variant] = arg.split('/');
    const entry = anatomy.glyphs[name];
    if (!entry) return null;
    const variants = variant ? [variant] : Object.keys(entry.status ?? {});
    return variants.map((v) => ({ name, variant: v }));
  }

  if (args.length > 0) {
    // HARD arg-режим (RED-proof): exit 1 при любом дефекте названных целей.
    const fails = [];
    let checked = 0;
    for (const arg of args) {
      const targets = resolveTargets(arg);
      if (!targets || targets.length === 0) {
        console.error(`check-ink-topology: нет глифа «${arg}» в anatomy (или у него нет статусов)`);
        process.exit(2);
      }
      for (const t of targets) {
        const res = checkVariant(t.name, t.variant);
        if (!res) continue;
        checked++;
        for (const dfc of res.defects) fails.push(`${t.name}/${t.variant}: ${dfc} [${res.handSource}]`);
      }
    }
    if (fails.length > 0) {
      console.log(`check-ink-topology: FAIL — ${fails.length} дефект(ов) топологии:`);
      for (const e of fails) console.log(`  - ${e}`);
      process.exit(1);
    }
    console.log(`check-ink-topology: OK — ${checked} вариант(ов) без дефектов топологии`);
    process.exit(0);
  }

  // Корпусный REPORT-каталог + HARD по промоутнутым в гейт (allowlist).
  const promotedFile = join(repoRoot, 'semantics', 'ink-topology-promoted.json');
  const promoted = existsSync(promotedFile)
    ? JSON.parse(readFileSync(promotedFile, 'utf8')).promoted || []
    : [];
  const offenders = [];
  let checked = 0;
  let generatedTotal = 0;
  for (const [name, entry] of Object.entries(anatomy.glyphs)) {
    for (const variant of Object.keys(entry.status ?? {})) {
      const res = checkVariant(name, variant);
      if (!res) continue;
      checked++;
      if (entry.status[variant] === 'generated') generatedTotal++;
      for (const dfc of res.defects) {
        offenders.push({ key: `${name}/${variant}`, status: entry.status[variant], defect: dfc, handSource: res.handSource });
      }
    }
  }
  const offenderKeys = [...new Set(offenders.map((o) => o.key))];
  const caughtGenerated = offenderKeys.filter((k) =>
    offenders.some((o) => o.key === k && o.status === 'generated'),
  );
  console.log('check-ink-topology: REPORT-каталог (HARD-флип по корпусу — демоут-прогоном):');
  if (offenders.length === 0) {
    console.log(`  дефектов топологии в корпусе нет (проверено ${checked} вариантов).`);
  } else {
    console.log(
      `  ${offenders.length} дефект(ов) у ${offenderKeys.length} вариант(ов); из них ПРОМОУТНУТЫХ (status:generated): ${caughtGenerated.length} из ${generatedTotal}:`,
    );
    for (const o of offenders) {
      console.log(`  - [${o.status}] ${o.key}: ${o.defect} [${o.handSource}]`);
    }
  }
  const hardFails = offenders.filter((o) => promoted.includes(o.key));
  if (hardFails.length > 0) {
    console.log(`check-ink-topology: FAIL — ${hardFails.length} дефект(ов) в защищённых глифах (регрессия топологии):`);
    for (const o of hardFails) console.log(`  - ${o.key}: ${o.defect}`);
    process.exit(1);
  }
  if (strict && offenders.length > 0) process.exit(1);
  console.log(
    `check-ink-topology: OK — REPORT-каталог; ${promoted.length} защищённых вариантов HARD-чисты (кусается через arg-режим: node scripts/check-ink-topology.js close).`,
  );
}
