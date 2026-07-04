/**
 * scripts/check-anatomy-drift.js — гейт дрейфа «анатомия ↔ файл» (BL-015).
 *
 * Для каждого глифа semantics/anatomy.json генерат из декларации
 * сверяется с файлом svg/ по IoU чернил:
 *   status=generated — файл создан генератором: IoU ≥ 0.995 (hard);
 *   status=hand      — рука ещё не заменена: IoU ≥ 0.95 (report при
 *                      меньшем — анатомия или файл уехали).
 *
 * Не задекларировано в анатомии = не проверяется (миграция поэтапная).
 * Режимы: report / --strict (как у соседей).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGlyph } from './lib/anatomy-gen.js';
import { renderedPathData } from './lib/icon-geometry.js';
import { samplePolylines } from './lib/motion-geometry.js';

function inkAt(polys, x, y) {
  let hits = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if (y1 > y !== y2 > y && x < x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)) hits++;
    }
  }
  return hits % 2 === 1;
}

export function inkIoU(dA, dB, cw, step = 0.12) {
  const A = samplePolylines(dA, 24).filter((p) => p.length > 2);
  const B = samplePolylines(dB, 24).filter((p) => p.length > 2);
  let both = 0, onlyA = 0, onlyB = 0;
  for (let x = step / 2; x < cw; x += step) {
    for (let y = step / 2; y < cw; y += step) {
      const a = inkAt(A, x, y);
      const b = inkAt(B, x, y);
      if (a && b) both++;
      else if (a) onlyA++;
      else if (b) onlyB++;
    }
  }
  return both / (both + onlyA + onlyB || 1);
}

/**
 * @param {{grid:any, anatomy:any, readSvg:(variant:string, name:string)=>string|null}} input
 * @returns {{hard:string[], report:string[], checked:number}}
 */
export function validateAnatomy({ grid, anatomy, readSvg }) {
  const hard = [];
  const report = [];
  let checked = 0;
  const cw = grid.canvas.width;
  for (const [name, entry] of Object.entries(anatomy.glyphs)) {
    let built;
    try {
      built = buildGlyph(entry, grid);
    } catch (cause) {
      hard.push(`${name}: генератор упал (${cause.message})`);
      continue;
    }
    for (const [variant, dGen] of Object.entries(built)) {
      const status = entry.status?.[variant];
      if (!status) continue;
      const file = readSvg(variant, name);
      if (!file) {
        hard.push(`${name}/${variant}: файла нет, а анатомия заявлена`);
        continue;
      }
      const dFile = renderedPathData(file).join('');
      const iou = inkIoU(dGen, dFile, cw);
      checked++;
      if (status === 'generated' && iou < 0.995) {
        hard.push(
          `${name}/${variant}: дрейф генерата и файла — IoU ${(iou * 100).toFixed(2)}% < 99.5% (status=generated)`,
        );
      } else if (status === 'hand' && iou < 0.95) {
        report.push(
          `${name}/${variant}: анатомия разошлась с рукой — IoU ${(iou * 100).toFixed(2)}% < 95%`,
        );
      }
    }
  }
  return { hard, report, checked };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
  const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
  const readSvg = (variant, name) => {
    const file =
      variant === 'outline'
        ? join(root, 'svg', 'Outline', `${name}.svg`)
        : join(root, 'svg', 'Filled', `${name}_filled.svg`);
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };
  const strict = process.argv.includes('--strict');
  const { hard, report, checked } = validateAnatomy({ grid, anatomy, readSvg });
  if (hard.length > 0) {
    console.error(`check-anatomy-drift: HARD — ${hard.length} дрейфов:`);
    for (const e of hard) console.error('  - ' + e);
  }
  if (report.length > 0) {
    console.log(`check-anatomy-drift: REPORT — ${report.length} расхождений с рукой:`);
    for (const e of report) console.log('  - ' + e);
  }
  if (hard.length === 0 && report.length === 0) {
    console.log(`check-anatomy-drift: OK — анатомия сходится с файлами (проверено ${checked} вариантов)`);
  }
  if (hard.length > 0 || (strict && report.length > 0)) process.exit(1);
}
