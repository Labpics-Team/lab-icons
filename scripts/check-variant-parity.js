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
 *   3. Регистрация: смысловые контуры глифа обязаны стоять одинаково в обоих
 *      вариантах — сопоставление контуров по сигнатуре (площадь+габариты),
 *      допуск tolerances.variantRegistration. Проверяется на всех парах,
 *      не только кольценосных.
 *
 * Режимы: report (exit 0 — материал поштучных правок), --strict — exit 1.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderedPathData } from '../src/core/icon-geometry.js';
import { samplePolylines } from './lib/curve-sampling.js';
import {
  compareDebtSnapshot,
  validateLegacyQualitySnapshot,
} from './lib/legacy-quality-snapshot.js';

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
export function circleFit(poly) {
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

function contourBBox(poly) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of poly) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  return {
    cx: (minX + maxX) / 2,
    cy: (minY + maxY) / 2,
    w: maxX - minX,
    h: maxY - minY,
  };
}

/**
 * Пересэмплирование рёбер длиннее maxStep: samplePolylines кладёт для
 * L-сегмента только конечную точку — квадрат 16×16 живёт как 4 вершины
 * на равном радиусе и притворяется идеальным кругом для circleFit.
 */
function resampleEdges(poly, maxStep = 0.3) {
  const out = [poly[0]];
  for (let i = 1; i <= poly.length; i++) {
    const a = poly[i - 1];
    const b = poly[i % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const parts = Math.max(1, Math.ceil(len / maxStep));
    for (let j = 1; j <= parts; j++) {
      out.push([a[0] + ((b[0] - a[0]) * j) / parts, a[1] + ((b[1] - a[1]) * j) / parts]);
    }
  }
  out.pop(); // замыкающая точка = первая
  return out;
}

/** Контуры SVG → круги-кандидаты, кольцо, диск, глиф-контуры (не контейнер). */
export function analyze(svgContent, canvasWidth) {
  const ds = renderedPathData(svgContent); // path из <defs> — не чернила
  const contours = ds
    .flatMap((d) => samplePolylines(d, 24))
    .filter((p) => p.length > 2)
    .map((raw) => {
      const poly = resampleEdges(raw);
      return {
        poly,
        fit: circleFit(poly),
        area: Math.abs(areaCentroid(poly).area),
        bbox: contourBBox(poly),
      };
    });
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
  const glyphs = contours.filter((c) => !ringParts.has(c));
  return { ring, disc, glyphs };
}

/**
 * Registration is meaningful only when a contour's geometry is demonstrably
 * identical up to translation. Filled/outline mass, bbox, and area are not a
 * semantic correspondence: either variant can legitimately change them.
 *
 * Repeated exact shapes (for example dot grids) vote for one translation
 * vector. A source pair is considered registered only if that vector accounts
 * for every contour on the smaller glyph side; a partial match has no proven
 * semantic correspondence.
 */
export function glyphIdentityRegistration(oGlyphs, fGlyphs, tolReg) {
  // A path's starting point and winding are exporter details.  Comparing the
  // raw sampled arrays therefore creates false negatives whenever Figma/SVGO
  // rotates the start point or reverses a contour.  Normalize every closed
  // contour to a fixed perimeter sampling, center it, and search cyclic
  // shifts in both winding directions.  Translation remains the only allowed
  // geometric difference: rotation, scale, and silhouette edits do not pass.
  const sampleCount = 96;
  // The source corpus is serialized to roughly 0.001u.  A 0.01u bound is
  // enough for exporter rounding while rejecting a visibly re-shaped filled
  // silhouette that merely happens to have the same outline class.
  const shapeEpsilon = 0.01;
  // The translation vote cannot be stricter than the contour identity proof:
  // exporter rounding that is accepted inside the shape must not split one
  // coherent translation into several artificial clusters.
  const vectorEpsilon = shapeEpsilon;

  function withoutClosure(poly) {
    if (poly.length > 1) {
      const first = poly[0];
      const last = poly[poly.length - 1];
      if (Math.hypot(last[0] - first[0], last[1] - first[1]) <= 1e-8) {
        return poly.slice(0, -1);
      }
    }
    return poly.slice();
  }

  function fixedPerimeter(poly, count) {
    const points = withoutClosure(poly);
    if (points.length < 3) return null;
    const lengths = [];
    let perimeter = 0;
    for (let index = 0; index < points.length; index += 1) {
      const a = points[index];
      const b = points[(index + 1) % points.length];
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      lengths.push(length);
      perimeter += length;
    }
    if (!(perimeter > 1e-8)) return null;

    const out = [];
    let edge = 0;
    let edgeStart = 0;
    for (let sample = 0; sample < count; sample += 1) {
      const distance = (sample * perimeter) / count;
      while (edge < lengths.length - 1 && edgeStart + lengths[edge] < distance) {
        edgeStart += lengths[edge];
        edge += 1;
      }
      const a = points[edge];
      const b = points[(edge + 1) % points.length];
      const span = lengths[edge] || 1;
      const t = Math.max(0, Math.min(1, (distance - edgeStart) / span));
      out.push([
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t,
      ]);
    }
    const center = out.reduce(
      (sum, [x, y]) => [sum[0] + x / count, sum[1] + y / count],
      [0, 0],
    );
    return {
      center,
      points: out.map(([x, y]) => [x - center[0], y - center[1]]),
    };
  }

  function distanceAt(a, b, shift, reverse) {
    let worst = 0;
    for (let index = 0; index < sampleCount; index += 1) {
      const mapped = reverse
        ? (shift - index + sampleCount * 2) % sampleCount
        : (index + shift) % sampleCount;
      const dx = a.points[index][0] - b.points[mapped][0];
      const dy = a.points[index][1] - b.points[mapped][1];
      worst = Math.max(worst, Math.hypot(dx, dy));
      if (worst > shapeEpsilon) return worst;
    }
    return worst;
  }

  function identicalContour(outline, filled) {
    const a = fixedPerimeter(outline.poly, sampleCount);
    const b = fixedPerimeter(filled.poly, sampleCount);
    if (!a || !b) return null;
    let best = Infinity;
    for (let shift = 0; shift < sampleCount; shift += 1) {
      best = Math.min(best, distanceAt(a, b, shift, false), distanceAt(a, b, shift, true));
      if (best <= shapeEpsilon) break;
    }
    if (best > shapeEpsilon) return null;
    return {
      dx: b.center[0] - a.center[0],
      dy: b.center[1] - a.center[1],
      off: Math.hypot(b.center[0] - a.center[0], b.center[1] - a.center[1]),
    };
  }

  const translations = [];

  for (const [outlineIndex, outline] of oGlyphs.entries()) {
    for (const [filledIndex, filled] of fGlyphs.entries()) {
      const match = identicalContour(outline, filled);
      if (!match) continue;
      translations.push({
        outlineIndex,
        filledIndex,
        ...match,
      });
    }
  }

  const clusters = [];
  for (const translation of translations) {
    let cluster = clusters.find(
      (candidate) => Math.hypot(candidate.dx - translation.dx, candidate.dy - translation.dy) <= vectorEpsilon,
    );
    if (!cluster) {
      cluster = { dx: translation.dx, dy: translation.dy, matches: [] };
      clusters.push(cluster);
    }
    cluster.matches.push(translation);
  }

  for (const cluster of clusters) {
    const usedOutline = new Set();
    const usedFilled = new Set();
    cluster.pairs = [];
    for (const match of cluster.matches) {
      if (usedOutline.has(match.outlineIndex) || usedFilled.has(match.filledIndex)) continue;
      usedOutline.add(match.outlineIndex);
      usedFilled.add(match.filledIndex);
      cluster.pairs.push(match);
    }
    cluster.support = cluster.pairs.length;
    cluster.off = Math.hypot(cluster.dx, cluster.dy);
  }

  // Source variants often reuse a same-sized primitive in several positions
  // (QR cells, sun rays). A subset can therefore vote for a false translation.
  // Treat a source pair as registered only when every glyph contour on the
  // smaller side is proven identical up to one vector; otherwise its semantic
  // correspondence is intentionally unknown.
  const minimumSupport = Math.min(oGlyphs.length, fGlyphs.length);
  const coherent = minimumSupport > 0
    ? clusters.filter((cluster) => cluster.support >= minimumSupport)
    : [];
  const shifted = coherent.filter((cluster) => cluster.off > tolReg);
  const worst = shifted.length
    ? shifted.reduce((a, b) => (b.off > a.off ? b : a))
    : null;
  const pairs = coherent.flatMap((cluster) => cluster.pairs);

  return {
    matched: pairs.length,
    worst,
    pairs,
  };
}

export function validateVariantParity({ grid, pairs }) {
  const hard = [];
  const report = [];
  const stats = { rings: 0, discs: 0, matchedGlyphs: 0 };
  const cw = grid.canvas.width;
  const u = (ratio) => ratio * cw;
  const thresholds = {
    keylineD: u(grid.ratios.keylines?.circle),
    base: u(grid.ratios.strokeWidth?.base),
    enclosure: u(grid.ratios.strokeWidth?.enclosureRing),
    tolW: u(grid.ratios.tolerances?.ringWeight),
    tolD: u(grid.ratios.tolerances?.ringDiameter),
    tolReg: u(grid.ratios.tolerances?.variantRegistration),
  };
  // fail-fast: пропавший токен даёт NaN, а сравнение с NaN всегда false —
  // гейт молча перестал бы падать (тихий отказ хуже падения)
  for (const [key, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value)) {
      throw new Error(`check-variant-parity: токен «${key}» отсутствует или не число в grid.json`);
    }
  }
  const { keylineD, base, enclosure, tolW, tolD, tolReg } = thresholds;

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

    // каноны кольца — только при детектированном кольце в Outline
    if (o.ring) {
      stats.rings++;
      const dOuter = o.ring.outer.fit.r * 2;
      const ringCenterOffset = Math.hypot(
        o.ring.outer.fit.cx - cw / 2,
        o.ring.outer.fit.cy - cw / 2,
      );
      if (ringCenterOffset > tolReg) {
        report.push(
          `${name}: keyline ring center moved from the canvas center by ${ringCenterOffset.toFixed(2)}` +
            ` (x ${o.ring.outer.fit.cx.toFixed(2)}, y ${o.ring.outer.fit.cy.toFixed(2)})`,
        );
      }
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
    }

    // канон диска: кандидат в keyline-контейнер определяется НЕЗАВИСИМЫМИ
    // признаками (центр у центра сетки, размер ≥ 0.8 keyline) — критерий
    // «близок к keyline» замыкался на проверяемое значение и глотал грубые
    // разъезды (Ø20 «не кандидат» → молчание)
    if (f.disc) {
      const dDisc = f.disc.fit.r * 2;
      const discCenterOffset = Math.hypot(
        f.disc.fit.cx - cw / 2,
        f.disc.fit.cy - cw / 2,
      );
      if (dDisc >= keylineD * 0.8) {
        stats.discs++;
        if (discCenterOffset > tolReg) {
          report.push(
            `${name}: keyline disc center moved from the canvas center by ${discCenterOffset.toFixed(2)}` +
              ` (x ${f.disc.fit.cx.toFixed(2)}, y ${f.disc.fit.cy.toFixed(2)})`,
          );
        }
        if (Math.abs(dDisc - keylineD) > tolD) {
          report.push(
            `${name}: Ø диска ${dDisc.toFixed(2)} ≠ keyline ${keylineD.toFixed(2)} (Filled)`,
          );
        }
      }
    }

    // регистрация — по совпавшим контурам, для ВСЕХ пар (не только колец)
    const reg = glyphIdentityRegistration(o.glyphs, f.glyphs, tolReg);
    stats.matchedGlyphs += reg.matched;
    if (reg.worst) {
      report.push(
        `${name}: регистрация глифа между вариантами разъехалась на ${reg.worst.off.toFixed(2)} ` +
          `(Δx ${reg.worst.dx.toFixed(2)}, Δy ${reg.worst.dy.toFixed(2)})`,
      );
    }
  }
  return { hard, report, stats };
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
  const { hard, report, stats } = validateVariantParity({ grid, pairs });
  const debt = validateLegacyQualitySnapshot(
    JSON.parse(readFileSync(join(root, 'semantics', 'legacy-quality-snapshot.json'), 'utf8')),
  );
  const debtErrors = compareDebtSnapshot(report, debt.variantParity);
  const covered =
    `проверено: ${stats.rings} колец, ${stats.discs} keyline-дисков, ` +
    `${stats.matchedGlyphs} сопоставленных глиф-контуров из ${pairs.length} пар`;
  if (hard.length > 0) {
    console.error(`check-variant-parity: HARD — ${hard.length} нечитаемых пар:`);
    for (const e of hard) console.error('  - ' + e);
  }
  if (report.length > 0) {
    console.log(
      `check-variant-parity: REPORT — ${report.length} отклонений контракта пары (${covered}):`,
    );
    for (const e of report) console.log('  - ' + e);
  }
  if (hard.length === 0 && report.length === 0) {
    console.log(`check-variant-parity: OK — контракт пар держится (${covered})`);
  }
  if (debtErrors.length > 0) {
    console.error(
      'check-variant-parity: HARD — frozen migration debt изменился; ' +
      `сначала опровергнуть регрессию:\n  - ${debtErrors.join('\n  - ')}`,
    );
  }
  if (debtErrors.length > 0) process.exit(1);
  if (strict && (hard.length > 0 || report.length > 0)) process.exit(1);
  if (!strict && hard.length > 0) process.exit(1);
}
