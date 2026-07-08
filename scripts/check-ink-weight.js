/**
 * scripts/check-ink-weight.js — видящий гейт ВЕСА ЧЕРНИЛ на материализованном
 * генерате (BL-021, класс с зума владельца: «вес выглядит несогласованно,
 * особенно в кругах на шевронах; если вес прыгает — в определённых весах баг;
 * вес должен ограничиваться, чтобы не ушёл в супертонкую линию»).
 *
 * КЛАСС дефекта (уникальный — НЕ дублирует check-variant-parity/static-grid):
 * variant-parity меряет вес только у КОЛЕЦ (circleFit пары кругов); фактическая
 * толщина ШТРИХОВ глифа (шеврон, галка, стрелка) не гейтится нигде — вес мог
 * дрейфовать от канонов незаметно. Этот гейт меряет ФАКТИЧЕСКУЮ толщину чернил
 * слепо (по материализованному d, без знания задекларированных весов) и держит:
 *   (а) каждый замеренный штрих = один из канонов сетки (base/bold/
 *       containerGlyph/enclosureRing) ± tolerance; «ничейный» вес = FAIL
 *       с координатой;
 *   (б) кольцо-обрамление легче глифа (SF-приём, канон сетки): замеренный вес
 *       обрамления < замеренного веса глифа минимум на tolerance;
 *   (в) супертонких линий нет: min замеренного штриха ≥ минимальный канон
 *       (enclosureRing) − tolerance.
 *
 * МЕТОД замера (детерминированный, слепой; прецедент BL-017 «EDT+луч ±0.003»):
 *   1. d → полилинии суб-путей (lib/curve-sampling, точный парсер);
 *   2. растр чернил скан-линиями (even-odd — дисциплина гейтов статики);
 *   3. точный EDT (Фельценсвальб—Хуттенлохер, O(N)) — квадрат расстояния
 *      до фона;
 *   4. хребет чернил: локальный максимум EDT поперёк штриха (осевые пары
 *      соседей, минимум одна строгая — плато вдоль штриха не хребет);
 *   5. уточнение: точное расстояние центра клетки хребта до сегментов контура
 *      (bucket-индекс) + тент-коррекция по соседям (профиль EDT поперёк штриха
 *      — тент; вершина = dc + |dl−dr|/2) — суб-пиксельная точность, толщина
 *      не зависит от шага растра;
 *   6. моды толщины по компонентам хребта: мода с протяжённостью ≥ 2×толщины
 *      = ШТРИХ (лента длиннее ширины; массы/терминалы/точки — не штрихи,
 *      их держит анатомия: «части-массы инвариантны весу»). Потолок штриха =
 *      bold + clearanceMin (толще максимального канона на целый охранный
 *      зазор = уже масса, не перо) — слепота выше потолка задокументирована.
 *
 * ОСИ (--axes, сетка weight 0.8/1.0/1.2 × corner 0/1): вес обязан
 * масштабироваться пропорционально ВСЮДУ (замер = замер@default × weight
 * ± tolerance×weight, «не прыгает»), клиренсы ≥ clearanceMin на всех углах
 * сетки. Кламп оси weight — grid.axes.weight (вывод min/max в комменте
 * grid.json; гейт держит формулу от токенов — анти-дрифт).
 *
 * Пороги — ТОЛЬКО из semantics/grid.json (ноль observer-fit).
 *
 * Строгость (прецедент промоушен-allowlist check-adjacency): корпусный прогон
 * без аргументов — report-каталог + HARD для глифов из
 * semantics/ink-weight-promoted.json (регрессия промоутнутого веса красит CI);
 * --strict — exit 1 на любой дефект; arg-режим (глиф из anatomy | файл.svg) —
 * HARD всегда, печатает замеры (RED-протокол числами).
 */

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGlyph } from './lib/anatomy-gen.js';
import { renderedPathData } from './lib/icon-geometry.js';
import { samplePolylines, segmentsCross } from './lib/curve-sampling.js';

// ── токены сетки (ноль observer-fit) ─────────────────────────────────────────

/** Каноны весов и допуски в юнитах канвы, масштабированные осью веса. */
export function gridInkTokens(grid, wScale = 1) {
  const cw = grid.canvas.width;
  const sw = grid.ratios.strokeWidth;
  const need = ['enclosureRing', 'base', 'containerGlyph', 'bold', 'tolerance'];
  for (const k of need) {
    if (!Number.isFinite(sw?.[k])) {
      throw new Error(`check-ink-weight: токен strokeWidth.${k} отсутствует или не число в grid.json`);
    }
  }
  const canons = {
    enclosureRing: sw.enclosureRing * cw * wScale,
    base: sw.base * cw * wScale,
    containerGlyph: sw.containerGlyph * cw * wScale,
    bold: sw.bold * cw * wScale,
  };
  return {
    cw,
    canons,
    tolU: sw.tolerance * cw * wScale, // допуск веса пера, пропорционален оси
    minCanon: canons.enclosureRing, // тончайший канон — низ инварианта (в)
    // потолок классификации «штрих»: толще bold на целый охранный зазор = масса
    capU: canons.bold + grid.ratios.clearanceMin * cw,
    clearU: grid.ratios.clearanceMin * cw,
    keylineR: (grid.ratios.keylines.circle * cw) / 2,
  };
}

/**
 * Диапазон клампа оси веса — ФОРМУЛА от токенов сетки (анти-дрифт для
 * литералов grid.axes.weight; вывод обоснован в комменте grid.json):
 *   min = capRadius/enclosureRing — ниже тончайший канон тоньше капа 0.9
 *         (кап = мельчайшая законная деталь пера, порог различимости);
 *   max = 1 + (enclosureRing − clearanceMin)/bold — выше узчайший канонический
 *         негатив-канал (enclosureRing: «негатив ≈ штрих») между двумя
 *         bold-штрихами проседает ниже охранного clearanceMin (стенки растут
 *         симметрично вокруг осей: потеря канала = (w−1)×bold).
 */
export function axesWeightRange(grid) {
  const r = grid.ratios;
  return {
    min: r.strokeWidth.capRadius / r.strokeWidth.enclosureRing,
    max: 1 + (r.strokeWidth.enclosureRing - r.clearanceMin) / r.strokeWidth.bold,
  };
}

// ── растр чернил + EDT ───────────────────────────────────────────────────────

/** 1D-квадратичный дистанс-трансформ (Фельценсвальб—Хуттенлохер). */
function edt1d(f, n, d, v, z) {
  let k = 0;
  v[0] = 0;
  z[0] = -Infinity;
  z[1] = Infinity;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++;
    v[k] = q;
    z[k] = s;
    z[k + 1] = Infinity;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
  }
}

/** Точное расстояние точка→отрезок. */
function segDist(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const l2 = dx * dx + dy * dy;
  let t = l2 > 0 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return Math.hypot(px - (x1 + dx * t), py - (y1 + dy * t));
}

/** Bucket-индекс рёбер контура для быстрых точных запросов расстояния. */
function buildEdgeIndex(edges, cw) {
  const size = 1.5; // юнит-ячейка; штрихи ≤ capU ≈ 3.2 — запрос 2–3 кольца
  const off = 4; // запас за канвой (овершут круга, поля)
  const cols = Math.ceil((cw + 2 * off) / size);
  const buckets = new Map();
  const bx = (x) => Math.max(0, Math.min(cols - 1, Math.floor((x + off) / size)));
  for (let e = 0; e < edges.length; e += 4) {
    const x1 = edges[e], y1 = edges[e + 1], x2 = edges[e + 2], y2 = edges[e + 3];
    const i0 = bx(Math.min(x1, x2)), i1 = bx(Math.max(x1, x2));
    const j0 = bx(Math.min(y1, y2)), j1 = bx(Math.max(y1, y2));
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const key = j * cols + i;
        let arr = buckets.get(key);
        if (!arr) buckets.set(key, (arr = []));
        arr.push(e);
      }
    }
  }
  return { size, off, cols, buckets, edges };
}

/** Точное расстояние точки до ближайшего ребра (расширение колец bucket'ов). */
function exactBoundaryDist(px, py, idx) {
  const { size, off, cols, buckets, edges } = idx;
  const ci = Math.max(0, Math.min(cols - 1, Math.floor((px + off) / size)));
  const cj = Math.max(0, Math.min(cols - 1, Math.floor((py + off) / size)));
  let best = Infinity;
  for (let ring = 0; ring < cols; ring++) {
    // гарантия: все рёбра колец дальше ring лежат ≥ (ring−1)×size от точки
    if ((ring - 1) * size > best) break;
    const j0 = Math.max(0, cj - ring), j1 = Math.min(cols - 1, cj + ring);
    const i0 = Math.max(0, ci - ring), i1 = Math.min(cols - 1, ci + ring);
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        if (ring > 0 && Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== ring) continue;
        const arr = buckets.get(j * cols + i);
        if (!arr) continue;
        for (const e of arr) {
          const d = segDist(px, py, edges[e], edges[e + 1], edges[e + 2], edges[e + 3]);
          if (d < best) best = d;
        }
      }
    }
  }
  return best;
}

/**
 * Слепой замер фактических толщин штрихов материализованного d.
 * @returns {{strokes:Array<Mode>, modes:Array<Mode>}} где Mode =
 *   {w, extent, count, at:[x,y], isRing} — толщина в юнитах канвы, охват
 *   (диагональ bbox моды), координата представителя, признак кольца-обрамления.
 */
export function measureStrokes(d, { cw, scale = 16, stepsPerSeg = 32, tolU, capU, keylineR, boldU }) {
  const polys = samplePolylines(d, stepsPerSeg).filter((p) => p.length > 2);
  if (polys.length === 0) return { strokes: [], modes: [] };
  const edges = [];
  for (const p of polys) {
    for (let i = 0; i < p.length; i++) {
      const a = p[i];
      const b = p[(i + 1) % p.length]; // замыкание суб-пути (even-odd честный)
      if (a[0] === b[0] && a[1] === b[1]) continue;
      edges.push(a[0], a[1], b[0], b[1]);
    }
  }

  // растр: скан-линии по центрам клеток, even-odd
  const N = Math.round(cw * scale);
  const ink = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    const y = (j + 0.5) / scale;
    const xs = [];
    for (let e = 0; e < edges.length; e += 4) {
      const y1 = edges[e + 1], y2 = edges[e + 3];
      if ((y1 > y) === (y2 > y)) continue;
      xs.push(edges[e] + ((y - y1) * (edges[e + 2] - edges[e])) / (y2 - y1));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      let i0 = Math.ceil(xs[k] * scale - 0.5);
      let i1 = Math.ceil(xs[k + 1] * scale - 0.5) - 1;
      if (i0 < 0) i0 = 0;
      if (i1 >= N) i1 = N - 1;
      for (let i = i0; i <= i1; i++) ink[j * N + i] = 1;
    }
  }

  // точный EDT: квадрат расстояния (px²) до ближайшего фонового центра клетки
  const INF = 1e12;
  const D = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) D[i] = ink[i] ? INF : 0;
  const f = new Float64Array(N);
  const d1 = new Float64Array(N);
  const v1 = new Int32Array(N);
  const z1 = new Float64Array(N + 1);
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) f[y] = D[y * N + x];
    edt1d(f, N, d1, v1, z1);
    for (let y = 0; y < N; y++) D[y * N + x] = d1[y];
  }
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) f[x] = D[y * N + x];
    edt1d(f, N, d1, v1, z1);
    for (let x = 0; x < N; x++) D[y * N + x] = d1[x];
  }

  // хребет: локальный максимум EDT поперёк штриха (минимум одна строгая
  // сторона — иначе плато ВДОЛЬ штриха у граничных клеток метилось бы хребтом)
  const at = (i, j) => (i < 0 || j < 0 || i >= N || j >= N ? 0 : D[j * N + i]);
  const ridge = new Map(); // idx → {i,j,ax:boolean,ay:boolean}
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const idx = j * N + i;
      if (!ink[idx]) continue;
      const c = D[idx];
      const l = at(i - 1, j), r = at(i + 1, j), u = at(i, j - 1), b = at(i, j + 1);
      const ax = l <= c && r <= c && (l < c || r < c);
      const ay = u <= c && b <= c && (u < c || b < c);
      if (ax || ay) ridge.set(idx, { i, j, ax, ay });
    }
  }

  // уточнение: точная дистанция до контура + тент-коррекция по соседям
  const edgeIdx = buildEdgeIndex(edges, cw);
  const exact = new Map(); // кэш точных дистанций клеток (знаковых: фон < 0)
  const sd = (i, j) => {
    if (i < 0 || j < 0 || i >= N || j >= N) return 0;
    const key = j * N + i;
    let val = exact.get(key);
    if (val === undefined) {
      const dd = exactBoundaryDist((i + 0.5) / scale, (j + 0.5) / scale, edgeIdx);
      val = ink[key] ? dd : -dd;
      exact.set(key, val);
    }
    return val;
  };
  // прунинг немаксимальных дисков (шум EDT-скелета у границ): если дистанция
  // к соседу растёт со скоростью ≥ MAX_GROWTH (у настоящей медиали ленты
  // скорость 0, у граничного шума ≈ 1 — его диск вложен в больший диск
  // интерьера), клетка — не скелет чернил. 0.8 = cos-порог клина: прунится
  // только веер шире 106°, любая лента/конус уже — остаётся.
  const MAX_GROWTH = 0.8;
  const step = 1 / scale;
  const cells = [];
  for (const { i, j, ax, ay } of ridge.values()) {
    const dc = sd(i, j);
    let pruned = false;
    for (let dj = -1; dj <= 1 && !pruned; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const dist = step * Math.hypot(di, dj);
        if (sd(i + di, j + dj) - dc >= MAX_GROWTH * dist) {
          pruned = true;
          break;
        }
      }
    }
    if (pruned) continue;
    let est = dc;
    // тент: профиль дистанции поперёк штриха = |x|-тент; вершина восстановима
    // точно из трёх сэмплов: dc + |dl−dr|/2 (знаковые значения соседей)
    if (ax && i > 0 && i < N - 1) est = Math.max(est, dc + Math.abs(sd(i - 1, j) - sd(i + 1, j)) / 2);
    if (ay && j > 0 && j < N - 1) est = Math.max(est, dc + Math.abs(sd(i, j - 1) - sd(i, j + 1)) / 2);
    cells.push({ i, j, x: (i + 0.5) / scale, y: (j + 0.5) / scale, w: 2 * est });
  }

  // 8-связные кластеры произвольного набора клеток
  const splitClusters = (set, NN) => {
    const byIdx = new Map();
    for (const c of set) byIdx.set(c.j * NN + c.i, c);
    const done = new Set();
    const clusters = [];
    for (const c of set) {
      const k0 = c.j * NN + c.i;
      if (done.has(k0)) continue;
      const cl = [];
      const stack = [k0];
      done.add(k0);
      while (stack.length) {
        const k = stack.pop();
        const cc = byIdx.get(k);
        cl.push(cc);
        for (let dj = -1; dj <= 1; dj++) {
          for (let di = -1; di <= 1; di++) {
            if (!di && !dj) continue;
            const nk = (cc.j + dj) * NN + (cc.i + di);
            if (byIdx.has(nk) && !done.has(nk)) {
              done.add(nk);
              stack.push(nk);
            }
          }
        }
      }
      clusters.push(cl);
    }
    return clusters;
  };

  // компоненты хребта (8-связность) → моды толщины
  const cellByIdx = new Map();
  for (const c of cells) cellByIdx.set(c.j * N + c.i, c);
  const comps = splitClusters(cells, N);

  const binW = tolU / 2;
  const modes = [];
  for (const comp of comps) {
    let rem = comp;
    let guard = 0;
    while (rem.length >= 4 && guard++ < 16) {
      const hist = new Map();
      for (const c of rem) {
        const k = Math.round(c.w / binW);
        hist.set(k, (hist.get(k) || 0) + 1);
      }
      let bestK = null;
      let bestN = 0;
      for (const [k, n] of hist) {
        const nn = n + (hist.get(k - 1) || 0) + (hist.get(k + 1) || 0);
        if (nn > bestN) {
          bestN = nn;
          bestK = k;
        }
      }
      const rough = bestK * binW;
      const win = rem.filter((c) => Math.abs(c.w - rough) <= binW * 1.5).sort((a, b) => a.w - b.w);
      const center = win[Math.floor(win.length / 2)].w; // медиана окна пика
      const sel = rem.filter((c) => Math.abs(c.w - center) <= tolU / 2);
      if (sel.length < 4) {
        const winSet = new Set(win);
        rem = rem.filter((c) => !winSet.has(c));
        continue;
      }
      // мода режется на 8-связные КЛАСТЕРЫ: клетки одной толщины из разных
      // мест фигуры (четыре угловых скелета прямоугольника) — разные
      // кандидаты, их охваты не суммируются в мнимый длинный «штрих»
      for (const cluster of splitClusters(sel, N)) {
        if (cluster.length < 4) continue;
        // статистика кластера
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        let rMin = Infinity, rMax = -Infinity;
        const sectors = new Set();
        let repr = cluster[0];
        for (const c of cluster) {
          if (c.x < minX) minX = c.x;
          if (c.y < minY) minY = c.y;
          if (c.x > maxX) maxX = c.x;
          if (c.y > maxY) maxY = c.y;
          const rr = Math.hypot(c.x - cw / 2, c.y - cw / 2);
          if (rr < rMin) rMin = rr;
          if (rr > rMax) rMax = rr;
          sectors.add(Math.floor(((Math.atan2(c.y - cw / 2, c.x - cw / 2) + Math.PI) / (2 * Math.PI)) * 16) % 16);
          if (Math.abs(c.w - center) < Math.abs(repr.w - center)) repr = c;
        }
        const extent = Math.hypot(maxX - minX, maxY - minY);
        // кольцо-обрамление: хребет на постоянном радиусе от центра сетки,
        // радиус keyline-масштаба, полный угловой охват (≥14/16 секторов)
        const isRing =
          rMax - rMin <= tolU && (rMin + rMax) / 2 >= keylineR - boldU && sectors.size >= 14;
        // срез клина: скелет кластера продолжается соседями И тоньше, И толще
        // окна (лестница срезов сужающегося клина — масса, не штрих; у
        // настоящего штриха продолжение либо вверх — сустав, либо никакое — кап)
        let below = false;
        let above = false;
        for (const c of cluster) {
          for (let dj = -1; dj <= 1 && !(below && above); dj++) {
            for (let di = -1; di <= 1; di++) {
              if (!di && !dj) continue;
              const nb = cellByIdx.get((c.j + dj) * N + (c.i + di));
              if (!nb) continue;
              if (nb.w < center - tolU / 2) below = true;
              else if (nb.w > center + tolU / 2) above = true;
            }
          }
        }
        modes.push({
          w: center, extent, count: cluster.length, at: [repr.x, repr.y], isRing,
          taperSlice: below && above,
        });
      }
      const selSet = new Set(sel);
      rem = rem.filter((c) => !selSet.has(c));
    }
  }

  // ШТРИХ = лента заметно длиннее ширины (мельче — точки/массы, их держит
  // анатомия), не толще потолка пера capU (толще — масса: диск, терминал)
  // и не срез клина (сужающиеся массы — стрелочные головы, капли)
  const strokes = modes.filter((m) => m.extent >= 2 * m.w && m.w <= capU && !m.taperSlice);
  return { strokes, modes };
}

// ── инварианты весов ─────────────────────────────────────────────────────────

/**
 * Дефекты веса чернил одного материализованного d.
 * @returns {{strokes:Array, modes:Array, defects:Array<{type:string,msg:string}>}}
 */
export function inkWeightDefects({ grid, d, wScale = 1, scale = 16, stepsPerSeg = 32 }) {
  const T = gridInkTokens(grid, wScale);
  const { strokes, modes } = measureStrokes(d, {
    cw: T.cw,
    scale,
    stepsPerSeg,
    tolU: T.tolU,
    capU: T.capU,
    keylineR: T.keylineR,
    boldU: T.canons.bold,
  });
  const defects = [];
  const fmt = (v) => v.toFixed(2);
  for (const s of strokes) {
    s.canon = Object.entries(T.canons)
      .filter(([, v]) => Math.abs(s.w - v) <= T.tolU)
      .map(([n]) => n);
    const coord = `@(${fmt(s.at[0])},${fmt(s.at[1])})`;
    if (s.w < T.minCanon - T.tolU) {
      defects.push({
        type: 'thin',
        msg: `супертонкий штрих ${fmt(s.w)} < минимального канона ${fmt(T.minCanon)} − допуск ${fmt(T.tolU)} ${coord}`,
      });
    } else if (s.canon.length === 0) {
      defects.push({
        type: 'orphan',
        msg:
          `ничейный вес ${fmt(s.w)} ${coord} — не совпадает ни с одним каноном ` +
          `(${Object.entries(T.canons).map(([n, v]) => `${n}=${fmt(v)}`).join(', ')}, допуск ±${fmt(T.tolU)})`,
      });
    }
  }
  // (б) кольцо-ОБРАМЛЕНИЕ обязано быть легче глифа (двусмысленный замер,
  // совместимый и с base-каноном предметного круга, не судится)
  const enclosure = strokes.find(
    (s) => s.isRing && s.canon?.includes('enclosureRing') && !s.canon.includes('base'),
  );
  if (enclosure) {
    for (const s of strokes) {
      if (s === enclosure || s.isRing) continue;
      if (s.w < T.minCanon - T.tolU) continue; // супертонкий шов уже пойман (в) — не дублировать
      if (s.w - enclosure.w < T.tolU) {
        defects.push({
          type: 'container-heavier',
          msg:
            `обрамление ${fmt(enclosure.w)} не легче глифа ${fmt(s.w)} @(${fmt(s.at[0])},${fmt(s.at[1])}) ` +
            `(канон: контейнер оптически легче глифа минимум на допуск ${fmt(T.tolU)})`,
        });
      }
    }
  }
  return { strokes, modes, defects };
}

/**
 * Минимальный охранный клиренс между раздельными элементами d (дисциплина
 * check-static-grid §4: вложенные и пересекающиеся пары не судятся).
 * @returns {number|null} юниты; null если раздельных пар нет
 */
export function minClearance(d) {
  const polys = samplePolylines(d, 10).filter((p) => p.length > 2);
  if (polys.length < 2) return null;
  const bbs = polys.map((p) => {
    let a = 1e9, b = 1e9, x = -1e9, y = -1e9;
    for (const [px, py] of p) {
      a = Math.min(a, px);
      b = Math.min(b, py);
      x = Math.max(x, px);
      y = Math.max(y, py);
    }
    return { a, b, x, y };
  });
  let min = null;
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      const A = bbs[i], B = bbs[j];
      const nested =
        (A.a <= B.a && A.b <= B.b && A.x >= B.x && A.y >= B.y) ||
        (B.a <= A.a && B.b <= A.b && B.x >= A.x && B.y >= A.y);
      if (nested) continue;
      let crossing = false;
      outer: for (let a2 = 0; a2 < polys[i].length; a2++) {
        for (let b2 = 0; b2 < polys[j].length; b2++) {
          if (
            segmentsCross(
              polys[i][a2], polys[i][(a2 + 1) % polys[i].length],
              polys[j][b2], polys[j][(b2 + 1) % polys[j].length],
            )
          ) {
            crossing = true;
            break outer;
          }
        }
      }
      if (crossing) continue;
      let g = 1e9;
      for (const q of polys[i]) {
        for (const w of polys[j]) {
          const dd = Math.hypot(q[0] - w[0], q[1] - w[1]);
          if (dd < g) g = dd;
        }
      }
      // 0-зазоры/стыки — зона path-quality; тут охранный коридор
      if (g > 0.05 && (min === null || g < min)) min = g;
    }
  }
  return min;
}

// ── оси: свип weight × corner ────────────────────────────────────────────────

export const AXES_GRID = { weight: [0.8, 1, 1.2], corner: [0, 1] };

/**
 * Свип осей по одному глифу: вес масштабируется пропорционально всюду
 * (каждый штрих default-замера обязан найтись в модах combo-замера как
 * ×weight ± tolerance×weight), клиренс ≥ clearanceMin на всех углах сетки.
 */
export function axesSweepGlyph({ grid, entry, allGlyphs, scale = 8, stepsPerSeg = 16 }) {
  const findings = [];
  let base;
  try {
    base = buildGlyph(entry, grid, {}, allGlyphs);
  } catch {
    return findings; // невалидная декларация — зона других гейтов
  }
  const fmt = (v) => v.toFixed(2);
  for (const variant of Object.keys(base)) {
    const d0 = base[variant];
    if (!d0) continue;
    const T0 = gridInkTokens(grid, 1);
    const base0 = measureStrokes(d0, {
      cw: T0.cw, scale, stepsPerSeg, tolU: T0.tolU, capU: T0.capU, keylineR: T0.keylineR, boldU: T0.canons.bold,
    });
    for (const w of AXES_GRID.weight) {
      for (const c of AXES_GRID.corner) {
        if (w === 1 && c === 1) continue; // default — база сравнения
        let built;
        try {
          built = buildGlyph(entry, grid, { weight: w, corner: c }, allGlyphs);
        } catch (cause) {
          findings.push({ variant, combo: `w${w}/c${c}`, type: 'build', msg: `генерат не собрался: ${cause.message}` });
          continue;
        }
        const d = built[variant];
        if (!d) continue;
        const combo = `w${w}/c${c}`;
        const r = inkWeightDefects({ grid, d, wScale: w, scale, stepsPerSeg });
        for (const df of r.defects) findings.push({ variant, combo, type: df.type, msg: df.msg });
        // пропорциональность: каждый default-штрих обязан отмасштабироваться
        const tolW = T0.tolU * w;
        for (const s0 of base0.strokes) {
          const expect = s0.w * w;
          const hit = r.modes.some((m) => Math.abs(m.w - expect) <= tolW);
          if (!hit) {
            const near = r.modes.reduce((b, m) => (b === null || Math.abs(m.w - expect) < Math.abs(b - expect) ? m.w : b), null);
            findings.push({
              variant, combo, type: 'weight-jump',
              msg:
                `вес прыгнул: штрих ${fmt(s0.w)}@default ожидался ${fmt(expect)}, ` +
                `ближайший замер ${near === null ? 'нет' : fmt(near)} (допуск ±${fmt(tolW)})`,
            });
          }
        }
        // охранный клиренс на углу сетки
        const gap = minClearance(d);
        if (gap !== null && gap < T0.clearU - 1e-9) {
          findings.push({
            variant, combo, type: 'clearance',
            msg: `клиренс ${fmt(gap)} < канона ${fmt(T0.clearU)} — охранный зазор схлопывается`,
          });
        }
      }
    }
  }
  return findings;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const repo = join(dirname(fileURLToPath(import.meta.url)), '..');
  const grid = JSON.parse(readFileSync(join(repo, 'semantics', 'grid.json'), 'utf8'));
  const anatomy = JSON.parse(readFileSync(join(repo, 'semantics', 'anatomy.json'), 'utf8'));
  const strict = process.argv.includes('--strict');
  const axesMode = process.argv.includes('--axes');
  const targets = process.argv.slice(2).filter((a) => !a.startsWith('-'));

  // анти-дрифт клампа: литералы grid.axes.weight обязаны совпадать с формулой
  const range = axesWeightRange(grid);
  const gw = grid.axes?.weight;
  if (!gw || Math.abs(gw.min - range.min) > 1e-6 || Math.abs(gw.max - range.max) > 1e-6) {
    console.error(
      `check-ink-weight: grid.axes.weight ${gw ? `{min:${gw.min}, max:${gw.max}}` : 'отсутствует'} ` +
        `≠ формуле от токенов {min:${range.min}, max:${range.max}} — кламп оси дрейфует от вывода`,
    );
    process.exit(1);
  }

  const promotedFile = join(repo, 'semantics', 'ink-weight-promoted.json');
  const promoted = existsSync(promotedFile)
    ? JSON.parse(readFileSync(promotedFile, 'utf8')).promoted || []
    : [];

  const fmt = (v) => v.toFixed(3);
  const printStrokes = (label, strokes) => {
    for (const s of strokes) {
      console.log(
        `    ${label}: штрих ${fmt(s.w)} (охват ${s.extent.toFixed(1)}, канон: ${
          s.canon && s.canon.length ? s.canon.join('|') : 'НИЧЕЙ'
        }${s.isRing ? ', кольцо-обрамление' : ''}) @(${s.at[0].toFixed(2)},${s.at[1].toFixed(2)})`,
      );
    }
  };

  if (targets.length > 0) {
    // HARD arg-режим (RED-протокол): глиф из anatomy или файл .svg
    let fails = 0;
    for (const arg of targets) {
      console.log(`${arg}:`);
      const variants = {};
      if (arg.endsWith('.svg')) {
        variants.file = renderedPathData(readFileSync(arg, 'utf8')).join('');
      } else {
        const entry = anatomy.glyphs[arg];
        if (!entry) {
          console.error(`check-ink-weight: нет глифа «${arg}» в anatomy и это не .svg`);
          process.exit(2);
        }
        Object.assign(variants, buildGlyph(entry, grid, {}, anatomy.glyphs));
      }
      for (const [variant, d] of Object.entries(variants)) {
        if (!d) continue;
        const { strokes, defects } = inkWeightDefects({ grid, d });
        printStrokes(variant, strokes);
        for (const df of defects) {
          console.log(`    ${variant}: FAIL [${df.type}] ${df.msg}`);
          fails++;
        }
      }
    }
    if (fails > 0) {
      console.log(`check-ink-weight: FAIL — ${fails} дефект(ов) веса`);
      process.exit(1);
    }
    console.log('check-ink-weight: OK — все замеры в канонах');
    process.exit(0);
  }

  if (axesMode) {
    // свип осей по корпусу: report-каталог + HARD для промоутнутых
    const offenders = [];
    for (const [name, entry] of Object.entries(anatomy.glyphs)) {
      const findings = axesSweepGlyph({ grid, entry, allGlyphs: anatomy.glyphs });
      for (const fnd of findings) offenders.push({ name, ...fnd });
    }
    if (offenders.length) {
      console.log(`check-ink-weight --axes: ${offenders.length} находок свипа weight×corner (report-каталог):`);
      for (const o of offenders) {
        console.log(`  - ${o.name}/${o.variant} [${o.combo}] [${o.type}] ${o.msg}`);
      }
    }
    const hardFails = offenders.filter((o) => promoted.includes(o.name));
    if (hardFails.length > 0) {
      console.log(`check-ink-weight --axes: FAIL — ${hardFails.length} находок в ПРОМОУТНУТЫХ глифах (регрессия осей)`);
      process.exit(1);
    }
    if (strict && offenders.length > 0) process.exit(1);
    console.log(
      `check-ink-weight --axes: OK — сетка ${AXES_GRID.weight.join('/')}×corner ${AXES_GRID.corner.join('/')}; ` +
        `${promoted.length} промоутнут(ых) HARD-чисты`,
    );
    process.exit(0);
  }

  // корпусный прогон: report-каталог + HARD для промоутнутых
  const offenders = [];
  let measured = 0;
  for (const [name, entry] of Object.entries(anatomy.glyphs)) {
    let built;
    try {
      built = buildGlyph(entry, grid, {}, anatomy.glyphs);
    } catch {
      continue; // невалидная декларация — зона других гейтов
    }
    for (const [variant, d] of Object.entries(built)) {
      if (!d) continue;
      let res;
      try {
        res = inkWeightDefects({ grid, d });
      } catch (cause) {
        offenders.push({ name, variant, type: 'error', msg: `замер не удался: ${cause.message}` });
        continue;
      }
      measured += res.strokes.length;
      for (const df of res.defects) offenders.push({ name, variant, type: df.type, msg: df.msg });
    }
  }
  if (offenders.length) {
    console.log(`check-ink-weight: REPORT — ${offenders.length} дефектов веса на генерате (кандидаты промоушена):`);
    for (const o of offenders) console.log(`  - ${o.name}/${o.variant} [${o.type}] ${o.msg}`);
  }
  const hardFails = offenders.filter((o) => promoted.includes(o.name));
  if (hardFails.length > 0) {
    console.log(`check-ink-weight: FAIL — ${hardFails.length} дефект(ов) в ПРОМОУТНУТЫХ глифах (регрессия веса):`);
    for (const o of hardFails) console.log(`  - ${o.name}/${o.variant} [${o.type}] ${o.msg}`);
    process.exit(1);
  }
  if (strict && offenders.length > 0) process.exit(1);
  console.log(
    `check-ink-weight: OK — ${measured} штрихов замерено по корпусу; ` +
      `${promoted.length} промоутнут(ых) глиф(ов) HARD-чисты (кусается и arg-режимом: node scripts/check-ink-weight.js chevron-down-circle)`,
  );
}
