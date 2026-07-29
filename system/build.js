/**
 * system/build.js — сборка объявленных глифов и замер сходимости.
 *
 * Ничего не «оптимизирует» и не «подчищает»: если генерат грязный, это видно
 * в отчёте, а не заметается постпроцессором. Постпроцессор, чинящий геометрию,
 * означал бы, что геометрия неверна.
 */

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as presolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { glyphs, buildGlyph } from './registry.js';
import { toSvg } from './render.js';
import { maskFromSvg, maskFromPath, compare, diffClusters, classify, contourOffset, SS } from './metrics.js';
import { pathsFromSvg, polylinesFromD } from './core/parse.js';
import { T } from './tokens.js';
import './glyphs/index.js';

export const ROOT = presolve(dirname(fileURLToPath(import.meta.url)), '..');
const refPath = (variant, name) =>
  `${ROOT}/reference/${variant === 'filled' ? 'Filled' : 'Outline'}/${name}${variant === 'filled' ? '_filled' : ''}.svg`;

/** Порог, за которым система обязана предъявить письменный аргумент. */
export const ARGUE_AT = 0.03;

export function buildOne(name, variant = 'outline') {
  const def = glyphs.get(name);
  const path = buildGlyph(name, variant);
  const svg = toSvg(path);
  const file = refPath(variant, name);
  const out = {
    name,
    variant,
    family: def.family,
    law: def.law,
    argument: def.argument ?? '',
    axes: def.axes ?? null,
    svg,
    d: path.toD(),
    subpaths: path.subs.length,
    segments: path.subs.reduce((s, x) => s + x.segs.length, 0),
    hasReference: existsSync(file),
  };
  if (!out.hasReference) return out;
  const refSvg = readFileSync(file, 'utf8');
  const a = maskFromSvg(refSvg);
  const b = maskFromPath(path);
  const cmp = compare(a, b);
  const clusters = diffClusters(a, b);
  const refPolys = pathsFromSvg(refSvg).flatMap((p) => polylinesFromD(p.d, 0.01));
  const offset = contourOffset(refPolys, path.flatten(0.01));
  const pen = variant === 'filled' ? T.stroke.bold : T.stroke.base;
  out.reference = refSvg;
  out.deviation = cmp.deviation;
  out.missing = cmp.missing;
  out.extra = cmp.extra;
  out.offset = offset;
  out.offsetPen = offset.median / pen;
  out.clusters = clusters.slice(0, 6);
  out.verdict = classify(cmp, clusters, offset, pen);
  return out;
}

export function buildAll() {
  const rows = [];
  for (const name of glyphs.keys()) {
    for (const variant of ['outline', 'filled']) {
      const def = glyphs.get(name);
      if (variant === 'filled' && def.deriveFilled === 'none' && !def.filled) continue;
      try {
        rows.push(buildOne(name, variant));
      } catch (e) {
        rows.push({ name, variant, family: def.family, law: def.law, error: String(e.message || e) });
      }
    }
  }
  return rows;
}

export function summarize(rows) {
  const withRef = rows.filter((r) => r.hasReference && r.deviation != null);
  const errs = rows.filter((r) => r.error);
  const sorted = [...withRef].sort((a, b) => a.deviation - b.deviation);
  const pct = (q) => (sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))].deviation : 0);
  return {
    declared: new Set(rows.map((r) => r.name)).size,
    rendered: rows.length,
    errors: errs.length,
    measured: withRef.length,
    under3: withRef.filter((r) => r.deviation <= ARGUE_AT).length,
    median: pct(0.5),
    p90: pct(0.9),
    worst: sorted.length ? sorted[sorted.length - 1] : null,
    mean: withRef.length ? withRef.reduce((s, r) => s + r.deviation, 0) / withRef.length : 0,
  };
}

if (process.argv[1] && process.argv[1].endsWith('build.js')) {
  const rows = buildAll();
  const sum = summarize(rows);
  mkdirSync(`${ROOT}/system/out`, { recursive: true });
  writeFileSync(
    `${ROOT}/system/out/report.json`,
    JSON.stringify(
      {
        summary: sum,
        rows: rows.map(({ reference, svg, ...r }) => r),
      },
      null,
      1,
    ),
  );
  const bad = rows.filter((r) => r.error);
  for (const b of bad) console.error(`ОШИБКА ${b.name}/${b.variant}: ${b.error}`);
  console.log(
    `объявлено ${sum.declared} имён · отрисовано ${sum.rendered} вариантов · измерено ${sum.measured}\n` +
      `≤3%: ${sum.under3}/${sum.measured} · медиана ${(sum.median * 100).toFixed(2)}% · p90 ${(sum.p90 * 100).toFixed(2)}%` +
      (sum.worst ? ` · худший ${sum.worst.name}/${sum.worst.variant} ${(sum.worst.deviation * 100).toFixed(2)}%` : ''),
  );
  if (sum.errors) process.exitCode = 1;
}

export { SS };
