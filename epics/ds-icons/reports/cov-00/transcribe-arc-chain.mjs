#!/usr/bin/env node
/**
 * scripts/transcribe-arc-chain.mjs — авто-транскрипция source-only иконок
 * в candidate-модели arc-chain (волна 1, покрытие анатомии).
 *
 * Закон честной единицы: модель = ТРАНСКРИПЦИЯ руки (status:hand,
 * state=candidate, оси пустые), shipped SVG не тронут. Приёмка — тот же
 * оракул, что drift-гейт (inkIoU): оба варианта ≥ 0.95, иначе имя
 * паркуется в hard-резидуал с достигнутым IoU.
 *
 * Метод: каждый сегмент source-path (L/A/C/Q) — параметрический сэмплер;
 * кривые аппроксимируются дугами окружности через 3 точки (концы +
 * середина) с рекурсивным делением при превышении допуска хорды.
 * Никакого конструктива не выводится — только замер (прецедент
 * «честный composite по замерам» словаря окружностей).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parsePathData } from '../../../../src/core/path-data.js';
import { renderedPathEntries } from '../../../../src/core/icon-geometry.js';
import { buildGlyph } from '../../../../src/core/anatomy-gen.js';
import { inkIoU } from '../../../../scripts/check-anatomy-drift.js';

const MAX_DEPTH = 4; // максимум 2^4 дуг на исходную кривую
const DEFAULT_TOLERANCE = 0.06; // юниты канвы: максимум отклонения дуги от кривой

// ── геометрия ────────────────────────────────────────────────────────────────

const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Центр окружности через 3 точки; null — коллинеарны. */
export function circleFrom3Points(p0, pm, p1) {
  const [ax, ay] = p0, [bx, by] = pm, [cx, cy] = p1;
  const d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = ax * ax + ay * ay, b2 = bx * bx + by * by, c2 = cx * cx + cy * cy;
  const ux = (a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d;
  const uy = (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d;
  return { c: [ux, uy], r: Math.hypot(ax - ux, ay - uy) };
}

/**
 * Флаги дуги P0→P1 через промежуточную точку M вокруг центра c.
 * sweep=1 ⇔ θ растёт (позитивное направление SVG); large ⇔ развёртка > π.
 */
export function arcFlags(p0, pm, p1, c) {
  const TWO_PI = 2 * Math.PI;
  const th = (p) => Math.atan2(p[1] - c[1], p[0] - c[0]);
  const t0 = th(p0);
  const dPos = ((th(p1) - t0) % TWO_PI + TWO_PI) % TWO_PI;
  const tM = ((th(pm) - t0) % TWO_PI + TWO_PI) % TWO_PI;
  if (tM <= dPos) return { sweep: 1, large: dPos > Math.PI ? 1 : 0 };
  return { sweep: 0, large: TWO_PI - dPos > Math.PI ? 1 : 0 };
}

/**
 * Рекурсивная аппроксимация параметрической кривой цепью дуг.
 * @param {(t:number)=>[number,number]} at сэмплер кривой на [0,1]
 * @param {number} tolerance допуск (юниты канвы)
 * @returns {Array<{to:[number,number], seg:{t:'l'}|{t:'a',r:number,sweep:0|1,large?:1}}>}
 */
export function fitArcs(at, tolerance = DEFAULT_TOLERANCE, t0 = 0, t1 = 1, depth = 0) {
  const p0 = at(t0), p1 = at(t1);
  const pm = at((t0 + t1) / 2);
  const fit = circleFrom3Points(p0, pm, p1);
  const chord = dist(p0, p1);
  // почти-прямая: стрела дуги в допуске
  const sagitta = fit ? fit.r - Math.hypot((p0[0] + p1[0]) / 2 - fit.c[0], (p0[1] + p1[1]) / 2 - fit.c[1]) : 0;
  if (!fit || (Math.abs(sagitta) < tolerance && chord > 1e-6)) {
    let maxLineDev = 0;
    for (let k = 1; k < 8; k++) {
      const p = at(t0 + ((t1 - t0) * k) / 8);
      // расстояние до хорды
      const t = chord < 1e-9 ? 0 : ((p[0] - p0[0]) * (p1[0] - p0[0]) + (p[1] - p0[1]) * (p1[1] - p0[1])) / (chord * chord);
      const q = [p0[0] + t * (p1[0] - p0[0]), p0[1] + t * (p1[1] - p0[1])];
      maxLineDev = Math.max(maxLineDev, dist(p, q));
    }
    if (maxLineDev < tolerance || depth >= MAX_DEPTH) return [{ to: p1, seg: { t: 'l' } }];
    return [
      ...fitArcs(at, tolerance, t0, (t0 + t1) / 2, depth + 1),
      ...fitArcs(at, tolerance, (t0 + t1) / 2, t1, depth + 1),
    ];
  }
  let maxDev = 0;
  for (let k = 1; k < 8; k++) {
    const p = at(t0 + ((t1 - t0) * k) / 8);
    maxDev = Math.max(maxDev, Math.abs(dist(p, fit.c) - fit.r));
  }
  if (maxDev < tolerance || depth >= MAX_DEPTH) {
    const { sweep, large } = arcFlags(p0, pm, p1, fit.c);
    const seg = { t: 'a', r: fit.r, sweep };
    if (large) seg.large = 1;
    return [{ to: p1, seg }];
  }
  return [
    ...fitArcs(at, tolerance, t0, (t0 + t1) / 2, depth + 1),
    ...fitArcs(at, tolerance, (t0 + t1) / 2, t1, depth + 1),
  ];
}

// ── сэмплеры сегментов path ──────────────────────────────────────────────────

function cubicSampler(p0, seg) {
  const { x1, y1, x2, y2, x, y } = seg;
  return (t) => {
    const mt = 1 - t;
    return [
      mt * mt * mt * p0[0] + 3 * mt * mt * t * x1 + 3 * mt * t * t * x2 + t * t * t * x,
      mt * mt * mt * p0[1] + 3 * mt * mt * t * y1 + 3 * mt * t * t * y2 + t * t * t * y,
    ];
  };
}

function quadSampler(p0, seg) {
  const { x1, y1, x, y } = seg;
  return (t) => {
    const mt = 1 - t;
    return [
      mt * mt * p0[0] + 2 * mt * t * x1 + t * t * x,
      mt * mt * p0[1] + 2 * mt * t * y1 + t * t * y,
    ];
  };
}

/** Сэмплер эллиптической дуги (центральная параметризация F.6.5). */
function arcSampler(p0, seg) {
  const { rx, ry, rotation, largeArc, sweep, x, y } = seg;
  const phi = (rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi), sinPhi = Math.sin(phi);
  const RX = Math.abs(rx), RY = Math.abs(ry);
  if (RX === 0 || RY === 0) return (t) => [p0[0] + t * (x - p0[0]), p0[1] + t * (y - p0[1])];
  const dx2 = (p0[0] - x) / 2, dy2 = (p0[1] - y) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;
  let rX = RX, rY = RY;
  const lambda = (x1p * x1p) / (rX * rX) + (y1p * y1p) / (rY * rY);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rX *= s; rY *= s;
  }
  const rx2 = rX * rX, ry2 = rY * rY;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rX * y1p) / rY;
  const cyp = (-coef * rY * x1p) / rX;
  const cx = cosPhi * cxp - sinPhi * cyp + (p0[0] + x) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (p0[1] + y) / 2;
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rX, (y1p - cyp) / rY);
  let dTheta = angle((x1p - cxp) / rX, (y1p - cyp) / rY, (-x1p - cxp) / rX, (-y1p - cyp) / rY);
  if (sweep === 0 && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep === 1 && dTheta < 0) dTheta += 2 * Math.PI;
  return (t) => {
    const th = theta1 + t * dTheta;
    return [
      cx + rX * Math.cos(th) * cosPhi - rY * Math.sin(th) * sinPhi,
      cy + rX * Math.cos(th) * sinPhi + rY * Math.sin(th) * cosPhi,
    ];
  };
}

// ── транскрипция субпутей ────────────────────────────────────────────────────

/** Разбивает d на субпути [{segs, start}] (M...Z|M). */
function subpaths(d) {
  const parsed = parsePathData(d);
  const out = [];
  let cur = null;
  for (const seg of parsed) {
    if (seg.cmd === 'M') {
      if (cur && cur.segs.length > 0) out.push(cur);
      cur = { start: [seg.x, seg.y], segs: [] };
    } else if (seg.cmd === 'Z') {
      if (cur) {
        out.push(cur);
        cur = { start: cur.start, segs: [], implicit: true };
      }
    } else if (cur) {
      cur.segs.push(seg);
    }
  }
  if (cur && cur.segs.length > 0) out.push(cur);
  return out.filter((s) => s.segs.length > 0);
}

/**
 * Транскрибирует один субпуть в params arc-chain (доли канвы).
 * @returns {{closed:true, nodes:number[][], segs:object[]}}
 */
export function transcribeSubpath(sub, cw, tolerance = DEFAULT_TOLERANCE) {
  const frac = (v) => Number((v / cw).toFixed(6));
  const nodes = [];
  const segs = [];
  let cursor = sub.start;
  const push = (to, seg) => {
    if (dist(cursor, to) < 1e-6) return; // нулевой сегмент
    nodes.push(cursor);
    if (seg.t === 'a') {
      const s = { t: 'a', r: Number((seg.r / cw).toFixed(6)), sweep: seg.sweep };
      if (seg.large) s.large = 1;
      // 2r ≥ хорда — инвариант buildDictPart (числовой зазор от округления)
      const chord = dist(cursor, to) / cw;
      if (2 * s.r < chord) s.r = Number((chord / 2 + 1e-6).toFixed(6));
      segs.push(s);
    } else {
      segs.push({ t: 'l' });
    }
    cursor = to;
  };
  for (const seg of sub.segs) {
    if (seg.cmd === 'L') {
      push([seg.x, seg.y], { t: 'l' });
    } else if (seg.cmd === 'A' && Math.abs(seg.rx - seg.ry) < 1e-6 && seg.rotation === 0) {
      // круговая дуга — прямой перенос; large>π делится (флаг large у
      // fitArcs есть, но исходный точный радиус честнее сохранить)
      push([seg.x, seg.y], { t: 'a', r: seg.rx, sweep: seg.sweep, large: seg.largeArc });
    } else {
      const sampler =
        seg.cmd === 'C' ? cubicSampler(cursor, seg)
        : seg.cmd === 'Q' ? quadSampler(cursor, seg)
        : arcSampler(cursor, seg); // эллиптическая/повёрнутая дуга
      for (const piece of fitArcs(sampler, tolerance)) push(piece.to, piece.seg);
    }
  }
  // Замыкание: buildDictPart соединяет последний узел с nodes[0] последним
  // сегментом. Если субпуть не вернулся в старт (Z закрывает прямой), обязан
  // появиться явный узел + прямая — иначе последний сегмент ложится на чужую
  // (длинную) хорду и «R меньше полухорды» рвёт построение.
  if (dist(cursor, sub.start) > 1e-6) push(sub.start, { t: 'l' });
  return {
    closed: true,
    nodes: nodes.map((n) => [frac(n[0]), frac(n[1])]),
    segs,
  };
}

/** Полигональная площадь субпутя по сэмплам (для сортировки/спаривания). */
function subpathArea(sub) {
  const pts = [sub.start];
  let cursor = sub.start;
  for (const seg of sub.segs) {
    const sampler =
      seg.cmd === 'L' ? ((t) => [cursor[0] + t * (seg.x - cursor[0]), cursor[1] + t * (seg.y - cursor[1])])
      : seg.cmd === 'C' ? cubicSampler(cursor, seg)
      : seg.cmd === 'Q' ? quadSampler(cursor, seg)
      : arcSampler(cursor, seg);
    for (let k = 1; k <= 8; k++) pts.push(sampler(k / 8));
    cursor = [seg.x, seg.y];
  }
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i], [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  return area / 2;
}

/**
 * Строит anatomy-декларацию имени из обоих shipped SVG.
 * Субпути каждого варианта сортируются по |площади|; спаривание по индексу,
 * недостающий вариант — null (прецедент counter bookmark/filled).
 */
export function buildAnatomyEntry({ outlineSvg, filledSvg, cw, tolerance = DEFAULT_TOLERANCE }) {
  const variantSubs = {};
  for (const [variant, svg] of [['outline', outlineSvg], ['filled', filledSvg]]) {
    const entries = renderedPathEntries(svg);
    const subs = entries.flatMap((entry) => subpaths(entry.d));
    subs.sort((a, b) => Math.abs(subpathArea(b)) - Math.abs(subpathArea(a)));
    variantSubs[variant] = subs;
  }
  const partCount = Math.max(variantSubs.outline.length, variantSubs.filled.length);
  const parts = [];
  for (let i = 0; i < partCount; i++) {
    const params = {};
    for (const variant of ['outline', 'filled']) {
      const sub = variantSubs[variant][i];
      params[variant] = sub ? transcribeSubpath(sub, cw, tolerance) : null;
    }
    parts.push({
      id: `c${i}`,
      role: i === 0 ? 'body' : 'counter',
      primitive: 'arc-chain',
      mode: 'solid',
      params,
    });
  }
  return {
    archetype: 'composite',
    status: { outline: 'hand', filled: 'hand' },
    parts,
  };
}

/** Замер IoU кандидата тем же оракулом, что drift-гейт. */
export function measureEntry({ entry, grid, outlineSvg, filledSvg, lib }) {
  const built = buildGlyph(entry, grid, {}, lib);
  const cw = grid.canvas.width;
  const result = {};
  for (const [variant, svg] of [['outline', outlineSvg], ['filled', filledSvg]]) {
    const original = renderedPathEntries(svg).map((e) => e.d).join('');
    result[variant] = inkIoU(built[variant], original, cw);
  }
  return result;
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
  const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
  const anatomyPath = join(root, 'semantics', 'anatomy.json');
  const anatomy = JSON.parse(readFileSync(anatomyPath, 'utf8'));
  const cw = grid.canvas.width;
  const floor = 0.95;
  const write = process.argv.includes('--write');
  const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7)?.split(',');

  const names = [];
  for (const f of (await import('node:fs')).readdirSync(join(root, 'svg', 'Outline'))) {
    if (f.endsWith('.svg')) names.push(f.slice(0, -4));
  }
  const targets = names.filter(
    (n) => !anatomy.glyphs[n] && (!only || only.includes(n)),
  );

  const accepted = [];
  const residual = [];
  for (const name of targets) {
    const outlineSvg = readFileSync(join(root, 'svg', 'Outline', `${name}.svg`), 'utf8');
    const filledSvg = readFileSync(join(root, 'svg', 'Filled', `${name}_filled.svg`), 'utf8');
    let entry, iou;
    try {
      entry = buildAnatomyEntry({ outlineSvg, filledSvg, cw });
      iou = measureEntry({ entry, grid, outlineSvg, filledSvg, lib: anatomy.glyphs });
    } catch (cause) {
      residual.push({ name, reason: `транскрипция упала: ${cause.message}` });
      continue;
    }
    const worst = Math.min(iou.outline, iou.filled);
    if (worst >= floor) {
      accepted.push({ name, entry, iou });
    } else {
      residual.push({
        name,
        reason: `IoU ниже пола: outline ${(iou.outline * 100).toFixed(2)}%, filled ${(iou.filled * 100).toFixed(2)}%`,
      });
    }
  }

  console.log(`transcribe-arc-chain: целей ${targets.length}, принято ${accepted.length}, резидуал ${residual.length}`);
  for (const a of accepted) {
    console.log(`  + ${a.name}: outline ${(a.iou.outline * 100).toFixed(2)}%, filled ${(a.iou.filled * 100).toFixed(2)}%`);
  }
  for (const r of residual) console.log(`  - ${r.name}: ${r.reason}`);

  if (write && accepted.length > 0) {
    for (const a of accepted) anatomy.glyphs[a.name] = a.entry;
    writeFileSync(anatomyPath, JSON.stringify(anatomy, null, 1) + '\n', 'utf8');
    console.log(`transcribe-arc-chain: записано ${accepted.length} деклараций в semantics/anatomy.json`);
  }
}
