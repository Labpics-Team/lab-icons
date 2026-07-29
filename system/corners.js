/**
 * system/corners.js — СПЕКТР УГЛОВ.
 *
 * «Просто считать углы» ловит только половину беды. Угол характеризуется не
 * фактом своего существования, а тремя числами, и подменить можно любое из них,
 * не сдвинув площадь:
 *
 *   ПОВОРОТ Θ   на сколько градусов разворачивается касательная. Это про
 *               скелет: 90° у прямоугольника, ~50° у вершины клина play.
 *   РАДИУС  R   насколько крупно скруглено. R = L/Θ, где L — длина дуговой
 *               вставки. Устойчив к тому, ЧЕМ рисовали: дугой, кубикой или
 *               тремя дугами подряд — R получится один и тот же.
 *   МЯГКОСТЬ ε  R / Rmin. Чистая окружная галтель даёт ровно 1. Скругление с
 *               плавным входом (ζ-сглаживание, corner smoothing) размазывает
 *               поворот: по краям кривизна меньше, в середине больше, и ε
 *               уходит за 1.2…1.6.
 *
 * Именно ε отвечает на «скругление могло бы быть угловатым». Два скругления с
 * одинаковыми Θ и R выглядят по-разному: голая дуга втыкается в прямую с
 * разрывом кривизны, сглаженная — входит незаметно. Площадь между ними
 * отличается на сотые доли процента, глаз отличает мгновенно.
 *
 * Мера снимается с ГЕОМЕТРИИ, а не с записи. У руки один и тот же угол бывает
 * записан как `a3.6/a3.3/a3.6`, как `c…q…` и как `A2 2` — спектр сводит все три
 * записи к одной тройке чисел, поэтому оригинал и генерат сравнимы напрямую.
 */

import { edgesOfD, edgesOfPath, tangent, curvature, pointAt, edgeLen } from './contour.js';
import { v2 } from './core/num.js';

const DEG = 180 / Math.PI;
const TAU = Math.PI * 2;

/**
 * Кривизна, выше которой участок контура считается УГЛОВЫМ. 0.2 = радиус 5:
 * на канве 24 всё, что круче пятёрки, — скругление угла, а не изгиб тела.
 * Кольца корпуса (R = 9.5…11, k = 0.09…0.105) под порог не попадают.
 */
const K_CORNER = 0.2;
/** Кривизна, ниже которой участок считается прямым (радиус > 16). */
const K_FLAT = 0.02;
/** Доля пика, до которой угловая область разрастается в стороны. */
const TAIL = 0.12;
/** Поворот в узле, ниже которого узел не считается углом вовсе. */
const MIN_TURN_DEG = 12;
/** Поворот, выше которого дуга — это колпачок пера, а не угол контура. */
const CAP_DEG = 168;
/** Шаг выборки по длине дуги. */
const DS = 0.015;
/** Излом на стыке, выше которого это заведомо угол, а не шум записи. */
const HARD_IMP = 8;
/** Пики ближе этого расстояния по дуге — один составной угол. */
const GROUP = 0.9;
/** Столько выборок подряд без спада кривизны означают, что угол кончился. */
const PLATEAU_N = Math.max(2, Math.ceil(0.12 / DS));

/** Суммарный поворот касательной вдоль ребра, в градусах. */
function edgeTurn(e) {
  if (e.kind === 'line') return 0;
  if (e.kind === 'arc') return Math.abs(e.a1 - e.a0) * DEG;
  let sum = 0;
  let prev = tangent(e, 0);
  for (let i = 1; i <= 16; i++) {
    const t = tangent(e, i / 16);
    sum += Math.acos(Math.max(-1, Math.min(1, v2.dot(prev, t)))) * DEG;
    prev = t;
  }
  return sum;
}

/** Наибольшая |кривизна| на ребре. */
function edgeKMax(e) {
  if (e.kind === 'line') return 0;
  if (e.kind === 'arc') return 1 / e.r;
  let k = 0;
  for (let i = 0; i <= 16; i++) k = Math.max(k, Math.abs(curvature(e, i / 16)));
  return k;
}

/** Скачок касательной между концом a и началом b, в градусах (со знаком поворота). */
function jointTurn(a, b) {
  const ta = tangent(a, 1);
  const tb = tangent(b, 0);
  const dot = Math.max(-1, Math.min(1, v2.dot(ta, tb)));
  return { deg: Math.acos(dot) * DEG, sign: Math.sign(v2.cross(ta, tb)) || 1 };
}

/** Точка пересечения прямых, заданных точкой и направлением; null если параллельны. */
function meet(p1, d1, p2, d2) {
  const den = v2.cross(d1, d2);
  if (Math.abs(den) < 1e-9) return null;
  const t = v2.cross(v2.sub(p2, p1), d2) / den;
  return v2.mad(p1, d1, t);
}

/**
 * Выборка замкнутого подпути по длине дуги.
 *
 * Оба конца каждого ребра попадают в список, поэтому на стыке рёбер образуется
 * пара совпадающих точек с разными касательными — это и есть импульс поворота.
 * Так излом (голый угол) и скругление живут в одном представлении: у излома
 * поворот сосредоточен в нуле длины, у скругления размазан по дуге.
 */
export function sampleSub(sub) {
  const es = sub.edges.filter((e) => edgeLen(e) > 1e-7);
  const pts = [];
  for (const e of es) {
    const L = edgeLen(e);
    const m = Math.max(1, Math.ceil(L / DS));
    for (let q = 0; q <= m; q++) {
      const u = q / m;
      // ds — длина ИНТЕРВАЛА ДО СЛЕДУЮЩЕЙ точки; у последней точки ребра
      // следующая точка совпадающая (стык соседнего ребра), длина нулевая
      const k = curvature(e, u);
      pts.push({ p: pointAt(e, u), t: tangent(e, u), k: Math.abs(k), sk: k, ds: 0, dturn: 0, imp: 0, simp: 0 });
    }
    /**
     * Длина и поворот интервала берутся ГЕОМЕТРИЧЕСКИ — хордой и углом между
     * касательными, а не как k·Δt·L. У кубики скорость |r'(t)| непостоянна,
     * поэтому равномерный шаг по параметру ≠ равномерный шаг по длине, и
     * интеграл k по «средней» длине завышает поворот тем сильнее, чем сильнее
     * кубика разогнана. На ζ-сглаженном квадрате это давало 419° вместо 360°:
     * прибор врал, а не фигура.
     */
    const base = pts.length - (m + 1);
    for (let q = 0; q < m; q++) {
      const a = pts[base + q];
      const b = pts[base + q + 1];
      a.ds = v2.dist(a.p, b.p);
      a.dturn = Math.atan2(v2.cross(a.t, b.t), v2.dot(a.t, b.t)) * DEG;
    }
  }
  const n = pts.length;
  if (!n) return pts;
  // импульс поворота на совпадающей паре точек (стык рёбер и замыкание).
  // Знак обязателен: вогнутый узел поворачивает касательную В ДРУГУЮ сторону,
  // и без знака сумма по контуру перестаёт быть 360°.
  for (let i = 0; i < n; i++) {
    if (pts[i].ds !== 0) continue;
    const nxt = pts[(i + 1) % n];
    const dot = Math.max(-1, Math.min(1, v2.dot(pts[i].t, nxt.t)));
    const a = Math.acos(dot) * DEG;
    nxt.imp = a;
    nxt.simp = a * (Math.sign(v2.cross(pts[i].t, nxt.t)) || 1);
  }
  // кумулятивная длина дуги — по ней меряется близость пиков
  let s = 0;
  for (const q of pts) {
    q.s = s;
    s += q.ds;
  }
  pts.total = s;
  return pts;
}

/**
 * Спектр углов одного контура — по КРИВИЗНЕ, а не по записи.
 *
 * Угловая область строится вокруг локального пика |k|: она разрастается в обе
 * стороны, пока кривизна не упадёт до TAIL от пика (или до K_FLAT). Поэтому
 * мягкие хвосты ζ-сглаживания попадают внутрь области, и мягкость ε = R/Rmin
 * их видит. У голой галтели хвостов нет — ε выходит ровно 1.
 *
 * @returns {{at:number[], turn:number, r:number, ease:number, kind:string}[]}
 */
export function spectrum(subs) {
  const out = [];
  let sub_i = -1;
  for (const sub of subs) {
    sub_i++;
    const mark = out.length;
    const pts = sampleSub(sub);
    const n = pts.length;
    if (n < 3) continue;

    const at = (i) => pts[((i % n) + n) % n];
    // «горячая» точка: излом на стыке либо кривизна выше углового порога
    const hot = (i) => at(i).imp > HARD_IMP || at(i).k > K_CORNER;
    const seeds = [];
    for (let i = 0; i < n; i++) if (hot(i)) seeds.push(i);
    if (!seeds.length) {
      // ни одного угла: гладкий замкнутый контур — кольцо или овал
      const L = pts.total;
      const kAvg = pts.reduce((s, q) => s + Math.abs(q.dturn), 0) / DEG / Math.max(L, 1e-9);
      out.push({ at: pts[0].p.map(r2), turn: 360, r: r2(kAvg > 1e-6 ? 1 / kAvg : 0), ease: 1, kind: 'кольцо' });
      continue;
    }

    // Сдвинуть начало отсчёта в самое «холодное» место, чтобы ни одна угловая
    // область не разрывалась границей массива.
    let cold = 0;
    for (let i = 0; i < n; i++) {
      const q = at(i);
      const c = q.k + q.imp;
      if (c < at(cold).k + at(cold).imp) cold = i;
    }
    const gap = (a, b) => {
      const d = Math.abs(at(b).s - at(a).s);
      return Math.min(d, pts.total - d);
    };

    // Кластеризация: составное скругление руки (три дуги подряд, `c…q…`)
    // даёт несколько пиков на расстоянии долей единицы — это ОДИН угол.
    const ord = seeds.map((i) => (i - cold + n) % n).sort((a, b) => a - b);
    const clusters = [];
    for (const o of ord) {
      const last = clusters[clusters.length - 1];
      if (last && gap((last[last.length - 1] + cold) % n, (o + cold) % n) <= GROUP) last.push(o);
      else clusters.push([o]);
    }

    // Области не имеют права накладываться: иначе один и тот же поворот
    // попадёт в два угла, и сумма по контуру уедет за положенные 360°.
    const regions = [];
    const m = clusters.length;
    for (let c = 0; c < m; c++) {
      const cl = clusters[c];
      let peak = 0;
      let hard = false;
      for (const o of cl) {
        peak = Math.max(peak, at(o + cold).k);
        if (at(o + cold).imp > HARD_IMP) hard = true;
      }
      const cut = hard ? K_FLAT : Math.max(K_FLAT, TAIL * peak);
      const prev = clusters[(c - 1 + m) % m];
      const next = clusters[(c + 1) % m];
      const floor = m === 1 ? cl[0] - (n - 2) : prev[prev.length - 1] + (c === 0 ? -n : 0) + 1;
      const ceil = m === 1 ? cl[cl.length - 1] + (n - 2) : next[0] + (c === m - 1 ? n : 0) - 1;

      /**
       * Разрастание области от края КЛАСТЕРА наружу. Ядро угла (всё, что круче
       * K_CORNER) кластер уже накрыл, наружу добираются только хвосты.
       *
       * Хвост кончается там, где кривизна ПЕРЕСТАЁТ СПАДАТЬ. Порогом это не
       * ловится: галтель R=3 рядом с телом R=9.5 даёт k 0.33 → 0.105, и любой
       * абсолютный порог ниже 0.105 утащит область на всё тело, а выше —
       * обрежет хвосты у сглаженных углов. Спад же кончается ровно на стыке
       * скругления с телом, независимо от их радиусов.
       */
      const grow = (from, dir, limit) => {
        let runMin = at(from + cold).k;
        let flat = 0;
        let edge = from;
        for (let i = from; dir > 0 ? i < limit : i > limit; i += dir) {
          const q = at(i + dir + cold);
          if (q.imp > HARD_IMP) break;
          if (q.k <= cut) {
            edge = i + dir;
            break;
          }
          if (q.k >= runMin * 0.985) {
            if (++flat >= PLATEAU_N) break;
          } else {
            flat = 0;
            edge = i + dir;
          }
          runMin = Math.min(runMin, q.k);
        }
        return edge;
      };
      const lo = grow(cl[0], -1, floor);
      const hi = grow(cl[cl.length - 1], +1, ceil);
      regions.push([lo + cold, hi + cold]);
    }

    for (const [lo, hi] of regions) {
      let L = 0;
      let S = 0;
      let kMax = 0;
      for (let i = lo; i <= hi; i++) {
        const q = at(i);
        if (i > lo) S += q.simp;
        if (i < hi) {
          L += q.ds;
          S += q.dturn;
        }
        kMax = Math.max(kMax, q.k);
      }
      S += at(lo).simp;
      const Θ = Math.abs(S);
      if (Θ < MIN_TURN_DEG) continue;
      const R = Θ > 0 ? L / (Θ / DEG) : 0;
      const rMin = kMax > 1e-9 ? 1 / kMax : R;
      const before = at(lo - 1);
      const after = at(hi + 1);
      const v = meet(before.p, before.t, after.p, after.t) ?? v2.mul(v2.add(before.p, after.p), 0.5);
      const far = v2.dist(v, at(Math.round((lo + hi) / 2)).p);
      const vertex = far < 6 ? v : at(Math.round((lo + hi) / 2)).p;
      out.push({
        at: vertex.map(r2),
        turn: r2(Θ),
        r: r2(R),
        ease: r2(R > 1e-6 ? Math.max(1, R / Math.max(rMin, 1e-6)) : 1),
        convex: S >= 0,
        kind: Θ > CAP_DEG ? 'колпачок' : R < 0.06 ? 'острый' : 'скруглённый',
        sub: sub_i,
      });
    }

    /**
     * ИНВАРИАНТ ГАУССА. У простого замкнутого контура полный поворот
     * касательной ровно ±360° (знак — направление обхода: внешний контур и
     * дырка обходятся в разные стороны). Считается он по ВСЕМУ контуру, а не
     * по одним углам: гладкое тело тоже поворачивает.
     *
     * Инструмент, который не умеет сказать «я не знаю», хуже отсутствия
     * инструмента: он выдаёт выдумку за измерение. Поэтому, если контур не
     * даёт ±360°, все снятые с него углы помечаются как недостоверные.
     */
    let total = 0;
    for (let i = 0; i < n; i++) {
      total += pts[i].simp + pts[i].dturn;
    }
    if (Math.abs(Math.abs(total) - 360) > 12) for (const c of out.slice(mark)) c.doubt = r2(total);
  }
  return out;
}

const r2 = (x) => Math.round(x * 100) / 100;

/** Спектр по чужому d. */
export const spectrumOfD = (d) => spectrum(edgesOfD(d));
/**
 * Спектр по НЕСКОЛЬКИМ `d` одного файла — по одному на каждый `<path>`.
 *
 * Склеивать `d` разных элементов в одну строку нельзя: относительный `m`
 * первой командой отсчитывается от НАЧАЛА КООРДИНАТ, а после склейки попадает
 * в хвост предыдущего пути и уезжает вместе с ним. На корпусе это ловится
 * сразу: у `headphone_filled` два подпути уходили в (35…42, 24…34) — за
 * пределы канвы 24, — и спектр руки в этих местах был выдумкой прибора.
 */
export const spectrumOfDs = (ds) => spectrum(ds.flatMap((d) => edgesOfD(d)));
/** Спектр по системному пути. */
export const spectrumOfPath = (p) => spectrum(edgesOfPath(p));

/* ── СИЛУЭТ: сверка того, что НАРИСОВАНО, а не того, что записано ─────────
 *
 * Спектр снимается с ПОДПУТЕЙ, а глаз видит их ЗАЛИВКУ. Пока фигура — один
 * контур, это одно и то же; как только в дело идёт nonzero, расходится:
 *
 *   • система кладёт клин на древко и полагается на заливку — у руки в месте
 *     стыка два вогнутых узла, у системы в этом месте узла нет ни одного,
 *     хотя силуэт совпадает до пикселя;
 *   • угол одного подпути уходит ПОД чернила другого и не виден вовсе
 *     (у `turn-off` дуговая полоса ломается на 90° ровно под колпачком-диском,
 *     который к ней касателен: на экране — круглый терминал);
 *   • рука пишет скругление составом `a3.6/a3.3/a3.6`, система — одной дугой.
 *
 * Во всех трёх случаях РИСУНОК один, а записи разные, и «угол потерян» —
 * ложь прибора. Отличить их от настоящего дефекта можно только замером самого
 * силуэта, и он здесь такой: доля окружности радиуса ρ вокруг узла, покрытая
 * чернилами. Мера не зависит от того, чем и в сколько приёмов нарисовано:
 * у гладкого места ровно половина, у выпуклого угла Θ — (180−Θ)/360, у
 * вогнутого — (180+Θ)/360. Сравниваются не доли, а сами кольца поточечно:
 * так рядом стоящая деталь не сойдёт за совпадение.
 */

/** Радиусы колец: мелкое ловит остроту, крупное — скелет. */
const RING_R = [0.15, 0.35, 0.7];
/** Отсчётов по кольцу; 120 = шаг 3°. */
const RING_K = 120;
/** Доля кольца, разошедшаяся сверх которой считается разным рисунком (6° ≈ 2 отсчёта). */
const RING_TOL = 0.05;
/**
 * Допуск ПОСАДКИ узла. Рука дребезжит сама: у `chevron-down` два терминала
 * ОДНОГО штриха стоят на 0.063 друг от друга, а вердикт `registration` в
 * metrics.js считает сходимостью медиану смещения 0.06. Взято вдвое —
 * смещение узла до 0.12 ед (6.7% пера) не является потерей угла, это посадка,
 * и меряет её площадная метрика, а не спектр.
 */
const RING_FIT = 0.12;

/** Плоские отрезки силуэта: ломаные ВСЕХ подпутей фигуры. */
export function figureSegs(subs, step = 0.04) {
  const segs = [];
  for (const sub of subs) {
    const pts = [];
    for (const e of sub.edges) {
      const L = edgeLen(e);
      if (L < 1e-7) continue;
      const m = Math.max(2, Math.ceil(L / step));
      for (let q = 0; q < m; q++) pts.push(pointAt(e, q / m));
    }
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      segs.push([a[0], a[1], b[0], b[1]]);
    }
  }
  return segs;
}

/** Намотка nonzero в точке — лучом вправо по всей фигуре. */
function windingAt(segs, x, y) {
  let w = 0;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (s[1] <= y) {
      if (s[3] > y && (s[2] - s[0]) * (y - s[1]) - (x - s[0]) * (s[3] - s[1]) > 0) w++;
    } else if (s[3] <= y && (s[2] - s[0]) * (y - s[1]) - (x - s[0]) * (s[3] - s[1]) < 0) w--;
  }
  return w;
}

/** Отрезки, попадающие в круг радиуса rad вокруг c (для локального счёта). */
function nearSegs(segs, c, rad) {
  const out = [];
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    if (Math.min(s[0], s[2]) > c[0] + rad || Math.max(s[0], s[2]) < c[0] - rad) continue;
    if (Math.min(s[1], s[3]) > c[1] + rad || Math.max(s[1], s[3]) < c[1] - rad) continue;
    out.push(s);
  }
  return out;
}

/**
 * Приращение намотки на пути из c в q. Считается по ЛОКАЛЬНЫМ отрезкам: луч
 * в бесконечность требует всей фигуры, короткий отрезок — только соседей.
 */
function windingDelta(local, cx, cy, qx, qy) {
  const rx = qx - cx;
  const ry = qy - cy;
  let d = 0;
  for (let i = 0; i < local.length; i++) {
    const s = local[i];
    const sx = s[2] - s[0];
    const sy = s[3] - s[1];
    const den = rx * sy - ry * sx;
    if (den === 0) continue;
    const ax = s[0] - cx;
    const ay = s[1] - cy;
    const t = (ax * sy - ay * sx) / den;
    if (t < 0 || t >= 1) continue;
    const u = (ax * ry - ay * rx) / den;
    if (u < 0 || u >= 1) continue;
    d += den > 0 ? -1 : 1;
  }
  return d;
}

/** Расстояние от точки до ближайшего из отрезков. */
function distToSegs(segs, x, y) {
  let best = Infinity;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const vx = s[2] - s[0];
    const vy = s[3] - s[1];
    const l2 = vx * vx + vy * vy;
    let t = l2 ? ((x - s[0]) * vx + (y - s[1]) * vy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = (s[0] + t * vx - x) ** 2 + (s[1] + t * vy - y) ** 2;
    if (d < best) best = d;
  }
  return Math.sqrt(best);
}

/**
 * Битовая карта покрытия чернилами окружности радиуса rho вокруг c.
 *
 * Намотка считается ОДИН раз лучом в бесконечность — в якорном отсчёте, — а
 * дальше переносится по кольцу локальным счётом пересечений хорды. Якорем
 * берётся отсчёт, отстоящий от контура ДАЛЬШЕ прочих: на самом контуре намотка
 * не определена, а ошибка в якоре перевернула бы всё кольцо целиком. Центр
 * кольца якорем быть не может по этой же причине — он лежит на контуре всегда.
 */
function ringMask(all, local, cx, cy, rho) {
  const px = new Float64Array(RING_K);
  const py = new Float64Array(RING_K);
  for (let i = 0; i < RING_K; i++) {
    const a = (i / RING_K) * TAU;
    px[i] = cx + rho * Math.cos(a);
    py[i] = cy + rho * Math.sin(a);
  }
  let anchor = 0;
  let far = -1;
  for (let i = 0; i < RING_K; i += 4) {
    const d = distToSegs(local, px[i], py[i]);
    if (d > far) {
      far = d;
      anchor = i;
    }
  }
  const b = new Uint8Array(RING_K);
  let w = windingAt(all, px[anchor], py[anchor]);
  b[anchor] = w !== 0 ? 1 : 0;
  for (let k = 1; k < RING_K; k++) {
    const i = (anchor + k) % RING_K;
    const j = (anchor + k - 1) % RING_K;
    w += windingDelta(local, px[j], py[j], px[i], py[i]);
    b[i] = w !== 0 ? 1 : 0;
  }
  return b;
}

const ringXor = (a, b) => {
  let n = 0;
  for (let i = 0; i < RING_K; i++) if (a[i] !== b[i]) n++;
  return n / RING_K;
};

/**
 * ОДИН ЛИ РИСУНОК в точке p у двух фигур.
 *
 * Возвращает наименьшее расхождение колец, достижимое сдвигом второй фигуры не
 * дальше RING_FIT. Сдвиг обязателен: без него посадочный дребезг руки в сотые
 * доли единицы читался бы как потерянный угол — на кольце радиуса 0.15 сдвиг
 * 0.1 съедает треть окружности.
 */
export function silhouetteMismatch(aSegs, bSegs, p) {
  const rmax = RING_R[RING_R.length - 1];
  const aLocal = nearSegs(aSegs, p, rmax + 0.05);
  const bLocal = nearSegs(bSegs, p, rmax + RING_FIT + 0.05);
  const A = RING_R.map((r) => ringMask(aSegs, aLocal, p[0], p[1], r));
  const at = (dx, dy) => {
    let w = 0;
    for (let k = 0; k < RING_R.length; k++) {
      w = Math.max(w, ringXor(A[k], ringMask(bSegs, bLocal, p[0] + dx, p[1] + dy, RING_R[k])));
      if (w > 0.5) break;
    }
    return w;
  };
  let best = at(0, 0);
  // Посадка ищется по двум кольцам смещений внутри круга RING_FIT: 16 проб
  // вместо сетки — расхождение по сдвигу гладкое, минимум не прячется.
  for (const rad of [RING_FIT / 2, RING_FIT]) {
    if (best <= RING_TOL) break;
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * TAU;
      const w = at(rad * Math.cos(a), rad * Math.sin(a));
      if (w < best) best = w;
      if (best <= RING_TOL) break;
    }
  }
  return best;
}

/** Ближайшая к p точка НА ломаных фигуры: вершина угла — экстраполяция и может висеть в воздухе. */
function snapToSegs(segs, p) {
  let bd = Infinity;
  let bp = p;
  for (let i = 0; i < segs.length; i++) {
    const s = segs[i];
    const vx = s[2] - s[0];
    const vy = s[3] - s[1];
    const l2 = vx * vx + vy * vy;
    let t = l2 ? ((p[0] - s[0]) * vx + (p[1] - s[1]) * vy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const qx = s[0] + t * vx;
    const qy = s[1] + t * vy;
    const d = (qx - p[0]) ** 2 + (qy - p[1]) ** 2;
    if (d < bd) {
      bd = d;
      bp = [qx, qy];
    }
  }
  return bp;
}

/**
 * СВЕРКА СПЕКТРОВ. Углы сопоставляются по положению вершины; вершина —
 * пересечение прилежащих прямых, она не зависит от радиуса скругления, поэтому
 * пара «рука/генерат» находится даже когда радиусы разошлись вдвое.
 *
 * Непарные углы (потерянные и лишние) перед тем, как стать претензией,
 * ПРОВЕРЯЮТСЯ ПО СИЛУЭТУ — если фигуры в этом месте нарисованы одинаково,
 * разошлись не они, а записи, и претензии нет. Для проверки нужны сами
 * фигуры: `o.refSubs`/`o.genSubs` (нормализованные подпути из contour.js).
 * Без них сверка работает как раньше, но честно сообщает, что силуэт не
 * смотрела — счётчик `unchecked`.
 */
export function cornerDiff(ref, gen, o = {}) {
  const tol = o.tol ?? 1.6;
  const used = new Set();
  const pairs = [];
  // Кольцо — не угол, а его ОТСУТСТВИЕ: `at` у него равен первому отсчёту
  // гладкого контура, то есть месту, с которого автор начал писать путь.
  // Сопоставлять кольца по положению — сравнивать записи, а не фигуры.
  const skip = (c) => c.kind === 'колпачок' || c.kind === 'кольцо';
  for (const a of ref) {
    if (skip(a)) continue;
    let best = -1;
    let bd = tol;
    for (let i = 0; i < gen.length; i++) {
      if (used.has(i) || skip(gen[i])) continue;
      const d = v2.dist(a.at, gen[i].at);
      if (d < bd) {
        bd = d;
        best = i;
      }
    }
    if (best >= 0) {
      used.add(best);
      pairs.push({ ref: a, gen: gen[best], dist: r2(bd) });
    } else pairs.push({ ref: a, gen: null, dist: null });
  }
  for (let i = 0; i < gen.length; i++) {
    if (!used.has(i) && !skip(gen[i])) pairs.push({ ref: null, gen: gen[i], dist: null });
  }

  const issues = [];
  const doubt = [...ref, ...gen].filter((c) => c.doubt);
  if (doubt.length) {
    issues.push(`НЕДОСТОВЕРНО: разбиение контура даёт ${[...new Set(doubt.map((c) => c.doubt))].join('/')}° вместо 360° — по этому глифу спектру верить нельзя`);
    return { pairs, issues, unreliable: true };
  }

  const refSegs = o.refSubs ? figureSegs(o.refSubs) : null;
  const genSegs = o.genSubs ? figureSegs(o.genSubs) : null;
  let sameDraw = 0;
  let unchecked = 0;
  /** Нарисовано ли это место одинаково: true — претензии нет. */
  const drawnAlike = (c, mine, theirs) => {
    if (!mine || !theirs) {
      unchecked++;
      return false;
    }
    const m = silhouetteMismatch(mine, theirs, snapToSegs(mine, c.at));
    if (m <= RING_TOL) {
      sameDraw++;
      c.sameDraw = r2(m);
      return true;
    }
    c.silh = r2(m);
    return false;
  };

  for (const p of pairs) {
    const at = (p.ref ?? p.gen).at.join(',');
    if (!p.gen) {
      if (p.ref.turn >= 20 && !drawnAlike(p.ref, refSegs, genSegs)) {
        issues.push(`УГОЛ ПОТЕРЯН (${at}): у руки поворот ${p.ref.turn}° R=${p.ref.r}, у меня в этом месте угла нет`);
      }
      continue;
    }
    if (!p.ref) {
      if (p.gen.turn >= 20 && !drawnAlike(p.gen, genSegs, refSegs)) {
        issues.push(`УГОЛ ЛИШНИЙ (${at}): поворот ${p.gen.turn}° R=${p.gen.r}, у руки его нет`);
      }
      continue;
    }
    const a = p.ref;
    const b = p.gen;
    if (a.r >= 0.2 && b.r < 0.08) {
      issues.push(`ОСТРО (${at}): рука скруглила R=${a.r}, у меня голый угол — это и есть «угловато при сходящейся площади»`);
      continue;
    }
    if (a.r >= 0.15 && b.r >= 0.05) {
      const k = b.r / a.r;
      if (k < 0.62) issues.push(`КРУЧЕ (${at}): R=${b.r} против ${a.r} у руки (×${r2(k)}) — скругление мельче, угол читается острее`);
      else if (k > 1.7) issues.push(`ПОЛОЖЕ (${at}): R=${b.r} против ${a.r} у руки (×${r2(k)}) — скругление крупнее, форма расплылась`);
    }
    if (a.ease >= 1.25 && b.ease < 1.1) {
      issues.push(`БЕЗ СГЛАЖИВАНИЯ (${at}): у руки мягкость ${a.ease}, у меня ${b.ease} — голая дуга встык вместо плавного входа`);
    }
    /**
     * ПОВОРОТ — утверждение о СКЕЛЕТЕ, и только оно судится силуэтом.
     *
     * Если чернила вокруг узла лежат одинаково, скелет там тот же, а разница в
     * градусах есть разница РАЗБИЕНИЯ: угловая область кончается там, где
     * кривизна перестала спадать, и у двух записей одной формы эта граница
     * стоит по-разному. Проверка снимает 76 претензий из 81.
     *
     * Радиус и мягкость таким гейтом судить НЕЛЬЗЯ, и они через него не идут.
     * Голая дуга против плавного входа отличается сотыми долями процента
     * чернил — то есть силуэтом не отличается вовсе. Ради этих сотых прибор и
     * написан; закрыть их силуэтом значило бы отменить его смысл.
     */
    if (Math.abs(a.turn - b.turn) > 9 && Math.min(a.turn, b.turn) > 20 && !drawnAlike(a, refSegs, genSegs)) {
      issues.push(`ПОВОРОТ (${at}): ${b.turn}° против ${a.turn}° — расходится скелет, а не скругление`);
    }
  }
  return { pairs, issues, sameDraw, unchecked };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;
  const show = argv.includes('--show');
  const { readFileSync, existsSync } = await import('node:fs');
  const { pathsFromSvg } = await import('./core/parse.js');
  await import('./glyphs/index.js');
  const { glyphs, buildGlyph } = await import('./registry.js');
  const { ROOT } = await import('./build.js');

  const fmt = (c) => `${c.kind} Θ=${String(c.turn).padStart(6)}° R=${String(c.r).padStart(5)} ε=${c.ease}`;
  let bad = 0;
  let seen = 0;
  let alike = 0;
  for (const name of [...glyphs.keys()].sort()) {
    if (only && !only.has(name)) continue;
    for (const variant of ['outline', 'filled']) {
      const file = `${ROOT}/reference/${variant === 'filled' ? 'Filled' : 'Outline'}/${name}${variant === 'filled' ? '_filled' : ''}.svg`;
      if (!existsSync(file)) continue;
      const def = glyphs.get(name);
      // каждый <path> разбирается ОТДЕЛЬНО: склейка d ломает относительный `m`
      const refSubs = pathsFromSvg(readFileSync(file, 'utf8')).flatMap((p) => edgesOfD(p.d));
      let genPath;
      try {
        genPath = buildGlyph(name, variant, def.refAxes ? { axes: def.refAxes } : {});
      } catch {
        continue;
      }
      seen++;
      const genSubs = edgesOfPath(genPath);
      const R = spectrum(refSubs);
      const G = spectrum(genSubs);
      const d = cornerDiff(R, G, { refSubs, genSubs });
      alike += d.sameDraw ?? 0;
      if (d.issues.length || show) {
        if (d.issues.length) bad++;
        console.log(`\n${name}/${variant}`);
        for (const q of d.issues) console.log('  • ' + q);
        if (show) {
          for (const p of d.pairs) {
            console.log(`    ${p.ref ? fmt(p.ref) : '—'.padEnd(34)}  |  ${p.gen ? fmt(p.gen) : '—'}`);
          }
        }
      }
    }
  }
  console.log(`\nуглы: ${bad} из ${seen} вариантов расходятся по спектру углов`);
  console.log(`непарных узлов снято сверкой силуэта (разница записи, не рисунка): ${alike}`);
}
