/**
 * system/metrics.js — измерение сходимости с оригиналом.
 *
 * Отклонение = 1 − IoU по чернилам на суперсэмплированном растре. Метрика
 * ПЛОЩАДНАЯ, а не «похоже/непохоже»: 3%-порог, за которым система обязана
 * предъявить аргумент, — это 3% несовпавших чернил, число, а не вкус.
 *
 * Дополнительно считается покомпонентная диагностика (лишнее/недостающее и
 * расстояние Хаусдорфа по контуру): без неё «5% отклонения» не отличить —
 * это ровный субпиксельный сдвиг всего силуэта или потерянная деталь.
 */

import { polylinesFromD, pathsFromSvg } from './core/parse.js';

/** Растровое разрешение по умолчанию: 24 канвы × 16 = 384², 147k проб. */
export const SS = 16;

/**
 * Маска чернил как Uint8Array размера (canvas*ss)².
 * @param {{polys:number[][][], fillRule:string}[]} layers
 */
export function rasterize(layers, canvas = 24, ss = SS) {
  const n = canvas * ss;
  const mask = new Uint8Array(n * n);
  for (const layer of layers) {
    const edges = [];
    for (const poly of layer.polys) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        if (a[1] !== b[1]) edges.push([a[0], a[1], b[0], b[1]]);
      }
    }
    if (!edges.length) continue;
    const evenOdd = layer.fillRule === 'evenodd';
    for (let row = 0; row < n; row++) {
      const y = (row + 0.5) / ss;
      const xs = [];
      for (const [x1, y1, x2, y2] of edges) {
        if (y1 > y === y2 > y) continue;
        const t = (y - y1) / (y2 - y1);
        xs.push([x1 + t * (x2 - x1), y2 > y1 ? 1 : -1]);
      }
      if (!xs.length) continue;
      xs.sort((a, b) => a[0] - b[0]);
      let w = 0;
      for (let i = 0; i < xs.length - 1; i++) {
        w += evenOdd ? 1 : xs[i][1];
        const inside = evenOdd ? (i + 1) % 2 === 1 : w !== 0;
        if (!inside) continue;
        let c0 = Math.ceil(xs[i][0] * ss - 0.5);
        let c1 = Math.ceil(xs[i + 1][0] * ss - 0.5);
        if (c0 < 0) c0 = 0;
        if (c1 > n) c1 = n;
        const base = row * n;
        for (let c = c0; c < c1; c++) mask[base + c] = 1;
      }
    }
  }
  return mask;
}

/** Маска из содержимого SVG-файла. */
export function maskFromSvg(svg, canvas = 24, ss = SS, tol = 0.008) {
  const layers = pathsFromSvg(svg).map((p) => ({ polys: polylinesFromD(p.d, tol), fillRule: p.fillRule }));
  return rasterize(layers, canvas, ss);
}

/** Маска из системного пути (всегда nonzero — система не пользуется evenodd). */
export function maskFromPath(path, canvas = 24, ss = SS, tol = 0.008) {
  return rasterize([{ polys: path.flatten(tol), fillRule: 'nonzero' }], canvas, ss);
}

/** Сравнение двух масок. */
export function compare(a, b) {
  if (a.length !== b.length) {
    throw new Error(`сравнение растров разной плотности: ${a.length} против ${b.length}`);
  }
  let inter = 0;
  let union = 0;
  let onlyA = 0;
  let onlyB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (x & y) inter++;
    if (x | y) union++;
    if (x && !y) onlyA++;
    if (!x && y) onlyB++;
  }
  const iou = union ? inter / union : 1;
  return {
    iou,
    deviation: 1 - iou,
    /** Доля чернил оригинала, потерянных генератом. */
    missing: onlyA / Math.max(1, inter + onlyA),
    /** Доля чернил генерата, которых нет в оригинале. */
    extra: onlyB / Math.max(1, inter + onlyB),
    areaRef: inter + onlyA,
    areaGen: inter + onlyB,
  };
}

/**
 * Карта расхождения: связные пятна несовпадения с их габаритами и массой.
 * Отвечает на вопрос «отклонение размазано или собрано в детали».
 */
export function diffClusters(a, b, canvas = 24, ss = SS, minArea = 6) {
  const n = canvas * ss;
  const seen = new Uint8Array(n * n);
  const clusters = [];
  const stack = [];
  for (let i = 0; i < a.length; i++) {
    if (seen[i] || a[i] === b[i]) continue;
    const sign = a[i] ? 'missing' : 'extra';
    let area = 0;
    let x0 = n;
    let y0 = n;
    let x1 = -1;
    let y1 = -1;
    stack.push(i);
    seen[i] = 1;
    while (stack.length) {
      const p = stack.pop();
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
        if (seen[q] || a[q] === b[q]) continue;
        if ((a[q] ? 'missing' : 'extra') !== sign) continue;
        seen[q] = 1;
        stack.push(q);
      }
    }
    if (area >= minArea) {
      clusters.push({
        kind: sign,
        area: area / (ss * ss),
        box: [x0 / ss, y0 / ss, (x1 + 1) / ss, (y1 + 1) / ss],
        /** Максимальная толщина пятна в единицах канвы — «на сколько разъехалось». */
        thickness: Math.min((x1 - x0 + 1) / ss, (y1 - y0 + 1) / ss),
      });
    }
  }
  clusters.sort((p, q) => q.area - p.area);
  return clusters;
}

/**
 * ГЕОМЕТРИЧЕСКОЕ СМЕЩЕНИЕ КОНТУРА — вторая, более честная мера сходимости.
 *
 * Зачем она нужна. Площадная метрика на ШТРИХОВОМ глифе нелинейно жестока:
 * два штриха пера w, разошедшихся на δ по нормали, дают
 *     1 − IoU ≈ 2δ / (2w − δ),
 * то есть при w = 1.8 смещение всего 0.027 ед. (одна восьмидесятая канвы!)
 * уже съедает 3%. Собственный разброс руки внутри ОДНОГО глифа больше:
 * у chevron-down два терминала одного штриха стоят на 0.063 друг от друга.
 * Значит, площадной порог 3% на штрихах меряет не сходимость закона, а
 * дребезг оригинала, и опираться на него одного — самообман.
 *
 * Эта метрика отвечает на вопрос конструктора: «на сколько единиц канвы
 * контур разъехался». Медиана — про систематический сдвиг, p95 — про
 * потерянную деталь. Обе даны и в долях пера: 0.05 при пере 1.8 — это 2.8%
 * пера, то есть попадание, что бы ни говорила площадь.
 */
export function contourOffset(refPolys, genPolys, canvas = 24) {
  const cell = 0.5;
  const grid = new Map();
  const key = (x, y) => `${Math.floor(x / cell)}:${Math.floor(y / cell)}`;
  const push = (p) => {
    const k = key(p[0], p[1]);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  };
  const dense = (polys) => {
    const out = [];
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const a = poly[i];
        const b = poly[(i + 1) % poly.length];
        const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.08));
        for (let j = 0; j < n; j++) out.push([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
      }
    }
    return out;
  };
  const rp = dense(refPolys);
  const gp = dense(genPolys);
  if (!rp.length || !gp.length) return { median: canvas, p95: canvas, mean: canvas };
  for (const p of rp) push(p);
  const nearest = (p) => {
    let best = Infinity;
    for (let ring = 0; ring < 12; ring++) {
      const gx = Math.floor(p[0] / cell);
      const gy = Math.floor(p[1] / cell);
      for (let dx = -ring; dx <= ring; dx++) {
        for (let dy = -ring; dy <= ring; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const b = grid.get(`${gx + dx}:${gy + dy}`);
          if (!b) continue;
          for (const q of b) {
            const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
            if (d < best) best = d;
          }
        }
      }
      if (best <= ring * cell) break;
    }
    return best;
  };
  const ds = gp.map(nearest).filter((d) => Number.isFinite(d)).sort((a, b) => a - b);
  if (!ds.length) return { median: canvas, p95: canvas, mean: canvas };
  return {
    median: ds[Math.floor(ds.length / 2)],
    p95: ds[Math.floor(ds.length * 0.95)],
    mean: ds.reduce((s, d) => s + d, 0) / ds.length,
  };
}

/**
 * Классификация расхождения — то, что пойдёт в колонку «аргументация».
 * Возвращает машинный вердикт; текст к нему пишет декларация глифа.
 */
export function classify(cmp, clusters, offset, pen = 1.8) {
  if (cmp.deviation <= 0.03) return { kind: 'ok', note: '' };
  const top = clusters[0];
  const spread = clusters.reduce((s, c) => s + c.area, 0) || 1e-9;
  const thin = clusters.length > 0 && clusters.every((c) => c.thickness <= 0.25);

  const areaRatio = cmp.areaRef ? Math.abs(cmp.areaGen - cmp.areaRef) / cmp.areaRef : 1;
  if (offset && offset.median <= 0.06 && areaRatio <= 0.12) {
    return {
      kind: 'registration',
      note:
        `контур совпал по форме и разошёлся по посадке: медиана смещения ${offset.median.toFixed(3)} ед ` +
        `(${((offset.median / pen) * 100).toFixed(1)}% пера), p95 ${offset.p95.toFixed(2)} ед. ` +
        `На пере ${pen} площадная метрика даёт 1−IoU ≈ 2δ/(2w−δ), поэтому ${cmp.deviation > 0.03 ? (cmp.deviation * 100).toFixed(1) + '%' : ''} площади — ` +
        'следствие дребезга оригинала, а не расхождения конструкции',
    };
  }
  if (thin) {
    return { kind: 'subpixel', note: 'расхождение — тонкая кайма вдоль всего контура (дребезг руки), кластеров-деталей нет' };
  }
  if (top && top.area / spread > 0.6) {
    return {
      kind: 'feature',
      note: `один кластер несёт ${Math.round((top.area / spread) * 100)}% расхождения, габарит ${top.box.map((v) => v.toFixed(1)).join('..')}; ${top.kind === 'missing' ? 'деталь оригинала не построена' : 'генерат несёт деталь, которой в оригинале нет'}`,
    };
  }
  return {
    kind: 'distributed',
    note: `${clusters.length} кластеров расхождения, суммарно ${spread.toFixed(2)} ед²${offset ? `, медиана смещения ${offset.median.toFixed(3)} ед` : ''}`,
  };
}
