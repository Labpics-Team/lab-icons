// _clamp-move.mjs — тангенс-кламп стыков move после оптимизации (Волна-7).
// Нетрекаемый скрипт, удалить до merge.
import { readFileSync, writeFileSync } from 'node:fs';
import { report, q6 } from './_wave7-fit.mjs';

const j = JSON.parse(readFileSync('_move-entry.json', 'utf8'));
const e = j.entry;
const M = 0.02; // геом. запас, px (под мелкосеточный корпусный EO≠NZ-скан)

const px = (part, v) => part.params[v].points.map((q) => q.map((x) => x * 24));
const byName = Object.fromEntries(e.parts.map((p) => [p.name, p]));

const distToLine = (C, A, B) => {
  const [ax, ay] = A, [bx, by] = B;
  const L = Math.hypot(bx - ax, by - ay);
  return Math.abs((bx - ax) * (C[1] - ay) - (by - ay) * (C[0] - ax)) / L;
};

// Минимальный сдвиг кап-центра вдоль направления dir от точки start,
// чтобы расстояние до ОБЕИХ осей плеч головы head стало >= d.
function clampToHead(start, dir, head, d) {
  const [armEndA, apex, armEndB] = head;
  const g = (t) => {
    const C = [start[0] + dir[0] * t, start[1] + dir[1] * t];
    return Math.min(distToLine(C, apex, armEndA), distToLine(C, apex, armEndB)) - d;
  };
  if (g(0) >= 0) return start;
  let lo = 0, hi = 8;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (g(mid) >= 0) hi = mid; else lo = mid;
  }
  return [start[0] + dir[0] * hi, start[1] + dir[1] * hi];
}

for (const v of ['outline', 'filled']) {
  const p = v === 'outline' ? 0.9 : 1.2; // полперо = радиус капа
  const d = 2 * p + M;
  const H = {};
  for (const n of ['head-up', 'head-down', 'head-left', 'head-right']) H[n] = px(byName[n], v);
  const sv = px(byName['shaft-v'], v);
  const hl = px(byName['shaft-h-left'], v);
  const hr = px(byName['shaft-h-right'], v);
  // shaft-v: [0]=верхний конец (меньший y), [1]=нижний
  if (sv[0][1] > sv[1][1]) sv.reverse();
  sv[0] = clampToHead(sv[0], [0, 1], H['head-up'], d);
  sv[1] = clampToHead(sv[1], [0, -1], H['head-down'], d);
  // полуоси: [0]=внешний конец, [1]=внутренний (сортировка по x)
  if (hl[0][0] > hl[1][0]) hl.reverse();
  if (hr[0][0] > hr[1][0]) hr.reverse();
  hl[0] = clampToHead(hl[0], [1, 0], H['head-left'], d);
  hr[1] = clampToHead(hr[1], [-1, 0], H['head-right'], d);
  // изнутри: тангенс к кромке вертикали (x на уровне капа)
  const xvAt = (y) => sv[0][0] + ((sv[1][0] - sv[0][0]) * (y - sv[0][1])) / (sv[1][1] - sv[0][1] || 1);
  hl[1][0] = Math.min(hl[1][0], xvAt(hl[1][1]) - p - p - M);
  hr[0][0] = Math.max(hr[0][0], xvAt(hr[0][1]) + p + p + M);
  byName['shaft-v'].params[v].points = sv.map((q) => q.map((x) => x / 24));
  byName['shaft-h-left'].params[v].points = hl.map((q) => q.map((x) => x / 24));
  byName['shaft-h-right'].params[v].points = hr.map((q) => q.map((x) => x / 24));
}

q6(e);
const { m, eo } = report(e, 'move');
writeFileSync('_move-entry.json', JSON.stringify({ entry: e, m, eo }, null, 1));
