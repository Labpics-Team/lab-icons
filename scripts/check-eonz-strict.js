/**
 * check-eonz-strict.js — строгий шов-гейт отгрузки: EO≡NZ точно + стык без пинча.
 *
 * КЛАСС дефекта (дыра check-fill-rule, пойман владельцем на зуме): blob-гейт
 * калиброван на БЛОБЫ (расхождения 63–68% площади), а МАЛЫЕ артефакты стыков
 * (1–5% и меньше) проскакивают его порог: белый полумесяц в стыке
 * наконечник↔палочка (arrow-back-circle), белый ромбик в центре креста (close).
 * Замер корпуса 2026-07-09 показал ДВЕ физики одного класса «не-сварной стык»:
 *   1. ЛИНЗА — перекрытие одноимённо намотанных суб-путей: под evenodd вырезается
 *      белым, под nonzero заливается (EO≠NZ). Бывает суб-пиксельной (глубина
 *      0.015 у arrow-back-circle — грид 0.12 слеп, нужна тонкая полоса у стыка).
 *   2. ПИНЧ — касание без шва: круглый кап тангенциально касается грани сиблинга;
 *      перекрытия нет (EO≡NZ ТОЧНО, у close — 0 точек на любом шаге!), но глаз
 *      видит белые клинья, сходящиеся в точку касания (тот самый «ромбик»).
 * Гейт мерит МАТЕРИАЛИЗОВАННУЮ ОТГРУЗКУ (svg/), не только генерат: ловит и
 * класс «stale-материализация» (component: генерат чист, файл — нет).
 *
 * Инварианты (только для status=generated — промоутнутый генерат обязан быть
 * сварен; руки вне юрисдикции до своего промоушена):
 *   А. EO≡NZ ТОЧНО: 0 точек расхождения на полной сетке 0.12 (паттерн
 *      test/wave3-play.test.js) И на тонкой сетке 0.015 в полосе стыков пар
 *      суб-путей. Строже blob-порога: не «меньше 5%», а НОЛЬ.
 *   Б. СТЫК = ШОВ: пара суб-путей ближе клиренса обязана примыкать гранями на
 *      длину настоящего торца; точечное касание/волосок — дефект.
 *
 * Пороги — ВЫВОД из semantics/grid.json, не подгонка (промежуток классов
 * подтверждён замером корпуса, как у blob-гейта «0% против 63%»):
 *   CLEARANCE = clearanceMin·canvas (0.8): минимальный ЛЕГАЛЬНЫЙ охранный зазор
 *     РАЗДЕЛЬНЫХ элементов (тот же токен, что у check-adjacency). Пара ближе —
 *     «в стыке», обязана быть сварена.
 *   MIN_SEAM = min(strokeWidth)·canvas (1.5): торец «встык» несёт всю ширину
 *     пера части; тоньше самого тонкого пера сетки шов не бывает ни у одной
 *     конструкции. Замер: настоящие швы (сокеты time) ≥ 3.35, пинчи ≤ 1.40 —
 *     порог в промежутке, наблюдений внутри промежутка нет.
 *   CONTACT_TOL = 0.02: допуск совпадения граней = квантование решётки f3
 *     (1e-3) + полигонизация кривых (96 сэмплов/сегмент: прогиб хорды ≤ 6e-3
 *     при максимальном радиусе сетки) с запасом ≥3×.
 *
 * Режимы: report (по умолчанию, exit 0) / --strict (нарушение → exit 1).
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { samplePolylines } from './lib/curve-sampling.js';
import { renderedPathData } from './lib/icon-geometry.js';

// ── пороги из сетки (см. шапку) ─────────────────────────────────────────────
const COARSE_STEP = 0.12; // полная сетка (паттерн wave3-play)
const FINE_STEP = 0.015;  // тонкая сетка полосы стыка (линза глубиной ≥ CONTACT_TOL видна)
const FINE_BAND = 0.24;   // полоса вокруг границ стыка = 2 ячейки полной сетки
const CONTACT_TOL = 0.02; // допуск совпадения граней (решётка f3 + полигонизация)
const RESAMPLE_DS = 0.05; // шаг обхода границы при замере шва
const SAMPLES = 96;       // сэмплов на сегмент кривой (прогиб хорды ≤ 6e-3)

/**
 * Чернила точки под обоими правилами за один проход (паттерн wave3-play):
 * [evenodd (чётность пересечений), nonzero (ненулевая намотка)].
 */
function inkBoth(polys, x, y) {
  let hits = 0;
  let wind = 0;
  for (const poly of polys) {
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      if (y1 > y !== y2 > y && x < x1 + ((y - y1) / (y2 - y1)) * (x2 - x1)) {
        hits++;
        wind += y2 > y1 ? 1 : -1;
      }
    }
  }
  return [hits % 2 === 1, wind !== 0];
}

/** Точка внутри полигона (evenodd ray-casting). */
function pointInPoly(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Минимальное расстояние точки до рёбер замкнутой полилинии. */
function distToPoly(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const vx = b[0] - a[0];
    const vy = b[1] - a[1];
    const wx = p[0] - a[0];
    const wy = p[1] - a[1];
    const L2 = vx * vx + vy * vy || 1e-18;
    let t = (wx * vx + wy * vy) / L2;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const dx = wx - t * vx;
    const dy = wy - t * vy;
    const dd = dx * dx + dy * dy;
    if (dd < best) best = dd;
  }
  return Math.sqrt(best);
}

/** Равномерный ресэмплинг границы по длине дуги (шаг ds). */
function resampleBoundary(poly, ds) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const n = Math.max(1, Math.ceil(len / ds));
    for (let k = 0; k < n; k++) {
      out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
  }
  return out;
}

/** EO≠NZ на полной сетке (инвариант А, крупная фаза). */
export function eoNzMismatchGrid(polys, cw, step = COARSE_STEP) {
  let mismatch = 0;
  for (let x = step / 2; x < cw; x += step) {
    for (let y = step / 2; y < cw; y += step) {
      const [eo, nz] = inkBoth(polys, x, y);
      if (eo !== nz) mismatch++;
    }
  }
  return mismatch;
}

/**
 * Полный строгий отчёт по склеенному d одного варианта.
 * @param {string} d — все суб-пути файла одним path-data
 * @param {number} cw — ширина канвы
 * @returns {{coarse:number, fine:number, seams:Array, grid:{clearance:number,minSeam:number}}}
 *   coarse/fine — точки EO≠NZ; seams — пары-нарушители шва
 *   {i, j, minDist, contactLen} (пинч/волосок).
 */
export function strictSeamReport(d, cw, grid) {
  const clearance = grid.ratios.clearanceMin * cw;
  // перья сетки = все токены strokeWidth, КРОМЕ служебных (capRadius — радиус
  // терминала, tolerance — допуск веса): новый более тонкий токен пера сам
  // сдвинет порог, служебные величины швом не являются.
  const NOT_PEN = new Set(['capRadius', 'tolerance']);
  const minSeam =
    Math.min(
      ...Object.entries(grid.ratios.strokeWidth)
        .filter(([k, v]) => !NOT_PEN.has(k) && typeof v === 'number')
        .map(([, v]) => v),
    ) * cw;
  const polys = samplePolylines(d, SAMPLES).filter((p) => p.length > 2);
  const coarsePolys = samplePolylines(d, 24).filter((p) => p.length > 2);
  const coarse = eoNzMismatchGrid(coarsePolys, cw);

  // границы пар «в стыке»: тонкая фаза меряется только там (полоса FINE_BAND)
  const rs = polys.map((p) => resampleBoundary(p, RESAMPLE_DS));
  const seams = [];
  const bandPts = [];
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      let minDist = Infinity;
      let contact = 0;
      const near = [];
      for (const p of rs[i]) {
        const dd = distToPoly(p, polys[j]);
        if (dd < minDist) minDist = dd;
        if (dd <= CONTACT_TOL) contact++;
        if (dd <= FINE_BAND) near.push(p);
      }
      if (minDist >= clearance) continue; // легальный клиренс раздельных частей
      bandPts.push(...near);
      const contactLen = contact * RESAMPLE_DS;
      // вложение целиком (кольцо/вырез, границы дальше CONTACT_TOL повсюду) —
      // легально и уже отсечено клиренсом; здесь пара В СТЫКЕ: шов или дефект.
      if (contactLen < minSeam) seams.push({ i, j, minDist, contactLen });
    }
  }

  // тонкая фаза EO≠NZ: сетка FINE_STEP в полосе вокруг границ стыков
  let fine = 0;
  if (bandPts.length > 0) {
    const cells = new Set();
    const half = Math.ceil(FINE_BAND / FINE_STEP);
    for (const [px, py] of bandPts) {
      const cx = Math.round(px / FINE_STEP);
      const cy = Math.round(py / FINE_STEP);
      for (let ax = cx - half; ax <= cx + half; ax++) {
        for (let ay = cy - half; ay <= cy + half; ay++) cells.add(ax * 65536 + ay);
      }
    }
    for (const key of cells) {
      const ax = Math.floor(key / 65536);
      const ay = key - ax * 65536;
      const x = ax * FINE_STEP;
      const y = ay * FINE_STEP;
      if (x < 0 || y < 0 || x > cw || y > cw) continue;
      const [eo, nz] = inkBoth(polys, x, y);
      if (eo !== nz) fine++;
    }
  }
  return { coarse, fine, seams, grid: { clearance, minSeam } };
}

/**
 * Прогон по списку файлов отгрузки.
 * @param {Array<{name:string, content:string}>} files — svg generated-вариантов
 * @param {object} grid — semantics/grid.json
 * @returns {{fails:Array<{name:string, coarse:number, fine:number, seams:Array}>, minSeam:number}}
 */
export function findStrictViolations(files, grid) {
  const cw = grid.canvas.width;
  const fails = [];
  let minSeam = 0;
  for (const { name, content } of files) {
    const d = renderedPathData(content).join('');
    const r = strictSeamReport(d, cw, grid);
    minSeam = r.grid.minSeam;
    if (r.coarse > 0 || r.fine > 0 || r.seams.length > 0) {
      fails.push({ name, coarse: r.coarse, fine: r.fine, seams: r.seams });
    }
  }
  return { fails, minSeam };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
  const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
  const strict = process.argv.includes('--strict');

  const files = [];
  for (const [name, entry] of Object.entries(anatomy.glyphs)) {
    for (const variant of ['outline', 'filled']) {
      if (entry.status?.[variant] !== 'generated') continue;
      const file =
        variant === 'outline'
          ? join(root, 'svg', 'Outline', `${name}.svg`)
          : join(root, 'svg', 'Filled', `${name}_filled.svg`);
      if (!existsSync(file)) continue; // отсутствие файла ловит check-anatomy
      files.push({ name: `${name}/${variant}`, content: readFileSync(file, 'utf8') });
    }
  }

  const { fails, minSeam } = findStrictViolations(files, grid);
  if (fails.length > 0) {
    console.log(`check-eonz-strict: ${strict ? 'FAIL' : 'REPORT'} — ${fails.length} generated-вариантов с не-сварным стыком:`);
    for (const f of fails) {
      const parts = [];
      if (f.coarse > 0) parts.push(`EO≠NZ ${f.coarse} точек (сетка ${COARSE_STEP})`);
      if (f.fine > 0) parts.push(`EO≠NZ ${f.fine} точек (полоса стыка, сетка ${FINE_STEP})`);
      for (const s of f.seams) {
        parts.push(`пинч суб-путей ${s.i}~${s.j}: контакт ${s.contactLen.toFixed(2)} < шва ${minSeam} при зазоре ${s.minDist.toFixed(4)}`);
      }
      console.log(`  - ${f.name}: ${parts.join('; ')}`);
    }
    if (strict) process.exit(1);
  } else {
    console.log(`check-eonz-strict: OK — ${files.length} generated-вариантов отгрузки сварены (EO≡NZ точно, стыки со швом)`);
  }
}
