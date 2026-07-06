// Фит paw outline: ладонь tangent-chain(3 круга + 3 fillet) + 4 four-arc-oval
// подушечки зеркальными парами о x=12 (преп §1/§2.4).
import { readFileSync } from 'node:fs';
import { buildDictPart } from './lib/circle-dictionary.js';
import { inkIoU } from '../scripts/check-anatomy-drift.js';
import { renderedPathData } from './lib/icon-geometry.js';

const grid = JSON.parse(readFileSync('semantics/grid.json', 'utf8'));
const cw = grid.canvas.width, pen = grid.strokes?.base ?? 1.8;
const hand = renderedPathData(readFileSync('svg/Outline/paw.svg', 'utf8')).join('');
const f = (v) => v / cw;

// p: юниты канвы. Ладонь симметрична о x=12; пады зеркалятся парой.
function buildD(p, sSide, sUp, dv) {
  const { topY, topR, cnX, cnY, cnR, valR, botR, sx, sy, sa, sb, sre, sphi, ux, uy, ua, ub, ure, uphi } = p;
  const cen = [12, 17];
  const hint = (a, b) => {
    const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const d = Math.hypot(m[0] - cen[0], m[1] - cen[1]) || 1;
    return [m[0] + ((m[0] - cen[0]) / d) * 2.2, m[1] + ((m[1] - cen[1]) / d) * 2.2];
  };
  const cL = [24 - cnX, cnY], cT = [12, topY], cR = [cnX, cnY];
  const palm = {
    closed: true,
    elements: [
      { circle: { c: [f(cL[0]), f(cL[1])], r: f(cnR), dir: dv } },
      { circle: { c: [f(cT[0]), f(cT[1])], r: f(topR), dir: dv } },
      { circle: { c: [f(cR[0]), f(cR[1])], r: f(cnR), dir: dv } },
    ],
    connectors: [
      { type: 'fillet', r: f(valR), hint: hint(cL, cT).map(f) },
      { type: 'fillet', r: f(valR), hint: hint(cT, cR).map(f) },
      { type: 'fillet', r: f(botR), hint: [f(12), f(cnY + cnR + 1.2)] },
    ],
  };
  const pad = (cx, cy, a, b, re, phi) => ({ c: [f(cx), f(cy)], a: f(a), b: f(b), rEnd: f(re), phi });
  try {
    let d = buildDictPart('tangent-chain', palm, 'stroke', pen, cw);
    d += buildDictPart('four-arc-oval', pad(sx, sy, sa, sb, sre, sSide * sphi), 'stroke', pen, cw);
    d += buildDictPart('four-arc-oval', pad(24 - sx, sy, sa, sb, sre, -sSide * sphi), 'stroke', pen, cw);
    d += buildDictPart('four-arc-oval', pad(ux, uy, ua, ub, ure, sUp * uphi), 'stroke', pen, cw);
    d += buildDictPart('four-arc-oval', pad(24 - ux, uy, ua, ub, ure, -sUp * uphi), 'stroke', pen, cw);
    return d;
  } catch {
    return null;
  }
}
const iou = (p, sS, sU, dv) => {
  const d = buildD(p, sS, sU, dv);
  return d ? inkIoU(d, hand, cw, 0.12) : -1;
};

const p0 = {
  topY: 13.4, topR: 1.8, cnX: 16.9, cnY: 18.4, cnR: 2.1, valR: 4.7, botR: 8.0,
  sx: 4.28, sy: 10.95, sa: 2.91, sb: 1.92, sre: 1.2, sphi: 17,
  ux: 8.98, uy: 6.53, ua: 2.9, ub: 1.86, ure: 1.2, uphi: 6.5,
};
let best = { v: -1 };
for (const sS of [1, -1]) for (const sU of [1, -1]) for (const dv of [1, -1]) {
  const v = iou(p0, sS, sU, dv);
  if (v > best.v) best = { v, sS, sU, dv };
}
console.log('знаки/dir:', JSON.stringify(best));
const { sS, sU, dv } = best;
let cur = { ...p0 }, curV = best.v;
const keys = Object.keys(cur);
for (const step of [0.24, 0.12, 0.06, 0.03, 0.012]) {
  let moved = true;
  while (moved) {
    moved = false;
    for (const k of keys) for (const s of [step, -step]) {
      const c2 = { ...cur, [k]: cur[k] + (k === 'sphi' || k === 'uphi' ? s * 8 : s) };
      const v = iou(c2, sS, sU, dv);
      if (v > curV + 1e-6) { cur = c2; curV = v; moved = true; }
    }
  }
  console.log(`step ${step}: IoU=${curV.toFixed(5)}`);
}
const q6v = (v) => Number(f(v).toFixed(6)) * cw;
const snap = Object.fromEntries(Object.entries(cur).map(([k, v]) => [k, k.endsWith('phi') ? Number(v.toFixed(2)) : q6v(v)]));
console.log('q6 IoU =', iou(snap, sS, sU, dv).toFixed(5));
console.log('параметры =', JSON.stringify(snap), 'sS/sU/dv =', sS, sU, dv);
