/**
 * system/fit.js — подгон параметров конструкции к оригиналу.
 *
 * ВАЖНО, ЧЕМ ЭТО НЕ ЯВЛЯЕТСЯ. Подгон не рисует иконку и не попадает в
 * поставку. Он отвечает на один вопрос: «какие числа рука имела в виду?» —
 * чтобы затем эти числа были ЗАМЕНЕНЫ выводом из токенов, а цена замены
 * измерена. Порядок работы жёсткий:
 *
 *   1. подогнать свободные параметры семейства к оригиналу (этот файл);
 *   2. посмотреть на подогнанные числа и найти закон, который их объясняет;
 *   3. подставить закон и измерить, во сколько обошлась замена;
 *   4. если замена дороже 3% — закон неверен либо оригинал содержит дребезг,
 *      и то, и другое требует письменного аргумента в превью.
 *
 * Числа из шага 1 в декларации НЕ ПОПАДАЮТ. Иначе это не система, а обводка
 * чужого рисунка с лишними шагами.
 */

import { maskFromPath, compare } from './metrics.js';

/**
 * Симплекс Нелдера–Мида. Производных нет (метрика растровая и ступенчатая),
 * потому симплекс, а не градиент.
 *
 * @param {(p:number[])=>number} cost
 * @param {number[]} init
 * @param {number[]} step
 */
export function nelderMead(cost, init, step, { iters = 400, tol = 1e-5 } = {}) {
  const n = init.length;
  const pts = [init.slice()];
  for (let i = 0; i < n; i++) {
    const p = init.slice();
    p[i] += step[i];
    pts.push(p);
  }
  let vals = pts.map(cost);
  const order = () => {
    const idx = pts.map((_, i) => i).sort((a, b) => vals[a] - vals[b]);
    const p2 = idx.map((i) => pts[i]);
    const v2v = idx.map((i) => vals[i]);
    for (let i = 0; i <= n; i++) {
      pts[i] = p2[i];
      vals[i] = v2v[i];
    }
  };
  order();
  for (let it = 0; it < iters; it++) {
    if (Math.abs(vals[n] - vals[0]) < tol) break;
    const centroid = new Array(n).fill(0);
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) centroid[j] += pts[i][j] / n;
    const worst = pts[n];
    const refl = centroid.map((c, j) => c + (c - worst[j]));
    const fr = cost(refl);
    if (fr < vals[0]) {
      const exp = centroid.map((c, j) => c + 2 * (c - worst[j]));
      const fe = cost(exp);
      pts[n] = fe < fr ? exp : refl;
      vals[n] = Math.min(fe, fr);
    } else if (fr < vals[n - 1]) {
      pts[n] = refl;
      vals[n] = fr;
    } else {
      const con = centroid.map((c, j) => c + 0.5 * (worst[j] - c));
      const fc = cost(con);
      if (fc < vals[n]) {
        pts[n] = con;
        vals[n] = fc;
      } else {
        for (let i = 1; i <= n; i++) {
          pts[i] = pts[i].map((v, j) => pts[0][j] + 0.5 * (v - pts[0][j]));
          vals[i] = cost(pts[i]);
        }
      }
    }
    order();
  }
  return { params: pts[0], cost: vals[0] };
}

/**
 * Подгон построителя к эталонной маске.
 *
 * @param {Uint8Array} refMask
 * @param {(p:number[])=>import('./core/path.js').Path} build
 * @param {number[]} init
 * @param {number[]} step
 */
export function fitToMask(refMask, build, init, step, opt = {}) {
  const canvas = opt.canvas ?? 24;
  // Разрешение берётся ИЗ САМОЙ маски: сравнивать растры разной плотности
  // бессмысленно, а молча — опасно (метрика становится константой и подгон
  // «сходится» в точку старта, отчитавшись об успехе).
  const ss = Math.round(Math.sqrt(refMask.length) / canvas);
  const cost = (p) => {
    let path;
    try {
      path = build(p);
    } catch {
      return 1;
    }
    if (!path || path.isEmpty()) return 1;
    return compare(refMask, maskFromPath(path, canvas, ss, 0.02)).deviation;
  };
  const best = nelderMead(cost, init, step, opt);
  return { params: best.params, deviation: best.cost };
}

/**
 * Цена подстановки закона: насколько выросло отклонение, когда подогнанные
 * числа заменили выводом из токенов. Это и есть колонка «аргументация».
 */
export function lawCost(refMask, fittedPath, lawPath, canvas = 24, ss = 16) {
  const fit = compare(refMask, maskFromPath(fittedPath, canvas, ss));
  const law = compare(refMask, maskFromPath(lawPath, canvas, ss));
  return {
    fitDeviation: fit.deviation,
    lawDeviation: law.deviation,
    price: law.deviation - fit.deviation,
  };
}
