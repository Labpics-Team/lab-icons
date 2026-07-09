/**
 * scripts/check-motion-collision.js — гейт BL-006: движение не создаёт
 * НОВЫХ наслоений слоёв (класс бага №2 из BL-005 — «вектор наезжал на вектор»).
 *
 * Метод: покадровый прогон (motion-scan); пара слоёв флагается, если чернила
 * пересеклись (рёбра контуров или поглощение, even-odd — дырки честные)
 * там, где в позе покоя пересечения нет. Слои одной части с одинаковой фазой
 * (синхронный transform) не проверяются друг о друга — их взаимная геометрия
 * не меняется.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { inkOverlap } from './lib/motion-geometry.js';
import { generatedEntries, scanEntry } from './lib/motion-scan.js';

/**
 * @param {{generated:any, readSvg:(name:string,variant:string)=>string,
 *          samples?:number}} input
 * @returns {string[]}
 */
export function validateMotionCollision({ generated, readSvg, samples = 48 }) {
  const errors = [];
  for (const { name, variant, entry } of generatedEntries(generated)) {
    const at = `${name}:${variant}`;
    let scan;
    try {
      scan = scanEntry(entry, readSvg(name, variant), { samples });
    } catch (cause) {
      errors.push(`collision: ${at} — прогон не собрался (${cause.message})`);
      continue;
    }
    const n = scan.rest.length;
    const restOverlap = new Set();
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (inkOverlap(scan.rest[i], scan.rest[j])) restOverlap.add(`${i}:${j}`);
      }
    }
    const flagged = new Set();
    for (const frame of scan.frames) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const key = `${i}:${j}`;
          if (restOverlap.has(key) || flagged.has(key)) continue;
          const a = frame.layers[i];
          const b = frame.layers[j];
          if (!a.moving && !b.moving) continue;
          // одна часть + одна фаза = жёсткая связка, взаимно неподвижны
          if (a.moving && b.moving && a.partIdx === b.partIdx && a.delayMs === b.delayMs) {
            continue;
          }
          if (inkOverlap(a.polys, b.polys)) {
            flagged.add(key);
            errors.push(
              `collision: ${at} слои ${i}×${j} — наслоение (t=${Math.round(frame.tMs)}мс)`,
            );
          }
        }
      }
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
  const errors = validateMotionCollision({
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
    console.error(`check-motion-collision: FAIL — ${errors.length} ошибок:`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  console.log('check-motion-collision: OK — движение не создаёт новых наслоений слоёв');
}
