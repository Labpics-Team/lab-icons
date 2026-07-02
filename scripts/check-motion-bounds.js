/**
 * scripts/check-motion-bounds.js — гейт BL-006: анимация не выводит контур
 * слоя за канву (viewBox). Вылет = срез краем svg (overflow: hidden) в бою.
 *
 * Метод: покадровый прогон данных генерата (motion-scan) — transform каждого
 * слоя вокруг якоря по сетке времени, точки точного контура против границ
 * viewBox с допуском EPS (сглаживание/антиалиасинг).
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { generatedEntries, scanEntry } from './lib/motion-scan.js';

const EPS = 0.05;

/**
 * @param {{generated:any, readSvg:(name:string,variant:string)=>string,
 *          samples?:number}} input
 * @returns {string[]}
 */
export function validateMotionBounds({ generated, readSvg, samples = 48 }) {
  const errors = [];
  for (const { name, variant, entry } of generatedEntries(generated)) {
    const at = `${name}:${variant}`;
    let scan;
    try {
      scan = scanEntry(entry, readSvg(name, variant), { samples });
    } catch (cause) {
      errors.push(`bounds: ${at} — прогон не собрался (${cause.message})`);
      continue;
    }
    const { x, y, width, height } = scan.viewBox;
    /** худший вылет на слой — одна строка на слой, не лавина точек */
    const worst = new Map();
    for (const frame of scan.frames) {
      for (const layer of frame.layers) {
        if (!layer.moving) continue;
        for (const poly of layer.polys) {
          for (const [px, py] of poly) {
            const excess = Math.max(x - px, px - (x + width), y - py, py - (y + height));
            if (excess > EPS) {
              const prev = worst.get(layer.index);
              if (!prev || excess > prev.excess) {
                worst.set(layer.index, { excess, tMs: frame.tMs, px, py });
              }
            }
          }
        }
      }
    }
    for (const [index, v] of worst) {
      errors.push(
        `bounds: ${at} слой ${index} — вылет за канву на ${v.excess.toFixed(2)} ` +
          `(t=${Math.round(v.tMs)}мс, точка (${v.px.toFixed(1)},${v.py.toFixed(1)}))`,
      );
    }
  }
  return errors;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const generated = JSON.parse(
    readFileSync(join(root, 'src', 'animate', 'icon-choreographies.generated.json'), 'utf8'),
  );
  const errors = validateMotionBounds({
    generated,
    readSvg: (name, variant) =>
      readFileSync(
        variant === 'filled'
          ? join(root, 'svg', 'Filled', `${name}_filled.svg`)
          : join(root, 'svg', 'Outline', `${name}.svg`),
        'utf8',
      ),
  });
  if (errors.length > 0) {
    console.error(`check-motion-bounds: FAIL — ${errors.length} ошибок:`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('check-motion-bounds: OK — ни один кадр не выводит контур за канву');
}
