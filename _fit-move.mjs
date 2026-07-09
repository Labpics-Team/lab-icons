// _fit-move.mjs — фиттинг move (Волна-7): крест (полная вертикаль + 2 полуоси)
// + 4 шеврон-головы. Нетрекаемый скрипт, удалить до merge.
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
    part('head-up',
      [[8.2, 5.27], [12, 1.48], [15.795, 5.27]],
      [[8.755, 4.715], [12, 1.48], [15.24, 4.72]]),
    part('head-down',
      [[8.205, 18.715], [12, 22.52], [15.865, 18.655]],
      [[8.76, 19.27], [12, 22.52], [15.245, 19.275]]),
    part('head-left',
      [[5.28, 8.195], [1.48, 12], [5.345, 15.86]],
      [[4.735, 8.76], [1.48, 12], [4.735, 15.24]]),
    part('head-right',
      [[18.66, 8.13], [22.52, 12], [18.7, 15.825]],
      [[19.27, 8.75], [22.52, 12], [19.35, 15.15]]),
    part('shaft-v', // полная ось, капы тангенсом к головам
      [[12, 4.03], [12, 19.97]],
      [[12, 4.87], [12, 19.13]]),
    part('shaft-h-left', // полуось, изнутри тангенсом к вертикали
      [[4.03, 12], [10.2, 12]],
      [[4.87, 12], [9.6, 12]]),
    part('shaft-h-right',
      [[13.8, 12], [19.97, 12]],
      [[14.4, 12], [19.13, 12]]),
  ],
};

console.log('start:');
report(structuredClone(entry), 'move');

for (const v of ['outline', 'filled']) {
  const iou = optimizeVariant(entry, 'move', v);
  console.log(`${v} optimized: ${(iou * 100).toFixed(2)}%`);
}
q6(entry);
const { m, eo } = report(entry, 'move');
writeFileSync('_move-entry.json', JSON.stringify({ entry, m, eo }, null, 1));
