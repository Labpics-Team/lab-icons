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
import { renderedPathData } from './lib/icon-geometry.js';
import { samplePolylines } from './lib/curve-sampling.js';

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
 * Регистрация глифа между вариантами — сопоставлением КОНТУРОВ по сигнатуре
 * (площадь ±30%, габариты ±0.5): состав глифа в Filled легально отличается
 * (негативы сливаются с массами), сравнивать валовый bbox — ловить артефакты
 * (person-circle: внутренний край кольца в Outline срастается с плечами и
 * даёт мнимый разъезд > 3, при идеально совпадающей голове). Меряются только
 * уверенно совпавшие контуры; несопоставленные — структурная разница, не дрейф.
 */
export function glyphRegistration(oGlyphs, fGlyphs, tolReg) {
  const used = new Set();
  const offsets = [];
  const gross = [];
  for (const og of oGlyphs) {
    const candidates = [];
    for (const fg of fGlyphs) {
      if (used.has(fg)) continue;
      const areaOk = Math.abs(og.area - fg.area) / Math.max(og.area, fg.area, 1e-9) <= 0.3;
      const sizeOk = Math.abs(og.bbox.w - fg.bbox.w) <= 0.5 && Math.abs(og.bbox.h - fg.bbox.h) <= 0.5;
      if (!areaOk || !sizeOk) continue;
      const off = Math.hypot(fg.bbox.cx - og.bbox.cx, fg.bbox.cy - og.bbox.cy);
      if (off > 3) continue; // дальше даже как грубый разъезд не читается
      candidates.push({ off, dx: fg.bbox.cx - og.bbox.cx, dy: fg.bbox.cy - og.bbox.cy, fg });
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => a.off - b.off);
    // взаимозаменяемые элементы (точки dice, зубцы ticket): два кандидата
    // с близким off = неоднозначное сопоставление — мерить нельзя.
    // ИЗВЕСТНЫЙ КОМПРОМИСС: реальный дрейф может замаскироваться контуром-
    // обманкой с близким off — принято осознанно (иначе ложные FAIL на
    // каждой сетке точек).
    if (candidates.length > 1 && candidates[1].off - candidates[0].off < 0.5) continue;
    const best = candidates[0];
    if (best.off > 1.2) {
      // однозначное совпадение сигнатуры, но слишком далеко для «съехал»:
      // грубая рассинхронизация ЛИБО структурная разница — отдельная
      // категория, не молчание (порог-фильтр не должен глотать грубое)
      gross.push(best);
      continue;
    }
    used.add(best.fg);
    offsets.push(best);
  }
  const worst = offsets.length ? offsets.reduce((a, b) => (b.off > a.off ? b : a)) : null;
  return {
    matched: offsets.length,
    worst: worst && worst.off > tolReg ? worst : null,
    gross,
    pairs: offsets, // полный список совпавших пар — для инструмента правки
  };
}

/**
 * @param {{grid:any, pairs:Array<{name:string, outline:string, filled:string}>}} input
 * @returns {{hard:string[], report:string[], stats:{rings:number, discs:number, matchedGlyphs:number}}}
 */
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
      const centered =
        Math.abs(f.disc.fit.cx - cw / 2) <= 1 && Math.abs(f.disc.fit.cy - cw / 2) <= 1;
      if (centered && dDisc >= keylineD * 0.8) {
        stats.discs++;
        if (Math.abs(dDisc - keylineD) > tolD) {
          report.push(
            `${name}: Ø диска ${dDisc.toFixed(2)} ≠ keyline ${keylineD.toFixed(2)} (Filled)`,
          );
        }
      }
    }

    // регистрация — по совпавшим контурам, для ВСЕХ пар (не только колец)
    const reg = glyphRegistration(o.glyphs, f.glyphs, tolReg);
    stats.matchedGlyphs += reg.matched;
    if (reg.worst) {
      report.push(
        `${name}: регистрация глифа между вариантами разъехалась на ${reg.worst.off.toFixed(2)} ` +
          `(Δx ${reg.worst.dx.toFixed(2)}, Δy ${reg.worst.dy.toFixed(2)})`,
      );
    }
    for (const g of reg.gross) {
      report.push(
        `${name}: контур совпал по сигнатуре, но стоит в ${g.off.toFixed(2)} — ` +
          `грубая рассинхронизация или структурная разница (глазами)`,
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
  if (strict && (hard.length > 0 || report.length > 0)) process.exit(1);
  if (!strict && hard.length > 0) process.exit(1);
}
