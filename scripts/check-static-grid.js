/**
 * scripts/check-static-grid.js — гейт СТАТИКИ по сетке (BL-008/BL-009).
 *
 * Сетка (semantics/grid.json) — фундамент дисциплины: ловит «не сходящиеся
 * в деталях» исходные иконки. Правила v1:
 *   1. Канва: контур строго внутри 0..24 (hard всегда).
 *   2. Поля: заход в поля глубже tolerances.marginReport — report;
 *      глубже marginHard (фактически нулевые поля) — нарушение strict.
 *   3. Круглые обрамления (*-circle и полновесные кольца): центр
 *      обрамляющего слоя обязан стоять на центре сетки ±circleCenter —
 *      системный дефект корпуса 2026-07-02: смещение ~0.3 вверх.
 *
 * Режимы: по умолчанию report (exit 0, полный список — материал для
 * поштучной ревизии статики владельцем); --strict — ненулевой exit
 * (включается в CI после ревизии).
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { iconGeometry } from './lib/icon-geometry.js';

/**
 * @param {{grid:any, files:Array<{name:string, content:string}>}} input
 * @returns {{hard:string[], report:string[]}}
 */
export function validateStaticGrid({ grid, files }) {
  const hard = [];
  const report = [];
  const { width: cw, height: ch } = grid.canvas;
  // Токены сетки — доли канвы (grid v2): резолвим в юниты текущей канвы.
  const u = (ratio) => ratio * cw;
  const m = u(grid.ratios.margin);
  const tol = {
    canvas: u(grid.ratios.tolerances.canvas),
    marginReport: u(grid.ratios.tolerances.marginReport),
    marginHard: u(grid.ratios.tolerances.marginHard),
    circleCenter: u(grid.ratios.tolerances.circleCenter),
  };
  const circleKeyline = u(grid.ratios.keylines.circle);

  for (const { name, content } of files) {
    let g;
    try {
      g = iconGeometry(content);
    } catch (cause) {
      hard.push(`${name}: SVG не читается (${cause.message})`);
      continue;
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let enclosure = null;
    for (const p of g.paths) {
      minX = Math.min(minX, p.bbox.minX);
      minY = Math.min(minY, p.bbox.minY);
      maxX = Math.max(maxX, p.bbox.maxX);
      maxY = Math.max(maxY, p.bbox.maxY);
      if (!enclosure || p.area > enclosure.area) enclosure = p;
    }

    // 1. Канва — hard.
    const canvasExcess = Math.max(-minX, -minY, maxX - cw, maxY - ch);
    if (canvasExcess > tol.canvas) {
      hard.push(`${name}: контур за канвой на ${canvasExcess.toFixed(2)}`);
    }

    // 2. Поля.
    const marginDepth = Math.max(m - minX, m - minY, maxX - (cw - m), maxY - (ch - m), 0);
    if (marginDepth > tol.marginHard) {
      hard.push(`${name}: поля фактически нулевые (заход ${marginDepth.toFixed(2)} из ${m})`);
    } else if (marginDepth > tol.marginReport) {
      report.push(`${name}: заход в поля на ${marginDepth.toFixed(2)}`);
    }

    // 3. Круглое обрамление: слой ~квадратного bbox во всю live-zone.
    if (enclosure) {
      const w = enclosure.bbox.maxX - enclosure.bbox.minX;
      const h = enclosure.bbox.maxY - enclosure.bbox.minY;
      const isRing = Math.abs(w - h) < 0.3 && Math.max(w, h) > circleKeyline - 1.5;
      if (isRing) {
        const cx = (enclosure.bbox.minX + enclosure.bbox.maxX) / 2;
        const cy = (enclosure.bbox.minY + enclosure.bbox.maxY) / 2;
        const off = Math.hypot(cx - cw / 2, cy - ch / 2);
        if (off > tol.circleCenter) {
          report.push(
            `${name}: круглое обрамление смещено с центра сетки на ${off.toFixed(2)} ` +
              `(центр ${cx.toFixed(2)},${cy.toFixed(2)})`,
          );
        }
      }
    }
  }
  return { hard, report };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
  const files = [];
  for (const variant of ['Outline', 'Filled']) {
    for (const f of readdirSync(join(root, 'svg', variant))) {
      files.push({
        name: `${variant}/${f}`,
        content: readFileSync(join(root, 'svg', variant, f), 'utf8'),
      });
    }
  }
  const strict = process.argv.includes('--strict');
  const { hard, report } = validateStaticGrid({ grid, files });
  if (hard.length > 0) {
    console.error(`check-static-grid: HARD — ${hard.length} нарушений канвы/полей:`);
    for (const e of hard) console.error('  - ' + e);
  }
  if (report.length > 0) {
    console.log(`check-static-grid: REPORT — ${report.length} отклонений статики (ревизия владельца):`);
    for (const e of report) console.log('  - ' + e);
  }
  if (hard.length === 0 && report.length === 0) {
    console.log(`check-static-grid: OK — статика ${files.length} файлов сходится с сеткой`);
  }
  if (strict && (hard.length > 0 || report.length > 0)) process.exit(1);
  if (!strict && hard.length > 0) process.exit(1);
}
