// Видящие гейты — ловят то, что видит глаз дизайнера, но слепа площадная IoU:
//   1. eoNzDisagree  — доля площади, где evenodd ≠ nonzero (класс «прорезь»:
//      перекрытие суб-путей даёт дыру под evenodd — reload/arrow наконечники).
//   2. handDisplacement — робастное p90 смещение контура генерат↔рука в юнитах
//      (уход формы: бабочка play-skip, тонкий plus, чужое скругление pause).
// Обе меры детерминированы и считаются по ВСЕМУ корпусу, не по выборке-глазу.
import { samplePolylines } from './curve-sampling.js';

// ── точка внутри чернил: even-odd (чётность) и nonzero (винтинг) ──
function insideEO(px, py, polys) {
  let inside = false;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}
function windingNZ(px, py, polys) {
  let wn = 0;
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, yi] = poly[i], [xj, yj] = poly[j];
      // луч вправо; учитываем направление ребра (винтинг)
      if (yi <= py) {
        if (yj > py && (xj - xi) * (py - yi) - (px - xi) * (yj - yi) > 0) wn++;
      } else if (yj <= py && (xj - xi) * (py - yi) - (px - xi) * (yj - yi) < 0) wn--;
    }
  }
  return wn;
}
function polysOf(d) {
  // замыкаем каждую полилинию (samplePolylines оставляет открытой, если нет Z)
  return samplePolylines(d, 12).map((p) => (p.length && (p[0][0] !== p[p.length - 1][0] || p[0][1] !== p[p.length - 1][1]) ? [...p, p[0]] : p));
}
function bbox(polys) {
  let a = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polys) for (const [x, y] of p) { if (x < a[0]) a[0] = x; if (y < a[1]) a[1] = y; if (x > a[2]) a[2] = x; if (y > a[3]) a[3] = y; }
  return a;
}

/**
 * ПРОДАКШН-ГЕЙТ «чёрный блоб». Иконка со сквозными дырами (кольцо, лицо-в-круге)
 * рендерится дырявой ТОЛЬКО под evenodd. Если файл не объявил fill-rule=evenodd —
 * браузер применяет nonzero по умолчанию → одинаково-намотанные контуры сливаются
 * в СПЛОШНОЙ силуэт. Глаз видит «залитый диск», площадная IoU — нет.
 * Дискриминатор = высокое EO≠NZ И отсутствие объявленного evenodd в файле.
 * @param {string} rawSvg  сырой текст .svg-файла
 * @param {number} tau     порог «есть геометрия дыр», % (по данным корпуса ~5)
 */
export function fillRuleBlobBug(rawSvg, tau = 5) {
  const declaresEvenOdd = /fill-rule\s*=\s*["']?\s*evenodd/i.test(rawSvg);
  const d = (rawSvg.match(/[<]path[^>]*\sd=["']([^"']+)["']/gi) || [])
    .map((p) => (p.match(/\sd=["']([^"']+)["']/i) || [, ''])[1])
    .filter((s) => !/M0\s*0[hH]24[vV]24[hH]0[zZ]/.test(s)) // клип-рамка Figma
    .join(' ');
  if (!d.trim()) return { disagreePct: 0, declaresEvenOdd, isBlobBug: false };
  // Короткие замыкания (перед дорогим растровым сканом):
  //  1. объявлен evenodd → блоб невозможен, автор задал намерение;
  //  2. <2 подпутей (M) → нет замкнутой контрформы → залить нечего.
  if (declaresEvenOdd) return { disagreePct: 0, declaresEvenOdd, isBlobBug: false };
  if ((d.match(/[Mm]/g) || []).length < 2) return { disagreePct: 0, declaresEvenOdd, isBlobBug: false };
  const { disagreePct } = eoNzDisagree(d, 0.2);
  return { disagreePct, declaresEvenOdd, isBlobBug: disagreePct > tau };
}

/** Доля площади nonzero-чернил, где вердикт EO≠NZ. >0 => латентная «прорезь». */
export function eoNzDisagree(d, step = 0.1) {
  const polys = polysOf(d);
  if (!polys.length) return { eo: 0, nz: 0, disagreePct: 0 };
  const [minX, minY, maxX, maxY] = bbox(polys);
  let eo = 0, nz = 0, diff = 0;
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      const iEO = insideEO(x, y, polys);
      const iNZ = windingNZ(x, y, polys) !== 0;
      if (iEO) eo++;
      if (iNZ) nz++;
      if (iEO !== iNZ) diff++;
    }
  }
  return { eo, nz, disagreePct: nz ? (diff / nz) * 100 : (diff ? 100 : 0) };
}

// ── робастное смещение контура (p90 + пик), в юнитах ──
function pts(d) { return samplePolylines(d, 14).flat(); }
function nn(A, B) {
  const out = [];
  for (const a of A) { let m = Infinity; for (const b of B) { const dx = a[0] - b[0], dy = a[1] - b[1], s = dx * dx + dy * dy; if (s < m) m = s; } out.push(Math.sqrt(m)); }
  return out;
}
/** p90 (типичное) и max (пик) смещение контура dGen↔dHand в юнитах. */
export function handDisplacement(dGen, dHand) {
  const A = pts(dGen), B = pts(dHand);
  if (!A.length || !B.length) return null;
  const dd = nn(A, B).concat(nn(B, A)).sort((x, y) => x - y);
  const q = (p) => dd[Math.min(dd.length - 1, Math.floor(p * dd.length))];
  return { p90: q(0.9), max: dd[dd.length - 1] };
}
