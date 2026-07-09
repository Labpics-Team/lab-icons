/**
 * scripts/lib/corners.js — примитив ПЕР-ВЕРШИННОГО РАДИУСА СКРУГЛЕНИЯ (zero-dep).
 *
 * КЛАСС дефекта (уникальный — НЕ покрыт другими гейтами): генерат СКРУГЛЯЕТ
 * угол, который у РУКИ ОСТРЫЙ. Пока genRoundedPolygon/genRoundedRect скругляют
 * все вершины ОДНИМ глобальным скаляром (blanket-round, до EC3), острые углы
 * руки массово скругляются генератом. Площадная IoU этого почти не видит
 * (скругление 0.3px смещает контур на доли пикселя — угол 0.3px «невидим»);
 * check-fill-rule видит только evenodd/nonzero; check-path-quality — микро-узлы
 * и почти-гладкие изломы; check-topology — разрыв незакрытого суб-пути. Здесь —
 * ИМЕННО радиус скругления НА ВЕРШИНЕ, дифференциально генерат-vs-рука.
 *
 * МЕРА (относительна канве, не абсолютна): в каждой вершине контура касательная
 * поворачивается на угол Δθ. Острый угол концентрирует весь поворот в ОДНОЙ
 * точке (дуга Δs≈0 → r≈0). Скруглённый угол размазывает тот же поворот по
 * короткой дуге-филлету (Δs>0 → r=Δs/Δθ, ровно радиус дуги окружности:
 * длина_дуги = r·угол). «Угол» отделяется от «стороны» по ДЛИНЕ ребра: сторона —
 * длинное ребро (> доля диагонали bbox), филлет — цепочка коротких рёбер между
 * двумя сторонами. Острая вершина = одиночный кластер меж двух длинных рёбер
 * (Δs=0). Мера детерминирована, считается через общий сэмплер полилиний
 * (lib/curve-sampling.js) и точный bbox (lib/path-data.js) — свой парсер НЕ пишем.
 */

import { samplePolylines } from './curve-sampling.js';
import { pathBBox } from './path-data.js';

// Плотность сэмплинга кривых: филлет-дуга разбивается на N рёбер — достаточно
// для устойчивого Δs/Δθ, не переусердствуя (16 → погрешность радиуса < 0.1%).
const ARC_STEPS = 16;
// Ребро — «сторона» (граница угла), если длиннее этой доли диагонали bbox.
const SIDE_RATIO = 0.06;
// Кластер считается УГЛОМ (а не прямым участком стороны), если суммарный
// поворот касательной ≥ этого (рад ≈ 15°). Отсекает шум коллинеарных вершин.
const MIN_CORNER_TURN = 0.26;
const EPS = 1e-9;

/** Знаковый поворот касательной в вершине: угол между (P0→P1) и (P1→P2). */
function turnAngle(p0, p1, p2) {
  const ax = p1[0] - p0[0];
  const ay = p1[1] - p0[1];
  const bx = p2[0] - p1[0];
  const by = p2[1] - p1[1];
  const la = Math.hypot(ax, ay);
  const lb = Math.hypot(bx, by);
  if (la < EPS || lb < EPS) return 0;
  const cross = ax * by - ay * bx;
  const dot = ax * bx + ay * by;
  return Math.atan2(cross, dot);
}

/**
 * Углы ОДНОЙ полилинии (замкнутого кольца). Кластеризует вершины между
 * «сторонами» (длинными рёбрами); для каждого кластера радиус = Δs/|Δθ|.
 * @returns {Array<{x:number, y:number, radius:number, turn:number}>}
 */
function ringCorners(ring, sideThreshold) {
  // Снять дубль-замыкание (samplePolylines дописывает старт при Z).
  let pts = ring;
  if (pts.length >= 2) {
    const a = pts[0];
    const b = pts[pts.length - 1];
    if (Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6) pts = pts.slice(0, -1);
  }
  const n = pts.length;
  if (n < 3) return [];

  // Длины рёбер кольца e_i = P_i→P_{i+1} (mod n) и классификация сторона/филлет.
  const edgeLen = new Array(n);
  const isSide = new Array(n);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    edgeLen[i] = Math.hypot(pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]);
    isSide[i] = edgeLen[i] > sideThreshold;
  }

  // Ротация старта на вершину сразу ПОСЛЕ длинного ребра, чтобы ни один
  // кластер не рвался на шве индекса 0. Нет длинных рёбер (окружность) —
  // всё кольцо один кластер (равномерный радиус).
  let start = -1;
  for (let i = 0; i < n; i++) {
    if (isSide[i]) {
      start = (i + 1) % n;
      break;
    }
  }
  const corners = [];
  if (start < 0) {
    // Замкнутая гладкая кривая без прямых сторон: один «угол» = весь контур.
    let turn = 0;
    let arc = 0;
    for (let i = 0; i < n; i++) {
      turn += turnAngle(pts[(i - 1 + n) % n], pts[i], pts[(i + 1) % n]);
      arc += edgeLen[i];
    }
    const r = Math.abs(turn) > EPS ? arc / Math.abs(turn) : 0;
    if (Math.abs(turn) >= MIN_CORNER_TURN) {
      corners.push({ x: pts[0][0], y: pts[0][1], radius: r, turn });
    }
    return corners;
  }

  // Линейный проход по вершинам, начиная от start; кластер = run вершин,
  // внутренние рёбра которого КОРОТКИЕ; граница кластера — длинное ребро.
  let cluster = [];
  for (let k = 0; k < n; k++) {
    const i = (start + k) % n;
    cluster.push(i);
    const outLong = isSide[i]; // ребро i→i+1
    const last = k === n - 1;
    if (outLong || last) {
      // Замкнуть кластер cluster[0..end].
      let turn = 0;
      let arc = 0;
      for (let t = 0; t < cluster.length; t++) {
        const v = cluster[t];
        turn += turnAngle(pts[(v - 1 + n) % n], pts[v], pts[(v + 1) % n]);
        if (t < cluster.length - 1) arc += edgeLen[cluster[t]]; // короткие внутр.
      }
      if (Math.abs(turn) >= MIN_CORNER_TURN) {
        let sx = 0;
        let sy = 0;
        for (const v of cluster) {
          sx += pts[v][0];
          sy += pts[v][1];
        }
        const r = Math.abs(turn) > EPS ? arc / Math.abs(turn) : 0;
        corners.push({ x: sx / cluster.length, y: sy / cluster.length, radius: r, turn });
      }
      cluster = [];
    }
  }
  return corners;
}

/**
 * Пер-вершинные радиусы скругления всех углов контура d (по всем суб-путям).
 * Порог «стороны» относителен диагонали bbox контура (масштаб-инвариантно:
 * мелкий глиф судится своей мерой, а не канвой).
 * @param {string} d — path-data
 * @returns {Array<{x:number, y:number, radius:number, turn:number}>}
 */
export function cornerRadii(d) {
  const bb = pathBBox(d);
  const diag = Math.hypot(bb.maxX - bb.minX, bb.maxY - bb.minY);
  const sideThreshold = SIDE_RATIO * diag;
  const polys = samplePolylines(d, ARC_STEPS);
  const out = [];
  for (const poly of polys) {
    for (const c of ringCorners(poly, sideThreshold)) out.push(c);
  }
  return out;
}
