/**
 * system/motion.js — ЯКОРЯ ДВИЖЕНИЯ, извлечённые из самой геометрии.
 *
 * Анимации в этой сессии не делаются. Но подготовка к ним — не «оставить
 * место», а сохранить то, что обычно теряется при экспорте.
 *
 * Модель пути хранит дугу ЦЕНТРОМ и углами. Значит, ось вращения кругового
 * штриха (reload крутится вокруг неё, earth вокруг своей, hourglass вокруг
 * своей) не надо угадывать обратно из эндпоинтов — она уже лежит в данных.
 * Этот файл её просто достаёт. Ни одной декларации от автора глифа не
 * требуется: если он построил кольцо кольцом, ось найдётся сама.
 *
 * Что отдаётся потребителю (lab-motion):
 *   pivots  — центры дуг, сгруппированные по совпадению, с суммарным
 *             заметённым углом и радиусами. Кандидаты на ось вращения.
 *   spans   — прямые звенья: направление и длина. Кандидаты на draw/растяжение.
 *   ink     — центроид и габарит чернил: якорь масштабирования и «дыхания».
 */

import { v2 } from './core/num.js';

const KEY = (p) => `${Math.round(p[0] * 100)}:${Math.round(p[1] * 100)}`;

/**
 * @param {import('./core/path.js').Path} path
 */
export function motionAnchors(path) {
  const byCenter = new Map();
  const spans = [];

  for (const sub of path.subs) {
    let cur = sub.from;
    for (const s of sub.segs) {
      if (s.k === 'A') {
        const k = KEY(s.c);
        if (!byCenter.has(k)) byCenter.set(k, { center: [s.c[0], s.c[1]], sweep: 0, radii: [], arcs: 0 });
        const g = byCenter.get(k);
        g.sweep += Math.abs(s.a1 - s.a0);
        g.radii.push(Number(s.r.toFixed(3)));
        g.arcs++;
      } else if (s.k === 'L') {
        const d = v2.sub(s.to, cur);
        const len = v2.len(d);
        if (len > 0.2) {
          spans.push({
            from: [round(cur[0]), round(cur[1])],
            to: [round(s.to[0]), round(s.to[1])],
            len: round(len),
            deg: round((Math.atan2(d[1], d[0]) * 180) / Math.PI),
          });
        }
      }
      cur = s.to;
    }
  }

  const pivots = [...byCenter.values()]
    .map((g) => ({
      center: [round(g.center[0]), round(g.center[1])],
      /** Суммарный заметённый угол вокруг центра, градусы. Чем больше — тем «круглее» деталь. */
      sweepDeg: round((g.sweep * 180) / Math.PI),
      radii: [...new Set(g.radii)].sort((a, b) => a - b),
      arcs: g.arcs,
    }))
    .filter((p) => p.sweepDeg >= 89.9)
    // Ранг = заметённый угол × наибольший радиус. Терминал пера — тоже 180°
    // вокруг своего центра, но радиус у него 0.9, и по рангу он честно
    // уступает кольцу радиуса 11. Сортировать по одному углу значило бы
    // объявить осью вращения глифа кончик его же штриха.
    .map((p) => ({ ...p, rank: round(p.sweepDeg * Math.max(...p.radii)) }))
    .sort((a, b) => b.rank - a.rank);

  const b = path.bbox();
  const ink = inkCentroid(path);

  return {
    pivots,
    spans: spans.sort((a, b2) => b2.len - a.len).slice(0, 12),
    ink: {
      bbox: [round(b.x0), round(b.y0), round(b.x1), round(b.y1)],
      center: [round(b.cx), round(b.cy)],
      centroid: ink ? [round(ink[0]), round(ink[1])] : null,
    },
    /** Главная ось: центр с наибольшим заметённым углом, если он вообще есть. */
    primaryPivot: pivots.length ? pivots[0].center : null,
  };
}

const round = (v) => Number(v.toFixed(3));

/** Центроид чернил по площадям подпутей (знак площади учитывает дырки). */
function inkCentroid(path, tol = 0.01) {
  let ax = 0;
  let ay = 0;
  let A = 0;
  for (const poly of path.flatten(tol)) {
    let a = 0;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % poly.length];
      const cross = p[0] * q[1] - q[0] * p[1];
      a += cross;
      cx += (p[0] + q[0]) * cross;
      cy += (p[1] + q[1]) * cross;
    }
    if (Math.abs(a) < 1e-9) continue;
    A += a / 2;
    ax += cx / 6;
    ay += cy / 6;
  }
  return Math.abs(A) < 1e-9 ? null : [ax / A, ay / A];
}
