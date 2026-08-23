#!/usr/bin/env node
/**
 * offline-cov00/measure.mjs — COV-00 offline experiment: честный замер
 * транскрипции arc-chain для всех имён без semantic-модели.
 *
 * Ничего в репо не мутирует: читает svg/ + semantics/, пишет только в
 * offline-cov00/. Метрики per-variant:
 *   - IoU (маска чернил, оракул drift-гейта rasterizePathEntries);
 *   - дискретный Хаусдорф в КЛЕТКАХ растра (симметричный, по маскам) —
 *    правильный инвариант для тонких штрихов (память: IoU роняется
 *    квантованием до 0.92 на визуально идентичных);
 *   - topology: число компонент/дыр (significantTopology, 4 фазы) +
 *    сравнение числа субпутей и fill-rule классов;
 *   - reason code при провале.
 *
 * Пороги вердикта (из quality-thresholds + память о Хаусдорфе):
 *   PASS: Хаусдорф ≤ 1 клетки И topology стабильна и совпадает.
 *   Иначе reason code: BUILD_FAIL | HAUSDORFF_GT1 | TOPOLOGY_DIFF |
 *   TOPOLOGY_UNSTABLE.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderedPathEntries } from '../../../../src/core/icon-geometry.js';
import { buildGlyph } from '../../../../src/core/anatomy-gen.js';
import {
  rasterizePathEntries,
  topologyAcrossPhases,
} from '../../../../scripts/lib/ink-raster.js';
import { buildAnatomyEntry } from './transcribe-arc-chain.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const grid = JSON.parse(readFileSync(join(ROOT, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(ROOT, 'semantics', 'anatomy.json'), 'utf8'));
const CW = grid.canvas.width;
const STEP = 0.12; // тот же шаг, что drift-гейт maskIoU
// Порог значимой topology-фичи: клетка ~0.12×0.12 → шум < 3 клеток
const MIN_FEATURE = 5 * STEP * STEP;

// ── метрики по маскам ────────────────────────────────────────────────────────

export function maskOf(entries) {
  return rasterizePathEntries(entries, { width: CW, height: CW, step: STEP, phaseX: 0.5, phaseY: 0.5 });
}

export function iouOfMasks(A, B) {
  let inter = 0, uni = 0;
  for (let i = 0; i < A.mask.length; i++) {
    const a = A.mask[i] !== 0, b = B.mask[i] !== 0;
    if (a && b) inter++;
    if (a || b) uni++;
  }
  return inter / (uni || 1);
}

/**
 * Дискретный симметричный Хаусдорф между двумя масками, в клетках растра.
 * BFS-волна от каждой маски (дистанс-трансформа Чебышёва, 8-связность):
 * H = max( max_{a∈A} d(a,B), max_{b∈B} d(b,A) ).
 */
function chebyshevDT(mask, cols, rows) {
  const INF = 1e9;
  const d = new Float64Array(mask.length).fill(INF);
  const qx = new Int32Array(mask.length), qy = new Int32Array(mask.length);
  let head = 0, tail = 0;
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
    if (mask[r * cols + c]) { d[r * cols + c] = 0; qx[tail] = c; qy[tail] = r; tail++; }
  }
  while (head < tail) {
    const c = qx[head], r = qy[head]; head++;
    const base = d[r * cols + c];
    for (let dr = -1; dr <= 1; dr++) for (let dc = -1; dc <= 1; dc++) {
      if (!dr && !dc) continue;
      const nr = r + dr, nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const idx = nr * cols + nc;
      if (d[idx] > base + 1) { d[idx] = base + 1; qx[tail] = nc; qy[tail] = nr; tail++; }
    }
  }
  return d;
}

export function hausdorffCells(A, B) {
  const { cols, rows } = A;
  const dtB = chebyshevDT(B.mask, cols, rows);
  const dtA = chebyshevDT(A.mask, cols, rows);
  let hAB = 0, hBA = 0;
  let emptyA = true, emptyB = true;
  for (let i = 0; i < A.mask.length; i++) {
    if (A.mask[i]) { emptyA = false; if (dtB[i] > hAB) hAB = dtB[i]; }
    if (B.mask[i]) { emptyB = false; if (dtA[i] > hBA) hBA = dtA[i]; }
  }
  if (emptyA || emptyB) return Infinity;
  return Math.max(hAB, hBA);
}

function topoSig(entries) {
  const t = topologyAcrossPhases(entries, {
    width: CW, height: CW, step: STEP, minFeatureArea: MIN_FEATURE,
  });
  return { stable: t.stable, sig: t.signatures[0], signatures: t.signatures };
}

function countSubpaths(entries) {
  let n = 0;
  for (const e of entries) n += (e.d.match(/M/gi) || []).length;
  return n;
}

function fillRuleClasses(entries) {
  return [...new Set(entries.map((e) => (e.fillRule === 'evenodd' ? 'evenodd' : 'nonzero')))].sort().join('+');
}

// ── прогон ───────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
const names = readdirSync(join(ROOT, 'svg', 'Outline'))
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.slice(0, -4))
  .filter((n) => !anatomy.glyphs[n])
  .sort();

const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)?.split(',');
const targets = only ? names.filter((n) => only.includes(n)) : names;

const results = [];
const t0 = Date.now();
for (const name of targets) {
  const row = { name, variants: {} };
  let outlineSvg, filledSvg;
  try {
    outlineSvg = readFileSync(join(ROOT, 'svg', 'Outline', `${name}.svg`), 'utf8');
    filledSvg = readFileSync(join(ROOT, 'svg', 'Filled', `${name}_filled.svg`), 'utf8');
  } catch (cause) {
    row.error = `NO_INPUT: ${cause.message}`;
    results.push(row);
    continue;
  }
  let entry, built;
  try {
    entry = buildAnatomyEntry({ outlineSvg, filledSvg, cw: CW });
    built = buildGlyph(entry, grid, {}, anatomy.glyphs);
  } catch (cause) {
    row.error = `BUILD_FAIL: ${cause.message}`;
    results.push(row);
    continue;
  }
  row.parts = entry.parts.length;
  row.segs = entry.parts.reduce((s, p) => {
    for (const v of ['outline', 'filled']) if (p.params[v]) s += p.params[v].segs.length;
    return s;
  }, 0);
  for (const [variant, svg] of [['outline', outlineSvg], ['filled', filledSvg]]) {
    const origEntries = renderedPathEntries(svg);
    // Кандидат — конкатенация транскрибированных субпутей исходного path;
    // дырки оригинала живут за счёт его fill-rule → зеркалим правило.
    const candEntries = [{ d: built[variant], fillRule: origEntries[0]?.fillRule ?? 'nonzero' }];
    let mo, mc;
    try {
      mo = maskOf(origEntries);
      mc = maskOf(candEntries);
    } catch (cause) {
      row.variants[variant] = { reason: `RASTER_FAIL: ${cause.message}` };
      continue;
    }
    const iou = iouOfMasks(mo, mc);
    const haus = hausdorffCells(mo, mc);
    const tOrig = topoSig(origEntries);
    const tCand = topoSig(candEntries);
    const subOrig = countSubpaths(origEntries);
    const subCand = countSubpaths(candEntries);
    const frOrig = fillRuleClasses(origEntries);
    const frCand = fillRuleClasses(candEntries);
    // Провал — только когда кандидат ОТКЛОНИЛСЯ от оригинала:
    // нестабильный оригинал с тем же набором фазовых сигнатур — не дефект
    // транскрипции (свойство растра исходника, кандидат его повторил).
    const sigSet = (t) => [...new Set(t.signatures)].sort().join('|');
    let reason = null;
    if (tOrig.stable && !tCand.stable) reason = 'TOPOLOGY_UNSTABLE_INTRODUCED';
    else if (tOrig.stable && tCand.stable && tOrig.sig !== tCand.sig) reason = 'TOPOLOGY_DIFF';
    else if (!tOrig.stable && sigSet(tOrig) !== sigSet(tCand)) reason = 'TOPOLOGY_PHASE_MISMATCH';
    else if (haus > 1) reason = 'HAUSDORFF_GT1';
    row.variants[variant] = {
      iou: Number(iou.toFixed(4)),
      hausdorffCells: haus === Infinity ? 'inf' : haus,
      topoOrig: tOrig.sig, topoCand: tCand.sig,
      topoStableOrig: tOrig.stable, topoStableCand: tCand.stable,
      subpaths: `${subOrig}→${subCand}`,
      fillRules: `${frOrig}→${frCand}`,
      reason,
    };
  }
  results.push(row);
}
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);

writeFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'results.json'),
  JSON.stringify({ commit: process.env.COV_COMMIT ?? null, step: STEP, canvas: CW, minFeatureArea: MIN_FEATURE, elapsedSec: Number(elapsed), targets: targets.length, results }, null, 1),
);
console.log(`measure: ${targets.length} имён за ${elapsed}s → results.json`);
}
