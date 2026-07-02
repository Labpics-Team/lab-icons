/**
 * scripts/check-variant-parity.js — гейт геометрического КОНТРАКТА пары
 * Outline↔Filled (BL-016). Наличие пар файлов держит check-parity.js;
 * здесь — геометрия:
 *
 *   1. Кольца (Outline) и диски (Filled) держат канон Ø = keylines.circle.
 *   2. Толщина кольца = ОДИН ИЗ ДВУХ канонов весов: базис (предметный круг —
 *      часы, смайл) или enclosureRing (круг-обрамление легче глифа, приём
 *      SF-уровня). Третьего канона нет — корпусный аудит 2026-07-02 нашёл
 *      ровно два (22×1.50 + 9×1.80), всё прочее = дрейф.
 *   3. Регистрация: глиф внутри обрамления обязан стоять одинаково в обоих
 *      вариантах (bbox-центр не-кольцевых контуров; допуск
 *      tolerances.variantRegistration; дрейф корпуса: chevron-down-circle
 *      0.31 по Y, time 0.17).
 *
 * Режимы: report (exit 0 — материал поштучных правок), --strict — exit 1.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { samplePolylines } from './lib/motion-geometry.js';

/** Площадь и центроид замкнутой полилинии (Гаусс). */
function areaCentroid(poly) {
  let a = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const w = x1 * y2 - x2 * y1;
    a += w;
    cx += (x1 + x2) * w;
    cy += (y1 + y2) * w;
  }
  a /= 2;
  if (Math.abs(a) < 1e-9) return { area: 0, cx: 0, cy: 0 };
  return { area: a, cx: cx / (6 * a), cy: cy / (6 * a) };
}

/** Оценка круга: центр, средний радиус, некруглость (max-min радиуса). */
function circleFit(poly) {
  const { cx, cy } = areaCentroid(poly);
  let sum = 0;
  let min = Infinity;
  let max = -Infinity;
  for (const [x, y] of poly) {
    const r = Math.hypot(x - cx, y - cy);
    sum += r;
    min = Math.min(min, r);
    max = Math.max(max, r);
  }
  return { cx, cy, r: sum / poly.length, rondel: max - min };
}

/** Контуры SVG → круги-кандидаты, кольца, диск, bbox-центр глифа. */
function analyze(svgContent, canvasWidth) {
  const ds = [...svgContent.matchAll(/<path\b[^>]*?\bd="([^"]+)"/g)].map((m) => m[1]);
  const contours = ds
    .flatMap((d) => samplePolylines(d, 24))
    .filter((p) => p.length > 2)
    .map((poly) => ({ poly, fit: circleFit(poly), area: Math.abs(areaCentroid(poly).area) }));
  // площадь > 3 и r в пределах канвы: обрезки руин дают нестабильный
  // centroid и фиктивные «круги» радиусом больше канвы
  const isCircle = (c) =>
    c.fit.rondel < 0.35 && c.fit.r > canvasWidth / 4 && c.fit.r < canvasWidth * 0.55 && c.area > 3;
  const circles = contours.filter(isCircle);

  // кольцо = концентрическая пара кругов (внешний/внутренний)
  let ring = null;
  for (const outer of circles) {
    for (const inner of circles) {
      if (inner === outer || inner.fit.r >= outer.fit.r) continue;
      const conc = Math.hypot(outer.fit.cx - inner.fit.cx, outer.fit.cy - inner.fit.cy);
      const thick = outer.fit.r - inner.fit.r;
      if (conc < 0.5 && thick > 0.5 && thick < 3) {
        if (!ring || outer.fit.r > ring.outer.fit.r) ring = { outer, inner, thick };
      }
    }
  }
  // диск = крупнейший круг (для Filled-варианта)
  const disc = circles.reduce((best, c) => (!best || c.fit.r > best.fit.r ? c : best), null);

  const ringParts = ring ? new Set([ring.outer, ring.inner]) : new Set(disc ? [disc] : []);
  const glyphParts = contours.filter((c) => !ringParts.has(c));
  let glyph = null;
  if (glyphParts.length) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const { poly } of glyphParts) {
      for (const [x, y] of poly) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    }
    glyph = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
  }
  return { ring, disc, glyph };
}

/**
 * @param {{grid:any, pairs:Array<{name:string, outline:string, filled:string}>}} input
 * @returns {{hard:string[], report:string[]}}
 */
export function validateVariantParity({ grid, pairs }) {
  const hard = [];
  const report = [];
  const cw = grid.canvas.width;
  const u = (ratio) => ratio * cw;
  const keylineD = u(grid.ratios.keylines.circle);
  const base = u(grid.ratios.strokeWidth.base);
  const enclosure = u(grid.ratios.strokeWidth.enclosureRing);
  const tolW = u(grid.ratios.tolerances.ringWeight);
  const tolD = u(grid.ratios.tolerances.ringDiameter);
  const tolReg = u(grid.ratios.tolerances.variantRegistration);

  for (const { name, outline, filled } of pairs) {
    let o;
    let f;
    try {
      o = analyze(outline, cw);
      f = analyze(filled, cw);
    } catch (cause) {
      hard.push(`${name}: вариант не читается (${cause.message})`);
      continue;
    }
    if (!o.ring) continue; // без кольца контракт колец не применим

    const dOuter = o.ring.outer.fit.r * 2;
    if (Math.abs(dOuter - keylineD) > tolD) {
      report.push(
        `${name}: Ø кольца ${dOuter.toFixed(2)} ≠ keyline ${keylineD.toFixed(2)} (Outline)`,
      );
    }
    const t = o.ring.thick;
    if (Math.abs(t - base) > tolW && Math.abs(t - enclosure) > tolW) {
      report.push(
        `${name}: толщина кольца ${t.toFixed(2)} вне канонов весов ` +
          `(${enclosure.toFixed(2)} обрамление / ${base.toFixed(2)} предмет)`,
      );
    }

    if (f.disc) {
      const dDisc = f.disc.fit.r * 2;
      if (Math.abs(dDisc - keylineD) > tolD) {
        report.push(
          `${name}: Ø диска ${dDisc.toFixed(2)} ≠ keyline ${keylineD.toFixed(2)} (Filled)`,
        );
      }
    }

    if (o.glyph && f.glyph) {
      const dx = f.glyph.cx - o.glyph.cx;
      const dy = f.glyph.cy - o.glyph.cy;
      const off = Math.hypot(dx, dy);
      if (off > tolReg) {
        report.push(
          `${name}: регистрация глифа между вариантами разъехалась на ${off.toFixed(2)} ` +
            `(Δx ${dx.toFixed(2)}, Δy ${dy.toFixed(2)})`,
        );
      }
    }
  }
  return { hard, report };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
  const pairs = [];
  for (const file of readdirSync(join(root, 'svg', 'Outline'))) {
    const name = file.replace(/\.svg$/, '');
    pairs.push({
      name,
      outline: readFileSync(join(root, 'svg', 'Outline', file), 'utf8'),
      filled: readFileSync(join(root, 'svg', 'Filled', `${name}_filled.svg`), 'utf8'),
    });
  }
  const strict = process.argv.includes('--strict');
  const { hard, report } = validateVariantParity({ grid, pairs });
  if (hard.length > 0) {
    console.error(`check-variant-parity: HARD — ${hard.length} нечитаемых пар:`);
    for (const e of hard) console.error('  - ' + e);
  }
  if (report.length > 0) {
    console.log(
      `check-variant-parity: REPORT — ${report.length} отклонений контракта пары (ревизия):`,
    );
    for (const e of report) console.log('  - ' + e);
  }
  if (hard.length === 0 && report.length === 0) {
    console.log(`check-variant-parity: OK — контракт пар держится (${pairs.length} пар)`);
  }
  if (strict && (hard.length > 0 || report.length > 0)) process.exit(1);
  if (!strict && hard.length > 0) process.exit(1);
}
