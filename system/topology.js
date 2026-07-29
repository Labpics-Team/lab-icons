/**
 * system/topology.js — ТОПОЛОГИЯ И ШВЫ: из скольких кусков собран глиф, какие
 * из его просветов задуманы, и где форма держится на ниточке.
 *
 * Зачем. Требование звучало так: «считай островки в контейнере — если иконка
 * со швом, покажет больше нужного». Прямой счёт островков шва не ловит, потому
 * что шов — это НЕ разрыв. Два слоя, сведённые встык, остаются односвязными
 * чернилами: кусок как был один, так и остался, а в стыке живёт щель шириной
 * в пиксель. Считать надо не куски, а то, ЧТО МЕЖДУ НИМИ, и мерить это
 * линейкой, а не глазами.
 *
 * Отсюда три независимых зонда, каждый на свой класс дефекта.
 *
 *   ЧИСЛО КУСКОВ И ДЫРОК (topology). Дырка дырке рознь. Внутренность кольца,
 *   счётчик буквы, просвет в закладке — ЗАДУМАННЫЙ негатив, он широкий.
 *   Щель между двумя слоями — ТРЕЩИНА, она шириной в растровый пиксель.
 *   Разделяет их замер, а не вкус: у задуманного просвета вписанная окружность
 *   крупная, у трещины — с пиксель. Порог 2·maxR ≥ 0.5 ед (1/48 канвы) режет
 *   ровно по этой границе: тоньше полуединицы просветов в системе не бывает —
 *   такое не переживёт ни один рендер в 16 px.
 *
 *   ГРАНУЛОМЕТРИЯ (necks). Шов, который ещё не разошёлся, — это перешеек, и
 *   топологически он неотличим от здоровой формы: куски те же, дырок столько
 *   же. Но сожми чернила на r — и место, где ширина меньше 2r, рвётся, а
 *   здоровый штрих нет. Кривая ink(r) по возрастающим r и есть топологическая
 *   подпись: у руки и у генерата она обязана совпасть шаг в шаг. Это честная
 *   версия исходной идеи «считать острова» — острова считаются, но не у формы,
 *   а у её сжатий, и потому видят почти-шов до того, как он стал швом.
 *
 *   САМОЕ УЗКОЕ МЕСТО (minWidth). Гранулометрия говорит ЧТО, но не ГДЕ и не
 *   НАСКОЛЬКО. Минимум 2·r по гребню карты расстояний даёт число в единицах
 *   канвы и точку: вот здесь штрих пережат. Меряется по гребню, а не по всей
 *   маске, потому что у кромки расстояние равно нулю всегда и ни о чём не
 *   говорит.
 *
 * Эйлерова характеристика ink − holes идёт довеском: один инвариант, который
 * обязан совпасть, что бы ни случилось с посадкой и калибром.
 *
 *   node system/topology.js bookmarks
 *   node system/topology.js volume --filled
 */

import { edt } from './ductus.js';

/** 8-связность для чернил. */
const NB8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
/** 4-связность для фона. */
const NB4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
/**
 * Оси для разбора гребня: [поперёк A, поперёк B, вдоль A, вдоль B].
 * Перешеек — седло карты расстояний: поперёк штриха максимум, вдоль — минимум.
 */
const AXES = [
  [[0, 1], [0, -1], [1, 0], [-1, 0]],
  [[1, 0], [-1, 0], [0, 1], [0, -1]],
  [[1, 1], [-1, -1], [1, -1], [-1, 1]],
  [[1, -1], [-1, 1], [1, 1], [-1, -1]],
];

const r2 = (v) => Number(v.toFixed(2));
const r3 = (v) => Number(v.toFixed(3));

/** Геометрия растра по длине маски: канва, суперсэмплинг, сторона в пикселях. */
function grid(mask, o = {}) {
  const canvas = o.canvas ?? 24;
  const ss = o.ss ?? Math.round(Math.sqrt(mask.length) / canvas);
  return { canvas, ss, n: canvas * ss };
}

/**
 * Разметка связных компонент. Связность задаётся явно, потому что для чернил и
 * для фона она ОБЯЗАНА быть разной: 8-связные чернила двойственны 4-связному
 * фону. Возьми обе по 8 — и диагональный стык одновременно и соединит чернила,
 * и соединит дырку с внешним фоном; Эйлер после этого врёт.
 *
 * @returns {{labels:Int32Array, area:number[]}} area[id] — площадь в пикселях
 */
function label(mask, n, conn = 8) {
  const nb = conn === 4 ? NB4 : NB8;
  const labels = new Int32Array(mask.length).fill(-1);
  const area = [];
  const st = [];
  for (let s = 0; s < mask.length; s++) {
    if (!mask[s] || labels[s] >= 0) continue;
    const id = area.length;
    let a = 0;
    labels[s] = id;
    st.push(s);
    while (st.length) {
      const p = st.pop();
      const px = p % n;
      const py = (p - px) / n;
      a++;
      for (const [dx, dy] of nb) {
        const qx = px + dx;
        const qy = py + dy;
        if (qx < 0 || qy < 0 || qx >= n || qy >= n) continue;
        const q = qy * n + qx;
        if (mask[q] && labels[q] < 0) {
          labels[q] = id;
          st.push(q);
        }
      }
    }
    area.push(a);
  }
  return { labels, area };
}

/**
 * ТОПОЛОГИЯ ОДНОЙ МАСКИ.
 *
 * holes — все компоненты фона, не вышедшие на рамку канвы, с площадью и
 * максимальным вписанным радиусом. maxR берётся из карты расстояний ФОНА до
 * чернил: для точки внутри дырки это ровно радиус наибольшей окружности,
 * которая туда влезает, а 2·maxR — ширина просвета в самом широком месте.
 * Дальше просветы делятся порогом на задуманные (counters) и трещины (cracks).
 *
 * @param {Uint8Array} mask бинарная маска чернил
 * @param {{canvas?:number, ss?:number, counterWidth?:number}} [o]
 */
export function topology(mask, o = {}) {
  const { ss, n } = grid(mask, o);
  const ink = label(mask, n, 8).area.length;

  const bg = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) bg[i] = mask[i] ? 0 : 1;
  const { labels, area } = label(bg, n, 4);

  // Компонента фона, вышедшая на рамку, — это «снаружи», а не дырка.
  const outside = new Set();
  for (let k = 0; k < n; k++) {
    outside.add(labels[k]);
    outside.add(labels[(n - 1) * n + k]);
    outside.add(labels[k * n]);
    outside.add(labels[k * n + n - 1]);
  }

  // Одна карта расстояний на все дырки сразу: дырки разделены чернилами,
  // поэтому ближайший к точке дырки не-фон — всегда чернила её же стенки.
  const d2 = edt(bg, n);
  const peak = new Map();
  for (let i = 0; i < labels.length; i++) {
    const id = labels[i];
    if (id < 0 || outside.has(id)) continue;
    const prev = peak.get(id);
    if (!prev || d2[i] > prev.d2) peak.set(id, { d2: d2[i], i });
  }

  const holes = [...peak].map(([id, p]) => ({
    area: r2(area[id] / (ss * ss)),
    maxR: r3(Math.sqrt(p.d2) / ss),
    at: [r2(((p.i % n) + 0.5) / ss), r2(((p.i - (p.i % n)) / n + 0.5) / ss)],
  }));
  holes.sort((a, b) => b.maxR - a.maxR);

  const counterWidth = o.counterWidth ?? 0.5;
  const counters = holes.filter((h) => 2 * h.maxR >= counterWidth).length;
  return { ink, holes, counters, cracks: holes.length - counters, euler: ink - holes.length };
}

/**
 * ГРАНУЛОМЕТРИЯ ПО ЧЕРНИЛАМ. Эрозия на радиус r — это отбор точек, куда ещё
 * влезает перо радиуса r (dist ≥ r по карте расстояний), и пересчёт кусков.
 *
 * Читается кривая так: пока ink(r) держится на исходном числе кусков, форма
 * толще 2r везде. Скачок вверх на радиусе r — форма имеет перешеек тоньше 2r и
 * при таком сжатии рвётся именно там. Падение до нуля — вся форма тоньше 2r.
 * Сравнение двух кривых отвечает на вопрос «стало ли хуже» точнее, чем любое
 * одно число: у одинаковых конструкций кривые совпадают целиком.
 *
 * @param {Uint8Array} mask
 * @param {{canvas?:number, ss?:number, radii?:number[], minPart?:number}} [o]
 * @returns {{r:number, ink:number}[]}
 */
export function necks(mask, o = {}) {
  const { ss, n } = grid(mask, o);
  const radii = o.radii ?? [0.1, 0.15, 0.2, 0.25, 0.3, 0.4];
  const d2 = edt(mask, n);
  // Обрезок мельче 0.05 ед² — растровая пыль на границе уровня, а не кусок
  // формы: считать её куском значит мерить сглаживание, а не конструкцию.
  const minPart = (o.minPart ?? 0.05) * ss * ss;
  const worn = new Uint8Array(mask.length);
  return radii.map((r) => {
    const t = (r * ss) * (r * ss);
    for (let i = 0; i < mask.length; i++) worn[i] = mask[i] && d2[i] >= t ? 1 : 0;
    return { r, ink: label(worn, n, 8).area.filter((a) => a >= minPart).length };
  });
}

/**
 * САМОЕ УЗКОЕ МЕСТО ЧЕРНИЛ — минимум 2·r по гребню карты расстояний, плюс
 * точка, где этот минимум стоит.
 *
 * Гребень берётся в двух видах, и оба нужны.
 *   • ПИК — ни один из восьми соседей не больше. Это середина штриха постоянной
 *     ширины (там вдоль гребня плато) и центр массы.
 *   • СЕДЛО — поперёк одной из четырёх осей максимум, вдоль перпендикулярной
 *     минимум. Это и есть перешеек: талия между двумя утолщениями пиком не
 *     является (вдоль гребня соседи больше) и без седла была бы пропущена —
 *     то есть мера прошла бы мимо ровно того дефекта, ради которого писалась.
 * Сравнения нестрогие с одной строгой добавкой, иначе плато чётной ширины
 * (талия ровно между двумя рядами пикселей) выпадает из обоих определений.
 *
 * Кромка в гребень не входит: у кромки расстояние равно нулю у любой формы.
 */
function narrowest(mask, o = {}) {
  const { ss, n } = grid(mask, o);
  const d2 = edt(mask, n);
  let best = Infinity;
  let at = null;
  for (let y = 1; y < n - 1; y++) {
    for (let x = 1; x < n - 1; x++) {
      const i = y * n + x;
      if (!mask[i] || d2[i] >= best) continue;
      const v = d2[i];
      let ridge = true;
      for (const [dx, dy] of NB8) {
        if (d2[i + dy * n + dx] > v + 1e-9) {
          ridge = false;
          break;
        }
      }
      if (!ridge) {
        for (const [[ax, ay], [bx, by], [cx, cy], [ex, ey]] of AXES) {
          const a = d2[i + ay * n + ax];
          const b = d2[i + by * n + bx];
          const c = d2[i + cy * n + cx];
          const e = d2[i + ey * n + ex];
          if (a <= v + 1e-9 && b <= v + 1e-9 && Math.min(a, b) < v - 1e-9 &&
              c >= v - 1e-9 && e >= v - 1e-9 && Math.max(c, e) > v + 1e-9) {
            ridge = true;
            break;
          }
        }
      }
      if (!ridge) continue;
      best = v;
      at = [r2((x + 0.5) / ss), r2((y + 0.5) / ss)];
    }
  }
  if (!Number.isFinite(best)) return { width: 0, at: null };
  return { width: r3((2 * Math.sqrt(best)) / ss), at };
}

/**
 * Минимальная ширина чернил вдоль гребня, в единицах канвы.
 * @param {Uint8Array} mask
 * @param {{canvas?:number, ss?:number}} [o]
 * @returns {number}
 */
export function minWidth(mask, o = {}) {
  return narrowest(mask, o).width;
}

/** Полный топологический разбор одной маски — то, что кладётся в сверку. */
export function analyzeTopology(mask, o = {}) {
  const { canvas, ss } = grid(mask, o);
  const t = topology(mask, { canvas, ss, counterWidth: o.counterWidth });
  const thin = narrowest(mask, { canvas, ss });
  return { ...t, necks: necks(mask, { canvas, ss, radii: o.radii, minPart: o.minPart }), minWidth: thin.width, pinch: thin.at };
}

/**
 * СВЕРКА ТОПОЛОГИЙ. Отвечает на один вопрос: СТАЛО ЛИ ХУЖЕ, чем у руки. Не
 * «правильно ли», а именно хуже — оригинал здесь единственная мера, и если у
 * него самого шов, генерат за это не отвечает.
 *
 * Пять классов, каждый — отдельный дефект сборки:
 *   ОСТРОВА   — не то число кусков чернил: штрих разорван или детали слиплись.
 *   СЧЁТЧИКИ  — не то число задуманных просветов: контур залился или прорвался.
 *   ТРЕЩИНЫ   — у генерата есть тонкие дырки, которых у руки нет: слои сведены
 *               встык и не заварены. Главный шовный дефект.
 *   ПЕРЕШЕЕК  — форма распадается при сжатии раньше оригинала: шва ещё нет, но
 *               ниточка уже есть, и на следующем же изменении она порвётся.
 *   ПЕРЕЖИМ   — самое узкое место заметно уже, чем у руки: штрих сдавлен.
 */
export function topologyDiff(refMask, genMask, o = {}) {
  const a = analyzeTopology(refMask, o);
  const b = analyzeTopology(genMask, o);
  const issues = [];

  if (a.ink !== b.ink) {
    issues.push(
      `ОСТРОВА: кусков чернил ${b.ink} против ${a.ink} у руки — ` +
        (b.ink > a.ink ? 'форма распалась, где у руки цельный штрих' : 'детали слиплись в один кусок'),
    );
  }
  if (a.counters !== b.counters) {
    issues.push(
      `СЧЁТЧИКИ: задуманных просветов ${b.counters} против ${a.counters} у руки — ` +
        (b.counters < a.counters ? 'просвет залился чернилами' : 'в чернилах лишний просвет'),
    );
  }

  const wide = (h) => 2 * h.maxR >= (o.counterWidth ?? 0.5);
  const genCracks = b.holes.filter((h) => !wide(h)).sort((p, q) => q.area - p.area);
  if (genCracks.length > a.cracks) {
    const shown = genCracks.slice(0, 3).map((h) => `${r2(2 * h.maxR)}×${h.area} ед в точке ${h.at.join(', ')}`);
    issues.push(
      `ТРЕЩИНЫ: ${genCracks.length} тонких дырок против ${a.cracks} у руки (${shown.join('; ')}) — ` +
        'слои сведены встык и не заварены: шов виден на любом рендере, где пиксель попадёт в щель',
    );
  }

  // Перешеек считается по ПРИРОСТУ кусков при сжатии: если исходное число
  // кусков и так разошлось, это дефект класса ОСТРОВА, и второй раз его
  // предъявлять нечестно. Разваливается ли форма БЫСТРЕЕ — вопрос отдельный.
  for (let k = 0; k < Math.min(a.necks.length, b.necks.length); k++) {
    const ga = a.necks[k].ink - a.ink;
    const gb = b.necks[k].ink - b.ink;
    if (gb > ga) {
      issues.push(
        `ПЕРЕШЕЕК: при сжатии на r=${a.necks[k].r} форма даёт ${b.necks[k].ink} кусков против ${a.necks[k].ink} у руки — ` +
          `в конструкции есть место тоньше ${r2(2 * a.necks[k].r)} ед, у руки такого нет`,
      );
      break;
    }
  }

  if (a.minWidth > 0 && b.minWidth < a.minWidth * 0.85 && a.minWidth - b.minWidth > 0.1) {
    issues.push(
      `ПЕРЕЖИМ: самое узкое место ${b.minWidth} против ${a.minWidth} ед у руки (×${r2(b.minWidth / a.minWidth)})` +
        `${b.pinch ? ` в точке ${b.pinch.join(', ')}` : ''} — штрих сдавлен там, где рука вела ровно`,
    );
  }

  if (a.euler !== b.euler && !issues.length) {
    issues.push(`ЭЙЛЕР: ${b.euler} против ${a.euler} у руки — связность разошлась, а куски и просветы совпали: смотри дырки`);
  }
  return { ref: a, gen: b, issues };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const name = argv.find((a) => !a.startsWith('-'));
  if (!name) {
    console.error('укажи имя: node system/topology.js <имя> [--filled] [--ss 12]');
    process.exit(2);
  }
  const variant = argv.includes('--filled') ? 'filled' : 'outline';
  const ss = argv.includes('--ss') ? Number(argv[argv.indexOf('--ss') + 1]) : 12;
  const { readFileSync, existsSync } = await import('node:fs');
  const { maskFromSvg, maskFromPath } = await import('./metrics.js');
  const { ROOT } = await import('./build.js');
  const { glyphs, buildGlyph } = await import('./registry.js');

  const file = `${ROOT}/reference/${variant === 'filled' ? 'Filled' : 'Outline'}/${name}${variant === 'filled' ? '_filled' : ''}.svg`;
  if (!existsSync(file)) {
    console.error(`оригинала нет: ${file}`);
    process.exit(2);
  }
  const opt = { canvas: 24, ss };
  const ref = maskFromSvg(readFileSync(file, 'utf8'), 24, ss);
  const def = glyphs.get(name);
  const gen = def ? maskFromPath(buildGlyph(name, variant, def.refAxes ? { axes: def.refAxes } : {}), 24, ss, 0.01) : null;

  const card = (t) => {
    console.log(`   кусков чернил ${t.ink} · просветов ${t.counters} · трещин ${t.cracks} · Эйлер ${t.euler}`);
    for (const h of t.holes.slice(0, 6)) {
      console.log(`     ${2 * h.maxR >= 0.5 ? 'просвет ' : 'ТРЕЩИНА '} ширина ${r2(2 * h.maxR)}  площадь ${h.area}  в точке ${h.at.join(', ')}`);
    }
    if (t.holes.length > 6) console.log(`     … ещё ${t.holes.length - 6}`);
    console.log(`   сжатие: ${t.necks.map((p) => `${p.r}→${p.ink}`).join('  ')}`);
    console.log(`   самое узкое место ${t.minWidth} ед${t.pinch ? ` в точке ${t.pinch.join(', ')}` : ''}`);
  };

  console.log(`── ТОПОЛОГИЯ ${name}/${variant} (растр ${24 * ss}²) ──`);
  if (!gen) {
    console.log(' рука:');
    card(analyzeTopology(ref, opt));
    console.log(` (декларации ${name} в системе нет — сверять не с чем)`);
  } else {
    const d = topologyDiff(ref, gen, opt);
    console.log(' рука:');
    card(d.ref);
    console.log(' я:');
    card(d.gen);
    console.log(d.issues.length ? ' претензии:' : ' претензий нет: конструкция сошлась по кускам, просветам и перешейкам');
    for (const q of d.issues) console.log('  • ' + q);
  }
}
