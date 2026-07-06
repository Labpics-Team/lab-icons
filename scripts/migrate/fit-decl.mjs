/**
 * fit-decl.mjs — обобщённый фиттер деклараций (рычаг пропускной способности
 * миграции: волна ≠ ручной подбор параметров по одной иконке).
 *
 * Метод: берёт черновик декларации (существующий глиф semantics/anatomy.json
 * или --draft <file.json>), собирает ВСЕ числовые листья и жмёт их
 * координатным спуском с убывающим шагом (метод tmp-fit-paw, проверен на
 * paw/cloud) к руке по inkIoU. Генерат строится ПРОДАКШЕНОВЫМ buildGlyph
 * с lib=anatomy.glyphs — фит и билд не могут разойтись по определению.
 *
 * Никаких фантазий: топология НЕ варьируется — примитивы, dir, счётчики
 * (teeth/spokes), rotation и весовые токены заморожены. Только непрерывные
 * параметры формы. Объектив = МИНИМУМ IoU по целевым вариантам (жмём худший).
 *
 * Запуск:
 *   node scripts/migrate/fit-decl.mjs eye --variants outline
 *   node scripts/migrate/fit-decl.mjs bulb --variants filled --draft tmp/bulb.json --merge
 * Опции:
 *   --variants a,b   какие варианты фитим (default: что строит buildGlyph и
 *                    для чего есть файл руки)
 *   --only <regex>   фитим только листья с путём под regex
 *   --lock <regex>   замораживаем листья с путём под regex
 *   --fast           поиск на сетке IoU 0.24 (финальный замер всегда 0.12)
 *   --steps a,b,..   свои шаги спуска в юнитах канвы (default 0.24..0.012)
 *   --arrays         жать и числа внутри массивов (координаты точек: p, c,
 *                    start/end, points). Направляющие d заморожены всегда —
 *                    их сдвиг денормализует прямую. По умолчанию ВЫКЛ:
 *                    прежние прогоны воспроизводимы бит-в-бит.
 *   --merge          записать результат в semantics/anatomy.json (статус и
 *                    fidelityToHand НЕ трогаем — промоушен отдельным шагом)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGlyph } from '../lib/anatomy-gen.js';
import { renderedPathData } from '../lib/icon-geometry.js';
import { inkIoU } from '../check-anatomy-drift.js';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const grid = JSON.parse(readFileSync(`${REPO}/semantics/grid.json`, 'utf8'));
const cw = grid.canvas.width;

// ── CLI ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const name = argv.find((a) => !a.startsWith('--'));
if (!name) {
  console.error('usage: node scripts/migrate/fit-decl.mjs <glyph> [опции]');
  process.exit(2);
}
const opt = (k) => {
  const i = argv.indexOf(k);
  return i >= 0 ? argv[i + 1] : null;
};
const has = (k) => argv.includes(k);

const anatomy = JSON.parse(readFileSync(`${REPO}/semantics/anatomy.json`, 'utf8'));
const draftPath = opt('--draft');
const entry = structuredClone(
  draftPath ? JSON.parse(readFileSync(draftPath, 'utf8')) : anatomy.glyphs[name],
);
if (!entry) {
  console.error(`нет декларации «${name}» и не дан --draft`);
  process.exit(2);
}

// ── рука ─────────────────────────────────────────────────────────────────
const handFile = (v) =>
  v === 'outline' ? `${REPO}/svg/Outline/${name}.svg` : `${REPO}/svg/Filled/${name}_filled.svg`;
const readHand = (v) => {
  try {
    return renderedPathData(readFileSync(handFile(v), 'utf8')).join('');
  } catch {
    return null;
  }
};

const build = (e) => buildGlyph(e, grid, {}, anatomy.glyphs);

let variants = opt('--variants')?.split(',');
if (!variants) {
  const built = build(entry);
  variants = ['outline', 'filled'].filter((v) => built[v] && readHand(v));
}
const hand = {};
for (const v of variants) {
  hand[v] = readHand(v);
  if (!hand[v]) {
    console.error(`нет руки для варианта ${v}: ${handFile(v)}`);
    process.exit(2);
  }
}

// ── числовые листья ──────────────────────────────────────────────────────
// Заморожено всегда: топология и дискретные величины. Весовые токены —
// закон сетки, фитить нельзя (числовой weight допускается только по --only).
const FROZEN_KEYS = new Set(['dir', 'teeth', 'spokes', 'rotation', 'weight', 'closed']);
const FROZEN_SUBTREES = new Set(['status', 'fidelityToHand', 'weights', 'mode', 'translate', 'd']);
const fitArrays = has('--arrays');
const only = opt('--only') ? new RegExp(opt('--only')) : null;
const lock = opt('--lock') ? new RegExp(opt('--lock')) : null;
const ANGLE = /(phi|theta|deg|angle)/i;

const leaves = [];
(function walk(node, path) {
  if (Array.isArray(node)) {
    node.forEach((x, i) => {
      if (typeof x === 'number') {
        if (!fitArrays) return; // историческое поведение: массивы не жмём
        const p = path.concat(i);
        const ps = p.join('.');
        if (only && !only.test(ps)) return;
        if (lock && lock.test(ps)) return;
        leaves.push({ path: p, angle: false });
      } else walk(x, path.concat(i));
    });
    return;
  }
  if (node && typeof node === 'object') {
    for (const [k, x] of Object.entries(node)) {
      if (FROZEN_SUBTREES.has(k)) continue;
      if (typeof x === 'number') {
        const p = path.concat(k);
        const ps = p.join('.');
        if (FROZEN_KEYS.has(k)) continue;
        if (only && !only.test(ps)) continue;
        if (lock && lock.test(ps)) continue;
        leaves.push({ path: p, angle: ANGLE.test(k) });
      } else walk(x, path.concat(k));
    }
  }
})(entry, []);
if (!leaves.length) {
  console.error('нет свободных числовых листьев (все под lock?)');
  process.exit(2);
}

const get = (o, p) => p.reduce((a, k) => a[k], o);
const set = (o, p, v) => {
  get(o, p.slice(0, -1))[p.at(-1)] = v;
};

// ── объектив ─────────────────────────────────────────────────────────────
let evals = 0;
const iouStepSearch = has('--fast') ? 0.24 : 0.12;
function objective(e, iouStep) {
  evals++;
  let d;
  try {
    d = build(e);
  } catch {
    return -1;
  }
  let worst = 1;
  for (const v of variants) {
    if (!d[v]) return -1;
    worst = Math.min(worst, inkIoU(d[v], hand[v], cw, iouStep));
  }
  return worst;
}

// ── спуск ────────────────────────────────────────────────────────────────
const stepsCanvas = opt('--steps')
  ? opt('--steps').split(',').map(Number)
  : [0.24, 0.12, 0.06, 0.03, 0.012];
const t0 = Date.now();
const detail = () =>
  variants
    .map((v) => {
      const d = build(entry);
      return `${v}=${(inkIoU(d[v], hand[v], cw, 0.12) * 100).toFixed(2)}%`;
    })
    .join(' ');
console.log(`фит «${name}» [${variants.join(',')}]: листьев ${leaves.length}`);
console.log(`  старт: ${detail()}`);

let curV = objective(entry, iouStepSearch);
for (const stepC of stepsCanvas) {
  let moved = true;
  while (moved) {
    moved = false;
    for (const leaf of leaves) {
      const base = get(entry, leaf.path);
      // пространственный шаг — доля канвы; угловой — градусы (×8, как paw)
      const s0 = leaf.angle ? stepC * 8 : stepC / cw;
      for (const s of [s0, -s0]) {
        set(entry, leaf.path, base + s);
        const v = objective(entry, iouStepSearch);
        if (v > curV + 1e-6) {
          curV = v;
          moved = true;
        } else {
          set(entry, leaf.path, base);
        }
      }
    }
  }
  console.log(`  шаг ${stepC}: worst=${(curV * 100).toFixed(3)}% (${evals} eval)`);
}

// ── квантизация (стабильность артефакта) ────────────────────────────────
for (const leaf of leaves) {
  const v = get(entry, leaf.path);
  set(entry, leaf.path, Number(v.toFixed(leaf.angle ? 2 : 6)));
}
console.log(`  финал (сетка 0.12, после q6): ${detail()}  [${((Date.now() - t0) / 1000).toFixed(1)}s]`);

if (has('--merge')) {
  const prev = anatomy.glyphs[name] || {};
  anatomy.glyphs[name] = { ...prev, ...entry, status: prev.status ?? entry.status };
  writeFileSync(`${REPO}/semantics/anatomy.json`, JSON.stringify(anatomy, null, 1));
  console.log(`  записано в semantics/anatomy.json (статус не тронут)`);
} else {
  console.log(JSON.stringify(entry, null, 1));
}
