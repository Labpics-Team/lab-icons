import { readFileSync } from 'node:fs';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { samplePolylines } from '../scripts/lib/curve-sampling.js';
const grid = JSON.parse(readFileSync('semantics/grid.json', 'utf8'));
const a = JSON.parse(readFileSync('semantics/anatomy.json', 'utf8'));
const d = buildGlyph(a.glyphs.paw, grid, {}, a.glyphs);
for (const v of ['outline', 'filled']) {
  console.log(`── ${v} ──`);
  for (const [i, p] of samplePolylines(d[v], 24).filter(q => q.length > 2).entries()) {
    const xs = p.map(q => q[0]), ys = p.map(q => q[1]);
    console.log(`#${i} bbox x[${Math.min(...xs).toFixed(1)},${Math.max(...xs).toFixed(1)}] y[${Math.min(...ys).toFixed(1)},${Math.max(...ys).toFixed(1)}]`);
  }
}
