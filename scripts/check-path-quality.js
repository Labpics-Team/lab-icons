/**
 * scripts/check-path-quality.js — гейт чистоты кривых (BL-013).
 *
 * Правило владельца: «отклонение от формы — шум»; форма решается
 * сбалансированным количеством опорных точек. Ловится машиной:
 *   1. Микросегменты (< microSegment) — «узелки».
 *   2. Почти-гладкие изломы: разворот касательных на стыке сегментов
 *      в диапазоне [almostSmoothMin..almostSmoothMax]° — глаз читает как
 *      грязь; осознанный угол (> max) и гладкий стык (< min) легальны.
 *      Проверяются стыки, где оба сегмента длиннее minSegmentForKink
 *      (микроскругления касаются по построению).
 *   3. Лишние узлы: коллинеарные соседние прямые (узел не меняет форму).
 *   4. Нулевые швы: контуры соседних слоёв ближе seamGap БЕЗ площадного
 *      нахлёста — при анимации/сглаживании шов раскрывается щелью;
 *      слои одного вещества обязаны перекрываться, разные — держать зазор.
 *
 * Все токены — доли канвы (grid v2). Режим report (материал ревизии),
 * --strict — ненулевой exit.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderedPathData } from './lib/icon-geometry.js';
import { inkOverlap, samplePolylines, segmentsCross } from './lib/motion-geometry.js';
import { parsePathData } from './lib/path-data.js';

const DEFAULT_RATIOS = {
  microSegment: 0.05 / 24,
  nodeRedundancy: 0.02 / 24,
  seamGap: 0.15 / 24,
  almostSmoothMinDeg: 2,
  almostSmoothMaxDeg: 30,
  minSegmentForKink: 0.3 / 24,
};

function serializeSeg(seg) {
  if (seg.cmd === 'L' || seg.cmd === 'M') return `L${seg.x} ${seg.y}`;
  if (seg.cmd === 'C') return `C${seg.x1} ${seg.y1} ${seg.x2} ${seg.y2} ${seg.x} ${seg.y}`;
  if (seg.cmd === 'Q') return `Q${seg.x1} ${seg.y1} ${seg.x} ${seg.y}`;
  if (seg.cmd === 'A')
    return `A${seg.rx} ${seg.ry} ${seg.rotation} ${seg.largeArc} ${seg.sweep} ${seg.x} ${seg.y}`;
  return '';
}

/** Направления концов сегмента через плотную мини-полилинию (универсально). */
function segmentEnds(seg, fromX, fromY) {
    // 64 сэмпла: хорда полилинии сходится к касательной (< 1° на дуге 90°) —
  // иначе стык прямая↔дуга ложно читается «почти-гладким изломом»
  const poly = samplePolylines(`M${fromX} ${fromY}${serializeSeg(seg)}`, 64)[0] ?? [];
  let start = null;
  for (let i = 1; i < poly.length; i++) {
    const dx = poly[i][0] - poly[0][0];
    const dy = poly[i][1] - poly[0][1];
    if (Math.hypot(dx, dy) > 1e-6) {
      start = Math.atan2(dy, dx);
      break;
    }
  }
  let end = null;
  for (let i = poly.length - 2; i >= 0; i--) {
    const dx = poly[poly.length - 1][0] - poly[i][0];
    const dy = poly[poly.length - 1][1] - poly[i][1];
    if (Math.hypot(dx, dy) > 1e-6) {
      end = Math.atan2(dy, dx);
      break;
    }
  }
  let length = 0;
  for (let i = 1; i < poly.length; i++) {
    length += Math.hypot(poly[i][0] - poly[i - 1][0], poly[i][1] - poly[i - 1][1]);
  }
  return { start, end, length };
}

function angleDiffDeg(a, b) {
  let d = ((b - a) * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d < -180) d += 360;
  return Math.abs(d);
}

function minContourDistance(polysA, polysB) {
  let min = Infinity;
  for (const pa of polysA) {
    for (const [x, y] of pa) {
      for (const pb of polysB) {
        for (let i = 0; i + 1 < pb.length; i++) {
          // расстояние точка—отрезок
          const [x1, y1] = pb[i];
          const [x2, y2] = pb[i + 1];
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len2 = dx * dx + dy * dy;
          const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / len2));
          const d = Math.hypot(x - (x1 + t * dx), y - (y1 + t * dy));
          if (d < min) min = d;
        }
      }
    }
  }
  return min;
}

/**
 * @param {{grid:any, files:Array<{name:string, content:string}>}} input
 * @returns {string[]}
 */
export function validatePathQuality({ grid, files }) {
  const cw = grid.canvas.width;
  const r = { ...DEFAULT_RATIOS, ...(grid.ratios?.pathQuality ?? {}) };
  const micro = r.microSegment * cw;
  const redundancy = r.nodeRedundancy * cw;
  const seamGap = r.seamGap * cw;
  const minSegKink = r.minSegmentForKink * cw;

  const findings = [];
  for (const { name, content } of files) {
    const ds = renderedPathData(content); // path из <defs> — не чернила

    ds.forEach((d, layerIdx) => {
      let segs;
      try {
        segs = parsePathData(d);
      } catch (cause) {
        findings.push(`${name} слой ${layerIdx}: d не парсится (${cause.message})`);
        return;
      }
      // обход суб-путей: концы/длины сегментов
      let cx = 0;
      let cy = 0;
      let subStart = null;
      /** элементы: {startDir, endDir, length, isLine, from:[x,y], to:[x,y]} */
      let chain = [];
      const flushChain = (closed) => {
        if (chain.length === 0) return;
        const pairs = [];
        for (let i = 0; i + 1 < chain.length; i++) pairs.push([chain[i], chain[i + 1]]);
        if (closed && chain.length > 1) pairs.push([chain[chain.length - 1], chain[0]]);
        for (const [a, b] of pairs) {
          if (a.endDir === null || b.startDir === null) continue;
          const kink = angleDiffDeg(a.endDir, b.startDir);
          if (
            kink >= r.almostSmoothMinDeg &&
            kink <= r.almostSmoothMaxDeg &&
            a.length >= minSegKink &&
            b.length >= minSegKink
          ) {
            findings.push(
              `${name} слой ${layerIdx}: почти-гладкий излом ${kink.toFixed(1)}° ` +
                `в точке (${a.to[0].toFixed(2)},${a.to[1].toFixed(2)}) — шум формы`,
            );
          }
          if (a.isLine && b.isLine && kink < r.almostSmoothMinDeg) {
            // отклонение узла от хорды соседей
            const [x1, y1] = a.from;
            const [x2, y2] = b.to;
            const [px, py] = a.to;
            const dx = x2 - x1;
            const dy = y2 - y1;
            const len = Math.hypot(dx, dy) || 1;
            const dist = Math.abs((px - x1) * dy - (py - y1) * dx) / len;
            if (dist < redundancy) {
              findings.push(
                `${name} слой ${layerIdx}: лишний узел (${px.toFixed(2)},${py.toFixed(2)}) ` +
                  `на прямой — узел не меняет форму`,
              );
            }
          }
        }
      };
      for (const seg of segs) {
        if (seg.cmd === 'M') {
          flushChain(false);
          chain = [];
          cx = seg.x;
          cy = seg.y;
          subStart = [seg.x, seg.y];
          continue;
        }
        if (seg.cmd === 'Z') {
          if (subStart && (cx !== subStart[0] || cy !== subStart[1])) {
            const closeLen = Math.hypot(subStart[0] - cx, subStart[1] - cy);
            if (closeLen > 1e-9 && closeLen < micro) {
              findings.push(
                `${name} слой ${layerIdx}: микросегмент замыкания ${closeLen.toFixed(3)}`,
              );
            }
            if (closeLen > 1e-9) {
              const dir = Math.atan2(subStart[1] - cy, subStart[0] - cx);
              chain.push({
                startDir: dir,
                endDir: dir,
                length: closeLen,
                isLine: true,
                from: [cx, cy],
                to: subStart,
              });
            }
          }
          flushChain(true);
          chain = [];
          if (subStart) [cx, cy] = subStart;
          continue;
        }
        const ends = segmentEnds(seg, cx, cy);
        if (ends.length > 1e-9 && ends.length < micro) {
          findings.push(
            `${name} слой ${layerIdx}: микросегмент ${ends.length.toFixed(3)} ` +
              `у (${seg.x.toFixed(2)},${seg.y.toFixed(2)}) — «узелок»`,
          );
        }
        chain.push({
          startDir: ends.start,
          endDir: ends.end,
          length: ends.length,
          isLine: seg.cmd === 'L',
          from: [cx, cy],
          to: [seg.x, seg.y],
        });
        cx = seg.x;
        cy = seg.y;
      }
      flushChain(false);
    });

    // 5. Фрагментация внутри evenodd-path (класс дырок cog): суб-пути
    //    могут быть ВЛОЖЕНЫ (честная дырка), но не могут ПЕРЕСЕКАТЬСЯ —
    //    у evenodd нахлёст фрагментов одного вещества ВЫЧИТАЕТСЯ в белую
    //    дырку; стык-встык даёт волосяную щель. Атрибут fill-rule берём
    //    из полного тега path (renderedPathData отдаёт только d).
    const eoTags = [...content.replace(/<defs\b[\s\S]*?<\/defs>/g, '').matchAll(/<path\b[^>]*?>/g)]
      .filter((m) => m[0].includes('fill-rule="evenodd"'))
      .map((m) => /\bd="([^"]+)"/.exec(m[0])?.[1])
      .filter(Boolean);
    // 5а. Волосяные суб-пути (реальная механика дырок cog): фрагмент со
    //     средней толщиной 2|S|/P меньше hairline — мусор экспорта при
    //     ЛЮБОМ fill-rule (nonzero рисует чёрный волос, evenodd — белый).
    ds.forEach((dOne, layerIdx) => {
      const subs = samplePolylines(dOne, 16).filter((p) => p.length > 2);
      if (subs.length < 2) return; // одиночный контур волосяным быть может лишь намеренно
      subs.forEach((p, si) => {
        let a = 0, per = 0;
        for (let i = 0; i < p.length; i++) {
          const [x1, y1] = p[i];
          const [x2, y2] = p[(i + 1) % p.length];
          a += x1 * y2 - x2 * y1;
          per += Math.hypot(x2 - x1, y2 - y1);
        }
        a = Math.abs(a / 2);
        if (per > 1e-9 && (2 * a) / per < 0.15 && per > 0.1) {
          findings.push(
            `${name} слой ${layerIdx}: волосяной суб-путь ${si} (ср. толщина ${((2 * a) / per).toFixed(3)}, ` +
              `периметр ${per.toFixed(2)}) — фрагмент экспорта, при evenodd даёт белую дырку`,
          );
        }
      });
    });

    // 5б. Встык-швы МЕЖДУ path (класс BL-020, radio): куски одного
    //     вещества в разных path с зазором ~0 — антиалиасинг рисует
    //     волосяной шов через элемент. Report: часть касаний
    //     конструкционные (invert/text) — триаж поштучно.
    {
      const polysByPath = ds.map((dOne) => samplePolylines(dOne, 16).filter((p) => p.length > 2));
      for (let pi = 0; pi < polysByPath.length; pi++) {
        for (let pj = pi + 1; pj < polysByPath.length; pj++) {
          for (const A of polysByPath[pi]) {
            for (const B of polysByPath[pj]) {
              let min = Infinity;
              let at = null;
              for (const q of A) {
                for (const w of B) {
                  const dd = Math.hypot(q[0] - w[0], q[1] - w[1]);
                  if (dd < min) {
                    min = dd;
                    at = q;
                  }
                }
              }
              if (min < 0.02) {
                let cross = false;
                outer: for (let a2 = 0; a2 < A.length; a2++) {
                  for (let b2 = 0; b2 < B.length; b2++) {
                    if (segmentsCross(A[a2], A[(a2 + 1) % A.length], B[b2], B[(b2 + 1) % B.length])) {
                      cross = true;
                      break outer;
                    }
                  }
                }
                if (!cross) {
                  findings.push(
                    `${name}: встык-шов между path ${pi}↔${pj} (зазор ${min.toFixed(4)}) ` +
                      `у (${at[0].toFixed(1)},${at[1].toFixed(1)}) — куски встык рисуют волосяную линию`,
                  );
                }
              }
            }
          }
        }
      }
    }

    for (const dEO of eoTags) {
      const subs = samplePolylines(dEO, 8).filter((p) => p.length > 2);
      if (subs.length < 2) continue;
      const boxes = subs.map((p) => {
        let a = Infinity, b = Infinity, c = -Infinity, d2 = -Infinity;
        for (const [x, y] of p) {
          a = Math.min(a, x); b = Math.min(b, y);
          c = Math.max(c, x); d2 = Math.max(d2, y);
        }
        return [a, b, c, d2];
      });
      const HAIR = 0.05;
      for (let i = 0; i < subs.length; i++) {
        for (let j = i + 1; j < subs.length; j++) {
          // bbox-префильтр с запасом на щель
          if (
            boxes[i][2] + HAIR < boxes[j][0] || boxes[j][2] + HAIR < boxes[i][0] ||
            boxes[i][3] + HAIR < boxes[j][1] || boxes[j][3] + HAIR < boxes[i][1]
          ) continue;
          let crossed = false;
          outer: for (let a = 0; a < subs[i].length; a++) {
            const a1 = subs[i][a], a2 = subs[i][(a + 1) % subs[i].length];
            for (let b = 0; b < subs[j].length; b++) {
              if (segmentsCross(a1, a2, subs[j][b], subs[j][(b + 1) % subs[j].length])) {
                crossed = true;
                break outer;
              }
            }
          }
          if (crossed) {
            findings.push(
              `${name}: суб-пути ${i}×${j} evenodd-path пересекаются — вычитание = дырка ` +
                `(фрагментация экспорта, у (${boxes[j][0].toFixed(1)},${boxes[j][1].toFixed(1)}))`,
            );
          } else {
            const gap = minContourDistance([subs[i]], [subs[j]]);
            if (gap > 1e-9 && gap < HAIR) {
              findings.push(
                `${name}: суб-пути ${i}×${j} evenodd-path встык (щель ${gap.toFixed(3)}) — ` +
                  `волосяной просвет (фрагментация экспорта)`,
              );
            }
          }
        }
      }
    }

    // 4. Нулевые швы между слоями: близко, но без площадного нахлёста.
    if (ds.length > 1) {
      const polys = ds.map((d) => samplePolylines(d, 6));
      for (let i = 0; i < polys.length; i++) {
        for (let j = i + 1; j < polys.length; j++) {
          if (inkOverlap(polys[i], polys[j])) continue; // честный нахлёст
          const dist = minContourDistance(polys[i], polys[j]);
          if (dist < seamGap) {
            findings.push(
              `${name}: слои ${i}×${j} — нулевой шов (зазор ${dist.toFixed(3)}): ` +
                `нужен нахлёст (одно вещество) или зазор ≥ ${seamGap.toFixed(2)}`,
            );
          }
        }
      }
    }
  }
  return findings;
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
  const findings = validatePathQuality({ grid, files });
  if (findings.length > 0) {
    // Расслоение: изломы 2–4° = систематический шум экспортного округления
    // (чинится пере-фитом кривых пакетно), остальное = ревизия руками.
    const minor = findings.filter((e) => /излом [23]\./.test(e));
    const major = findings.filter((e) => !/излом [23]\./.test(e));
    console.log(
      `check-path-quality: REPORT — ${findings.length} находок: ` +
        `${minor.length} minor (экспортный шум 2–4°), ${major.length} major (ревизия)`,
    );
    for (const e of major) console.log('  - ' + e);
  } else {
    console.log(`check-path-quality: OK — кривые ${files.length} файлов чисты`);
  }
  if (process.argv.includes('--strict') && findings.length > 0) process.exit(1);
}
