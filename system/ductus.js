/**
 * system/ductus.js — ДУКТУС: разбор чужого глифа вписанными окружностями.
 *
 * Зачем. До этого файла модель глифа выбиралась глазами по картинке, а фиттер
 * лишь уточнял числа. Глазами видно не всё: у одной иконки «блоб» оказывается
 * обводкой эллипса, у другой — сплошной массой, и отличить их можно только
 * замером. Здесь замер делается честно.
 *
 * ИДЕЯ. Максимальная вписанная окружность в точке чернил — это ровно перо,
 * которым в этой точке вели. Цепочка их центров — скелет. Значит:
 *
 *   • где радиус ≈ const по всей длине — там ШТРИХ, и 2r даёт перо;
 *   • где радиус скачком больше — там МАССА (голова ноты, диск солнца);
 *   • конец цепочки — ТЕРМИНАЛ, и его радиус обязан равняться перу/2;
 *   • развилка цепочки — СУСТАВ;
 *   • максимальная окружность, вписанная в СЧЁТЧИК, — это негативное
 *     пространство, измеренное, а не прикинутое;
 *   • минимальная описанная окружность — фактический keyline глифа.
 *
 * И ещё одно, ради чего это писалось: РАЗРЫВ. Если чернила распадаются на
 * несколько связных кусков, дуктус это видит сразу — а на глаз разрыв в
 * 0.3 ед. внутри завитка не заметен.
 *
 *   node system/ductus.js signature
 *   node system/ductus.js dice --filled
 */

import { readFileSync } from 'node:fs';
import { maskFromSvg, maskFromPath } from './metrics.js';

/**
 * Точное евклидово расстояние до фона (алгоритм Фельзенсвальба, две проходки
 * по осям). Возвращает КВАДРАТ расстояния в пикселях растра.
 */
export function edt(mask, n) {
  const INF = 1e12;
  const f = new Float64Array(n);
  const d = new Float64Array(n * n);
  const v = new Int32Array(n);
  const z = new Float64Array(n + 1);

  const pass = (get, set) => {
    let k = 0;
    v[0] = 0;
    z[0] = -INF;
    z[1] = INF;
    for (let q = 1; q < n; q++) {
      let s = (get(q) + q * q - (get(v[k]) + v[k] * v[k])) / (2 * q - 2 * v[k]);
      while (s <= z[k]) {
        k--;
        s = (get(q) + q * q - (get(v[k]) + v[k] * v[k])) / (2 * q - 2 * v[k]);
      }
      k++;
      v[k] = q;
      z[k] = s;
      z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < n; q++) {
      while (z[k + 1] < q) k++;
      set(q, (q - v[k]) * (q - v[k]) + get(v[k]));
    }
  };

  for (let x = 0; x < n; x++) {
    for (let y = 0; y < n; y++) f[y] = mask[y * n + x] ? INF : 0;
    const src = Float64Array.from(f);
    pass(
      (i) => src[i],
      (i, val) => {
        d[i * n + x] = val;
      },
    );
  }
  for (let y = 0; y < n; y++) {
    const row = d.subarray(y * n, y * n + n);
    const src = Float64Array.from(row);
    pass(
      (i) => src[i],
      (i, val) => {
        row[i] = val;
      },
    );
  }
  return d;
}

/** Связные компоненты маски (4-связность). */
export function components(mask, n) {
  const lab = new Int32Array(n * n).fill(-1);
  const out = [];
  const st = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i] || lab[i] >= 0) continue;
    const id = out.length;
    let area = 0;
    let x0 = n;
    let y0 = n;
    let x1 = -1;
    let y1 = -1;
    st.push(i);
    lab[i] = id;
    while (st.length) {
      const p = st.pop();
      const px = p % n;
      const py = (p - px) / n;
      area++;
      if (px < x0) x0 = px;
      if (py < y0) y0 = py;
      if (px > x1) x1 = px;
      if (py > y1) y1 = py;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= n || qy >= n) continue;
        const q = qy * n + qx;
        if (mask[q] && lab[q] < 0) {
          lab[q] = id;
          st.push(q);
        }
      }
    }
    out.push({ id, area, box: [x0, y0, x1, y1] });
  }
  return { labels: lab, list: out };
}

/**
 * ЖАДНАЯ УПАКОВКА ВПИСАННЫХ ОКРУЖНОСТЕЙ. Берём самую большую вписанную, гасим
 * её и повторяем. Круги идут по убыванию радиуса, поэтому первые несколько
 * сразу показывают структуру: у штрихового глифа они все одного радиуса, у
 * глифа с массой первые заметно крупнее.
 *
 * @param {Uint8Array} mask
 * @param {{canvas?:number, ss?:number, count?:number, minR?:number, overlap?:number}} [o]
 */
export function inscribedCircles(mask, o = {}) {
  const canvas = o.canvas ?? 24;
  const ss = o.ss ?? Math.round(Math.sqrt(mask.length) / canvas);
  const n = canvas * ss;
  const count = o.count ?? 24;
  const minR = (o.minR ?? 0.25) * ss;
  /** Доля радиуса, на которую гасится площадь вокруг найденного центра. */
  const overlap = o.overlap ?? 0.85;

  const work = Uint8Array.from(mask);
  const out = [];
  for (let k = 0; k < count; k++) {
    const d2 = edt(work, n);
    let best = -1;
    let bi = -1;
    for (let i = 0; i < d2.length; i++) {
      if (d2[i] > best) {
        best = d2[i];
        bi = i;
      }
    }
    const r = Math.sqrt(best);
    if (r < minR) break;
    const cx = bi % n;
    const cy = (bi - cx) / n;
    out.push({ c: [(cx + 0.5) / ss, (cy + 0.5) / ss], r: r / ss });
    // гасим круг радиуса overlap·r вокруг центра
    const rr = Math.max(1, overlap * r);
    const r2 = rr * rr;
    const x0 = Math.max(0, Math.floor(cx - rr));
    const x1 = Math.min(n - 1, Math.ceil(cx + rr));
    const y0 = Math.max(0, Math.floor(cy - rr));
    const y1 = Math.min(n - 1, Math.ceil(cy + rr));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) work[y * n + x] = 0;
      }
    }
  }
  return out;
}

/**
 * ПРОФИЛЬ ПЕРА. Гистограмма 2·r по гребню карты расстояний: там, где глиф —
 * штрих, гребень весь на одном радиусе, и мода гистограммы и есть перо.
 */
export function penProfile(mask, o = {}) {
  const canvas = o.canvas ?? 24;
  const ss = o.ss ?? Math.round(Math.sqrt(mask.length) / canvas);
  const n = canvas * ss;
  const d2 = edt(mask, n);
  const bins = new Map();
  let ridge = 0;
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      if (!mask[i]) continue;
      const v = d2[i];
      let isRidge = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        if (d2[i + dy * n + dx] > v + 1e-9) {
          isRidge = false;
          break;
        }
      }
      if (!isRidge) continue;
      ridge++;
      const w = Number(((2 * Math.sqrt(v)) / ss).toFixed(1));
      bins.set(w, (bins.get(w) ?? 0) + 1);
    }
  }
  const sorted = [...bins.entries()].sort((a, b) => b[1] - a[1]);
  return {
    ridgePixels: ridge,
    mode: sorted.length ? sorted[0][0] : null,
    histogram: sorted.slice(0, 6).map(([w, c]) => ({ width: w, share: c / Math.max(1, ridge) })),
  };
}

/** Минимальная описанная окружность чернил (итеративное сжатие Ричи). */
export function enclosingCircle(mask, o = {}) {
  const canvas = o.canvas ?? 24;
  const ss = o.ss ?? Math.round(Math.sqrt(mask.length) / canvas);
  const n = canvas * ss;
  const pts = [];
  for (let i = 0; i < mask.length; i++) {
    if (!mask[i]) continue;
    const x = i % n;
    const y = (i - x) / n;
    // только кромка — внутренние точки на описанную не влияют
    if (mask[i - 1] && mask[i + 1] && mask[i - n] && mask[i + n]) continue;
    pts.push([(x + 0.5) / ss, (y + 0.5) / ss]);
  }
  if (!pts.length) return null;
  let c = pts.reduce((a, p) => [a[0] + p[0] / pts.length, a[1] + p[1] / pts.length], [0, 0]);
  let r = 0;
  for (const p of pts) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1]));
  for (let it = 0; it < 400; it++) {
    let far = pts[0];
    let fd = 0;
    for (const p of pts) {
      const d = Math.hypot(p[0] - c[0], p[1] - c[1]);
      if (d > fd) {
        fd = d;
        far = p;
      }
    }
    const step = (fd - r * 0.999) / (it + 2);
    c = [c[0] + (far[0] - c[0]) * (step / Math.max(fd, 1e-9)), c[1] + (far[1] - c[1]) * (step / Math.max(fd, 1e-9))];
    r = 0;
    for (const p of pts) r = Math.max(r, Math.hypot(p[0] - c[0], p[1] - c[1]));
  }
  return { c: [Number(c[0].toFixed(3)), Number(c[1].toFixed(3))], r: Number(r.toFixed(3)) };
}

/** Счётчики (просветы внутри чернил) с максимальной вписанной в каждый окружностью. */
export function counters(mask, o = {}) {
  const canvas = o.canvas ?? 24;
  const ss = o.ss ?? Math.round(Math.sqrt(mask.length) / canvas);
  const n = canvas * ss;
  const bg = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) bg[i] = mask[i] ? 0 : 1;
  // залить фон снаружи, чтобы остались только дырки
  const st = [];
  const seen = new Uint8Array(mask.length);
  for (let x = 0; x < n; x++) {
    for (const i of [x, (n - 1) * n + x, x * n, x * n + n - 1]) if (bg[i] && !seen[i]) { seen[i] = 1; st.push(i); }
  }
  while (st.length) {
    const p = st.pop();
    const px = p % n;
    const py = (p - px) / n;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const qx = px + dx;
      const qy = py + dy;
      if (qx < 0 || qy < 0 || qx >= n || qy >= n) continue;
      const q = qy * n + qx;
      if (bg[q] && !seen[q]) {
        seen[q] = 1;
        st.push(q);
      }
    }
  }
  const holes = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) holes[i] = bg[i] && !seen[i] ? 1 : 0;
  const { labels, list } = components(holes, n);
  return list
    .filter((c) => c.area / (ss * ss) > 0.05)
    .map((c) => {
      if (o.light) return { area: Number((c.area / (ss * ss)).toFixed(2)), box: c.box.map((v) => Number((v / ss).toFixed(2))), maxCircle: null };
      const only = new Uint8Array(mask.length);
      for (let i = 0; i < labels.length; i++) if (labels[i] === c.id) only[i] = 1;
      const circ = inscribedCircles(only, { canvas, ss, count: 1, minR: 0.05 })[0] ?? null;
      return {
        area: Number((c.area / (ss * ss)).toFixed(2)),
        box: c.box.map((v) => Number((v / ss).toFixed(2))),
        maxCircle: circ ? { c: circ.c.map((v) => Number(v.toFixed(2))), r: Number(circ.r.toFixed(3)) } : null,
      };
    })
    .sort((a, b) => b.area - a.area);
}

/** Полный разбор одной маски. */
export function analyze(mask, o = {}) {
  const canvas = o.canvas ?? 24;
  const ss = o.ss ?? Math.round(Math.sqrt(mask.length) / canvas);
  const n = canvas * ss;
  const parts = components(mask, n).list.map((c) => ({
    area: Number((c.area / (ss * ss)).toFixed(2)),
    box: c.box.map((v) => Number((v / ss).toFixed(2))),
  }));
  return {
    parts: parts.sort((a, b) => b.area - a.area),
    pen: penProfile(mask, { canvas, ss }),
    // Упаковка окружностей — самая дорогая часть (по карте расстояний на круг),
    // и для СВЕРКИ она не нужна: структуру задают куски, просветы, перо и
    // калибр. Поэтому в лёгком режиме её не считаем.
    circles: o.light ? [] : inscribedCircles(mask, { canvas, ss, count: o.count ?? 16 }).map((c) => ({
      c: c.c.map((v) => Number(v.toFixed(2))),
      r: Number(c.r.toFixed(3)),
    })),
    counters: counters(mask, { canvas, ss, light: o.light }),
    enclosing: enclosingCircle(mask, { canvas, ss }),
  };
}

/** Разбор эталонного файла по имени. */
export function analyzeReference(name, variant = 'outline', ss = 12) {
  const file = `reference/${variant === 'filled' ? 'Filled' : 'Outline'}/${name}${variant === 'filled' ? '_filled' : ''}.svg`;
  return analyze(maskFromSvg(readFileSync(file, 'utf8'), 24, ss), { canvas: 24, ss });
}

/** Разбор построенного системой пути — для сверки конструкции с оригиналом. */
export function analyzePath(path, ss = 12) {
  return analyze(maskFromPath(path, 24, ss, 0.01), { canvas: 24, ss });
}

/**
 * СВЕРКА ДУКТУСОВ. Отвечает на вопрос, на который площадная метрика ответить
 * не может: совпала ли КОНСТРУКЦИЯ. Три сигнала, каждый — отдельный класс
 * ошибки:
 *
 *   parts     — разное число связных кусков чернил. Значит деталь потеряна
 *               или слиплась. Разрыв в 0.3 ед. внутри завитка площадью не
 *               ловится вовсе, а здесь виден сразу.
 *   counters  — разное число просветов. Значит контур залился или, наоборот,
 *               прорвался.
 *   pen       — разная мода пера. Значит глиф ведён не тем инструментом.
 *   enclosing — разный keyline. Значит глиф не того калибра.
 */
export function ductusDiff(refMask, genMask, o = {}) {
  const a = analyze(refMask, { ...o, light: true });
  const b = analyze(genMask, { ...o, light: true });
  const issues = [];
  if (a.parts.length !== b.parts.length)
    issues.push(`кусков чернил: оригинал ${a.parts.length}, генерат ${b.parts.length}`);
  if (a.counters.length !== b.counters.length)
    issues.push(`просветов: оригинал ${a.counters.length}, генерат ${b.counters.length}`);
  if (a.pen.mode != null && b.pen.mode != null && Math.abs(a.pen.mode - b.pen.mode) > 0.25)
    issues.push(`перо: оригинал ${a.pen.mode}, генерат ${b.pen.mode}`);
  if (a.enclosing && b.enclosing && Math.abs(a.enclosing.r - b.enclosing.r) > 0.35)
    issues.push(`описанная окружность: оригинал r=${a.enclosing.r}, генерат r=${b.enclosing.r}`);
  return { ref: a, gen: b, issues };
}

if (process.argv[1] && process.argv[1].endsWith('ductus.js')) {
  const name = process.argv[2];
  if (!name) {
    console.error('укажи имя: node system/ductus.js <имя> [--filled] [--ss 16]');
    process.exit(2);
  }
  const variant = process.argv.includes('--filled') ? 'filled' : 'outline';
  const ss = process.argv.includes('--ss') ? Number(process.argv[process.argv.indexOf('--ss') + 1]) : 12;
  const a = analyzeReference(name, variant, ss);
  console.log(`── ДУКТУС ${name}/${variant} (растр ${24 * ss}²) ──`);
  console.log(`связных кусков чернил: ${a.parts.length}`);
  for (const p of a.parts.slice(0, 6)) console.log(`   площадь ${String(p.area).padStart(7)}  габарит ${p.box.join('..')}`);
  console.log(
    `перо (мода по гребню): ${a.pen.mode}  ·  ` + a.pen.histogram.map((h) => `${h.width}:${(h.share * 100).toFixed(0)}%`).join(' '),
  );
  console.log('вписанные окружности (по убыванию):');
  for (const c of a.circles) console.log(`   r=${c.r.toFixed(3)}  центр ${c.c.join(', ')}`);
  console.log('счётчики (негативное пространство):');
  for (const c of a.counters) console.log(`   площадь ${c.area}  габарит ${c.box.join('..')}  макс. вписанная r=${c.maxCircle?.r}`);
  console.log(`описанная окружность: r=${a.enclosing.r} центр ${a.enclosing.c.join(', ')}`);
}
