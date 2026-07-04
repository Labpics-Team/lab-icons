/**
 * prim-scan.mjs — авторазметка «чисто примитивных» иконок композитами
 * (BL-015, волна 2): контуры классифицируются (круг → circle-dot,
 * прямоугольник → rounded-rect-капсула), части O↔F сопоставляются по
 * близости центров, декларация принимается при IoU генерата ≥ 97%
 * на обоих вариантах. Вложенные пары кругов (кольцо) → frame-режим.
 *
 * Запуск: node prim-scan.mjs <имя...> [--write]
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { samplePolylines } from '../lib/curve-sampling.js';
import { buildGlyph } from '../lib/anatomy-gen.js';
import { inkIoU } from '../check-anatomy-drift.js';
import { renderedPathData } from '../lib/icon-geometry.js';
import { circleFit } from '../check-variant-parity.js';

import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const grid = JSON.parse(readFileSync(`${REPO}/semantics/grid.json`, 'utf8'));
const r6 = (v) => Math.round((v / 24) * 1e6) / 1e6;

function classify(file) {
  const d = renderedPathData(readFileSync(file, 'utf8')).join('');
  const polys = samplePolylines(d, 48).filter((p) => p.length > 2);
  const shapes = [];
  for (const p of polys) {
    let minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9, area = 0;
    for (let i = 0; i < p.length; i++) {
      const [x1, y1] = p[i];
      const [x2, y2] = p[(i + 1) % p.length];
      area += x1 * y2 - x2 * y1;
      minX = Math.min(minX, x1); minY = Math.min(minY, y1);
      maxX = Math.max(maxX, x1); maxY = Math.max(maxY, y1);
    }
    area = Math.abs(area / 2);
    const bb = { cx: (minX + maxX) / 2, cy: (minY + maxY) / 2, w: maxX - minX, h: maxY - minY };
    const cf = circleFit(p);
    if (cf.rondel < 0.12) {
      shapes.push({ kind: 'circle', cx: cf.cx, cy: cf.cy, r: cf.r, area });
    } else if (area / (bb.w * bb.h) > 0.93) {
      shapes.push({ kind: 'rect', ...bb, area });
    } else {
      shapes.push({ kind: 'other', ...bb, area });
    }
  }
  return shapes;
}

/** Вложенные пары кругов одного центра → кольцо (frame). */
function foldRings(shapes) {
  const circles = shapes.filter((s) => s.kind === 'circle').sort((a, b) => b.r - a.r);
  const rest = shapes.filter((s) => s.kind !== 'circle');
  const used = new Set();
  const out = [...rest];
  for (let i = 0; i < circles.length; i++) {
    if (used.has(i)) continue;
    let inner = -1;
    for (let j = i + 1; j < circles.length; j++) {
      if (used.has(j)) continue;
      if (Math.hypot(circles[i].cx - circles[j].cx, circles[i].cy - circles[j].cy) < 0.35 && circles[j].r < circles[i].r - 0.3) {
        inner = j;
        break;
      }
    }
    if (inner >= 0) {
      used.add(i); used.add(inner);
      out.push({ kind: 'ring', cx: circles[i].cx, cy: circles[i].cy, r: circles[i].r, rIn: circles[inner].r });
    } else {
      used.add(i);
      out.push(circles[i]);
    }
  }
  return out;
}

const key = (s) => `${s.kind === 'ring' ? 'circle' : s.kind}`;

function declare(name) {
  const O = foldRings(classify(`${REPO}/svg/Outline/${name}.svg`));
  const F = foldRings(classify(`${REPO}/svg/Filled/${name}_filled.svg`));
  if (O.some((s) => s.kind === 'other') || F.some((s) => s.kind === 'other')) {
    return { skip: `${name}: неклассифицируемые контуры` };
  }
  // сопоставление по ближайшему центру совместимого рода (кольцо↔диск совместимы)
  const fLeft = [...F];
  const parts = [];
  for (const o of O.sort((a, b) => b.area - a.area || 0)) {
    let bi = -1, bd = 1e9;
    fLeft.forEach((f, i) => {
      if (key(f) !== key(o)) return;
      const d2 = Math.hypot((f.cx ?? 0) - (o.cx ?? 0), (f.cy ?? 0) - (o.cy ?? 0));
      if (d2 < bd) { bd = d2; bi = i; }
    });
    if (bi < 0 || bd > 3) return { skip: `${name}: нет пары для части (${o.kind})` };
    const f = fLeft.splice(bi, 1)[0];
    if (o.kind === 'ring' || o.kind === 'circle') {
      const mode = { outline: o.kind === 'ring' ? 'frame' : 'solid', filled: f.kind === 'ring' ? 'frame' : 'solid' };
      const wO = o.kind === 'ring' ? o.r - o.rIn : null;
      const wF = f.kind === 'ring' ? f.r - f.rIn : null;
      parts.push({
        primitive: 'circle-dot', mode,
        ...(wO || wF ? { weight: r6(wO ?? wF) } : {}),
        params: {
          outline: { cx: r6(o.cx), cy: r6(o.cy), r: r6(o.r) },
          filled: { cx: r6(f.cx), cy: r6(f.cy), r: r6(f.r) },
        },
      });
    } else {
      parts.push({
        primitive: 'rounded-rect', mode: 'solid',
        params: {
          outline: { cx: r6(o.cx), cy: r6(o.cy), w: r6(o.w), h: r6(o.h), rOuter: r6(Math.min(o.w, o.h) / 2) },
          filled: { cx: r6(f.cx), cy: r6(f.cy), w: r6(f.w), h: r6(f.h), rOuter: r6(Math.min(f.w, f.h) / 2) },
        },
      });
    }
  }
  if (fLeft.length) return { skip: `${name}: лишние части в Filled (${fLeft.length})` };
  const entry = { archetype: 'composite', status: { outline: 'hand', filled: 'hand' }, parts };
  const built = buildGlyph(entry, grid);
  const oC = renderedPathData(readFileSync(`${REPO}/svg/Outline/${name}.svg`, 'utf8')).join('');
  const fC = renderedPathData(readFileSync(`${REPO}/svg/Filled/${name}_filled.svg`, 'utf8')).join('');
  const iouO = inkIoU(built.outline, oC, 24);
  const iouF = inkIoU(built.filled, fC, 24);
  if (iouO < 0.97 || iouF < 0.97) {
    return { skip: `${name}: IoU O ${(iouO * 100).toFixed(1)} F ${(iouF * 100).toFixed(1)}` };
  }
  return { name, entry, iouO, iouF };
}

const WRITE = process.argv.includes('--write');
let names = process.argv.slice(2).filter((a) => a !== '--write' && a !== '--all');
if (process.argv.includes('--all')) {
  const declared = new Set(Object.keys(JSON.parse(readFileSync(`${REPO}/semantics/anatomy.json`, 'utf8')).glyphs));
  names = readdirSync(`${REPO}/svg/Outline`).map((f) => f.replace('.svg', '')).filter((n) => !declared.has(n));
}
const anatomy = JSON.parse(readFileSync(`${REPO}/semantics/anatomy.json`, 'utf8'));
let written = 0;
for (const name of names) {
  const res = declare(name);
  if (res.skip) {
    console.log('  ✗ ' + res.skip);
    continue;
  }
  console.log(`  ✓ ${name}: ${res.entry.parts.length} частей, IoU O ${(res.iouO * 100).toFixed(2)} F ${(res.iouF * 100).toFixed(2)}`);
  if (WRITE) {
    anatomy.glyphs[name] = res.entry;
    written++;
  }
}
if (WRITE && written) {
  writeFileSync(`${REPO}/semantics/anatomy.json`, JSON.stringify(anatomy, null, 1));
  console.log(`записано: ${written}`);
}
