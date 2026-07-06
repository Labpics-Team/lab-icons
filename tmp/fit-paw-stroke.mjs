// Стадия-3: пальцы = superellipse-stroke (outline: кольцо-обводка эллипса
// константным пером; filled: solid c axisB). Старт от стадии-2.
import { readFileSync, writeFileSync } from 'node:fs';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { inkIoU } from '../scripts/check-anatomy-drift.js';
import { renderedPathData } from '../scripts/lib/icon-geometry.js';

const grid = JSON.parse(readFileSync('semantics/grid.json', 'utf8'));
const A = JSON.parse(readFileSync('semantics/anatomy.json', 'utf8'));
const S2 = JSON.parse(readFileSync('tmp/fit-paw-result.json', 'utf8'));
const cw = grid.canvas.width;
const hand = {
  outline: renderedPathData(readFileSync('svg/Outline/paw.svg', 'utf8')).join(''),
  filled: renderedPathData(readFileSync('svg/Filled/paw_filled.svg', 'utf8')).join(''),
};
const base = A.glyphs.paw.parts[0].params;
const cBig = base.elements[2].circle.c, rBig = base.elements[2].circle.r;
const rSide = base.elements[1].circle.r, R = rBig + rSide;
const rnd = (v) => Math.round(v * 1e4) / 1e4;
const chainOf = (p) => {
  const sx = cBig[0] + R * Math.sin(p.phi), sy = cBig[1] - R * Math.cos(p.phi);
  return { closed: true, elements: [
      { circle: { c: [0.5, rnd(p.cy)], r: rnd(p.r) } },
      { circle: { c: [rnd(sx), rnd(sy)], r: rSide } },
      { circle: { c: cBig.slice(), r: rBig, dir: -1 } },
      { circle: { c: [rnd(1 - sx), rnd(sy)], r: rSide } },
    ], connectors: JSON.parse(JSON.stringify(base.connectors)) };
};
const chain = S2.chain;
const chainW = { outline: S2.wgt.outline, filled: S2.wgt.filled }; // null = 'base'
// конверсия frame→stroke: ось = середина кольца, перо = ширина кольца
const cvO = (t) => ({ cx: t.cx, cy: t.cy, axis: (t.aOut + t.aIn) / 2, axisB: (t.bOut + t.bIn) / 2, n: 2, rotation: t.rotation });
const cvF = (t) => ({ cx: t.cx, cy: t.cy, axis: t.aOut, axisB: t.bOut, n: 2, rotation: t.rotation });
const toes = {
  outline: [cvO(S2.toes.outline[0]), cvO(S2.toes.outline[1])],
  filled: [cvF(S2.toes.filled[0]), cvF(S2.toes.filled[1])],
};
const ring = [
  S2.toes.outline[0].aOut - S2.toes.outline[0].aIn,
  S2.toes.outline[1].aOut - S2.toes.outline[1].aIn,
];
function buildPaw() {
  const paw = JSON.parse(JSON.stringify(A.glyphs.paw));
  paw.parts[0].params = { outline: chainOf(chain.outline), filled: chainOf(chain.filled) };
  paw.parts[0].weight = { outline: chainW.outline ?? 'base', filled: chainW.filled ?? 'base' };
  for (const [pi, ti] of [[1, 0], [2, 0], [3, 1], [4, 1]]) {
    const mk = (v) => {
      const t = { ...toes[v][ti] };
      Object.keys(t).forEach((k) => { if (typeof t[k] === 'number') t[k] = rnd(t[k]); });
      if (pi === 2 || pi === 4) { t.cx = rnd(1 - t.cx); t.rotation = -t.rotation; }
      return t;
    };
    paw.parts[pi] = {
      primitive: 'superellipse-stroke',
      mode: { outline: 'stroke', filled: 'solid' },
      weight: { outline: rnd(ring[ti]), filled: 'base' },
      params: { outline: mk('outline'), filled: mk('filled') },
    };
  }
  return paw;
}
function evalV(variant) {
  try { return inkIoU(buildGlyph(buildPaw(), grid, {}, A.glyphs)[variant], hand[variant], cw); }
  catch { return -1; }
}
for (const variant of ['outline', 'filled']) {
  let best = evalV(variant);
  console.log(`${variant}: старт IoU=${(best * 100).toFixed(2)}%`);
  for (const step of [0.004, 0.002, 0.001]) {
    let moved = true, guard = 0;
    while (moved && guard++ < 14) {
      moved = false;
      const tryMove = (get, set) => {
        for (const dir of [1, -1]) {
          const old = get(); set(old + dir * step * (arguments, 1));
        }
      };
      for (const ti of [0, 1]) for (const key of ['cx', 'cy', 'axis', 'axisB', 'rotation']) {
        const st = key === 'rotation' ? step * 250 : step;
        for (const dir of [1, -1]) {
          const old = toes[variant][ti][key];
          toes[variant][ti][key] = old + dir * st;
          const v = evalV(variant);
          if (v > best) { best = v; moved = true; } else toes[variant][ti][key] = old;
        }
      }
      if (variant === 'outline') for (const ti of [0, 1]) for (const dir of [1, -1]) {
        const old = ring[ti];
        ring[ti] = rnd(old + dir * step);
        const v = evalV(variant);
        if (v > best) { best = v; moved = true; } else ring[ti] = old;
      }
      for (const key of ['cy', 'r', 'phi']) for (const dir of [1, -1]) {
        const old = chain[variant][key];
        chain[variant][key] = old + dir * (key === 'phi' ? step * 2.5 : step);
        const v = evalV(variant);
        if (v > best) { best = v; moved = true; } else chain[variant][key] = old;
      }
      {
        const w0 = chainW[variant] ?? 0.075;
        for (const dir of [1, -1]) {
          chainW[variant] = rnd(w0 + dir * step);
          const v = evalV(variant);
          if (v > best) { best = v; moved = true; } else chainW[variant] = w0 === 0.075 ? null : w0;
        }
      }
    }
  }
  console.log(`${variant}: финиш IoU=${(best * 100).toFixed(2)}%`);
}
writeFileSync('tmp/fit-paw-stroke-result.json',
  JSON.stringify({ chain, chainW, toes, ring, paw: buildPaw() }, null, 2));
console.log('результат → tmp/fit-paw-stroke-result.json');
