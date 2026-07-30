/**
 * system/contour.js — КАЧЕСТВО КОНТУРА, а не его площадь.
 *
 * Претензия, ради которой файл написан: «1% разницы ≠ хорошо». И это верно.
 * Площадная метрика не отличает круглое от угловатого: замените дугу хордой,
 * и потеряете доли процента площади, но получите визуально другой глиф.
 * Она же не видит шва — двух кусков, сошедшихся встык, — и перелома, где
 * касательная скачет на градус.
 *
 * Здесь меряется то, чем контур ЖИВЁТ:
 *
 *   РАЗЛОМ (G0)      конец сегмента не совпал с началом следующего. Всегда
 *                    дефект: на экране это волосяная щель.
 *   ПЕРЕЛОМ (G1)     касательная скачет. Скачок больше `cornerDeg` — это
 *                    намеренный угол, он законен и считается отдельно.
 *                    Скачок в полосе (0.3°, cornerDeg) — дребезг: угла не
 *                    задумывали, а он есть.
 *   ЖЁСТКОСТЬ (G2)   касательная непрерывна, а кривизна прыгает. Глаз читает
 *                    это как «сломанную» дугу. Мера — перепад радиуса
 *                    кривизны в долях пера: переход прямая→дуга радиуса пера
 *                    даёт 1.0 и совершенно нормален, а вот дуга R=8 → дуга
 *                    R=2 в одном узле выглядит помятой.
 *   УГЛОВАТОСТЬ      сколько чернил приходится на прямые против дуг. Если у
 *                    оригинала дуга, а у генерата ломаная — доля прямых
 *                    вырастет, и это видно числом.
 *
 * Всё считается И для оригинала тоже. Вопрос не «сколько дефектов у меня», а
 * «стало ли их больше, чем было у руки».
 */

import { parseD } from './core/parse.js';
import { v2, norm2pi } from './core/num.js';

const TAU = Math.PI * 2;
const DEG = 180 / Math.PI;

/** Порог, выше которого перелом считается НАМЕРЕННЫМ углом, а не дребезгом. */
export const CORNER_DEG = 8;
/** Ниже этого перелом — числовой шум, не дефект. */
export const NOISE_DEG = 0.3;

/**
 * КВАНТ ЗАПИСИ. Оригиналы записаны с двумя знаками после запятой, то есть
 * каждая координата несёт ±0.005 округления. У отрезка короче нескольких
 * квантов НАПРАВЛЕНИЕ — не измерение, а шум: на длине 0.02 ошибка ±0.005 по
 * каждому концу разворачивает касательную на десятки градусов.
 *
 * Такие огарки в корпусе не редкость: 375 рёбер короче 0.05 в 194 файлах из
 * 444. Обычно они безвредны — два крошечных поворота взаимно гасятся. Но когда
 * огарок направлен ПРОТИВ потока (у `download` контур замыкается отрезком
 * длиной 0.01 назад по ходу), он вносит +180° дважды, и полный поворот
 * контура становится 720° вместо 360°: инвариант Гаусса рушится, и весь глиф
 * уходит в «недостоверно». Прибор при этом не сломан — сломана вера в запись.
 *
 * Поэтому в АНАЛИЗЕ ПОВОРОТА такие рёбра не участвуют: огарок — это запись
 * одного узла, а не сторона, и поворот в узле надо мерить прямо между
 * касательными двух настоящих рёбер. Порог 0.05 — это 1/36 пера 1.8; ни одна
 * осмысленная фаска в такую щель не проваливается. Применяется СИММЕТРИЧНО к
 * руке и к системе: мерить двумя разными линейками нельзя.
 *
 * В поиске РАЗЛОМОВ (G0) тот же порог применять нельзя: щель 0.05 не видна на
 * 24 px, но на плакате 1000 px это 2 px настоящей дыры. Там порог остаётся
 * 0.005, и огарки просто числятся сторонами — повороту они там не мешают.
 */
export const SLOP = 0.05;

// ── нормализованное ребро ────────────────────────────────────────────────
// {kind:'line', a, b} | {kind:'arc', c, r, a0, a1} | {kind:'cubic', p}

/** Дуга SVG в эндпоинт-форме → центр и углы. */
function arcToCenter(from, to, rx, ry, rotDeg, large, sweep) {
  if (Math.abs(rx - ry) > 1e-6) return null; // эллиптические здесь не встречаются
  const r0 = Math.abs(rx);
  const dx = (from[0] - to[0]) / 2;
  const dy = (from[1] - to[1]) / 2;
  const d = Math.hypot(dx, dy);
  let r = r0;
  if (d > r) r = d;
  const h = Math.sqrt(Math.max(0, r * r - d * d));
  const sign = large !== sweep ? 1 : -1;
  const cx = (from[0] + to[0]) / 2 + sign * h * (dy / Math.max(d, 1e-12));
  const cy = (from[1] + to[1]) / 2 - sign * h * (dx / Math.max(d, 1e-12));
  const a0 = Math.atan2(from[1] - cy, from[0] - cx);
  let a1 = Math.atan2(to[1] - cy, to[0] - cx);
  if (sweep) {
    while (a1 < a0) a1 += TAU;
  } else {
    while (a1 > a0) a1 -= TAU;
  }
  return { kind: 'arc', c: [cx, cy], r, a0, a1 };
}

/** Путь системы → нормализованные подпути. */
export function edgesOfPath(path) {
  return path.subs
    .filter((s) => s.segs.length)
    .map((sub) => {
      let cur = sub.from;
      const es = [];
      for (const s of sub.segs) {
        if (s.k === 'L') es.push({ kind: 'line', a: cur, b: s.to });
        else if (s.k === 'C') es.push({ kind: 'cubic', p: [cur, s.c1, s.c2, s.to] });
        else es.push({ kind: 'arc', c: s.c, r: s.r, a0: s.a0, a1: s.a1 });
        cur = s.to;
      }
      // Замыкающий отрезок подпути НЕ хранится сегментом — заливка замыкает
      // контур сама. Но для разбора контура он такое же ребро, как прочие: без
      // него теряется одна сторона и два узла, и весь спектр съезжает.
      if (v2.dist(cur, sub.from) > 1e-9) es.push({ kind: 'line', a: cur, b: sub.from });
      return { edges: es, closed: true };
    });
}

/** Чужой d → нормализованные подпути. */
export function edgesOfD(d) {
  const cmds = parseD(d);
  const subs = [];
  let cur = null;
  let pen = [0, 0];
  let start = [0, 0];
  // Подпуть без явного Z всё равно замкнут заливкой — дорисовываем ребро.
  const flush = () => {
    if (cur && cur.length) {
      if (v2.dist(pen, start) > 1e-9) cur.push({ kind: 'line', a: pen, b: start });
      subs.push({ edges: cur, closed: true });
    }
    cur = null;
  };
  for (const s of cmds) {
    if (s.k === 'M') {
      flush();
      cur = [];
      pen = s.p;
      start = s.p;
    } else if (s.k === 'Z') {
      if (cur && v2.dist(pen, start) > 1e-9) cur.push({ kind: 'line', a: pen, b: start });
      flush();
      pen = start;
    } else if (!cur) {
      continue;
    } else if (s.k === 'L') {
      if (v2.dist(pen, s.p) > 1e-9) cur.push({ kind: 'line', a: pen, b: s.p });
      pen = s.p;
    } else if (s.k === 'C') {
      cur.push({ kind: 'cubic', p: [pen, s.c1, s.c2, s.p] });
      pen = s.p;
    } else if (s.k === 'A') {
      const a = arcToCenter(pen, s.p, s.rx, s.ry, s.rot, s.large, s.sweep);
      cur.push(a ?? { kind: 'line', a: pen, b: s.p });
      pen = s.p;
    }
  }
  flush();
  return subs;
}

// ── касательная и кривизна ───────────────────────────────────────────────

const cubicAt = (p, t) => {
  const u = 1 - t;
  return [
    u * u * u * p[0][0] + 3 * u * u * t * p[1][0] + 3 * u * t * t * p[2][0] + t * t * t * p[3][0],
    u * u * u * p[0][1] + 3 * u * u * t * p[1][1] + 3 * u * t * t * p[2][1] + t * t * t * p[3][1],
  ];
};
const cubicD1 = (p, t) => {
  const u = 1 - t;
  return [
    3 * (u * u * (p[1][0] - p[0][0]) + 2 * u * t * (p[2][0] - p[1][0]) + t * t * (p[3][0] - p[2][0])),
    3 * (u * u * (p[1][1] - p[0][1]) + 2 * u * t * (p[2][1] - p[1][1]) + t * t * (p[3][1] - p[2][1])),
  ];
};
const cubicD2 = (p, t) => {
  const u = 1 - t;
  return [
    6 * (u * (p[2][0] - 2 * p[1][0] + p[0][0]) + t * (p[3][0] - 2 * p[2][0] + p[1][0])),
    6 * (u * (p[2][1] - 2 * p[1][1] + p[0][1]) + t * (p[3][1] - 2 * p[2][1] + p[1][1])),
  ];
};

/** Единичная касательная ребра в параметре t. */
export function tangent(e, t) {
  if (e.kind === 'line') return v2.norm(v2.sub(e.b, e.a));
  if (e.kind === 'arc') {
    const a = e.a0 + (e.a1 - e.a0) * t;
    const s = Math.sign(e.a1 - e.a0) || 1;
    return v2.norm([-Math.sin(a) * s, Math.cos(a) * s]);
  }
  const d = cubicD1(e.p, t);
  return v2.len(d) < 1e-12 ? v2.norm(v2.sub(e.p[3], e.p[0])) : v2.norm(d);
}

/** Знаковая кривизна ребра в параметре t. */
export function curvature(e, t) {
  if (e.kind === 'line') return 0;
  if (e.kind === 'arc') return (Math.sign(e.a1 - e.a0) || 1) / e.r;
  const d1 = cubicD1(e.p, t);
  const d2 = cubicD2(e.p, t);
  const s = v2.len(d1);
  return s < 1e-9 ? 0 : (d1[0] * d2[1] - d1[1] * d2[0]) / (s * s * s);
}

export const pointAt = (e, t) =>
  e.kind === 'line'
    ? v2.mad(e.a, v2.sub(e.b, e.a), t)
    : e.kind === 'arc'
      ? v2.polar(e.c, e.r, e.a0 + (e.a1 - e.a0) * t)
      : cubicAt(e.p, t);

export const edgeLen = (e) => {
  if (e.kind === 'line') return v2.dist(e.a, e.b);
  if (e.kind === 'arc') return Math.abs(e.a1 - e.a0) * e.r;
  let l = 0;
  let prev = e.p[0];
  for (let i = 1; i <= 12; i++) {
    const q = cubicAt(e.p, i / 12);
    l += v2.dist(prev, q);
    prev = q;
  }
  return l;
};

/**
 * Разбор узлов контура.
 * @param {{edges:object[], closed:boolean}[]} subs
 * @param {{pen?:number, cornerDeg?:number}} [o]
 */
export function joints(subs, o = {}) {
  const pen = o.pen ?? 1.8;
  const cornerDeg = o.cornerDeg ?? CORNER_DEG;
  const out = { breaks: [], kinks: [], corners: [], stiff: [], straightLen: 0, curvedLen: 0, edges: 0 };

  for (const sub of subs) {
    const es = sub.edges.filter((e) => edgeLen(e) > 1e-7);
    if (!es.length) continue;
    out.edges += es.length;
    for (const e of es) {
      const l = edgeLen(e);
      if (e.kind === 'line') out.straightLen += l;
      else out.curvedLen += l;
    }
    const n = es.length;
    const last = sub.closed ? n : n - 1;
    for (let i = 0; i < last; i++) {
      const a = es[i];
      const b = es[(i + 1) % n];
      const pa = pointAt(a, 1);
      const pb = pointAt(b, 0);
      const gap = v2.dist(pa, pb);
      if (gap > 5e-3) {
        out.breaks.push({ at: pa.map((v) => +v.toFixed(3)), gap: +gap.toFixed(4) });
        continue;
      }
      const ta = tangent(a, 1);
      const tb = tangent(b, 0);
      const dot = Math.max(-1, Math.min(1, v2.dot(ta, tb)));
      const turn = Math.acos(dot) * DEG;
      if (turn > cornerDeg) {
        out.corners.push({ at: pa.map((v) => +v.toFixed(2)), deg: +turn.toFixed(1) });
      } else if (turn > NOISE_DEG) {
        out.kinks.push({ at: pa.map((v) => +v.toFixed(2)), deg: +turn.toFixed(2) });
      } else {
        // касательная непрерывна — смотрим перепад кривизны
        const ka = curvature(a, 1);
        const kb = curvature(b, 0);
        const jump = Math.abs(ka - kb) * pen; // в долях пера
        if (jump > 1.05) {
          out.stiff.push({
            at: pa.map((v) => +v.toFixed(2)),
            jump: +jump.toFixed(2),
            from: ka === 0 ? 'прямая' : `R=${(1 / Math.abs(ka)).toFixed(2)}`,
            to: kb === 0 ? 'прямая' : `R=${(1 / Math.abs(kb)).toFixed(2)}`,
          });
        }
      }
    }
  }
  const total = out.straightLen + out.curvedLen;
  out.straightShare = total ? out.straightLen / total : 0;
  return out;
}

/**
 * СВЕРКА КАЧЕСТВА: стало ли хуже, чем было у руки.
 * Возвращает список претензий; пустой список = не ухудшил.
 */
export function contourDiff(refSubs, genSubs, o = {}) {
  const a = joints(refSubs, o);
  const b = joints(genSubs, o);
  const issues = [];

  if (b.breaks.length > a.breaks.length) {
    issues.push(
      `РАЗЛОМЫ: у генерата ${b.breaks.length} против ${a.breaks.length} у руки` +
        (b.breaks[0] ? ` (наибольший ${Math.max(...b.breaks.map((x) => x.gap)).toFixed(3)} ед)` : ''),
    );
  }
  if (b.kinks.length > a.kinks.length + 1) {
    issues.push(
      `ПЕРЕЛОМЫ-ДРЕБЕЗГ: ${b.kinks.length} против ${a.kinks.length}` +
        (b.kinks.length ? ` (наибольший ${Math.max(...b.kinks.map((x) => x.deg)).toFixed(2)}°)` : ''),
    );
  }
  // угловатость: доля прямых выросла заметно ⟹ дуги заменены ломаной
  if (b.straightShare > a.straightShare + 0.06) {
    issues.push(
      `УГЛОВАТОСТЬ: прямых ${(b.straightShare * 100).toFixed(0)}% длины против ${(a.straightShare * 100).toFixed(0)}% — дуги подменены ломаной`,
    );
  }
  if (b.stiff.length > a.stiff.length + 1) {
    const worst = b.stiff.reduce((m, x) => Math.max(m, x.jump), 0);
    issues.push(`ЖЁСТКОСТЬ: ${b.stiff.length} узлов с перепадом кривизны против ${a.stiff.length} (худший ×${worst.toFixed(1)} пера)`);
  }
  // намеренные углы: их стало БОЛЬШЕ ⟹ скругление потеряно
  if (b.corners.length > a.corners.length + 1) {
    issues.push(`УГЛОВ: ${b.corners.length} против ${a.corners.length} — скругление потеряно`);
  }
  return { ref: a, gen: b, issues };
}

export { norm2pi };

/**
 * Разбор одного глифа против его оригинала.
 * @returns {{name, variant, dev?, ref, gen, issues}|null}
 */
export async function auditGlyph(name, variant, opt = {}) {
  const { glyphs, buildGlyph } = await import('./registry.js');
  const { readFileSync, existsSync } = await import('node:fs');
  const { pathsFromSvg } = await import('./core/parse.js');
  const def = glyphs.get(name);
  if (!def) return null;
  const file = `${opt.root ?? '.'}/reference/${variant === 'filled' ? 'Filled' : 'Outline'}/${name}${variant === 'filled' ? '_filled' : ''}.svg`;
  if (!existsSync(file)) return null;
  const refD = pathsFromSvg(readFileSync(file, 'utf8')).map((p) => p.d).join(' ');
  const path = buildGlyph(name, variant, def.refAxes ? { axes: def.refAxes } : {});
  const pen = variant === 'filled' ? 2.4 : 1.8;
  const r = contourDiff(edgesOfD(refD), edgesOfPath(path), { pen });
  return { name, variant, ...r };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const only = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;
  const verbose = argv.includes('-v');
  await import('./glyphs/index.js');
  const { glyphs } = await import('./registry.js');
  const { ROOT } = await import('./build.js');

  let bad = 0;
  let seen = 0;
  for (const name of [...glyphs.keys()].sort()) {
    if (only && !only.has(name)) continue;
    for (const variant of ['outline', 'filled']) {
      const a = await auditGlyph(name, variant, { root: ROOT });
      if (!a) continue;
      seen++;
      if (a.issues.length) {
        bad++;
        console.log(`\n${name}/${variant}`);
        for (const q of a.issues) console.log('  • ' + q);
      }
      if (verbose) {
        const f = (j) => `разломов ${j.breaks.length}, дребезга ${j.kinks.length}, углов ${j.corners.length}, жёстких ${j.stiff.length}, прямых ${(j.straightShare * 100).toFixed(0)}%`;
        console.log(`${a.issues.length ? '  ' : ''}${name}/${variant}\n    рука: ${f(a.ref)}\n    я:    ${f(a.gen)}`);
      }
    }
  }
  console.log(`\nконтур: ${bad} из ${seen} вариантов ухудшили качество контура относительно руки`);
}
