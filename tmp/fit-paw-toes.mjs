// Стадия-2: пальцы (зеркальные пары) + числовое перо цепи (outline).
// Цепь стартует с результата стадии-1 (kiss-инвариант держит φ-параметризация).
import { readFileSync, writeFileSync } from 'node:fs';
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

const base = A.glyphs.paw.parts[0].params;
const cBig = base.elements[2].circle.c, rBig = base.elements[2].circle.r;
const rSide = base.elements[1].circle.r, R = rBig + rSide;
const rnd = (v) => Math.round(v * 1e4) / 1e4;
const chainOf = (p) => {
  const sx = cBig[0] + R * Math.sin(p.phi), sy = cBig[1] - R * Math.cos(p.phi);
  return {
    closed: true,
    elements: [
      { circle: { c: [0.5, rnd(p.cy)], r: rnd(p.r) } },
      { circle: { c: [rnd(sx), rnd(sy)], r: rSide } },
      { circle: { c: cBig.slice(), r: rBig, dir: -1 } },
      { circle: { c: [rnd(1 - sx), rnd(sy)], r: rSide } },
    ],
    connectors: JSON.parse(JSON.stringify(base.connectors)),
  };
};
// стартовые цепи = финиш стадии-1
const chain = {
  outline: { cy: 0.5755, r: 0.1017, phi: 0.44087320388138607 },
  filled: { cy: 0.5855, r: 0.0917, phi: 0.43337320388138606 },
};
// пальцы: [side, top] на вариант; зеркальная пара делит листья
const T = A.glyphs.paw.parts;
const toes = {
  outline: [ { ...T[1].params.outline }, { ...T[3].params.outline } ],
  filled:  [ { ...T[1].params.filled },  { ...T[3].params.filled } ],
};
const wgt = { outline: null, filled: null }; // null = токен 'base'

function buildPaw() {
  const paw = JSON.parse(JSON.stringify(A.glyphs.paw));
  paw.parts[0].params = { outline: chainOf(chain.outline), filled: chainOf(chain.filled) };
  if (wgt.outline || wgt.filled) paw.parts[0].weight = {
    outline: wgt.outline ?? 'base', filled: wgt.filled ?? 'base' };
  for (const [pi, ti] of [[1, 0], [2, 0], [3, 1], [4, 1]]) {
    for (const v of ['outline', 'filled']) {
      const t = { ...toes[v][ti] };
      Object.keys(t).forEach((k) => { if (typeof t[k] === 'number') t[k] = rnd(t[k]); });
      if (pi === 2 || pi === 4) { t.cx = rnd(1 - t.cx); t.rotation = -t.rotation; }
      paw.parts[pi].params[v] = t;
    }
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
  const toeKeys = Object.keys(toes[variant][0]).filter((k) => typeof toes[variant][0][k] === 'number' && k !== 'nOut');
  for (const step of [0.004, 0.002, 0.001]) {
    let moved = true, guard = 0;
    while (moved && guard++ < 12) {
      moved = false;
      // пальцы
      for (const ti of [0, 1]) for (const key of toeKeys) {
        const st = key === 'rotation' ? step * 250 : step;
        for (const dir of [1, -1]) {
          const old = toes[variant][ti][key];
          toes[variant][ti][key] = old + dir * st;
          const v = evalV(variant);
          if (v > best) { best = v; moved = true; } else toes[variant][ti][key] = old;
        }
      }
      // перо цепи (только outline; filled = силуэт, перо влияет иначе — тоже пробуем)
      const w0 = wgt[variant] ?? 0.075;
      for (const dir of [1, -1]) {
        wgt[variant] = rnd(w0 + dir * step);
        const v = evalV(variant);
        if (v > best) { best = v; moved = true; } else wgt[variant] = w0 === 0.075 ? null : w0;
      }
      // цепь повторно (мелкий шаг)
      for (const key of ['cy', 'r', 'phi']) for (const dir of [1, -1]) {
        const old = chain[variant][key];
        chain[variant][key] = old + dir * (key === 'phi' ? step * 2.5 : step);
        const v = evalV(variant);
        if (v > best) { best = v; moved = true; } else chain[variant][key] = old;
      }
    }
  }
  console.log(`${variant}: финиш IoU=${(best * 100).toFixed(2)}%  wgt=${wgt[variant]}`);
}
writeFileSync('tmp/fit-paw-result.json', JSON.stringify({ chain, toes, wgt }, null, 2));
console.log('результат → tmp/fit-paw-result.json');
