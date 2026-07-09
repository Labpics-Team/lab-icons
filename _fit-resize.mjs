// _fit-resize.mjs — фиттинг resize (Волна-7). Нетрекаемый скрипт, удалить до merge.
import { writeFileSync } from 'node:fs';
import { optimizeVariant, report, q6 } from './_wave7-fit.mjs';

const u = (x, y) => [x / 24, y / 24];
const part = (name, o, f) => ({
  primitive: 'stroke-path',
  mode: 'solid',
  weight: { outline: 'base', filled: 'bold' },
  params: {
    outline: { points: o.map((p) => u(...p)), closed: false },
    filled: { points: f.map((p) => u(...p)), closed: false },
  },
  name,
  role: 'ink',
});

const entry = {
  archetype: 'composite',
  status: { outline: 'hand', filled: 'hand' },
  parts: [
    part('head-a', // скобка верх-право
      [[13.92, 1.9], [22.11, 1.9], [22.11, 10.05]],
      [[13.58, 2.215], [21.8, 2.215], [21.8, 10.37]]),
    part('head-b', // скобка низ-лево
      [[1.9, 13.95], [1.9, 22.095], [10.1, 22.095]],
      [[2.215, 13.63], [2.215, 21.78], [10.42, 21.78]]),
    part('shaft', // диагональ x+y≈24
      [[3.708, 20.3], [20.31, 3.698]],
      [[4.135, 19.87], [19.87, 4.135]]),
  ],
};

console.log('start:');
report(structuredClone(entry), 'resize');

for (const v of ['outline', 'filled']) {
  const iou = optimizeVariant(entry, 'resize', v);
  console.log(`${v} optimized: ${(iou * 100).toFixed(2)}%`);
}
q6(entry);
const { m, eo } = report(entry, 'resize');
writeFileSync('_resize-entry.json', JSON.stringify({ entry, m, eo }, null, 1));
