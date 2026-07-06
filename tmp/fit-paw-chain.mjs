// Самодоводка paw: per-variant цепь ладони. Свободные листья на вариант:
// apex.cy, apex.r, φ боковых кругов ВДОЛЬ большого круга (kiss-инвариант
// |c_side−c_big| = r_big+r_side держится конструктивно). Пальцы не трогаем.
import { readFileSync } from 'node:fs';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { inkIoU } from '../scripts/check-anatomy-drift.js';
import { renderedPathData } from '../scripts/lib/icon-geometry.js';

const grid = JSON.parse(readFileSync('semantics/grid.json', 'utf8'));
const A = JSON.parse(readFileSync('semantics/anatomy.json', 'utf8'));
const cw = grid.canvas.width;
const hand = {
  outline: renderedPathData(readFileSync('svg/Outline/paw.svg', 'utf8')).join(''),
  filled: renderedPathData(readFileSync('svg/Filled/paw_filled.svg', 'utf8')).join(''),
};

const base = A.glyphs.paw.parts[0].params; // текущая общая цепь
const cBig = base.elements[2].circle.c, rBig = base.elements[2].circle.r;
const rSide = base.elements[1].circle.r;
const R = rBig + rSide;
const s0 = base.elements[1].circle.c;
const phi0 = Math.atan2(s0[0] - cBig[0], cBig[1] - s0[1]);
const apex0 = { cy: base.elements[0].circle.c[1], r: base.elements[0].circle.r };

const rnd = (v) => Math.round(v * 1e4) / 1e4;
function chainParams(p) {
  const sx = cBig[0] + R * Math.sin(p.phi), sy = cBig[1] - R * Math.cos(p.phi);
  return {
    closed: true,
    elements: [
      { circle: { c: [0.5, rnd(p.cy)], r: rnd(p.r) } },
      { circle: { c: [rnd(sx), rnd(sy)], r: rSide } },
      { circle: { c: cBig.slice(), r: rBig, dir: -1 } },
      { circle: { c: [rnd(1 - sx), rnd(sy)], r: rSide } },
    ],
    connectors: base.connectors.map((c) => ({ ...c, hint: c.hint ? c.hint.slice() : undefined }))
      .map((c) => { if (!c.hint) delete c.hint; return c; }),
  };
}

function evalVariant(variant, p) {
  const paw = JSON.parse(JSON.stringify(A.glyphs.paw));
  paw.parts[0].params = { outline: chainParams(variant === 'outline' ? p : cur.outline),
                          filled: chainParams(variant === 'filled' ? p : cur.filled) };
  try {
    const out = buildGlyph(paw, grid, {}, A.glyphs);
    return inkIoU(out[variant], hand[variant], cw);
  } catch { return -1; }
}

const cur = { outline: { ...apex0, phi: phi0 }, filled: { ...apex0, phi: phi0 } };
for (const variant of ['outline', 'filled']) {
  let best = evalVariant(variant, cur[variant]);
  console.log(`${variant}: старт IoU=${(best * 100).toFixed(2)}%`);
  for (const step of [0.008, 0.004, 0.002, 0.001]) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const key of ['cy', 'r', 'phi']) {
        const st = key === 'phi' ? step * 2.5 : step;
        for (const dir of [1, -1]) {
          const cand = { ...cur[variant], [key]: cur[variant][key] + dir * st };
          const v = evalVariant(variant, cand);
          if (v > best) { best = v; cur[variant] = cand; moved = true; }
        }
      }
    }
  }
  console.log(`${variant}: финиш IoU=${(best * 100).toFixed(2)}%  cy=${rnd(cur[variant].cy)} r=${rnd(cur[variant].r)} phi=${rnd(cur[variant].phi)}`);
}
console.log('OUT', JSON.stringify(cur));
