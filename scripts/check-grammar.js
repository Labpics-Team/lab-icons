#!/usr/bin/env node
/**
 * scripts/check-grammar.js — грамматика начертания (v1: направления рёбер).
 *
 * Кастомные силуэты систематизируются НЕ декомпозицией в примитивы, а общей
 * ГРАММАТИКОЙ КОНСТРУКЦИИ, наложенной на произвольный скелет — как шрифтовая
 * foundry систематизирует буквы (все разные) единым пером/терминалами/
 * суставами. Первый закон грамматики, применимый к ЛЮБОЙ форме:
 *
 *   R1 — направление прямого ребра. Каждое прямое ребро длиной ≥ minLen,
 *   чьё направление лежит В ПОЛОСЕ СНОСА (0.5°, snapDeg) от какого-либо
 *   направления angleScale (0/30/45/90/135), обязано СОВПАДАТЬ со шкалой:
 *   ребро «почти горизонтальное» с наклоном 1–3° — экспортный дребезг
 *   (наклон 3° на 10 юнитах = 0.5 юнита подъёма, видимая кривизна прямой).
 *   Рёбра дальше snapDeg — намеренные диагонали произвольного угла, НЕ
 *   нарушение (грамматика допускает custom-направления, ловит только снос).
 *
 * Режимы: report (exit 0 — punch-list миграции), --strict — exit 1.
 * Слой расширяется (вес на лестнице, терминал=cap) — v1 держит направления.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { renderedPathData } from './lib/icon-geometry.js';
import { parsePathData } from './lib/path-data.js';

const MIN_EDGE = 1.0; // короче — микроребро скругления, не несёт направления
const EXACT_EPS = 0.5; // уже на шкале (в пределах сериализации 3 знаков)

/** Минимальное отклонение направления (град, mod 180) от шкалы углов. */
function scaleDeviation(angleDeg, scale) {
  const a = ((angleDeg % 180) + 180) % 180;
  let best = Infinity;
  for (const s of scale) {
    const t = ((s % 180) + 180) % 180;
    best = Math.min(best, Math.abs(a - t), Math.abs(a - t - 180), Math.abs(a - t + 180));
  }
  return best;
}

export function validateGrammar({ grid, files }) {
  const hard = [];
  const report = [];
  const scale = grid.ratios.angleScale;
  const snapDeg = grid.ratios.grammarSnapDeg ?? 4;

  for (const { name, content } of files) {
    let ds;
    try {
      ds = renderedPathData(content);
    } catch (cause) {
      hard.push(`${name}: SVG не читается (${cause.message})`);
      continue;
    }
    const seen = new Set(); // дедуп по (ближняя ступень) — макс 5 строк/файл
    for (const d of ds) {
      let px = 0, py = 0, sx = 0, sy = 0;
      const edge = (x1, y1, x2, y2) => {
        const len = Math.hypot(x2 - x1, y2 - y1);
        if (len < MIN_EDGE) return;
        const dir = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
        const dev = scaleDeviation(dir, scale);
        if (dev <= EXACT_EPS || dev >= snapDeg) return; // на шкале ИЛИ намеренная диагональ
        const nearest = scale.reduce((a, b) =>
          scaleDeviation(dir, [b]) < scaleDeviation(dir, [a]) ? b : a,
        );
        if (seen.has(nearest)) return;
        seen.add(nearest);
        report.push(
          `${name}: прямое ребро ~${nearest}° со сносом ${dev.toFixed(1)}° — вне грамматики направлений (снап к шкале)`,
        );
      };
      for (const s of parsePathData(d)) {
        if (s.cmd === 'M') {
          px = s.x; py = s.y; sx = s.x; sy = s.y;
          continue;
        }
        if (s.cmd === 'Z') {
          edge(px, py, sx, sy); // замыкающее ребро
          px = sx; py = sy;
          continue;
        }
        if (s.cmd === 'L') edge(px, py, s.x, s.y);
        if ('x' in s) { px = s.x; py = s.y; }
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
      files.push({ name: `${variant}/${f}`, content: readFileSync(join(root, 'svg', variant, f), 'utf8') });
    }
  }
  const strict = process.argv.includes('--strict');
  const { hard, report } = validateGrammar({ grid, files });
  if (hard.length) {
    console.error(`check-grammar: HARD — ${hard.length}:`);
    for (const e of hard) console.error('  - ' + e);
  }
  if (report.length) {
    console.log(`check-grammar: REPORT — ${report.length} рёбер вне грамматики направлений (punch-list):`);
    for (const e of report) console.log('  - ' + e);
  }
  if (!hard.length && !report.length) console.log(`check-grammar: OK — направления рёбер ${files.length} файлов на шкале`);
  if (strict && (hard.length || report.length)) process.exit(1);
  if (hard.length) process.exit(1);
}
