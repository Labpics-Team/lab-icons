/**
 * system/core/parse.js — чтение чужого d-атрибута.
 *
 * Нужен ровно для одного: измерять ОРИГИНАЛ. Система ничего не парсит для
 * рисования — она рисует из токенов; парсер живёт на стороне сходимости.
 */

const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/gi;

/** Разбор d в список команд с абсолютными координатами. */
export function parseD(d) {
  const out = [];
  const re = /([MmLlHhVvCcSsQqTtAaZz])([^MmLlHhVvCcSsQqTtAaZz]*)/g;
  let m;
  let cur = [0, 0];
  let start = [0, 0];
  let prevC = null;
  let prevQ = null;
  while ((m = re.exec(d))) {
    const cmd = m[1];
    const args = (m[2].match(NUM) || []).map(Number);
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    let i = 0;
    const rx = (v) => (rel ? cur[0] + v : v);
    const ry = (v) => (rel ? cur[1] + v : v);
    if (C === 'Z') {
      out.push({ k: 'Z' });
      cur = start.slice();
      prevC = prevQ = null;
      continue;
    }
    do {
      if (C === 'M') {
        const p = [rx(args[i]), ry(args[i + 1])];
        i += 2;
        out.push({ k: out.length && cmd !== 'M' && cmd !== 'm' ? 'L' : 'M', p });
        cur = p;
        if (out[out.length - 1].k === 'M') start = p.slice();
        prevC = prevQ = null;
        // последующие пары в M трактуются как L
        while (i + 1 < args.length) {
          const q = [rel ? cur[0] + args[i] : args[i], rel ? cur[1] + args[i + 1] : args[i + 1]];
          i += 2;
          out.push({ k: 'L', p: q });
          cur = q;
        }
      } else if (C === 'L') {
        const p = [rx(args[i]), ry(args[i + 1])];
        i += 2;
        out.push({ k: 'L', p });
        cur = p;
        prevC = prevQ = null;
      } else if (C === 'H') {
        const p = [rel ? cur[0] + args[i] : args[i], cur[1]];
        i += 1;
        out.push({ k: 'L', p });
        cur = p;
        prevC = prevQ = null;
      } else if (C === 'V') {
        const p = [cur[0], rel ? cur[1] + args[i] : args[i]];
        i += 1;
        out.push({ k: 'L', p });
        cur = p;
        prevC = prevQ = null;
      } else if (C === 'C' || C === 'S') {
        let c1;
        if (C === 'C') {
          c1 = [rx(args[i]), ry(args[i + 1])];
          i += 2;
        } else {
          c1 = prevC ? [2 * cur[0] - prevC[0], 2 * cur[1] - prevC[1]] : cur.slice();
        }
        const c2 = [rx(args[i]), ry(args[i + 1])];
        const p = [rx(args[i + 2]), ry(args[i + 3])];
        i += 4;
        out.push({ k: 'C', c1, c2, p });
        prevC = c2;
        prevQ = null;
        cur = p;
      } else if (C === 'Q' || C === 'T') {
        let c1;
        if (C === 'Q') {
          c1 = [rx(args[i]), ry(args[i + 1])];
          i += 2;
        } else {
          c1 = prevQ ? [2 * cur[0] - prevQ[0], 2 * cur[1] - prevQ[1]] : cur.slice();
        }
        const p = [rx(args[i]), ry(args[i + 1])];
        i += 2;
        out.push({ k: 'C', c1: [cur[0] + (2 / 3) * (c1[0] - cur[0]), cur[1] + (2 / 3) * (c1[1] - cur[1])], c2: [p[0] + (2 / 3) * (c1[0] - p[0]), p[1] + (2 / 3) * (c1[1] - p[1])], p });
        prevQ = c1;
        prevC = null;
        cur = p;
      } else if (C === 'A') {
        const rxr = args[i];
        const ryr = args[i + 1];
        const rot = args[i + 2];
        const large = args[i + 3];
        const sweep = args[i + 4];
        const p = [rx(args[i + 5]), ry(args[i + 6])];
        i += 7;
        out.push({ k: 'A', rx: rxr, ry: ryr, rot, large, sweep, from: cur.slice(), p });
        cur = p;
        prevC = prevQ = null;
      }
    } while (i < args.length && args.length - i >= 2);
  }
  return out;
}

function cubicPts(p0, p1, p2, p3, tol, out) {
  const d = Math.hypot(p1[0] - p0[0], p1[1] - p0[1]) + Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) + Math.hypot(p3[0] - p2[0], p3[1] - p2[1]);
  const n = Math.max(4, Math.min(120, Math.ceil(Math.sqrt(d / Math.max(tol, 1e-4)) * 1.4)));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
      u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
}

/** Дуга SVG (эндпоинт-параметризация, включая эллиптическую) → точки. */
function arcPts(s, tol, out) {
  let { rx, ry, rot, large, sweep, from, p } = s;
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  if (rx < 1e-9 || ry < 1e-9) {
    out.push(p);
    return;
  }
  const phi = (rot * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (from[0] - p[0]) / 2;
  const dy = (from[1] - p[1]) / 2;
  const x1 = cosP * dx + sinP * dy;
  const y1 = -sinP * dx + cosP * dy;
  const l = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
  if (l > 1) {
    const k = Math.sqrt(l);
    rx *= k;
    ry *= k;
  }
  const sign = large !== sweep ? 1 : -1;
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1;
  const co = sign * Math.sqrt(Math.max(0, num / den));
  const cxp = (co * rx * y1) / ry;
  const cyp = (-co * ry * x1) / rx;
  const cx = cosP * cxp - sinP * cyp + (from[0] + p[0]) / 2;
  const cy = sinP * cxp + cosP * cyp + (from[1] + p[1]) / 2;
  const ang = (ux, uy, vx, vy) => {
    const d = (ux * vx + uy * vy) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    const a = Math.acos(Math.max(-1, Math.min(1, d)));
    return ux * vy - uy * vx < 0 ? -a : a;
  };
  const th0 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
  let dth = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
  if (!sweep && dth > 0) dth -= Math.PI * 2;
  if (sweep && dth < 0) dth += Math.PI * 2;
  const rmax = Math.max(rx, ry);
  const step = rmax <= tol ? Math.PI / 2 : 2 * Math.acos(Math.max(-1, 1 - tol / rmax));
  const n = Math.max(2, Math.ceil(Math.abs(dth) / Math.min(step, Math.PI / 2)));
  for (let i = 1; i <= n; i++) {
    const t = th0 + (dth * i) / n;
    const px = rx * Math.cos(t);
    const py = ry * Math.sin(t);
    out.push([cx + cosP * px - sinP * py, cy + sinP * px + cosP * py]);
  }
}

/** d → замкнутые полилинии (все подпути замыкаются: заливка их и так замыкает). */
export function polylinesFromD(d, tol = 0.01) {
  const segs = parseD(d);
  const polys = [];
  let cur = null;
  let pen = [0, 0];
  for (const s of segs) {
    if (s.k === 'M') {
      if (cur && cur.length > 2) polys.push(cur);
      cur = [s.p.slice()];
      pen = s.p;
    } else if (s.k === 'Z') {
      if (cur && cur.length > 2) polys.push(cur);
      cur = cur && cur.length ? [cur[0].slice()] : null;
      if (cur) pen = cur[0];
    } else if (!cur) {
      continue;
    } else if (s.k === 'L') {
      cur.push(s.p.slice());
      pen = s.p;
    } else if (s.k === 'C') {
      cubicPts(pen, s.c1, s.c2, s.p, tol, cur);
      pen = s.p;
    } else if (s.k === 'A') {
      arcPts(s, tol, cur);
      pen = s.p;
    }
  }
  if (cur && cur.length > 2) polys.push(cur);
  return polys.map((p) => {
    const q = p.slice();
    while (q.length > 1 && Math.abs(q[0][0] - q[q.length - 1][0]) < 1e-9 && Math.abs(q[0][1] - q[q.length - 1][1]) < 1e-9) q.pop();
    return q;
  }).filter((p) => p.length > 2);
}

/**
 * Извлечь из SVG-файла список {d, fillRule} — ТОЛЬКО рисующие пути.
 *
 * Содержимое `<defs>`, `<clipPath>`, `<mask>`, `<symbol>` и `<pattern>` НЕ
 * рисует: это определения. Шесть иконок корпуса несут
 * `<defs><clipPath id="a"><path d="M0 0h24v24H0z"/></clipPath></defs>`, и
 * наивная регулярка по `<path>` считала этот прямоугольник чернилами — то есть
 * мерила у них залитую канву целиком. Один вырезанный кусок разметки, а метрика
 * врала на 100%.
 */
const NON_RENDERING = /<(defs|clipPath|mask|symbol|pattern)\b[\s\S]*?<\/\1>/gi;

export function pathsFromSvg(svg) {
  const out = [];
  const drawable = svg.replace(NON_RENDERING, '');
  const re = /<path\b([^>]*)>/g;
  let m;
  while ((m = re.exec(drawable))) {
    const attrs = m[1];
    const dm = /\sd="([^"]*)"/.exec(attrs);
    if (!dm) continue;
    const fr = /fill-rule="([^"]*)"/.exec(attrs);
    out.push({ d: dm[1], fillRule: fr ? fr[1] : 'nonzero' });
  }
  return out;
}
