import { readFileSync, writeFileSync } from 'node:fs';
const F = 'semantics/anatomy.json';
const a = JSON.parse(readFileSync(F, 'utf8'));
const toe = (cxO, cyO, aO, bO, aI, bI, cxF, cyF, aF, bF, rot) => ({
  primitive: 'superellipse',
  mode: { outline: 'frame', filled: 'solid' },
  params: {
    outline: { cx: cxO, cy: cyO, aOut: aO, bOut: bO, aIn: aI, bIn: bI, nOut: 2, rotation: rot },
    filled:  { cx: cxF, cy: cyF, aOut: aF, bOut: bF, nOut: 2, rotation: rot },
  },
});
a.glyphs.paw = {
  archetype: 'composite',
  status: { outline: 'generated', filled: 'generated' },
  parts: [
    { primitive: 'tangent-chain',
      mode: { outline: 'stroke', filled: 'silhouette' },
      weight: 'base',
      params: {
        closed: true,
        elements: [
          { circle: { c: [0.5, 0.5725], r: 0.1017 } },
          { circle: { c: [0.7063, 0.7638], r: 0.0875 } },
          { circle: { c: [0.5, 1.1982], r: 0.3934, dir: -1 } },
          { circle: { c: [0.2937, 0.7638], r: 0.0875 } },
        ],
        connectors: [
          { type: 'tangent' }, { type: 'kiss' }, { type: 'kiss' }, { type: 'tangent' },
        ],
      } },
    toe(0.1780, 0.45615, 0.16045, 0.11755, 0.08395, 0.04185, 0.16135, 0.4539, 0.14585, 0.10065,  67.0),
    toe(0.8220, 0.45615, 0.16045, 0.11755, 0.08395, 0.04185, 0.83865, 0.4539, 0.14585, 0.10065, -67.0),
    toe(0.3738, 0.2694,  0.15945, 0.1153,  0.08245, 0.0397,  0.3673,  0.2575, 0.1447,  0.0984,   81.8),
    toe(0.6262, 0.2694,  0.15945, 0.1153,  0.08245, 0.0397,  0.6327,  0.2575, 0.1447,  0.0984,  -81.8),
  ],
};
writeFileSync(F, JSON.stringify(a, null, 2) + '\n');
console.log('paw записан');
