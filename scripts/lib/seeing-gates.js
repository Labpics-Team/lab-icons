// Видящие гейты — ловят то, что видит глаз дизайнера, но слепа площадная IoU:
//   1. fillRuleBlobBug — «чёрный блоб»: контур со сквозной дырой без evenodd
//      заливается в сплошной силуэт под nonzero (браузер по умолчанию). Модель —
//      симуляция рендера ПО-ПУТЁВО (own fill-rule каждого path), не конкатенация.
//   2. eoNzDisagree — примитив: доля площади, где evenodd ≠ nonzero для одного d.
// Меры детерминированы и считаются по ВСЕМУ корпусу, не по выборке-глазу.
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

// Разбор <path> с СОБСТВЕННЫМ fill-rule (SVG применяет правило заливки ПО-ПУТЁВО;
// в корпусе нет контейнерного fill-rule на <svg>/<g> — проверено, так что own = эффективное).
function pathsOf(rawSvg) {
  const out = [];
  for (const tag of rawSvg.match(/<path\b[^>]*>/gi) || []) {
    const dm = tag.match(/\sd=["']([^"']+)["']/i);
    if (!dm) continue;
    const d = dm[1];
    if (/M0\s*0[hH]24[vV]24[hH]0[zZ]/.test(d)) continue; // клип-рамка Figma — не геометрия
    out.push({ d, eo: /fill-rule\s*=\s*["']?\s*evenodd/i.test(tag), polys: polysOf(d) });
  }
  return out;
}
const inkedShipped = (paths, x, y) => paths.some((p) => (p.eo ? insideEO(x, y, p.polys) : windingNZ(x, y, p.polys) !== 0));
const inkedAllEO = (paths, x, y) => paths.some((p) => insideEO(x, y, p.polys));

/**
 * ПРОДАКШН-ГЕЙТ «чёрный блоб». Контур со сквозной дырой (кольцо, лицо-в-круге),
 * чьи под-контуры намотаны ОДИНАКОВО и path НЕ объявил fill-rule=evenodd →
 * браузер по умолчанию (nonzero) заливает дыру → сплошной силуэт. Глаз видит
 * «залитый диск», площадная IoU — нет.
 *
 * Модель = симуляция рендера ПО-ПУТЁВО (не конкатенация — она склеивала бы
 * раздельные path в ложные дыры на нахлёстах). Чернила as-shipped = OR по path
 * под ЭФФЕКТИВНЫМ правилом (own evenodd → evenodd, иначе nonzero). Блоб-дыра =
 * точка залита as-shipped, но ПУСТА, будь все path evenodd. Это ловит и mixed-файл
 * (один path evenodd, другой — кольцо без него: старый общефайловый чек его прятал).
 * @param {string} rawSvg  сырой текст .svg-файла
 * @param {number} tau     порог доли залитых дыр, % (чистые=0, блобы 63–68%)
 */
export function fillRuleBlobBug(rawSvg, tau = 5, step = 0.2) {
  const paths = pathsOf(rawSvg);
  const declaresEvenOdd = paths.some((p) => p.eo);
  if (!paths.length) return { disagreePct: 0, declaresEvenOdd, isBlobBug: false };
  // Блоб возможен только у path БЕЗ own-evenodd и с ≥2 под-путями (есть контрформа).
  const candidate = paths.some((p) => !p.eo && (p.d.match(/[Mm]/g) || []).length >= 2);
  if (!candidate) return { disagreePct: 0, declaresEvenOdd, isBlobBug: false };
  const [minX, minY, maxX, maxY] = bbox(paths.flatMap((p) => p.polys));
  let ship = 0, blob = 0;
  for (let y = minY; y <= maxY; y += step) {
    for (let x = minX; x <= maxX; x += step) {
      if (!inkedShipped(paths, x, y)) continue;
      ship++;
      if (!inkedAllEO(paths, x, y)) blob++; // залито сейчас, но дыра под evenodd
    }
  }
  const disagreePct = ship ? (blob / ship) * 100 : 0;
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
