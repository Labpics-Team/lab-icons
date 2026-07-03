#!/usr/bin/env node
/**
 * Анатомическая модель @labpics/icons — этап 1: скелет-экстракция.
 *
 * Видение (владелец, 2026-07-03): иконка — не картинка, а машинно-читаемая
 * АНАТОМИЯ: примитивы → скелет → семантические привязки, поверх которых
 * строятся SF Symbols-класса анимации ПО СМЫСЛУ (песочные часы
 * переворачиваются, кисть красит). Этап 1 добывает скелет из существующих
 * 444 SVG детерминированной геометрией — ноль придуманных значений, каждая
 * метрика воспроизводима из path-данных. Модель и дорожная карта этапов —
 * docs/anatomy-model.md.
 *
 * Выход: dist/anatomy.json
 *   icons.<exportName> = {
 *     variant, file, viewBox,
 *     subpaths: [{ closed, points, bbox, areaSigned, centroid, perimeter }],
 *     bbox, area, centroid,                  // агрегаты по контурам
 *     holes,                                 // контуры-вырезы (противо-ориентация)
 *     symmetry: { x, y },                    // зеркальный overlap-скор [0..1]
 *   }
 *
 * Геометрия:
 *   - парсер полной path-грамматики (MmLlHhVvCcSsQqTtAaZz), кривые
 *     сэмплируются фиксированным N=16 на сегмент (детерминизм);
 *   - площадь — шнуровка Гаусса (знак = ориентация обхода);
 *   - «вырез» — контур, чья ориентация противоположна максимальному по
 *     |площади| контуру своего path-элемента (модель even-odd/nonzero
 *     вырезов Figma-экспорта — этап 1 фиксирует факт, не рендерит);
 *   - симметрия — доля точек контуров, чьё зеркало относительно центра
 *     bbox попадает в контурное множество с допуском 0.15px (метрика
 *     сходства, не бинарный вердикт).
 *
 * Числа округлены до 3 знаков (стабильность артефакта между платформами).
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST_SVG = join(ROOT, 'dist', 'svg');
const OUT = join(ROOT, 'dist', 'anatomy.json');

const CURVE_SAMPLES = 16;

// ── парсер path-данных ────────────────────────────────────────────────────────

/** Токенизация: команды и числа (включая экспоненты и слитные знаки). */
function tokenize(d) {
  const re = /([MmLlHhVvCcSsQqTtAaZz])|(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)/g;
  const tokens = [];
  let m = re.exec(d);
  while (m !== null) {
    tokens.push(m[1] ? { cmd: m[1] } : { num: Number.parseFloat(m[2]) });
    m = re.exec(d);
  }
  return tokens;
}

function cubicAt(p0, p1, p2, p3, t) {
  const u = 1 - t;
  return [
    u * u * u * p0[0] + 3 * u * u * t * p1[0] + 3 * u * t * t * p2[0] + t * t * t * p3[0],
    u * u * u * p0[1] + 3 * u * u * t * p1[1] + 3 * u * t * t * p2[1] + t * t * t * p3[1],
  ];
}

function quadAt(p0, p1, p2, t) {
  const u = 1 - t;
  return [
    u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
    u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
  ];
}

/** Дуга A → сэмплы (эталонная реконструкция SVG 2 B.2.4, endpoint→center). */
function arcSamples(p0, rx, ry, xrotDeg, largeArc, sweep, p1) {
  if (rx === 0 || ry === 0) return [p1];
  let rxa = Math.abs(rx);
  let rya = Math.abs(ry);
  const phi = (xrotDeg * Math.PI) / 180;
  const cosP = Math.cos(phi);
  const sinP = Math.sin(phi);
  const dx = (p0[0] - p1[0]) / 2;
  const dy = (p0[1] - p1[1]) / 2;
  const x1p = cosP * dx + sinP * dy;
  const y1p = -sinP * dx + cosP * dy;
  const lam = (x1p * x1p) / (rxa * rxa) + (y1p * y1p) / (rya * rya);
  if (lam > 1) {
    const s = Math.sqrt(lam);
    rxa *= s;
    rya *= s;
  }
  const num = rxa * rxa * rya * rya - rxa * rxa * y1p * y1p - rya * rya * x1p * x1p;
  const den = rxa * rxa * y1p * y1p + rya * rya * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rxa * y1p) / rya;
  const cyp = (-coef * rya * x1p) / rxa;
  const cx = cosP * cxp - sinP * cyp + (p0[0] + p1[0]) / 2;
  const cy = sinP * cxp + cosP * cyp + (p0[1] + p1[1]) / 2;
  const ang = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.hypot(ux, uy) * Math.hypot(vx, vy);
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const th1 = ang(1, 0, (x1p - cxp) / rxa, (y1p - cyp) / rya);
  let dth = ang((x1p - cxp) / rxa, (y1p - cyp) / rya, (-x1p - cxp) / rxa, (-y1p - cyp) / rya);
  if (!sweep && dth > 0) dth -= 2 * Math.PI;
  if (sweep && dth < 0) dth += 2 * Math.PI;
  const pts = [];
  for (let i = 1; i <= CURVE_SAMPLES; i++) {
    const th = th1 + (dth * i) / CURVE_SAMPLES;
    const x = cx + rxa * Math.cos(th) * cosP - rya * Math.sin(th) * sinP;
    const y = cy + rxa * Math.cos(th) * sinP + rya * Math.sin(th) * cosP;
    pts.push([x, y]);
  }
  return pts;
}

/**
 * d-атрибут → массив контуров (subpath = массив точек-сэмплов, флаг closed).
 * Ошибка грамматики — жёсткий бросок с именем файла (честная граница:
 * анатомия из битого пути — мусор).
 */
export function parsePathToSubpaths(d, file) {
  const t = tokenize(d);
  const subpaths = [];
  let cur = null;
  let pos = [0, 0];
  let start = [0, 0];
  let prevCubicCtrl = null;
  let prevQuadCtrl = null;
  let i = 0;
  let lastCmd = null;

  const need = (n) => {
    const out = [];
    for (let k = 0; k < n; k++) {
      const tok = t[i++];
      if (!tok || tok.num === undefined) {
        throw new Error(`${file}: ожидалось число (команда ${lastCmd}), позиция ${i - 1}`);
      }
      out.push(tok.num);
    }
    return out;
  };
  const push = (p) => {
    // Сегмент после Z без M начинает НОВЫЙ контур от точки закрытия
    // (SVG 2 §9.3.4: "the next subpath starts at the same initial point").
    if (!cur) {
      if (subpaths.length === 0) throw new Error(`${file}: координата до первого M`);
      open(pos);
    }
    cur.pts.push(p);
    pos = p;
  };
  const open = (p) => {
    cur = { pts: [p], closed: false };
    subpaths.push(cur);
    pos = p;
    start = p;
  };

  while (i < t.length) {
    let cmd;
    if (t[i].cmd !== undefined) {
      cmd = t[i].cmd;
      i++;
    } else {
      // повтор предыдущей команды (implicit); после M — L той же регистровости
      cmd = lastCmd === 'M' ? 'L' : lastCmd === 'm' ? 'l' : lastCmd;
      if (!cmd) throw new Error(`${file}: число до первой команды`);
    }
    lastCmd = cmd;
    const rel = cmd === cmd.toLowerCase();
    const C = cmd.toUpperCase();
    if (C !== 'C') prevCubicCtrl = null;
    if (C !== 'Q') prevQuadCtrl = null;

    switch (C) {
      case 'M': {
        const [x, y] = need(2);
        open(rel ? [pos[0] + x, pos[1] + y] : [x, y]);
        break;
      }
      case 'L': {
        const [x, y] = need(2);
        push(rel ? [pos[0] + x, pos[1] + y] : [x, y]);
        break;
      }
      case 'H': {
        const [x] = need(1);
        push([rel ? pos[0] + x : x, pos[1]]);
        break;
      }
      case 'V': {
        const [y] = need(1);
        push([pos[0], rel ? pos[1] + y : y]);
        break;
      }
      case 'C':
      case 'S': {
        const n = C === 'C' ? 6 : 4;
        const v = need(n);
        const abs = rel ? v.map((c, k) => c + pos[k % 2]) : v;
        let c1;
        if (C === 'C') {
          c1 = [abs[0], abs[1]];
        } else {
          c1 = prevCubicCtrl ? [2 * pos[0] - prevCubicCtrl[0], 2 * pos[1] - prevCubicCtrl[1]] : pos;
        }
        const c2 = C === 'C' ? [abs[2], abs[3]] : [abs[0], abs[1]];
        const end = C === 'C' ? [abs[4], abs[5]] : [abs[2], abs[3]];
        const p0 = pos;
        for (let s = 1; s <= CURVE_SAMPLES; s++) push(cubicAt(p0, c1, c2, end, s / CURVE_SAMPLES));
        prevCubicCtrl = c2;
        break;
      }
      case 'Q':
      case 'T': {
        const n = C === 'Q' ? 4 : 2;
        const v = need(n);
        const abs = rel ? v.map((c, k) => c + pos[k % 2]) : v;
        const c1 =
          C === 'Q'
            ? [abs[0], abs[1]]
            : prevQuadCtrl
              ? [2 * pos[0] - prevQuadCtrl[0], 2 * pos[1] - prevQuadCtrl[1]]
              : pos;
        const end = C === 'Q' ? [abs[2], abs[3]] : [abs[0], abs[1]];
        const p0 = pos;
        for (let s = 1; s <= CURVE_SAMPLES; s++) push(quadAt(p0, c1, end, s / CURVE_SAMPLES));
        prevQuadCtrl = c1;
        break;
      }
      case 'A': {
        const [rx, ry, rot, laf, sf, x, y] = need(7);
        const end = rel ? [pos[0] + x, pos[1] + y] : [x, y];
        for (const p of arcSamples(pos, rx, ry, rot, laf !== 0, sf !== 0, end)) push(p);
        break;
      }
      case 'Z': {
        if (!cur) throw new Error(`${file}: Z до первого M`);
        cur.closed = true;
        pos = start;
        cur = null;
        break;
      }
      default:
        throw new Error(`${file}: неизвестная команда ${cmd}`);
    }
  }
  return subpaths.filter((s) => s.pts.length > 1);
}

// ── геометрия контура ─────────────────────────────────────────────────────────

function shoelace(pts) {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function perimeter(pts, closed) {
  let p = 0;
  const n = closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    p += Math.hypot(x2 - x1, y2 - y1);
  }
  return p;
}

function centroidOf(pts, areaSigned) {
  // Центроид многоугольника; у вырожденной площади — среднее точек.
  if (Math.abs(areaSigned) < 1e-9) {
    const s = pts.reduce((acc, p) => [acc[0] + p[0], acc[1] + p[1]], [0, 0]);
    return [s[0] / pts.length, s[1] / pts.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    const w = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * w;
    cy += (y1 + y2) * w;
  }
  return [cx / (6 * areaSigned), cy / (6 * areaSigned)];
}

const r3 = (x) => Math.round(x * 1000) / 1000;

/** Зеркальный overlap-скор точек относительно центра bbox по оси axis (0=x,1=y). */
function mirrorScore(allPts, bbox, axis, tol = 0.15) {
  const mid = axis === 0 ? (bbox[0] + bbox[2]) / 2 : (bbox[1] + bbox[3]) / 2;
  // Сетка для поиска соседей: ячейка = tol.
  const key = (x, y) => `${Math.round(x / tol)}:${Math.round(y / tol)}`;
  const grid = new Set();
  for (const [x, y] of allPts) {
    grid.add(key(x, y));
  }
  let hit = 0;
  for (const [x, y] of allPts) {
    const mx = axis === 0 ? 2 * mid - x : x;
    const my = axis === 1 ? 2 * mid - y : y;
    // сосед в 3×3 окрестности ячеек
    let found = false;
    for (let dx = -1; dx <= 1 && !found; dx++) {
      for (let dy = -1; dy <= 1 && !found; dy++) {
        if (grid.has(`${Math.round(mx / tol) + dx}:${Math.round(my / tol) + dy}`)) found = true;
      }
    }
    if (found) hit++;
  }
  return hit / allPts.length;
}

// ── сборка ────────────────────────────────────────────────────────────────────

function toCamelCase(str) {
  return str.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (_, c) => c.toLowerCase());
}

function anatomyOfIcon(variant, file, svg) {
  const dAttrs = [...svg.matchAll(/<path[^>]*\bd="([^"]+)"/g)].map((m) => m[1]);
  // clipPath-пути — служебная геометрия (кадрирование), не анатомия знака.
  const clipDs = new Set(
    [...svg.matchAll(/<clipPath[^>]*>\s*<path[^>]*\bd="([^"]+)"/g)].map((m) => m[1]),
  );
  const subpaths = [];
  for (const d of dAttrs) {
    if (clipDs.has(d)) continue;
    const parsed = parsePathToSubpaths(d, `${variant}/${file}`);
    // ориентация мажоритарного контура ЭТОГО path-элемента — база вырезов
    let major = 0;
    let majorAbs = -1;
    const areas = parsed.map((sp) => shoelace(sp.pts));
    areas.forEach((a, k) => {
      if (Math.abs(a) > majorAbs) {
        majorAbs = Math.abs(a);
        major = k;
      }
    });
    parsed.forEach((sp, k) => {
      const area = areas[k];
      subpaths.push({
        closed: sp.closed,
        hole: sp.closed && parsed.length > 1 && Math.sign(area) !== Math.sign(areas[major]),
        pts: sp.pts,
        areaSigned: area,
      });
    });
  }
  if (subpaths.length === 0) {
    throw new Error(`${variant}/${file}: анатомия пуста (нет контуров вне clipPath)`);
  }

  const allPts = subpaths.flatMap((s) => s.pts);
  const bbox = allPts.reduce(
    (b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
    [Infinity, Infinity, -Infinity, -Infinity],
  );
  let areaTotal = 0;
  let cx = 0;
  let cy = 0;
  const subOut = subpaths.map((s) => {
    const sb = s.pts.reduce(
      (b, [x, y]) => [Math.min(b[0], x), Math.min(b[1], y), Math.max(b[2], x), Math.max(b[3], y)],
      [Infinity, Infinity, -Infinity, -Infinity],
    );
    const c = centroidOf(s.pts, s.areaSigned);
    const aAbs = Math.abs(s.areaSigned) * (s.hole ? -1 : 1);
    areaTotal += aAbs;
    cx += c[0] * aAbs;
    cy += c[1] * aAbs;
    return {
      closed: s.closed,
      hole: s.hole,
      points: s.pts.length,
      bbox: sb.map(r3),
      areaSigned: r3(s.areaSigned),
      centroid: c.map(r3),
      perimeter: r3(perimeter(s.pts, s.closed)),
    };
  });
  const centroid =
    Math.abs(areaTotal) > 1e-9
      ? [cx / areaTotal, cy / areaTotal]
      : [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2];

  return {
    variant,
    file,
    viewBox: '0 0 24 24',
    subpaths: subOut,
    bbox: bbox.map(r3),
    area: r3(areaTotal),
    centroid: centroid.map(r3),
    holes: subOut.filter((s) => s.hole).length,
    symmetry: {
      x: r3(mirrorScore(allPts, bbox, 0)),
      y: r3(mirrorScore(allPts, bbox, 1)),
    },
  };
}

function main() {
  const icons = {};
  let count = 0;
  for (const variant of ['Filled', 'Outline']) {
    const dir = join(DIST_SVG, variant);
    for (const file of readdirSync(dir)
      .filter((f) => f.endsWith('.svg'))
      .sort()) {
      const svg = readFileSync(join(dir, file), 'utf8');
      const base = file.replace(/\.svg$/, '');
      const name = variant === 'Filled' ? toCamelCase(base) : `${toCamelCase(base)}Outline`;
      icons[name] = anatomyOfIcon(variant, file, svg);
      count++;
    }
  }
  const doc = {
    $schema: './anatomy-schema-v1',
    $comment:
      'GENERATED — скелет-экстракция этапа 1 анатомической модели (docs/anatomy-model.md). ' +
      'Детерминированная геометрия из path-данных dist/svg; регенерация: node scripts/build-anatomy.js',
    stage: 1,
    curveSamples: CURVE_SAMPLES,
    icons,
  };
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(doc, null, 1)}\n`, 'utf8');
  console.info(`✓  anatomy.json: скелеты ${count} иконок (${Object.keys(icons).length} имён)`);
}

// Прямой запуск (модуль импортируется гардом check-anatomy.js).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
