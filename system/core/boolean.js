/**
 * system/core/boolean.js — аналитическая разность путей.
 *
 * Единственная нужная системе булева операция — ВЫЧИТАНИЕ, потому что все
 * накладные классы (перечёркивание, бейдж, конструктивный зазор) описываются
 * одинаково: «вырезать из глифа тень накладки, расширенную на охранный зазор».
 * Негативное пространство здесь не проверяется постфактум — оно СТРОИТСЯ.
 *
 * Операция аналитическая: прямая остаётся прямой, дуга — дугой, центр дуги
 * сохраняется. Полигонализации нет ⇒ нет ступенек на скруглениях.
 *
 * Ориентация: внешние контуры — по часовой (положительная площадь при y вниз),
 * дырки — против. Это позволяет выводить систему на fill-rule nonzero и
 * структурно исключить класс дефектов «контур залился блобом».
 */

import { v2 } from './num.js';
import { Path, edgeAt, edgeEnd, edgeStart, edgeLen, splitEdge, pathFromEdges } from './path.js';
import { intersectEdges } from './intersect.js';

const JOIN_TOL = 1e-5;
const key = (p) => `${Math.round(p[0] * 1e5)}:${Math.round(p[1] * 1e5)}`;

/** Ненулевая намотка: точка внутри пути. */
export function containsPoint(path, p, tol = 0.004) {
  const polys = path.flatten(tol);
  let w = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i];
      const b = poly[(i + 1) % poly.length];
      if (a[1] <= p[1]) {
        if (b[1] > p[1] && v2.cross(v2.sub(b, a), v2.sub(p, a)) > 0) w++;
      } else if (b[1] <= p[1] && v2.cross(v2.sub(b, a), v2.sub(p, a)) < 0) w--;
    }
  }
  return w !== 0;
}

/** Суммарная знаковая площадь (положительная = преобладает «по часовой»). */
export function signedArea(path) {
  let a = 0;
  for (let i = 0; i < path.subs.length; i++) a += path.subArea(i);
  return a;
}

/** Привести внешний контур к «по часовой» (для регионов-вычитателей). */
export function orientCW(path) {
  const p = path.clone();
  if (signedArea(p) < 0) p.reverse();
  return p;
}

function collectSplits(aEdges, bEdges) {
  const ta = aEdges.map(() => []);
  const tb = bEdges.map(() => []);
  for (let i = 0; i < aEdges.length; i++) {
    for (let j = 0; j < bEdges.length; j++) {
      for (const x of intersectEdges(aEdges[i], bEdges[j])) {
        ta[i].push(x.t1);
        tb[j].push(x.t2);
      }
    }
  }
  return [ta, tb];
}

function splitAll(edges, ts) {
  const out = [];
  for (let i = 0; i < edges.length; i++) out.push(...splitEdge(edges[i], ts[i]));
  return out;
}

const midOf = (e) => edgeAt(e, 0.5);

function reverseEdge(e) {
  if (e.type === 'line') return { ...e, a: e.b, b: e.a };
  if (e.type === 'arc') return { ...e, a0: e.a1, a1: e.a0, a: e.b, b: e.a };
  return { ...e, p: [e.p[3], e.p[2], e.p[1], e.p[0]] };
}

/**
 * Сшивка ориентированных рёбер в замкнутые циклы.
 * Предпочтение отдаётся смене источника (subject↔region): на честном
 * пересечении куски всегда чередуются, и это снимает неоднозначность узла.
 */
const dirOut = (e) => v2.norm(v2.sub(edgeAt(e, Math.min(0.02, 0.5)), edgeStart(e)));
const dirIn = (e) => v2.norm(v2.sub(edgeEnd(e), edgeAt(e, Math.max(0.98, 0.5))));

/**
 * Правило выбора продолжения В УЗЛЕ ОБЪЕДИНЕНИЯ — не то же, что при вычитании.
 *
 * При честном пересечении куски subject и region строго чередуются, и смена
 * источника снимает неоднозначность. В объединении узел бывает КАСАТЕЛЬНЫМ:
 * стартовый колпачок хвоста стрелки упирается в дугу сустава головы, в точке
 * сходятся четыре конца, и переключаться на соседнюю фигуру там НЕЛЬЗЯ —
 * обход обязан идти по внешней стороне. Правило внешней стороны одно: из всех
 * продолжений брать самое «правое» относительно входного направления, то есть
 * максимальный поворот по обходу. Иначе цепь не замыкается, а незамкнутую
 * сшивка дотягивает хордой — это и есть косой разруб поперёк глифа.
 */
function pickOutermost(edges, cand, cur) {
  const tIn = dirIn(edges[cur]);
  let best = cand[0];
  let bestA = Infinity;
  for (const j of cand) {
    const tOut = dirOut(edges[j]);
    const a = Math.atan2(v2.cross(tIn, tOut), v2.dot(tIn, tOut));
    if (a < bestA) {
      bestA = a;
      best = j;
    }
  }
  return best;
}

function chain(edges, o = {}) {
  const buckets = new Map();
  edges.forEach((e, i) => {
    const k = key(edgeStart(e));
    if (!buckets.has(k)) buckets.set(k, []);
    buckets.get(k).push(i);
  });
  const used = new Array(edges.length).fill(false);
  const loops = [];
  for (let i = 0; i < edges.length; i++) {
    if (used[i]) continue;
    const loop = [];
    let cur = i;
    let guard = 0;
    while (cur != null && !used[cur] && guard++ < edges.length + 4) {
      used[cur] = true;
      loop.push(edges[cur]);
      const end = edgeEnd(edges[cur]);
      let cand = (buckets.get(key(end)) || []).filter((j) => !used[j]);
      if (!cand.length) {
        /**
         * Ключ узла — округление координаты, и координата умеет садиться РОВНО
         * на границу округления: 14.845775 → 1484577.5, где половинки уходят в
         * разные стороны от малейшей разницы в последнем бите. Тогда две
         * половины одной петли получают разные ключи, обход обрывается, и
         * незамкнутая цепь достраивается хордой — разруб поперёк глифа.
         *
         * Промах по ключу поэтому не приговор: добираем ближайшее начало в
         * пределах допуска. Путь дорогой, но случается только на этих самых
         * граничных узлах.
         */
        let best = null;
        let bd = JOIN_TOL * 20;
        for (let j = 0; j < edges.length; j++) {
          if (used[j]) continue;
          const d = v2.dist(edgeStart(edges[j]), end);
          if (d < bd) {
            bd = d;
            best = j;
          }
        }
        if (best == null) {
          cur = null;
          break;
        }
        cand = [best];
      }
      if (o.outermost) {
        cur = cand.length > 1 ? pickOutermost(edges, cand, cur) : cand[0];
      } else {
        const src = edges[cur].src;
        cur = cand.find((j) => edges[j].src !== src) ?? cand[0];
      }
    }
    if (loop.length) {
      const closed = v2.dist(edgeEnd(loop[loop.length - 1]), edgeStart(loop[0])) < JOIN_TOL * 20;
      loops.push({ edges: loop, closed });
    }
  }
  return loops;
}

/**
 * subject − region. Регион должен быть замкнутым путём; его ориентация
 * нормализуется внутри.
 *
 * @param {Path} subject
 * @param {Path} region
 * @returns {Path}
 */
/**
 * ГРАНИЦА ОБЪЕДИНЕНИЯ многосоставного региона.
 *
 * Вычитать перекрывающиеся куски ПООЧЕРЁДНО нельзя. Стрелка — это голова и
 * хвост, налегающие друг на друга у острия; если резать диск сначала головой,
 * а потом хвостом, второй рез идёт по краю уже вырезанной дырки и оставляет
 * лучину. Сложить же оба подпути развёрнутыми тоже нельзя: под nonzero в их
 * перекрытии намотка даёт −1, то есть дырка в дырке снова становится чернилами.
 *
 * Правильный ответ один: сперва граница ОБЪЕДИНЕНИЯ. Она состоит из тех кусков
 * контуров, что не лежат строго внутри другого подпути региона.
 */
/**
 * ПЕРЕСЕЧЕНИЕ ИЛИ КАСАНИЕ.
 *
 * Хвост стрелки выходит ровно из вершины шеврона, поэтому его кромка КАСАЕТСЯ
 * дуги сустава — в одной точке, не пересекая её. Резать контур в такой точке
 * нельзя: кусок не входит внутрь соседа и не выходит из него, а разрез рождает
 * узел, в котором сходятся четыре конца, и сшивка замыкает по ним лишнюю петлю.
 *
 * Проверка прямая и ровно та, ради которой разрез и делается: меняется ли
 * «внутри соседа» при переходе через точку. Не меняется — это касание.
 */
function crosses(edge, t, other) {
  // Отступ задаётся в ЕДИНИЦАХ КАНВЫ, а не в параметре: у короткого куска
  // параметрические 0.001 — это тысячные доли единицы, то есть меньше допуска
  // самого теста принадлежности, и обе пробы читаются одинаково. Тогда честное
  // пересечение объявляется касанием, разрез не делается, и сшивка режет глиф
  // пополам — что и было видно на краю оси rond.
  const L = Math.max(edgeLen(edge), 1e-6);
  const d = Math.min(0.35, 0.03 / L);
  const before = edgeAt(edge, Math.max(0, t - d));
  const after = edgeAt(edge, Math.min(1, t + d));
  return containsPoint(other, before) !== containsPoint(other, after);
}

export function unionBoundary(reg) {
  const subs = reg.subs.filter((s) => s.segs.length);
  if (subs.length < 2) return reg;
  const paths = subs.map((s) => new Path([s]));
  const per = paths.map((p) => p.edges());
  const ts = per.map((es) => es.map(() => []));
  /**
   * Пара считается ОДИН раз, и обе стороны режутся по одному и тому же
   * пересечению. Если звать intersectEdges для (i,j) и (j,i) порознь, точки
   * выходят чуть разные — численный решатель кубики к порядку не безразличен, —
   * концы кусков перестают совпадать, сшивка не находит стык и возвращает
   * ОТКРЫТУЮ цепь. Достроенная хордой, она и даёт разруб поперёк глифа.
   */
  for (let i = 0; i < per.length; i++) {
    for (let j = i + 1; j < per.length; j++) {
      for (let a = 0; a < per[i].length; a++) {
        for (let b = 0; b < per[j].length; b++) {
          for (const x of intersectEdges(per[i][a], per[j][b])) {
            if (!crosses(per[i][a], x.t1, paths[j])) continue;
            ts[i][a].push(x.t1);
            ts[j][b].push(x.t2);
          }
        }
      }
    }
  }
  const kept = [];
  for (let i = 0; i < per.length; i++) {
    for (const e of splitAll(per[i], ts[i])) {
      const m = midOf(e);
      let inside = false;
      for (let j = 0; j < paths.length && !inside; j++) if (j !== i && containsPoint(paths[j], m)) inside = true;
      // `src` — не украшение: в узле объединения сходятся куски РАЗНЫХ фигур,
      // и обход обязан переключаться между ними. Без пометки chain выбирает
      // продолжение произвольно и на касательных контактах замыкает лишнюю
      // петлю площадью 0.1 ед² — ту самую лучину, что читается трещиной.
      if (!inside) kept.push({ ...e, src: i });
    }
  }

  /**
   * СОВПАВШИЕ КУСКИ ГРАНИЦЫ. Хвост стрелки выходит из вершины шеврона, и его
   * стартовый колпачок ложится РОВНО на дугу сустава головы: две фигуры дают
   * здесь один и тот же кусок границы. Ни один из них не «внутри» другого,
   * поэтому фильтр выше пропускает оба, граница задваивается, и сшивка
   * замыкает по дублю лишнюю петлю.
   *
   * Сонаправленные дубли — это одна и та же внешняя граница, оставляем одну.
   * Встречные означали бы, что кусок внутренний для объединения, — убираем оба.
   */
  const dedup = [];
  const dropped = new Set();
  for (let a = 0; a < kept.length; a++) {
    if (dropped.has(a)) continue;
    let same = true;
    let dup = false;
    for (let b = a + 1; b < kept.length; b++) {
      if (dropped.has(b) || kept[b].src === kept[a].src) continue;
      if (v2.dist(midOf(kept[a]), midOf(kept[b])) > 1e-4) continue;
      dup = true;
      dropped.add(b);
      same = v2.dist(edgeStart(kept[a]), edgeStart(kept[b])) < 1e-4;
    }
    if (!dup || same) dedup.push(kept[a]);
  }
  const out = new Path();
  for (const l of chain(dedup)) if (l.edges.length >= 2) out.add(pathFromEdges(l.edges, true));
  return out.isEmpty() ? reg : out;
}

export function cut(subject, region) {
  const reg = unionBoundary(orientCW(region));
  const sEdges = subject.edges().map((e) => ({ ...e, src: 's' }));
  const rEdges = reg.edges().map((e) => ({ ...e, src: 'r' }));
  const [ts, tr] = collectSplits(sEdges, rEdges);
  const anyHit = ts.some((t) => t.length) || tr.some((t) => t.length);

  if (!anyHit) {
    const out = new Path();
    for (let i = 0; i < subject.subs.length; i++) {
      const sub = subject.subs[i];
      if (!sub.segs.length) continue;
      const probe = sub.segs[0].to;
      if (!containsPoint(reg, probe)) out.subs.push(structuredClone(sub));
    }
    // регион целиком внутри тела — становится дыркой
    const rp = reg.subs[0];
    if (rp && rp.segs.length && containsPoint(subject, rp.segs[0].to) && !out.isEmpty()) {
      out.add(reg.clone().reverse());
    }
    return out;
  }

  const sParts = splitAll(sEdges, ts).filter((e) => !containsPoint(reg, midOf(e)));
  const rParts = splitAll(rEdges, tr)
    .filter((e) => containsPoint(subject, midOf(e)))
    .map((e) => ({ ...reverseEdge(e), src: 'r' }));

  const loops = chain([...sParts, ...rParts]);
  const out = new Path();
  for (const l of loops) {
    if (l.edges.length < 2 && !l.closed) continue;
    out.add(pathFromEdges(l.edges, true));
  }
  return out;
}

/** Вычесть несколько регионов подряд. */
export function cutAll(subject, regions) {
  let p = subject;
  for (const r of regions) {
    if (r && !r.isEmpty()) p = cut(p, r);
  }
  return p;
}

export { pathFromEdges };
