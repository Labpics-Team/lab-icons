/**
 * lib/dry-coverage.js — чистое ядро DRY-гейта РАЗДЕЛЯЕМОСТИ примитивов.
 *
 * КЛАСС дефекта (уникальный — НЕ дублирует check-anatomy / check-anatomy-drift /
 * check-path-quality / check-fill-rule): ФЛАГМАНСКАЯ иконка, собранная НЕ из
 * переиспользуемых примитивов, а из one-off геометрии (мешок безье / bespoke
 * single-use архетип). Прочие гейты смотрят КАЧЕСТВО одного пути (шум кривых,
 * скелет, fill-rule) — здесь мерится РАЗДЕЛЯЕМОСТЬ строительных блоков МЕЖДУ
 * иконками (DRY по northInvariant «переиспользуемые примитивы»).
 *
 * ЕДИНИЦА КОНСТРУКЦИИ (unit): каждый part composite-глифа = один блок построения,
 * опознаётся по имени примитива-генератора (`part.primitive`). Глиф без parts
 * (archetype-driven) = один блок, опознаётся по имени архетипа (тот же генератор,
 * что и одноимённый part-примитив: `rounded-polygon`-архетип квадрата и
 * `rounded-polygon`-part треугольника play — ОДИН генератор genRoundedPolygon).
 *
 * ОБЩИЙ (shared) примитив = генератор, использованный ≥2 РАЗНЫМИ глифами корпуса
 * И не входящий в denylist транскрипции. ПОКРЫТИЕ флагмана = доля его блоков,
 * построенных из общих примитивов.
 *
 * ПОРОГ = 1.0 — НЕ подогнан под процент прохода (N1, ноль observer-fit), а
 * ГЕОМЕТРИЧЕСКОЕ определение «иконка сконструирована по закону»: DRY-иконка не
 * несёт НИ ОДНОГО one-off блока. Порог = экстремум смысла «нет уникальной
 * геометрии», а не тюнинг. Замер корпуса master подтверждает: реальные флагманы
 * (plus, close, checkmark, arrow-семейство) уже 100% — валидация закона, не подгонка.
 *
 * FROZEN MUST: транскрипция руки в per-icon безье НИКОГДА не считается общим
 * примитивом, ДАЖЕ если такой примитив формально встретился у ≥2 глифов — имена
 * из TRANSCRIPTION_PRIMITIVES исключаются из «общих» по определению. Так гейт
 * закрывает КЛАСС «переиспользованная транскрипция», а не конкретный вход.
 */

/**
 * Примитивы, всегда считаемые СЫРОЙ ТРАНСКРИПЦИЕЙ руки — никогда не «общие».
 * Пусты по факту в корпусе (генераторы параметрические), но фиксируют закон:
 * если кто-то введёт primitive:"bezier" с сырым d-string, он не пройдёт как DRY.
 */
export const TRANSCRIPTION_PRIMITIVES = new Set([
  'bezier',
  'raw-path',
  'raw-bezier',
  'path',
  'hand-bezier',
  'hand-path',
  'transcription',
  // 'complex' — бакет malformed/безымянной части (primitive не строка): СЫРАЯ,
  // неопознанная геометрия того же класса, что транскрипция. НИКОГДА не «общий»,
  // даже если сойдётся у ≥2 глифов, иначе флагман из мусора ложно пройдёт DRY.
  'complex',
]);

/** Порог покрытия флагмана — геометрический экстремум «ноль one-off блоков». */
export const FLAGSHIP_COVERAGE_THRESHOLD = 1.0;

// Semantic primitives where role/name can identify reusable unit families
// without overfitting to one-off geometry.
const SEMANTIC_REUSE_PRIMITIVES = new Set(['circle-dot', 'stroke-path']);

function buildReusableSignatures(glyphs) {
  const counts = new Map();
  for (const glyph of Object.values(glyphs)) {
    const parts = Array.isArray(glyph?.parts) ? glyph.parts : [];
    for (const part of parts) {
      if (typeof part?.primitive !== 'string') continue;
      if (!SEMANTIC_REUSE_PRIMITIVES.has(part.primitive)) continue;
      if (typeof part.role !== 'string' || typeof part.name !== 'string') continue;
      const sig = `${part.primitive}::${part.role}::${part.name}`;
      counts.set(sig, (counts.get(sig) || 0) + 1);
    }
  }
  const reusable = new Set();
  for (const [sig, count] of counts) {
    if (count >= 2) reusable.add(sig);
  }
  return reusable;
}

function partUnit(part, reusableSignatures) {
  if (typeof part?.primitive !== 'string') return 'complex';
  const primitive = part.primitive;
  if (TRANSCRIPTION_PRIMITIVES.has(primitive)) return primitive;
  if (typeof part.role === 'string' && typeof part.name === 'string') {
    const sig = `${primitive}::${part.role}::${part.name}`;
    if (reusableSignatures.has(sig)) return sig;
  }
  return primitive;
}

/**
 * Строительные блоки глифа как имена примитивов-генераторов.
 * @param {object} glyph
 * @returns {string[]} по одному имени на part; для part-less — [archetype].
 */
export function glyphUnits(glyph, reusableSignatures = new Set()) {
  const parts = Array.isArray(glyph?.parts) ? glyph.parts : [];
  if (parts.length > 0) {
    return parts.map((p) => partUnit(p, reusableSignatures));
  }
  return glyph?.archetype ? [glyph.archetype] : [];
}

/**
 * Карта примитив → Set(имён глифов-потребителей) по всему корпусу.
 * @param {Record<string, object>} glyphs
 * @returns {Map<string, Set<string>>}
 */
export function buildPrimitiveUsers(glyphs, reusableSignatures = null) {
  const users = new Map();
  const signatures = reusableSignatures ?? buildReusableSignatures(glyphs);
  for (const [name, glyph] of Object.entries(glyphs)) {
    for (const prim of new Set(glyphUnits(glyph, signatures))) {
      if (!users.has(prim)) users.set(prim, new Set());
      users.get(prim).add(name);
    }
  }
  return users;
}

/**
 * Общий ли примитив: не транскрипция И ≥2 разных глифа-потребителя.
 * @param {string} prim
 * @param {Map<string, Set<string>>} users
 * @returns {boolean}
 */
export function isShared(prim, users) {
  if (TRANSCRIPTION_PRIMITIVES.has(prim)) return false;
  return (users.get(prim)?.size ?? 0) >= 2;
}

/**
 * Покрытие одного глифа общими примитивами.
 * @param {string} name
 * @param {Record<string, object>} glyphs
 * @param {Map<string, Set<string>>} users
 * @returns {{name:string, unitCount:number, sharedCount:number, coverage:number,
 *   shared:string[], oneOff:string[]}}
 */
export function glyphCoverage(name, glyphs, users, reusableSignatures) {
  const units = glyphUnits(glyphs[name], reusableSignatures);
  const shared = [];
  const oneOff = [];
  for (const u of units) (isShared(u, users) ? shared : oneOff).push(u);
  const unitCount = units.length;
  return {
    name,
    unitCount,
    sharedCount: shared.length,
    coverage: unitCount === 0 ? 0 : shared.length / unitCount,
    shared: [...new Set(shared)],
    oneOff: [...new Set(oneOff)],
  };
}

/**
 * Разрешить множество флагманов: объединение манифеста (flagships.json) и
 * inline-маркера glyph.tier === 'flagship'. Манифест держит anatomy.json
 * закон-чистым; inline-tier делает фикстуры самодостаточными.
 * @param {{glyphs:Record<string,object>}} anatomy
 * @param {{flagships?:string[]}|null} manifest
 * @returns {string[]}
 */
export function flagshipNames(anatomy, manifest) {
  const glyphs = anatomy?.glyphs ?? {};
  const set = new Set();
  if (Array.isArray(manifest?.flagships)) {
    for (const n of manifest.flagships) set.add(n);
  }
  for (const [n, g] of Object.entries(glyphs)) {
    if (g?.tier === 'flagship') set.add(n);
  }
  return [...set];
}

/**
 * Оценка DRY по всему множеству флагманов.
 * FAIL если: (а) покрытие любого флагмана < threshold, ИЛИ
 *            (б) ≥1 флагман с НУЛЁМ общих примитивов (zero-shared, сильный сигнал).
 * @param {{anatomy:object, manifest?:object|null, threshold?:number}} opts
 * @returns {{ok:boolean, threshold:number, flagships:object[], belowThreshold:object[],
 *   zeroShared:object[], missing:string[]}}
 */
export function evaluateDry({ anatomy, manifest = null, threshold = FLAGSHIP_COVERAGE_THRESHOLD }) {
  const glyphs = anatomy?.glyphs ?? {};
  const reusableSignatures = buildReusableSignatures(glyphs);
  const users = buildPrimitiveUsers(glyphs, reusableSignatures);
  const names = flagshipNames(anatomy, manifest);
  const missing = names.filter((n) => !glyphs[n]);
  const present = names.filter((n) => glyphs[n]);
  const flagships = present.map((n) => glyphCoverage(n, glyphs, users, reusableSignatures));
  const belowThreshold = flagships.filter((f) => f.coverage < threshold);
  const zeroShared = flagships.filter((f) => f.sharedCount === 0);
  const ok = missing.length === 0 && belowThreshold.length === 0 && zeroShared.length === 0;
  return { ok, threshold, flagships, belowThreshold, zeroShared, missing };
}
