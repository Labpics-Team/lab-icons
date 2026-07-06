import { readFileSync } from 'node:fs';
import { buildGlyph } from '../scripts/lib/anatomy-gen.js';
import { inkIoU } from '../scripts/check-anatomy-drift.js';
const grid = JSON.parse(readFileSync('semantics/grid.json', 'utf8'));
const anatomy = JSON.parse(readFileSync('semantics/anatomy.json', 'utf8'));
const cw = grid.canvas.width;
const d = buildGlyph(anatomy.glyphs.paw, grid, {}, anatomy.glyphs);
for (const [v, f] of [['outline', 'svg/outline/paw.svg'], ['filled', 'svg/filled/paw_filled.svg']]) {
  const hand = readFileSync(f, 'utf8').match(/ d="([^"]+)"/)[1];
  console.log(v, (inkIoU(d[v], hand, cw, 0.12) * 100).toFixed(2) + '%');
}
