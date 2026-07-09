/**
 * scripts/lib/anatomy-gen.js — генераторы статики из анатомии (BL-014/015/017).
 *
 * Три доказанных архетипа (пилоты в epics/ds-icons/tools, IoU 98–99.9%):
 *   radial-gear    — радиальный конструктор (cog): венец из токенов зуба ×
 *                    повороты + вырезы с G1-fillet борт↔обод.
 *   arc-terminal   — дуга-скелет × вес + терминал-актив (reload): кольцевая
 *                    полоса, круглый кап, стык с активом by construction.
 *   stroke-v       — штриховой V-знак × вес (chevron): чернильные якоря,
 *                    сустав = дуга R=перо вокруг внутреннего острия.
 *   container-glyph — композиция: контейнер из токенов сетки + глиф-генератор
 *                    (Outline: кольцо+глиф; Filled: диск−глиф негативом).
 *
 * Законы весов (адверсариально верифицированы 2026-07-02): независимые
 * абсолютные токены сетки — base 1.8 / bold 2.4 / containerGlyph 2.0 /
 * enclosureRing 1.5. Части-массы (терминалы) инвариантны весу.
 */

import { parsePathData } from './path-data.js';
import { buildDictPart, cutoutCircle, mirrorPathX } from './circle-dictionary.js';

const rad = (deg) => (deg * Math.PI) / 180;
const deg2 = (r) => ((r * 180) / Math.PI + 360) % 360;
const f3 = (v) => {
  let s = v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  s = s.replace(/^(-?)0\./, '$1.');
  return s === '' || s === '-' ? '0' : s;
};
const P = (p) => `${f3(p[0])} ${f3(p[1])}`;
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];

// ── radial-gear (cog) ──
export function genRadialGear(p) {
  const { cx, cy, teeth, rTip, rRoot, rRim, wTipDeg, wRootDeg, fTip, fRoot, spokes, spokeHW, rCO, rCI } = p;
  const period = 360 / teeth;
  const pt = (r, aDeg) => [cx + r * Math.cos(rad(aDeg)), cy + r * Math.sin(rad(aDeg))];
  const fmt = (q) => P(q);
  const lerpFlank = (rootA, tipA, dist, from) => {
    const p1 = pt(rRoot, rootA);
    const p2 = pt(rTip, tipA);
    const len = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const t = from === 'root' ? dist / len : 1 - dist / len;
    return [p1[0] + (p2[0] - p1[0]) * t, p1[1] + (p2[1] - p1[1]) * t];
  };
  let d = '';
  for (let i = 0; i < teeth; i++) {
    const c = i * period;
    const rootIn = c - wRootDeg / 2;
    const tipIn = c - wTipDeg / 2;
    const tipOut = c + wTipDeg / 2;
    const rootOut = c + wRootDeg / 2;
    const valleyEnd = c + period - wRootDeg / 2;
    const aFR = (fRoot / rRoot) * 57.2958;
    const aFT = (fTip / rTip) * 57.2958;
    if (i === 0) d += `M${fmt(pt(rRoot, rootIn - aFR))}`;
    d += `Q${fmt(pt(rRoot, rootIn))} ${fmt(lerpFlank(rootIn, tipIn, fRoot, 'root'))}`;
    d += `L${fmt(lerpFlank(rootIn, tipIn, fTip, 'tip'))}`;
    d += `Q${fmt(pt(rTip, tipIn))} ${fmt(pt(rTip, tipIn + aFT))}`;
    d += `A${f3(rTip)} ${f3(rTip)} 0 0 1 ${fmt(pt(rTip, tipOut - aFT))}`;
    d += `Q${fmt(pt(rTip, tipOut))} ${fmt(lerpFlank(rootOut, tipOut, fTip, 'tip'))}`;
    d += `L${fmt(lerpFlank(rootOut, tipOut, fRoot, 'root'))}`;
    d += `Q${fmt(pt(rRoot, rootOut))} ${fmt(pt(rRoot, rootOut + aFR))}`;
    d += `A${f3(rRoot)} ${f3(rRoot)} 0 0 1 ${fmt(pt(rRoot, valleyEnd - aFR))}`;
  }
  d += 'Z';
  const rHub = spokeHW / Math.sin(rad(60));
  const tF = Math.sqrt((rRim - rCO) ** 2 - (spokeHW + rCO) ** 2);
  const cutout = (baseDeg) => {
    const onSide = (axisDeg, sign, dist) => {
      const [ox, oy] = [Math.cos(rad(axisDeg)), Math.sin(rad(axisDeg))];
      const [nx, ny] = sign > 0 ? [-oy, ox] : [oy, -ox];
      return [cx + ox * dist + nx * spokeHW, cy + oy * dist + ny * spokeHW];
    };
    const fillet = (axisDeg, sign) => {
      const [ox, oy] = [Math.cos(rad(axisDeg)), Math.sin(rad(axisDeg))];
      const [nx, ny] = sign > 0 ? [-oy, ox] : [oy, -ox];
      const Cf = [cx + ox * tF + nx * (spokeHW + rCO), cy + oy * tF + ny * (spokeHW + rCO)];
      const T1 = [cx + ox * tF + nx * spokeHW, cy + oy * tF + ny * spokeHW];
      const dC = Math.hypot(Cf[0] - cx, Cf[1] - cy);
      const T2 = [cx + ((Cf[0] - cx) / dC) * rRim, cy + ((Cf[1] - cy) / dC) * rRim];
      return { T1, T2 };
    };
    const hub = [cx + rHub * Math.cos(rad(baseDeg + 60)), cy + rHub * Math.sin(rad(baseDeg + 60))];
    const f0 = fillet(baseDeg, +1);
    const f1 = fillet(baseDeg + 120, -1);
    const h1 = onSide(baseDeg + 120, -1, rHub * Math.cos(rad(60)) + rCI);
    const h2 = onSide(baseDeg, +1, rHub * Math.cos(rad(60)) + rCI);
    return (
      `M${fmt(h2)}L${fmt(f0.T1)}A${f3(rCO)} ${f3(rCO)} 0 0 1 ${fmt(f0.T2)}` +
      `A${f3(rRim)} ${f3(rRim)} 0 0 1 ${fmt(f1.T2)}` +
      `A${f3(rCO)} ${f3(rCO)} 0 0 1 ${fmt(f1.T1)}L${fmt(h1)}Q${fmt(hub)} ${fmt(h2)}Z`
    );
  };
  return d + spokes.map(cutout).join('');
}

/**
 * Масштабирование d-фрагмента (доли канвы → юниты): терминалы-активы
 * хранятся КРИВЫМИ (полигонализация даёт видимые ступеньки на скруглениях —
 * поймано владельцем), масштаб — через парсер, не текстом.
 */
export function scaleD(d, k) {
  const f3 = (v) => {
    let s = (v * k).toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
    s = s.replace(/^(-?)0\./, '$1.');
    return s === '' || s === '-' ? '0' : s;
  };
  let out = '';
  for (const s of parsePathData(d)) {
    if (s.cmd === 'M') out += `M${f3(s.x)} ${f3(s.y)}`;
    else if (s.cmd === 'L') out += `L${f3(s.x)} ${f3(s.y)}`;
    else if (s.cmd === 'C') out += `C${f3(s.x1)} ${f3(s.y1)} ${f3(s.x2)} ${f3(s.y2)} ${f3(s.x)} ${f3(s.y)}`;
    else if (s.cmd === 'Q') out += `Q${f3(s.x1)} ${f3(s.y1)} ${f3(s.x)} ${f3(s.y)}`;
    else if (s.cmd === 'A') out += `A${f3(s.rx)} ${f3(s.ry)} ${s.rotation} ${s.largeArc} ${s.sweep} ${f3(s.x)} ${f3(s.y)}`;
    else if (s.cmd === 'Z') out += 'Z';
  }
  return out;
}

/** Вершины d-фрагмента (концы сегментов) — для граней/центроида. */
function dVertices(d) {
  const pts = [];
  for (const s of parsePathData(d)) if (s.cmd !== 'Z') pts.push([s.x, s.y]);
  return pts;
}

// ── arc-terminal (reload) ──
export function genArcTerminal(p, w) {
  const { center, rAxis, thetaCap, headD } = p; // headD — d-фрагмент В ЮНИТАХ
  const w2 = w / 2;
  const C = center;
  const pt = (r, th) => [C[0] + r * Math.cos(rad(th)), C[1] + r * Math.sin(rad(th))];
  const thOf = (q) => deg2(Math.atan2(q[1] - C[1], q[0] - C[0]));
  // 45°-грани головы: по ПРЯМЫМ сегментам d-фрагмента
  const faces = [];
  {
    let cx = 0, cy = 0;
    for (const s of parsePathData(headD)) {
      if (s.cmd === 'L') {
        const v = sub([s.x, s.y], [cx, cy]);
        const len = Math.hypot(v[0], v[1]);
        if (len > 1e-9 && Math.abs(v[0] / len - Math.SQRT1_2) < 0.03 && Math.abs(v[1] / len + Math.SQRT1_2) < 0.03) {
          const prev = faces[faces.length - 1];
          if (prev && Math.hypot(prev.to[0] - cx, prev.to[1] - cy) < 1e-6) {
            prev.len += len;
            prev.to = [s.x, s.y];
          } else {
            faces.push({ from: [cx, cy], to: [s.x, s.y], len });
          }
        }
      }
      if (s.cmd !== 'Z') { cx = s.x; cy = s.y; }
    }
  }
  faces.sort((a, b) => b.len - a.len);
  const [hypFace, wingFace] = faces;
  const headVerts = dVertices(headD);
  const headCx = headVerts.reduce((s, q) => s + q[0], 0) / headVerts.length;
  const headCy = headVerts.reduce((s, q) => s + q[1], 0) / headVerts.length;
  const shifted = (face, delta) => {
    const n1 = [Math.SQRT1_2, Math.SQRT1_2];
    const toHead = [headCx - face.from[0], headCy - face.from[1]];
    const n = toHead[0] * n1[0] + toHead[1] * n1[1] > 0 ? n1 : [-n1[0], -n1[1]];
    return [face.from[0] + n[0] * delta, face.from[1] + n[1] * delta];
  };
  const circleLineHit = (r, p0, guessTh) => {
    const dDir = [Math.SQRT1_2, -Math.SQRT1_2];
    const f = [p0[0] - C[0], p0[1] - C[1]];
    const b = 2 * (f[0] * dDir[0] + f[1] * dDir[1]);
    const c2 = f[0] * f[0] + f[1] * f[1] - r * r;
    const disc = b * b - 4 * c2;
    const roots = [(-b + Math.sqrt(disc)) / 2, (-b - Math.sqrt(disc)) / 2];
    return roots
      .map((t) => [p0[0] + dDir[0] * t, p0[1] + dDir[1] * t])
      .reduce((best, q) => {
        const dth = Math.abs(((thOf(q) - guessTh) % 360 + 540) % 360 - 180);
        const bth = best ? Math.abs(((thOf(best) - guessTh) % 360 + 540) % 360 - 180) : Infinity;
        return dth < bth ? q : best;
      }, null);
  };
  const OVERLAP = 0.3;
  const rO = rAxis + w2;
  const rI = rAxis - w2;
  const pOutEnd = circleLineHit(rO, shifted(hypFace, OVERLAP), p.thetaArrowOut);
  const pInEnd = circleLineHit(rI, shifted(wingFace, OVERLAP), p.thetaArrowIn);
  const spanOut = (thOf(pOutEnd) - thetaCap + 360) % 360;
  const spanIn = (thOf(pInEnd) - thetaCap + 360) % 360;
  const pOutStart = pt(rO, thetaCap);
  const pInStart = pt(rI, thetaCap);
  const bow =
    `M${P(pOutStart)}` +
    `A${f3(rO)} ${f3(rO)} 0 ${spanOut > 180 ? 1 : 0} 1 ${P(pOutEnd)}` +
    `L${P(pInEnd)}` +
    `A${f3(rI)} ${f3(rI)} 0 ${spanIn > 180 ? 1 : 0} 0 ${P(pInStart)}` +
    `A${f3(w2)} ${f3(w2)} 0 0 1 ${P(pOutStart)}Z`; // кап наружу (sweep 1)
  return bow + headD;
}

/**
 * Поворот d-пути вокруг (cx,cy) на deg. Дуги генераторов КРУГОВЫЕ
 * (rx==ry) → x-rotation/флаги инвариантны, вращаются координаты.
 * Обобщает ориентацию-фиксированные примитивы на семьи (chevron ×4).
 */
export function rotatePath(d, deg, cx, cy) {
  const t = rad(deg), c = Math.cos(t), s = Math.sin(t);
  const rot = (x, y) => [cx + (x - cx) * c - (y - cy) * s, cy + (x - cx) * s + (y - cy) * c];
  let out = '';
  for (const g of parsePathData(d)) {
    if (g.cmd === 'M' || g.cmd === 'L') out += `${g.cmd}${P(rot(g.x, g.y))}`;
    else if (g.cmd === 'C') out += `C${P(rot(g.x1, g.y1))} ${P(rot(g.x2, g.y2))} ${P(rot(g.x, g.y))}`;
    else if (g.cmd === 'Q') out += `Q${P(rot(g.x1, g.y1))} ${P(rot(g.x, g.y))}`;
    else if (g.cmd === 'A') out += `A${f3(g.rx)} ${f3(g.ry)} ${f3(g.rotation)} ${g.largeArc} ${g.sweep} ${P(rot(g.x, g.y))}`;
    else if (g.cmd === 'Z') out += 'Z';
  }
  return out;
}

/** Сдвиг d-пути на (dx,dy) юнитов. Только координаты (флаги дуг неизменны). */
export function translateD(d, dx, dy) {
  let out = '';
  for (const g of parsePathData(d)) {
    const X = (x) => f3(x + dx), Y = (y) => f3(y + dy);
    if (g.cmd === 'M' || g.cmd === 'L') out += `${g.cmd}${X(g.x)} ${Y(g.y)}`;
    else if (g.cmd === 'C') out += `C${X(g.x1)} ${Y(g.y1)} ${X(g.x2)} ${Y(g.y2)} ${X(g.x)} ${Y(g.y)}`;
    else if (g.cmd === 'Q') out += `Q${X(g.x1)} ${Y(g.y1)} ${X(g.x)} ${Y(g.y)}`;
    else if (g.cmd === 'A') out += `A${f3(g.rx)} ${f3(g.ry)} ${f3(g.rotation)} ${g.largeArc} ${g.sweep} ${X(g.x)} ${Y(g.y)}`;
    else if (g.cmd === 'Z') out += 'Z';
  }
  return out;
}

// ── stroke-v (chevron) ──
/**
 * Законы, снятые с руки на двух весах (chevron-пилот):
 *  - ВНУТРЕННЯЯ (нижняя) грань ветви ФИКСИРОВАНА, вес растёт наружу;
 *  - чернильный конец ветви вдоль оси — инвариант веса;
 *  - сустав: внешняя дуга R = перо вокруг внутреннего острия (G1-касание
 *    фиксированных внутренних граней).
 * anchors: { endL, endR, innerL: [точка на нижней грани левой ветви],
 *            innerR: [точка на нижней грани правой] } — направления ветвей 45°.
 */
export function genStrokeV(anchors, w) {
  const w2 = w / 2;
  const dL = [Math.SQRT1_2, Math.SQRT1_2];   // ось левой ветви к суставу
  const dR2 = [Math.SQRT1_2, -Math.SQRT1_2]; // движение сустав→C
  const nLup = [Math.SQRT1_2, -Math.SQRT1_2];
  const nRup = [-Math.SQRT1_2, -Math.SQRT1_2];
  const proj = (Pt, dir, X) => add(Pt, dir, (X[0] - Pt[0]) * dir[0] + (X[1] - Pt[1]) * dir[1]);
  const lineHit = (p, dp, q, dq) => {
    const den = dp[0] * dq[1] - dp[1] * dq[0];
    const t = ((q[0] - p[0]) * dq[1] - (q[1] - p[1]) * dq[0]) / den;
    return add(p, dp, t);
  };
  const { endL, endR, innerL, innerR } = anchors;
  // наружные грани = внутренние + w по верхней нормали; остриё = их пересечение
  const upL = add(innerL, nLup, w);
  const upR = add(innerR, nRup, w);
  const topTip = lineHit(upL, dL, upR, dR2);
  // дуга сустава: R = w вокруг острия, касается фиксированных внутренних граней
  const tanL = proj(innerL, dL, topTip);
  const tanR = proj(innerR, dR2, topTip);
  // концы: чернильный якорь вдоль оси; поперёк — на осевой (внутр. грань + w/2)
  const axisPtL = add(innerL, nLup, w2);
  const tA = endL[0] * dL[0] + endL[1] * dL[1] + w2;
  const A = add(axisPtL, dL, tA - (axisPtL[0] * dL[0] + axisPtL[1] * dL[1]));
  const axisPtR = add(innerR, nRup, w2);
  const dCR = [-dR2[0], -dR2[1]];
  const tC = endR[0] * dCR[0] + endR[1] * dCR[1] + w2;
  const Cc = add(axisPtR, dCR, tC - (axisPtR[0] * dCR[0] + axisPtR[1] * dCR[1]));
  const aUp = add(A, nLup, w2);
  const cUp = add(Cc, nRup, w2);
  const cDn = add(Cc, nRup, -w2);
  const aDn = add(A, nLup, -w2);
  return (
    `M${P(aUp)}L${P(topTip)}L${P(cUp)}` +
    `A${f3(w2)} ${f3(w2)} 0 0 1 ${P(cDn)}` +
    `L${P(tanR)}A${f3(w)} ${f3(w)} 0 0 1 ${P(tanL)}` +
    `L${P(aDn)}A${f3(w2)} ${f3(w2)} 0 0 1 ${P(aUp)}Z`
  );
}

// ── суперэллипсное скругление 90° (ζ, Figma corner smoothing) ──
/**
 * Параметры углового профиля по формулам Figma (порт figma-squircle, MIT):
 * радиус вершины НЕИЗМЕНЕН, ζ растягивает вход (кривизна плавно 0 → 1/R) —
 * утверждено владельцем 2026-07-02: «не повышать радиусы, только сглаживать
 * перепады». ζ — токен grid.cornerSmoothing.
 */
export function cornerParams(R, zeta) {
  const p = (1 + zeta) * R;
  const arcMeasure = 90 * (1 - zeta);
  const arcLen = Math.sin(rad(arcMeasure / 2)) * R * Math.SQRT2;
  const angleAlpha = (90 - arcMeasure) / 2;
  const c = R * Math.tan(rad(angleAlpha / 2)) * Math.cos(rad(45 * zeta));
  const d = c * Math.tan(rad(45 * zeta));
  const b = (p - arcLen - c - d) / 3;
  const a = 2 * b;
  return { a, b, c, d, p, arcLen, R };
}

/**
 * d-фрагмент скругления прямого угла: V — вершина; uDir — единичное
 * направление ВХОДА (движения к вершине); wDir — ВЫХОДА (от вершины),
 * uDir ⊥ wDir. Фрагмент начинается в V − uDir·p (вызывающий доводит грань
 * до этой точки) и заканчивается в V + wDir·p.
 * Применять ТОЛЬКО к задекларированным скруглениям (не пост-обработка).
 */
export function smoothCorner90(V, uDir, wDir, R, zeta) {
  const { a, b, c, d, p, arcLen } = cornerParams(R, zeta);
  const S = [V[0] - uDir[0] * p, V[1] - uDir[1] * p];
  const at = (x, y) => [S[0] + uDir[0] * x + wDir[0] * y, S[1] + uDir[1] * x + wDir[1] * y];
  const sweep = uDir[0] * wDir[1] - uDir[1] * wDir[0] > 0 ? 1 : 0;
  // цепочка Figma в базисе (u, w); алгебра сходится: a+b+c+d+arcLen = p
  const arcEndX = a + b + c + arcLen;
  return {
    start: S,
    end: at(p, p),
    d:
      `C${P(at(a, 0))} ${P(at(a + b, 0))} ${P(at(a + b + c, d))}` +
      `A${f3(R)} ${f3(R)} 0 0 ${sweep} ${P(at(arcEndX, d + arcLen))}` +
      `C${P(at(arcEndX + d, d + arcLen + c))} ${P(at(arcEndX + d, d + arcLen + b + c))} ${P(at(p, p))}`,
  };
}

/**
 * Обобщение ζ-скругления на ПРОИЗВОЛЬНЫЙ угол между прямыми гранями.
 * Конструкция (вывод из Figma-90°): вписанная дуга R та же, что при ζ=0
 * (касается граней в R·cot(θ/2) от вершины) — радиус вершины неизменен;
 * ζ режет дугу до центрального сектора Δ(1−ζ), Δ=180°−θ; хвост = кубика
 * с P0,P1 на грани (κ=0 на входе), P2 = пересечение касательной дуги
 * с гранью, P3 на дуге; вход в кривую на (1+ζ)·R·cot(θ/2) от вершины;
 * |P0P2| делится a=2b (распределение Figma). На θ=90° тождественно
 * smoothCorner90 (закреплено дифференциальным тестом).
 */
export function smoothCornerAny(V, uDir, wDir, R, zeta) {
  const cross2 = (p, q) => p[0] * q[1] - p[1] * q[0];
  const dot2 = (p, q) => p[0] * q[0] + p[1] * q[1];
  // θ — внутренний угол клина между гранями: между (−u) и (w)
  const cosT = dot2([-uDir[0], -uDir[1]], wDir);
  const theta = Math.acos(Math.max(-1, Math.min(1, cosT)));
  const half = theta / 2;
  const cot = Math.cos(half) / Math.sin(half);
  const tNom = R * cot;                  // касание дуги при ζ=0
  const p = (1 + zeta) * tNom;           // вход в кривую от вершины
  const sweep = cross2(uDir, wDir) > 0 ? 1 : 0;
  const sgn = sweep === 1 ? 1 : -1;
  // нормали граней внутрь клина
  const nIn = [-uDir[1] * sgn, uDir[0] * sgn];
  const nOut = [wDir[1] * sgn, -wDir[0] * sgn];
  // центр вписанной дуги: на биссектрисе, dist R от обеих граней
  const C = [V[0] - uDir[0] * tNom + nIn[0] * R, V[1] - uDir[1] * tNom + nIn[1] * R];
  // ζ→0: хвосты вырождаются, а pересечение касательной с гранью — в 0/0
  // (NaN-контроли, ревью верификатора) → честная чистая дуга
  if (zeta < 1e-6) {
    const S0 = [V[0] - uDir[0] * tNom, V[1] - uDir[1] * tNom];
    const E0 = [V[0] + wDir[0] * tNom, V[1] + wDir[1] * tNom];
    return { start: S0, end: E0, d: `A${f3(R)} ${f3(R)} 0 0 ${sweep} ${P(E0)}` };
  }
  const delta = Math.PI - theta;          // полный поворот дуги при ζ=0
  const arcMeasure = delta * (1 - zeta);  // остающийся сектор
  const beta = (delta * zeta) / 2;        // срез с каждого конца
  // T1: точка дуги, повернутая на β от касания входной грани (к середине)
  const a0 = Math.atan2(-nIn[1], -nIn[0]); // направление центр→касание входа
  const a1 = a0 + sgn * beta;
  const a2 = a1 + sgn * arcMeasure;
  const T1 = [C[0] + R * Math.cos(a1), C[1] + R * Math.sin(a1)];
  const T2 = [C[0] + R * Math.cos(a2), C[1] + R * Math.sin(a2)];
  // P2 = пересечение касательной дуги в T1 с входной гранью
  const tan1 = [-Math.sin(a1) * sgn, Math.cos(a1) * sgn]; // касательная по ходу
  const lineHit = (P, d1, Q, d2) => {
    const den = d1[0] * d2[1] - d1[1] * d2[0];
    const t = ((Q[0] - P[0]) * d2[1] - (Q[1] - P[1]) * d2[0]) / den;
    return [P[0] + d1[0] * t, P[1] + d1[1] * t];
  };
  const P2 = lineHit(T1, tan1, V, uDir);
  const P0 = [V[0] - uDir[0] * p, V[1] - uDir[1] * p];
  const b = Math.hypot(P2[0] - P0[0], P2[1] - P0[1]) / 3;
  const P1 = [P0[0] + uDir[0] * 2 * b, P0[1] + uDir[1] * 2 * b];
  // симметричный хвост на выходе
  const tan2 = [-Math.sin(a2) * sgn, Math.cos(a2) * sgn];
  const Q2 = lineHit(T2, tan2, V, wDir);
  const E0 = [V[0] + wDir[0] * p, V[1] + wDir[1] * p];
  const b2 = Math.hypot(Q2[0] - E0[0], Q2[1] - E0[1]) / 3;
  const E1 = [E0[0] - wDir[0] * 2 * b2, E0[1] - wDir[1] * 2 * b2];
  return {
    start: P0,
    end: E0,
    d:
      `C${P(P1)} ${P(P2)} ${P(T1)}` +
      `A${f3(R)} ${f3(R)} 0 0 ${sweep} ${P(T2)}` +
      `C${P(Q2)} ${P(E1)} ${P(E0)}`,
  };
}

/**
 * Пер-вершинная корнер-роль (EC3, N3): радиус скругления вершины берётся из
 * ДАННЫХ декларации corners[], а не из одного глобального скаляра. Элемент
 * {sharp:true} ⇒ r=0 (острый угол руки НИКОГДА не округляется генератом),
 * {r:number} ⇒ заданный радиус, отсутствует/undefined ⇒ падаем на глобальный
 * скаляр `fallback`. Возврат — сырой радиус (клампинг у вызывающего).
 */
function cornerRadius(role, fallback) {
  if (role == null) return fallback;
  if (role.sharp) return 0;
  if (typeof role.r === 'number') return role.r;
  return fallback;
}

/**
 * Скруглённый прямоугольник с ζ-углами (первый живой носитель токена
 * cornerSmoothing): обход по часовой, углы — smoothCorner90.
 * corners[] — ОПЦИОНАЛЬНАЯ пер-вершинная роль (EC3), выровнена к углам в
 * порядке обхода [верх-право, низ-право, низ-лево, верх-лево] (индексы 0..3).
 * Отсутствует ⇒ вывод БАЙТ-В-БАЙТ идентичен нынешнему (все углы на скаляре R).
 */
export function genRoundedRect(cx, cy, w, h, R, zeta, rotationDeg = 0, corners) {
  // бюджет Figma (distributeAndNormalize при равных углах): вход в кривую
  // p=(1+ζ)R не может съесть больше полустороны — иначе ζ-хвосты соседних
  // углов перекрываются (капсула R=h/2 ⇒ ζ_eff=0, чистые полукруги)
  const budget = Math.min(w, h) / 2;
  R = Math.min(R, budget);
  zeta = Math.max(0, Math.min(1, zeta, budget / R - 1)); // ζ>1 невалиден в Figma (фазз)
  // повёрнутый контур бесплатно: углы векторные, вращаем базис
  const t = rad(rotationDeg);
  const ux = [Math.cos(t), Math.sin(t)];        // локальная ось X
  const uy = [-Math.sin(t), Math.cos(t)];       // локальная ось Y
  const at = (lx, ly) => [cx + ux[0] * lx + uy[0] * ly, cy + ux[1] * lx + uy[1] * ly];
  const neg = (v) => [-v[0], -v[1]];
  // Угол i: без corners[] ⇒ ровно скаляр R (baseline). С corners[]: пер-вершинный
  // радиус (кламп budget); r≤0 ⇒ ОСТРЫЙ угол — сегмент вырождается в вершину V
  // (start=end=V, d=''), вызывающий доводит грань линией L → чистый острый угол.
  const mk = (V, u, wDir, i) => {
    const Ri = Math.min(corners ? cornerRadius(corners[i], R) : R, budget);
    // Робастный класс-гейт вырожденной пер-вершинной роли ({r:NaN}/{r:±Infinity}/
    // {r:'3'}): только КОНЕЧНЫЙ положительный радиус скругляет, иначе ⇒ острый
    // угол (сегмент = вершина V, d=''). Не протекает NaN/Infinity в путь.
    if (corners && !(Number.isFinite(Ri) && Ri > 0)) return { start: V, end: V, d: '' };
    return smoothCorner90(V, u, wDir, Ri, zeta);
  };
  const segs = [
    mk(at(w / 2, -h / 2), ux, uy, 0),        // верх-право
    mk(at(w / 2, h / 2), uy, neg(ux), 1),    // низ-право
    mk(at(-w / 2, h / 2), neg(ux), neg(uy), 2), // низ-лево
    mk(at(-w / 2, -h / 2), neg(uy), ux, 3),  // верх-лево
  ];
  return (
    `M${P(segs[3].end)}` +
    segs.map((c) => `L${P(c.start)}${c.d}`).join('') +
    'Z'
  );
}

/**
 * Суперэллипс |x/a|^n + |y/b|^n = 1 (сквиркл-блоб: непрерывная кривизна,
 * прямых граней нет — класс ромбов component). Сериализация КРИВЫМИ:
 * 16 кубик-сегментов из аналитических производных (Эрмит→Безье),
 * никакой полигонализации (закон BL-014: ступеньки запрещены).
 */
export function genSuperellipse(cx, cy, a, b, n, rotationDeg = 0, reverse = false) {
  const t0 = rad(rotationDeg);
  const ux = [Math.cos(t0), Math.sin(t0)];
  const uy = [-Math.sin(t0), Math.cos(t0)];
  const world = (lx, ly) => [cx + ux[0] * lx + uy[0] * ly, cy + ux[1] * lx + uy[1] * ly];
  const e = 2 / n;
  const pt = (t) => {
    const c = Math.cos(t), s = Math.sin(t);
    return [a * Math.sign(c) * Math.abs(c) ** e, b * Math.sign(s) * Math.abs(s) ** e];
  };
  // ручки Эрмита по ЦЕНТРАЛЬНЫМ РАЗНОСТЯМ точек: аналитическая производная
  // содержит |cos|^(e−1) с e<1 при n>2 — взрывается у вершин (ловилось
  // тестом гладкости как петли на сотни юнитов)
  const pts = resampleByArc(pt, 32);
  // reverse: обратная намотка для негатив-контуров (frame-дырка) —
  // вычитается и под evenodd (гейт), и под nonzero (браузер); тот же
  // закон, что offsetPolyInward(...).reverse() у полигон-рамок
  if (reverse) pts.reverse();
  return emitClosedHermite(pts, world);
}

/**
 * Адаптивная выборка замкнутой параметрической кривой: мера = смесь
 * длины дуги и ПОВОРОТА КАСАТЕЛЬНОЙ (кривизна). Равномерная по t или
 * по дуге выборка теряет короткие вершинные дуги сквиркла — кубика
 * срезала вершины фасками (октагон-класс, пойман глазами дважды).
 */
function resampleByArc(pt, count) {
  const DENSE = 512;
  const dense = [];
  for (let i = 0; i < DENSE; i++) dense.push(pt((i / DENSE) * 2 * Math.PI));
  const seg = [];
  for (let i = 0; i < DENSE; i++) {
    const a = dense[i];
    const b = dense[(i + 1) % DENSE];
    seg.push([b[0] - a[0], b[1] - a[1]]);
  }
  const cum = [0];
  let totalArc = 0;
  let totalTurn = 0;
  const arcs = [];
  const turns = [];
  for (let i = 0; i < DENSE; i++) {
    const len = Math.hypot(seg[i][0], seg[i][1]);
    const prev = seg[(i - 1 + DENSE) % DENSE];
    let dAng = Math.abs(
      Math.atan2(seg[i][1], seg[i][0]) - Math.atan2(prev[1], prev[0]),
    );
    if (dAng > Math.PI) dAng = 2 * Math.PI - dAng;
    arcs.push(len);
    turns.push(dAng);
    totalArc += len;
    totalTurn += dAng;
  }
  for (let i = 0; i < DENSE; i++) {
    const w = 0.35 * (arcs[i] / totalArc) + 0.65 * (turns[i] / totalTurn);
    cum.push(cum[i] + w);
  }
  const total = cum[DENSE];
  const out = [];
  let j = 0;
  for (let k = 0; k < count; k++) {
    const target = (k / count) * total;
    while (cum[j + 1] < target) j++;
    const f = (target - cum[j]) / (cum[j + 1] - cum[j] || 1);
    const a = dense[j];
    const b = dense[(j + 1) % DENSE];
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

/**
 * Замкнутая гладкая кривая через точки: кубики с ручками Эрмита по
 * центральным разностям (общий эмиттер genSuperellipse / stroke —
 * дублирование сняли по ревью верификатора).
 */
function emitClosedHermite(pts, world) {
  const N = pts.length;
  let d = '';
  for (let i = 0; i < N; i++) {
    const Pa = pts[i];
    const Pb = pts[(i + 1) % N];
    const prev = pts[(i - 1 + N) % N];
    const next2 = pts[(i + 2) % N];
    const Da = [(Pb[0] - prev[0]) / 2, (Pb[1] - prev[1]) / 2];
    const Db = [(next2[0] - Pa[0]) / 2, (next2[1] - Pa[1]) / 2];
    const c1 = world(Pa[0] + Da[0] / 3, Pa[1] + Da[1] / 3);
    const c2 = world(Pb[0] - Db[0] / 3, Pb[1] - Db[1] / 3);
    if (i === 0) d += `M${P(world(Pa[0], Pa[1]))}`;
    d += `C${P(c1)} ${P(c2)} ${P(world(Pb[0], Pb[1]))}`;
  }
  return d + 'Z';
}

/**
 * Строук вокруг оси-суперэллипса (класс ромбов component): рамка руки —
 * ОФСЕТЫ осевого контура пером в обе стороны (офсет наружу скругляет
 * вершины, внутрь — заостряет; два независимых суперэллипса эту пару
 * не описывают — доказано свипами 75/84%). Возвращает {outer, inner}
 * или один контур (side='outer'|'inner'); кривые кубиками Эрмита по
 * конечным разностям офсет-точек.
 */
export function genSuperellipseStroke(cx, cy, a, b, n, rotationDeg, pen, side = 'both') {
  const t0 = rad(rotationDeg);
  const ux = [Math.cos(t0), Math.sin(t0)];
  const uy = [-Math.sin(t0), Math.cos(t0)];
  const world = (lx, ly) => [cx + ux[0] * lx + uy[0] * ly, cy + ux[1] * lx + uy[1] * ly];
  const e = 2 / n;
  const eps = 1e-9;
  const axis = (t) => {
    const c = Math.cos(t), s = Math.sin(t);
    return [a * Math.sign(c) * Math.abs(c) ** e, b * Math.sign(s) * Math.abs(s) ** e];
  };
  const dAxis = (t) => {
    const c = Math.cos(t), s = Math.sin(t);
    return [
      -a * e * Math.max(Math.abs(c), eps) ** (e - 1) * s,
      b * e * Math.max(Math.abs(s), eps) ** (e - 1) * c,
    ];
  };
  const offsetPt = (t, sign) => {
    const p = axis(t);
    const d = dAxis(t);
    const len = Math.hypot(d[0], d[1]) || eps;
    // нормаль наружу для обхода против часовой в локале: (dy, -dx)/|d|
    return [p[0] + (sign * pen * d[1]) / len, p[1] - (sign * pen * d[0]) / len];
  };
  // guard офсет-вырождения (фазз): перо ≥ минимального радиуса кривизны
  // оси → внутренний офсет самопересекается (петля-защип в углах сквиркла)
  {
    const probe = [];
    for (let i = 0; i < 64; i++) probe.push(axis((i / 64) * 2 * Math.PI));
    let minR = Infinity;
    for (let i = 0; i < 64; i++) {
      const A = probe[(i - 1 + 64) % 64], B = probe[i], C2 = probe[(i + 1) % 64];
      const ab = Math.hypot(B[0] - A[0], B[1] - A[1]);
      const bc = Math.hypot(C2[0] - B[0], C2[1] - B[1]);
      const ca = Math.hypot(A[0] - C2[0], A[1] - C2[1]);
      const area2 = Math.abs((B[0] - A[0]) * (C2[1] - A[1]) - (C2[0] - A[0]) * (B[1] - A[1]));
      if (area2 > 1e-12) minR = Math.min(minR, (ab * bc * ca) / (2 * area2));
    }
    if (pen >= minR) {
      throw new Error(
        `genSuperellipseStroke: перо ${pen} ≥ мин. радиуса кривизны оси ${minR.toFixed(3)} — внутренний офсет самопересечётся`,
      );
    }
  }
  const emit = (sign, reverse = false) => {
    const pts = resampleByArc((t) => offsetPt(t, sign), 32);
    // reverse: негатив обратной намоткой — дырка честна и под nonzero
    // (та же дисциплина, что frame-ветка superellipse и genRoundedPolygonRing)
    if (reverse) pts.reverse();
    return emitClosedHermite(pts, world);
  };
  if (side === 'outer') return emit(1);
  if (side === 'inner') return emit(-1);
  return emit(1) + emit(-1, true);
}

/**
 * Сокет-торец «встык» (класс стрелок: палочка ↔ шеврон-наконечник у
 * swap-horizontal, arrow-семьи, download/upload; прецедент — вогнутый сокет
 * genClockHand у time). Перекрытие двух суб-путей под evenodd вырезается белой
 * линзой (полумесяц в стыке, скриншот владельца) — вместо перекрытия торец
 * палочки ложится ТОЧНО на грани вогнутого miter-клина сиблинга: апекс торца =
 * miter-точка сиблинга (та же формула, что печатает его контур), грани торца =
 * отрезки ЕГО офсет-граней до створа палочки. Апекс и концы граней квантуются
 * к решётке f3 ДО вывода углов (дисциплина genClockHand: совпадающие грани
 * двух суб-путей совпадают ТОЧНО) → касание без перекрытия и без щели, EO≡NZ.
 *
 * @param {Array<[number,number]>} pts ось палочки (юниты)
 * @param {Array} u,n единичные направления/нормали сегментов палочки
 * @param {Array<number>} len длины сегментов палочки
 * @param {Array<number>} trims стыковые съедания палочки (guard)
 * @param {number} h полуширина пера палочки
 * @param {'start'|'end'} at какой торец замыкается сокетом
 * @param {{pts:Array<[number,number]>, pen:number}} sib ось и перо сиблинга
 * @returns {{plus:[number,number], apex:[number,number], minus:[number,number]}}
 *   углы торца на офсет-сторонах +n/−n и апекс клина
 */
function socketJoint(pts, u, n, len, trims, h, at, sib) {
  const q = (v) => Number.parseFloat(f3(v));
  const qP = (p) => [q(p[0]), q(p[1])];
  const N = pts.length;
  const seg = at === 'end' ? u.length - 1 : 0;
  const endPt = at === 'end' ? pts[N - 1] : pts[0];
  const uOut = at === 'end' ? u[seg] : [-u[0][0], -u[0][1]]; // наружу из торца
  const nEnd = n[seg];
  const S = sib.pts;
  const sh = sib.pen / 2;
  if (!Array.isArray(S) || S.length < 3) {
    throw new Error('genStrokePath: socket требует у сиблинга ≥3 точек оси (внутренний излом-клин)');
  }
  const su = [];
  const sn = [];
  for (let i = 0; i + 1 < S.length; i++) {
    const dx = S[i + 1][0] - S[i][0];
    const dy = S[i + 1][1] - S[i][1];
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) throw new Error(`genStrokePath: socket — нулевой сегмент оси сиблинга ${i}→${i + 1}`);
    su.push([dx / l, dy / l]);
    sn.push([-dy / l, dx / l]);
  }
  // клин = вогнутый miter ближайшего к торцу внутреннего излома сиблинга
  let k = -1;
  let best = Infinity;
  for (let j = 1; j + 1 < S.length; j++) {
    const dd = Math.hypot(S[j][0] - endPt[0], S[j][1] - endPt[1]);
    if (dd < best) { best = dd; k = j; }
  }
  const dot = su[k - 1][0] * su[k][0] + su[k - 1][1] * su[k][1];
  const cross = su[k - 1][0] * su[k][1] - su[k - 1][1] * su[k][0];
  if (Math.abs(cross) < 1e-9) {
    throw new Error('genStrokePath: socket — излом сиблинга прямой, вогнутого клина нет');
  }
  const sign = cross > 0 ? 1 : -1; // вогнутая сторона излома (где живёт miter)
  const s = [sn[k - 1][0] + sn[k][0], sn[k - 1][1] + sn[k][1]];
  // апекс/концы граней — ровно те точки, что печатает контур сиблинга;
  // квантуем ДО вывода углов торца (решётка f3, класс genClockHand)
  const apex = qP(add(S[k], s, (sign * sh) / (1 + dot)));
  const faces = [
    { E: qP(add(S[k - 1], sn[k - 1], sign * sh)) },
    { E: qP(add(S[k + 1], sn[k], sign * sh)) },
  ];
  for (const f of faces) {
    const v = sub(f.E, apex);
    f.len = Math.hypot(v[0], v[1]);
    if (f.len < 1e-9) throw new Error('genStrokePath: socket — грань клина сиблинга вырождена');
    f.dir = [v[0] / f.len, v[1] / f.len];
    // какую офсет-сторону палочки пересекает грань: знак поперечной координаты её конца
    f.side = (f.E[0] - endPt[0]) * nEnd[0] + (f.E[1] - endPt[1]) * nEnd[1] >= 0 ? 1 : -1;
  }
  if (faces[0].side === faces[1].side) {
    throw new Error('genStrokePath: socket — обе грани клина сиблинга по одну сторону оси, торец не сомкнуть');
  }
  const tApex = (apex[0] - endPt[0]) * nEnd[0] + (apex[1] - endPt[1]) * nEnd[1];
  if (Math.abs(tApex) >= h) {
    throw new Error('genStrokePath: socket — апекс клина сиблинга вне створа торца (|поперечное смещение| ≥ перо/2)');
  }
  const lineHit = (p, dp, p2, dp2) => {
    const den = dp[0] * dp2[1] - dp[1] * dp2[0];
    if (Math.abs(den) < 1e-12) {
      throw new Error('genStrokePath: socket — грань клина сиблинга параллельна оси палочки');
    }
    const t = ((p2[0] - p[0]) * dp2[1] - (p2[1] - p[1]) * dp2[0]) / den;
    return add(p, dp, t);
  };
  const avail = len[seg] - (u.length > 1 ? (at === 'end' ? trims[trims.length - 1] : trims[0]) : 0);
  const cornerOn = (sideSign) => {
    const f = faces.find((x) => x.side === sideSign);
    const c = lineHit(apex, f.dir, add(endPt, nEnd, sideSign * h), uOut);
    const t = (c[0] - apex[0]) * f.dir[0] + (c[1] - apex[1]) * f.dir[1];
    if (t <= 0 || t >= f.len) {
      throw new Error('genStrokePath: socket — торец шире грани клина сиблинга (угол сходит с грани)');
    }
    const back = -((c[0] - endPt[0]) * uOut[0] + (c[1] - endPt[1]) * uOut[1]); // вглубь палочки
    if (back >= avail) {
      throw new Error('genStrokePath: socket — клин сиблинга съедает сегмент палочки (торец глубже плеча)');
    }
    return c;
  };
  return { plus: cornerOn(1), apex, minus: cornerOn(-1) };
}

/**
 * Обводка ломаной оси ПОСТОЯННЫМ пером (класс штриховых глифов: галка,
 * «!», стержень «i», позже стрелки). Контур = офсеты оси по нормали
 * ±pen/2 — та же дисциплина, что genSuperellipseStroke (перо константно
 * по нормали, негатив следует форме). Капы — полукруги R=pen/2 на концах;
 * стыки круглые: на выпуклой стороне излома — дуга R=pen/2 вокруг
 * вершины, на вогнутой — честное пересечение офсет-прямых (miter, для
 * константного пера он и есть точный внутренний контур). Обход
 * согласованный (лево вперёд → кап → право назад → кап) — все дуги
 * sweep=0, один замкнутый суб-путь; mode:"solid" (залитый контур).
 *
 * @param {Array<[number,number]>} pts — вершины оси (юниты канвы)
 * @param {number} pen — полная ширина пера (юниты)
 * @param {boolean} closed — замкнутая ось (пока не реализовано)
 * @param {{socket?: {start?: {pts,pen}, end?: {pts,pen}}}} opts — сокет-торцы
 *   «встык» вместо капов (см. socketJoint): сиблинг-шеврон {ось, перо}
 */
export function genStrokePath(pts, pen, closed = false, opts = {}) {
  if (closed) {
    throw new Error('genStrokePath: замкнутые оси (closed) пока не реализованы — нет потребителя');
  }
  const N = pts.length;
  if (N < 2) throw new Error(`genStrokePath: нужно ≥2 точек оси, получено ${N}`);
  const h = pen / 2;
  const u = []; // единичные направления сегментов
  const n = []; // нормали (rot90)
  const len = [];
  for (let i = 0; i + 1 < N; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    const dy = pts[i + 1][1] - pts[i][1];
    const l = Math.hypot(dx, dy);
    if (l < 1e-9) throw new Error(`genStrokePath: нулевой сегмент оси ${i}→${i + 1}`);
    u.push([dx / l, dy / l]);
    n.push([-dy / l, dx / l]);
    len.push(l);
  }
  // guard офсет-вырождения (как в genSuperellipseStroke): стык длиной
  // h·tan(φ/2) не должен съедать соседние сегменты; разворот 180° запрещён
  const trims = []; // trims[i] — стык на изломе i+1 (между сегментами i и i+1)
  for (let i = 0; i + 1 < u.length; i++) {
    const dot = u[i][0] * u[i + 1][0] + u[i][1] * u[i + 1][1];
    const cross = u[i][0] * u[i + 1][1] - u[i][1] * u[i + 1][0];
    if (1 + dot < 1e-9) {
      // разворот 180°: φ→π, tan(φ/2)→∞ — офсет-стык не существует; отдельная
      // ветка, чтобы не печатать tan(π/2)-мусор в общем сообщении
      throw new Error(
        `genStrokePath: разворот оси на 180° на изломе ${i + 1} — офсет-стык не существует, разбейте ось на отдельные штрихи`,
      );
    }
    const trim = h * Math.tan(Math.atan2(Math.abs(cross), dot) / 2);
    if (trim >= Math.min(len[i], len[i + 1])) {
      throw new Error(
        `genStrokePath: перо ${pen} съедает сегмент на изломе ${i + 1} (стык ${trim.toFixed(3)} ≥ плечо)`,
      );
    }
    trims.push(trim);
  }
  // СОВМЕСТНОЕ съедание: каждый стык по отдельности короче плеч, но два
  // соседних вместе съедают внутренний сегмент → самопересечение контура
  for (let i = 1; i + 1 < u.length; i++) {
    if (trims[i - 1] + trims[i] >= len[i]) {
      throw new Error(
        `genStrokePath: перо ${pen} совместно съедает внутренний сегмент ${i}→${i + 1} (стыки ${trims[i - 1].toFixed(3)} + ${trims[i].toFixed(3)} ≥ длина ${len[i].toFixed(3)})`,
      );
    }
  }
  const arc = (to) => `A${f3(h)} ${f3(h)} 0 0 0 ${P(to)}`;
  // Кап — полукруг, его хорда равна 2h РОВНО, и после f3-квантования концов
  // хорда может округлиться до c < 2R (пример: 1.99899 при 2R=2) — тогда центр
  // дуги уезжает с оси на √(R²−(c/2)²): sqrt-усиление ошибки 5e-4 до ~0.032,
  // порог постоянства пера ±0.02 нарушен на коротких плечах. Поэтому радиус
  // капа эмитим не как фиксированное h, а как половину ФАКТИЧЕСКОЙ
  // квантованной хорды, округлённую ВНИЗ на 3-м знаке: гарантия R ≤ c/2 ⇒
  // рендерер по спецификации SVG (out-of-range radii) линейно растягивает R
  // до точного полукруга на квантованной хорде, отклонение схлопывается до
  // масштаба квантования (~1e-3). Стыковые дуги (arc) не трогаем: их хорда
  // далека от 2R, эффект пренебрежим.
  const q3 = (v) => Number.parseFloat(f3(v));
  const f3floor = (v) => f3(Math.floor(v * 1000) / 1000);
  const capArc = (from, to) => {
    const c = Math.hypot(q3(to[0]) - q3(from[0]), q3(to[1]) - q3(from[1]));
    const r = f3floor(c / 2);
    return `A${r} ${r} 0 0 0 ${P(to)}`;
  };
  const last = u.length - 1;
  // сокет-торцы «встык» (класс стрелок): конструкция от сиблинга-шеврона
  const sockEnd = opts.socket?.end ? socketJoint(pts, u, n, len, trims, h, 'end', opts.socket.end) : null;
  const sockStart = opts.socket?.start ? socketJoint(pts, u, n, len, trims, h, 'start', opts.socket.start) : null;
  // сторона +n вперёд
  let d = `M${P(sockStart ? sockStart.plus : add(pts[0], n[0], h))}`;
  for (let i = 0; i < u.length; i++) {
    if (i === last) {
      d += `L${P(sockEnd ? sockEnd.plus : add(pts[i + 1], n[i], h))}`;
    } else {
      const dot = u[i][0] * u[i + 1][0] + u[i][1] * u[i + 1][1];
      const cross = u[i][0] * u[i + 1][1] - u[i][1] * u[i + 1][0];
      if (cross < 0) {
        // выпуклый стык на стороне +n: круглый join вокруг вершины
        d += `L${P(add(pts[i + 1], n[i], h))}` + arc(add(pts[i + 1], n[i + 1], h));
      } else {
        // вогнутый: пересечение офсет-прямых
        const s = [n[i][0] + n[i + 1][0], n[i][1] + n[i + 1][1]];
        d += `L${P(add(pts[i + 1], s, h / (1 + dot)))}`;
      }
    }
  }
  // конец: сокет-встык (клин апексом внутрь) или полукруг-кап +n → −n
  d += sockEnd
    ? `L${P(sockEnd.apex)}L${P(sockEnd.minus)}`
    : capArc(add(pts[N - 1], n[last], h), add(pts[N - 1], n[last], -h));
  // сторона −n назад
  for (let i = last; i >= 0; i--) {
    if (i === 0) {
      d += `L${P(sockStart ? sockStart.minus : add(pts[0], n[0], -h))}`;
    } else {
      const dot = u[i - 1][0] * u[i][0] + u[i - 1][1] * u[i][1];
      const cross = u[i - 1][0] * u[i][1] - u[i - 1][1] * u[i][0];
      if (cross > 0) {
        // выпуклый стык на стороне −n
        d += `L${P(add(pts[i], n[i], -h))}` + arc(add(pts[i], n[i - 1], -h));
      } else {
        const s = [n[i - 1][0] + n[i][0], n[i - 1][1] + n[i][1]];
        d += `L${P(add(pts[i], s, -h / (1 + dot)))}`;
      }
    }
  }
  // начало замыкает контур (текущая точка — конец стороны −n): сокет-встык
  // (апекс; Z доводит до стартового угла plus) или полукруг-кап
  return d + (sockStart ? `L${P(sockStart.apex)}` : capArc(add(pts[0], n[0], -h), add(pts[0], n[0], h))) + 'Z';
}

/**
 * ОДНА стрелка часов (класс time/alarm/timer/history). Раздельные стрелки
 * вместо сваренного Г-пути — готовность к анимации: вращение каждой =
 * transform вокруг anchor-центра циферблата (сами анимации вне корпуса).
 * (cx,cy) — ось циферблата (пересечение осей стрелок), len — длина оси до
 * конца, t — перо; кап конца R=t/2, пивотный кап R=t/2 = «подшипник»
 * (диск вокруг оси). Союз двух стрелок воспроизводит канон руки time:
 * вогнутый угол стыка ОСТРЫЙ, нижне-левый выпуклый — четверть-дуга R=t/2.
 * socket=true (горизонтальная при вертикальном сиблинге): торец у оси —
 * грань сиблинга x=cx+t/2 + вогнутая дуга по его подшипнику — стык ВСТЫК
 * без перекрытия чернил (EO≡NZ, ноль паразитных линз). Все координаты
 * квантуются к решётке f3 ДО вывода производных точек: совпадающие грани
 * двух суб-путей совпадают ТОЧНО (ноль щелей-слайверов на стыке).
 * Реализованы только комбинации с потребителем (time): up без socket,
 * right с socket; остальное — по мере появления потребителей.
 */
export function genClockHand(cx, cy, len, t, dir, socket = false) {
  const q = (v) => Number.parseFloat(f3(v));
  const [qcx, qcy, qlen, qh] = [q(cx), q(cy), q(len), q(t / 2)];
  if (dir === 'up' && !socket) {
    const yTop = qcy - qlen;
    return (
      `M${f3(qcx - qh)} ${f3(yTop)}` +
      `A${f3(qh)} ${f3(qh)} 0 0 1 ${f3(qcx + qh)} ${f3(yTop)}` + // кап конца
      `L${f3(qcx + qh)} ${f3(qcy)}` +                            // правая грань до оси
      `A${f3(qh)} ${f3(qh)} 0 0 1 ${f3(qcx - qh)} ${f3(qcy)}` +  // пивотный кап-подшипник
      'Z'
    );
  }
  if (dir === 'right' && socket) {
    const xTip = qcx + qlen;
    return (
      `M${f3(qcx + qh)} ${f3(qcy - qh)}` +                        // острый вогнутый угол стыка (канон)
      `L${f3(xTip)} ${f3(qcy - qh)}` +                            // верхняя грань
      `A${f3(qh)} ${f3(qh)} 0 0 1 ${f3(xTip)} ${f3(qcy + qh)}` + // кап конца
      `L${f3(qcx)} ${f3(qcy + qh)}` +                             // нижняя грань до подшипника
      `A${f3(qh)} ${f3(qh)} 0 0 0 ${f3(qcx + qh)} ${f3(qcy)}` +  // вогнутый сокет по подшипнику сиблинга
      'Z'                                                         // замыкание по грани сиблинга x=cx+t/2
    );
  }
  throw new Error(`genClockHand: комбинация dir=«${dir}», socket=${socket} не реализована — нет потребителя`);
}

/**
 * Полоса вдоль дуги с полукруглыми капами (волны radio/volume/wifi —
 * класс BL-020: рука нарезала волны встык по разным path, швы виднелись
 * волосяными линиями). (cx,cy) — центр, r — осевой радиус, aCenterDeg —
 * азимут середины, halfSpanDeg — полуохват ОСЕВОЙ дуги (до центров
 * капов), t — перо.
 */
export function genArcBand(cx, cy, r, aCenterDeg, halfSpanDeg, t) {
  const h = t / 2;
  const a1 = rad(aCenterDeg - halfSpanDeg);
  const a2 = rad(aCenterDeg + halfSpanDeg);
  const pt = (rr, a) => [cx + rr * Math.cos(a), cy + rr * Math.sin(a)];
  const large = halfSpanDeg > 90 ? 1 : 0;
  return (
    `M${P(pt(r + h, a1))}` +
    `A${f3(r + h)} ${f3(r + h)} 0 ${large} 1 ${P(pt(r + h, a2))}` + // внешняя дуга
    `A${f3(h)} ${f3(h)} 0 0 1 ${P(pt(r - h, a2))}` +               // кап конца
    `A${f3(r - h)} ${f3(r - h)} 0 ${large} 0 ${P(pt(r - h, a1))}` + // внутренняя обратно
    `A${f3(h)} ${f3(h)} 0 0 1 ${P(pt(r + h, a1))}` +               // кап начала
    'Z'
  );
}

// ── контейнеры ──
/**
 * Кольцо/диск. Внутренний круг РЕВЕРСИРОВАН (sweep противоположен внешнему)
 * — дырка честно вычитается и под evenodd (гейт), и под nonzero (браузер),
 * как у genRoundedPolygonRing. Раньше оба круга шли sweep=0: под nonzero
 * дырка заливалась (EO≢NZ, адверсарная верификация Волны-2, обязательство №1).
 * Руки nonzero-безопасны (противоположные sweep) — генерат теперь тоже.
 */
export function genRing(cx, cy, rOut, rIn) {
  const c = (r, sw) =>
    `M${f3(cx - r)} ${f3(cy)}a${f3(r)} ${f3(r)} 0 1 ${sw} ${f3(2 * r)} 0a${f3(r)} ${f3(r)} 0 1 ${sw} ${f3(-2 * r)} 0Z`;
  return c(rOut, 0) + (rIn ? c(rIn, 1) : '');
}

// ── rounded-polygon (скруглённый многоугольник: play-треугольник, ромб) ──
/**
 * verts — ВИРТУАЛЬНЫЕ острые вершины (пересечения продолжений граней, не
 * скруглённые крайние точки); r — радиус скругления, ζ — суперэллипс входа.
 * Каждая вершина сглаживается smoothCornerAny (тот же ζ, что углы rect).
 */
const unitV = (a) => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
// corners[] (EC3, N3) — ОПЦИОНАЛЬНАЯ пер-вершинная роль, выровнена к verts по
// индексу. Отсутствует ⇒ вывод БАЙТ-В-БАЙТ идентичен нынешнему (скаляр r для
// всех вершин). {sharp:true}/r≤0 ⇒ острый угол (сегмент = вершина V, d='').
export function genRoundedPolygon(verts, r, zeta, corners) {
  const n = verts.length;
  const cs = verts.map((V, i) => {
    const uIn = unitV(sub(V, verts[(i - 1 + n) % n]));
    const uOut = unitV(sub(verts[(i + 1) % n], V));
    const ri = corners ? cornerRadius(corners[i], r) : r;
    // Робастный класс-гейт вырожденной роли ({r:NaN}/{r:±Infinity}) — здесь НЕТ
    // budget-клампа, поэтому Infinity протёк бы в smoothCornerAny. Только конечный
    // положительный радиус скругляет, иначе острый угол. См. genRoundedRect.
    if (corners && !(Number.isFinite(ri) && ri > 0)) return { start: V, end: V, d: '' };
    return smoothCornerAny(V, uIn, uOut, ri, zeta);
  });
  let d = `M${P(cs[0].start)}${cs[0].d}`;
  for (let i = 1; i < n; i++) d += `L${P(cs[i].start)}${cs[i].d}`;
  return d + 'Z';
}

/** Внутренний офсет многоугольника внутрь на pen (грань-сдвиг + пересечение). */
function offsetPolyInward(verts, pen) {
  const n = verts.length;
  const c = [verts.reduce((s, v) => s + v[0], 0) / n, verts.reduce((s, v) => s + v[1], 0) / n];
  const lines = verts.map((V, i) => {
    const nx = verts[(i + 1) % n];
    const dir = unitV(sub(nx, V));
    let nrm = [-dir[1], dir[0]];
    const mid = [(V[0] + nx[0]) / 2, (V[1] + nx[1]) / 2];
    if ((c[0] - mid[0]) * nrm[0] + (c[1] - mid[1]) * nrm[1] < 0) nrm = [-nrm[0], -nrm[1]];
    return { p: [V[0] + nrm[0] * pen, V[1] + nrm[1] * pen], d: dir };
  });
  const inter = (l1, l2) => {
    const [x1, y1] = l1.p, [dx1, dy1] = l1.d, [x2, y2] = l2.p, [dx2, dy2] = l2.d;
    const den = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(den) < 1e-9) return l2.p;
    const t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / den;
    return [x1 + dx1 * t, y1 + dy1 * t];
  };
  // miter-кламп: на ОСТРЫХ вершинах inner-точка уезжает на pen/sin(θ/2) →
  // переполнение. Ограничиваем смещение внутрь до maxMiter·pen (как stroke-
  // miterlimit), иначе кольцо у острого носа врёт.
  const maxMiter = 2.2 * pen;
  return verts.map((V, i) => {
    const p = inter(lines[(i - 1 + n) % n], lines[i]);
    const disp = Math.hypot(p[0] - V[0], p[1] - V[1]);
    if (disp <= maxMiter || disp < 1e-9) return p;
    return [V[0] + (p[0] - V[0]) * (maxMiter / disp), V[1] + (p[1] - V[1]) * (maxMiter / disp)];
  });
}

/**
 * Outline-кольцо: внешний контур + внутренний офсет. Внутренний РЕВЕРСИРОВАН
 * (обратная намотка) — вычитается и под nonzero (браузер), и под even-odd
 * (гейт), кольцо честное везде.
 */
export function genRoundedPolygonRing(verts, r, zeta, pen, rIn, corners) {
  const inner = offsetPolyInward(verts, pen).slice().reverse();
  // corners[] (EC3) наследуется ВНЕШНИМ контуром (выровнен к verts); внутренний
  // офсет идёт скаляром — его вершины смещены/переиндексированы miter-клампом,
  // пер-вершинная роль руки к ним не выровнена. Отсутствует ⇒ идентично baseline.
  return genRoundedPolygon(verts, r, zeta, corners) + genRoundedPolygon(inner, rIn ?? Math.max(r - pen, 0.15), zeta);
}

/**
 * Сборка глифа из записи semantics/anatomy.json.
 *
 * КОНВЕНЦИЯ ЕДИНИЦ (закреплена владельцем 2026-07-02): все пространственные
 * величины декларации — ОТНОСИТЕЛЬНЫЕ доли канвы (как grid v2); углы —
 * градусы; счётчики — штуки. Резолв ×canvas.width — только здесь, в одной
 * точке; генераторы работают уже в юнитах.
 *
 * @returns {{outline?: string, filled?: string}} d-строки вариантов
 */
export function buildGlyph(entry, grid, axes = {}, lib = null) {
  const cw = grid.canvas.width;
  // ОСЬ ВЕСА (вариативность, север владельца): глобальный множитель на все
  // штриховые токены — одна правка restyle-ит ВЕСЬ задекларированный корпус
  // (как весовая ось шрифта). Дефолт 1 = идентичность (гейты держат default).
  // КЛАМП в grid.axes.weight (BL-021): ниже min тончайший канон тоньше капа
  // (нечитаем), выше max схлопываются охранные клиренсы — вывод min/max
  // задокументирован в grid.json, формулу держит check-ink-weight.
  const wRange = grid.axes?.weight;
  const wRaw = axes.weight ?? 1;
  const wScale = wRange ? Math.min(wRange.max, Math.max(wRange.min, wRaw)) : wRaw;
  // ОСЬ УГЛА (вторая ось вариативности, парадигма Roboto Flex): множитель ζ
  // (cornerSmoothing) на все задекларированные скругления. Дефолт 1 =
  // идентичность БИТ-В-БИТ: короткое замыкание возвращает ζ нетронутым
  // (закреплено голден-фикстурой axes-baseline-d.json). При ≠1 результат
  // клампится в валидный диапазон ζ Figma [0,1] (ζ>1 невалиден, <0 бессмыслен).
  const zScale = axes.corner ?? 1;
  const zTok = (z) => (zScale === 1 ? z : Math.max(0, Math.min(1, z * zScale)));
  const L = (ratio) => ratio * cw;                       // длина: доля → юниты
  const Pt = (q) => [q[0] * cw, q[1] * cw];              // точка
  const Pts = (arr) => arr.map(Pt);                      // полилиния
  const tok = (nameOrRatio) =>
    (typeof nameOrRatio === 'number' ? L(nameOrRatio) : grid.ratios.strokeWidth[nameOrRatio] * cw) * wScale;
  const out = {};
  if (entry.archetype === 'radial-gear') {
    const p = entry.params;
    out.outline = genRadialGear({
      cx: L(p.cx), cy: L(p.cy), teeth: p.teeth,
      rTip: L(p.rTip), rRoot: L(p.rRoot), rRim: L(p.rRim),
      wTipDeg: p.wTipDeg, wRootDeg: p.wRootDeg,
      fTip: L(p.fTip), fRoot: L(p.fRoot),
      spokes: p.spokes, spokeHW: L(p.spokeHW), rCO: L(p.rCO), rCI: L(p.rCI),
    });
  } else if (entry.archetype === 'arc-terminal') {
    const s = entry.skeleton;
    const skel = {
      center: Pt(s.center), rAxis: L(s.rAxis),
      thetaCap: s.thetaCap, thetaArrowOut: s.thetaArrowOut, thetaArrowIn: s.thetaArrowIn,
      headD: scaleD(s.headD, cw), // терминал-актив кривыми, доли → юниты
    };
    if (entry.weights.outline) out.outline = genArcTerminal(skel, tok(entry.weights.outline));
    if (entry.weights.filled) out.filled = genArcTerminal(skel, tok(entry.weights.filled));
  } else if (entry.archetype === 'stroke-v') {
    const a = entry.inkAnchors;
    const anchors = { endL: Pt(a.endL), endR: Pt(a.endR), innerL: Pt(a.innerL), innerR: Pt(a.innerR) };
    // семья по ориентации: rotation (град) поворачивает знак вокруг центра
    // канвы — chevron up/down/back/forward = одна форма × поворот (DRY,
    // грамматика-консистентность). translate ([dx,dy] в долях) — малая
    // позиционная коррекция под faithful-позицию сиблинга (сохраняет вид,
    // геометрия остаётся чистой by construction). Per-variant translate:
    // bold-вариант рука клала иначе.
    const rotDeg = entry.rotation ?? 0;
    const trV = (v) => {
      const t = entry.translate;
      if (!t) return [0, 0];
      if (Array.isArray(t)) return t; // плоский [dx,dy] — оба варианта
      return Array.isArray(t[v]) ? t[v] : [0, 0]; // per-variant объект
    };
    const spin = (dS, v) => {
      let d = rotDeg ? rotatePath(dS, rotDeg, cw / 2, cw / 2) : dS;
      const [dx, dy] = trV(v);
      return dx || dy ? translateD(d, L(dx), L(dy)) : d;
    };
    if (entry.weights.outline) out.outline = spin(genStrokeV(anchors, tok(entry.weights.outline)), 'outline');
    if (entry.weights.filled) out.filled = spin(genStrokeV(anchors, tok(entry.weights.filled)), 'filled');
  } else if (entry.archetype === 'rounded-rect-container') {
    // контейнер-рамка: внешний rounded-rect (ζ из сетки) + внутренний офсет
    // пером; filled = сплошной внешний. Внутренний радиус = R − перо.
    const p2 = entry.params;
    const zeta = zTok(grid.ratios.cornerSmoothing ?? 0);
    const w = tok(entry.weights?.outline ?? 'base');
    const [cx2, cy2, W, H, R] = [L(p2.cx), L(p2.cy), L(p2.w), L(p2.h), L(p2.rOuter)];
    if (W - 2 * w <= 0 || H - 2 * w <= 0) {
      throw new Error(`rounded-rect-container: перо ${w} съедает габарит ${W}×${H} — рамка вырождена`);
    }
    const outer = genRoundedRect(cx2, cy2, W, H, R, zeta);
    const inner = genRoundedRect(cx2, cy2, W - 2 * w, H - 2 * w, Math.max(R - w, 0.1), zeta);
    out.outline = outer + inner; // evenodd-вложение (честная дырка)
    out.filled = outer;
  } else if (entry.archetype === 'composite') {
    // композиция частей: каждая часть — примитив с режимом на вариант
    // (frame = рамка пером, solid = заливка); параметры могут быть
    // per-variant (законы инверсии выводятся по мере разметки корпуса)
    for (const variant of ['outline', 'filled']) {
      if (!entry.status?.[variant]) continue;
      const chunks = [];
      for (const part of entry.parts) {
        // per-variant активация: явный null в params[variant] исключает часть
        // из этого варианта. Структурная разница outline↔filled: напр. полость
        // лотка (rounded-rect-cutout) рисуется только в outline (открытая ⊔-рамка),
        // а в filled контейнер сплошной и стрелка вычитается негативом.
        if (part.params && Object.hasOwn(part.params, variant) && part.params[variant] === null) continue;
        const mode = part.mode?.[variant] ?? part.mode ?? 'solid';
        const pp = part.params?.[variant] ?? part.params;
        if (part.primitive === 'rounded-rect') {
          const [cx2, cy2, W, H, R] = [L(pp.cx), L(pp.cy), L(pp.w), L(pp.h), L(pp.rOuter)];
          const rot = pp.rotation ?? 0; // градусы (конвенция единиц)
          const zeta = zTok(grid.ratios.cornerSmoothing ?? 0);
          const outer = genRoundedRect(cx2, cy2, W, H, R, zeta, rot);
          if (mode === 'frame') {
            const w = tok(part.weight ?? 'base');
            if (W - 2 * w <= 0 || H - 2 * w <= 0) {
              throw new Error(`composite rounded-rect frame: перо ${w} съедает габарит ${W}×${H}`);
            }
            chunks.push(outer + genRoundedRect(cx2, cy2, W - 2 * w, H - 2 * w, Math.max(R - w, 0.1), zeta, rot));
          } else {
            chunks.push(outer);
          }
        } else if (part.primitive === 'circle-dot') {
          // точка/диск; mode frame = кольцо пером (редко), solid = диск,
          // cutout = противо-намотанный диск (дырка в сплошной массе —
          // честно и под evenodd, и под nonzero; Волна-6: зрачок eye/filled)
          const [cx2, cy2, r] = [L(pp.cx), L(pp.cy), L(pp.r)];
          if (mode === 'frame') {
            const w = tok(part.weight ?? 'base');
            chunks.push(genRing(cx2, cy2, r, Math.max(r - w, 0.05)));
          } else if (mode === 'cutout') {
            chunks.push(cutoutCircle(cx2, cy2, r));
          } else {
            chunks.push(genRing(cx2, cy2, r, 0));
          }
        } else if (
          part.primitive === 'tangent-chain' ||
          part.primitive === 'circle-hull' ||
          part.primitive === 'arc-splice' ||
          part.primitive === 'four-arc-oval' ||
          part.primitive === 'arc-chain'
        ) {
          // словарь конструктивных окружностей (Волна-6, преп §2):
          // центральная линия = цепь дуг/прямых с аналитическими стыками;
          // stroke = оффсеты ±перо/2, silhouette = внешний оффсет (закон №1),
          // contour/solid = сама цепь. Вес — токен сетки или число-доля;
          // per-variant вес объектом {outline,filled} (прецедент stroke-path).
          const wRaw = part.weight != null && typeof part.weight === 'object' ? part.weight[variant] : part.weight;
          const w = tok(wRaw ?? 'base');
          chunks.push(buildDictPart(part.primitive, pp, mode, w, cw));
        } else if (part.primitive === 'superellipse-stroke') {
          // сквиркл-рамка: контуры = офсеты ОСИ по нормали (перо константно,
          // негатив-дырка следует форме); solid = внешний офсет оси;
          // вес per-variant объектом — тот же прецедент, что словарная ветка
          const rot = pp.rotation ?? 0;
          const wRaw2 = part.weight != null && typeof part.weight === 'object' ? part.weight[variant] : part.weight;
          const w = tok(wRaw2 ?? 'base');
          const ax = L(pp.axis);
          // axisB: эллиптическая ось (paw: палец = кольцо-обводка эллипса
          // константным пером — два концентрических эллипса эту пару НЕ
          // описывают, оффсет эллипса ≠ эллипс); без axisB — как раньше
          const bx = pp.axisB != null ? L(pp.axisB) : ax;
          if (mode === 'stroke') {
            chunks.push(genSuperellipseStroke(L(pp.cx), L(pp.cy), ax, bx, pp.n, rot, w / 2, 'both'));
          } else {
            // solid: сплошной сквиркл, axis = полная полуось силуэта
            chunks.push(genSuperellipse(L(pp.cx), L(pp.cy), ax, bx, pp.n, rot));
          }
        } else if (part.primitive === 'superellipse') {
          // сквиркл-блоб |x/a|^n+|y/b|^n=1; mode frame = пара контуров
          // (внешний aOut + внутренний aIn — рука рисует их порознь)
          const rot = pp.rotation ?? 0;
          if (mode === 'frame') {
            chunks.push(
              genSuperellipse(L(pp.cx), L(pp.cy), L(pp.aOut), L(pp.bOut ?? pp.aOut), pp.nOut, rot) +
                // внутренний = обратная намотка: дырка честна под nonzero
                genSuperellipse(L(pp.cx), L(pp.cy), L(pp.aIn), L(pp.bIn ?? pp.aIn), pp.nIn ?? pp.nOut, rot, true),
            );
          } else {
            chunks.push(genSuperellipse(L(pp.cx), L(pp.cy), L(pp.aOut), L(pp.bOut ?? pp.aOut), pp.nOut, rot));
          }
        } else if (part.primitive === 'arc-band') {
          // волна: полоса вдоль дуги с капами (radio/volume/wifi, BL-020);
          // t — перо штриха: ось веса масштабирует (tok), замер BL-021 ловил
          // волны 1.6 без изменений на всей сетке весов («вес прыгает»)
          chunks.push(genArcBand(L(pp.cx), L(pp.cy), L(pp.r), pp.aCenter, pp.halfSpan, tok(pp.t)));
        } else if (part.primitive === 'clock-hand') {
          // раздельная стрелка часов (Г-глиф распался на 2 суб-пути);
          // в filled — вырез в диске (evenodd + встречная намотка).
          // anchor — центр циферблата в ДОЛЯХ КАНВЫ: контракт готовности
          // к анимации (вращение = transform вокруг anchor), обязателен
          if (!Array.isArray(part.anchor) || part.anchor.length !== 2) {
            throw new Error('clock-hand: обязателен anchor:[x,y] (центр циферблата, доли канвы)');
          }
          // t — перо стрелки: ось веса масштабирует (tok); обе стрелки берут
          // один множитель — сокет-стык остаётся встык by construction
          chunks.push(genClockHand(L(pp.cx), L(pp.cy), L(pp.len), tok(pp.t), part.dir, part.socket ?? false));
        } else if (part.primitive === 'rounded-rect-cutout') {
          // негатив: контур внутри сплошной части, evenodd вычитает
          // (белые стрелки в диске filled-часов и подобные)
          const [cx2, cy2, W, H, R] = [L(pp.cx), L(pp.cy), L(pp.w), L(pp.h), L(pp.rOuter)];
          chunks.push(genRoundedRect(cx2, cy2, W, H, R, zTok(grid.ratios.cornerSmoothing ?? 0), pp.rotation ?? 0));
        } else if (part.primitive === 'stroke-path') {
          // обводка ломаной оси постоянным пером, капы/стыки круглые
          // (класс штриховых глифов: галка, «!», стержень «i», стрелки);
          // points — доли канвы, вес — токен сетки или число-доля;
          // двухвариантные глифы (стрелки, Волна-5): weight может быть
          // объектом {outline, filled} — резолв по текущему варианту
          // (прецедент per-variant весов: entry.weights у stroke-v)
          if (mode !== 'solid') {
            throw new Error(`stroke-path: режим «${mode}» не поддержан — обводка сама по себе solid-контур`);
          }
          const wRaw = part.weight != null && typeof part.weight === 'object' ? part.weight[variant] : part.weight;
          const w = tok(wRaw ?? 'base');
          // socket {start|end: '<имя сиблинга>'} — торец «встык» по клину
          // сиблинга-шеврона (стык палочка↔наконечник БЕЗ перекрытия, класс
          // time; см. socketJoint). Сиблинг ищется в частях этой же декларации;
          // partsScope — полный список частей при изоляции части гейтом
          // (materializeParts в check-adjacency / adjacency.test).
          let socket;
          if (part.socket) {
            socket = {};
            const scope = entry.partsScope ?? entry.parts;
            for (const endKey of ['start', 'end']) {
              const sibName = part.socket[endKey];
              if (sibName == null) continue;
              const sib = scope.find((p2) => p2.name === sibName && p2 !== part);
              if (!sib || sib.primitive !== 'stroke-path') {
                throw new Error(`stroke-path: socket-сиблинг «${sibName}» не найден среди stroke-path частей декларации`);
              }
              const sibPP = sib.params?.[variant] ?? sib.params;
              const sibWRaw = sib.weight != null && typeof sib.weight === 'object' ? sib.weight[variant] : sib.weight;
              socket[endKey] = { pts: Pts(sibPP.points ?? []), pen: tok(sibWRaw ?? 'base') };
            }
          }
          chunks.push(genStrokePath(Pts(pp.points ?? []), w, pp.closed ?? false, { socket }));
        } else if (part.primitive === 'rounded-polygon') {
          // скруглённый многоугольник как часть композиции (play-семья,
          // обязательство №3 Волны-2): vertices — ВИРТУАЛЬНЫЕ вершины
          // (пересечения продолжений граней, доли канвы), r — радиус (доля),
          // ζ — безразмерный (дефолт из сетки) — резолв 1:1 как у
          // standalone-архетипа rounded-polygon. solid = масса, frame =
          // кольцо (внешний контур + внутренний офсет пером, реверс внутри).
          const verts = Pts(pp.vertices);
          const r = L(pp.r);
          const zeta = zTok(pp.zeta ?? grid.ratios.cornerSmoothing);
          if (mode === 'frame') {
            const w = tok(part.weight ?? 'base');
            const rIn = pp.rInner != null ? L(pp.rInner) : undefined;
            chunks.push(genRoundedPolygonRing(verts, r, zeta, w, rIn));
          } else {
            chunks.push(genRoundedPolygon(verts, r, zeta));
          }
        } else {
          throw new Error(`composite: неизвестный примитив «${part.primitive}»`);
        }
      }
      out[variant] = chunks.join('');
    }
  } else if (entry.archetype === 'container-glyph') {
    const center = [cw / 2, cw / 2];
    const rOut = (grid.ratios.keylines.circle * cw) / 2;
    // кольцо — ШТРИХ, ось веса масштабирует его как все штриховые токены
    // (замер BL-021: при weight 1.2 кольцо оставалось 1.5 при глифе 2.4 —
    // «вес прыгает» ровно класса с зума владельца); default бит-в-бит прежний
    const ringWeight = tok('enclosureRing');
    const a = entry.glyph.inkAnchors;
    let glyphD = genStrokeV(
      { endL: Pt(a.endL), endR: Pt(a.endR), innerL: Pt(a.innerL), innerR: Pt(a.innerR) },
      tok(entry.glyph.weight),
    );
    // семья по ориентации: тот же rotation+translate, что у stroke-v —
    // внутренний глиф контейнера вращается, кольцо инвариантно (chevron
    // {down,up,back,forward}-circle = одна форма × поворот, DRY).
    const gr = entry.glyph.rotation ?? 0;
    if (gr) glyphD = rotatePath(glyphD, gr, center[0], center[1]);
    const gt = Array.isArray(entry.glyph.translate) ? entry.glyph.translate : null;
    if (gt && (gt[0] || gt[1])) glyphD = translateD(glyphD, L(gt[0]), L(gt[1]));
    out.outline = genRing(center[0], center[1], rOut, rOut - ringWeight) + glyphD;
    out.filled = genRing(center[0], center[1], rOut, 0) + glyphD;
  } else if (entry.archetype === 'rounded-polygon') {
    // скруглённый многоугольник-масса (play-треугольник, ромб): Filled —
    // сплошной, Outline — кольцо (внешний + внутр. офсет на перо).
    const verts = entry.vertices.map(Pt);
    const r = L(entry.r);
    const zeta = zTok(entry.zeta ?? grid.ratios.cornerSmoothing);
    const pen = tok(entry.weight ?? 'base');
    const rIn = entry.rInner != null ? L(entry.rInner) : undefined;
    out.filled = genRoundedPolygon(verts, r, zeta);
    out.outline = genRoundedPolygonRing(verts, r, zeta, pen, rIn);
  } else if (entry.archetype === 'mirror') {
    // зеркальный глиф: ОДИН источник чисел + отражение (Волна-6:
    // arrow-undo = mirror(arrow-redo); рука подтверждает зеркало точно —
    // центры 12.95↔11.05, 3.13↔20.87, суммы x = 24.00). Требует карту
    // глифов (4-й аргумент) — передаётся из validateAnatomy/тестов.
    const src = lib?.[entry.of];
    if (!src) throw new Error(`anatomy-gen: mirror «${entry.of}» — источник не найден (нужен 4-й аргумент lib)`);
    if (src.archetype === 'mirror') throw new Error('anatomy-gen: mirror от mirror запрещён (один уровень)');
    const built = buildGlyph(src, grid, axes, lib);
    for (const variant of ['outline', 'filled']) {
      if (!entry.status?.[variant] || !built[variant]) continue;
      out[variant] = mirrorPathX(built[variant], cw / 2);
    }
  } else {
    throw new Error(`anatomy-gen: неизвестный архетип «${entry.archetype}»`);
  }
  return out;
}
