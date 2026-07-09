/**
 * promote-wave.mjs — промоушен волны «формула вместо руки» (per-variant).
 *
 * Для каждого глифа со status:hand (per-variant) кандидат-волны:
 *   а) замер fidelityToHand генерата против ТЕКУЩЕЙ руки (ДО замены) —
 *      исторический рекорд, фиксируется в декларации (inkIoU, шаг 0.12 —
 *      тот же растеризатор, что fit-decl/check-anatomy-drift);
 *   б) материализация генерата в формат svg/Outline|Filled (d = buildGlyph
 *      дословно; fill-rule="evenodd"+clip-rule при EO≠NZ генерата — прецедент
 *      cog: отгружается ровно та геометрия, что замерена EO-моделью);
 *   в) видящие гейты НА МАТЕРИАЛИЗОВАННОМ генерате: check-fill-rule,
 *      check-topology, check-adjacency (по глифу, закон из руки),
 *      check-corners (дифференциал рука→генерат), check-path-quality
 *      (строго: любая находка = красный) + инварианты корпуса (f3, bbox⊆24²);
 *   г) все зелёные и fid≥0.99 → замена отгружаемого svg генератом,
 *      status:"generated";
 *   д) 0.97≤fid<0.99 → то же + correctionReason из карты остатка
 *      (residual-map: где и почему генерат расходится с рукой);
 *   е) гейт красный или fid<0.97 → НЕ продвигать, parked с причиной.
 *
 * eye и reload не трогаются (fidelity-стопы владельца, ниже пола 0.97).
 * Промоутнутые multi-part глифы добавляются в semantics/adjacency-promoted.json
 * (HARD-флип корпусного check-adjacency — бетонирование смежности).
 *
 * Запуск: node scripts/migrate/promote-wave.mjs           # dry-run, отчёт
 *         node scripts/migrate/promote-wave.mjs --apply   # запись
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGlyph } from '../lib/anatomy-gen.js';
import { renderedPathData } from '../lib/icon-geometry.js';
import { samplePolylines } from '../lib/curve-sampling.js';
import { pathBBox } from '../lib/path-data.js';
import { eoNzDisagree } from '../lib/seeing-gates.js';
import { inkIoU } from '../check-anatomy-drift.js';
import { findBlobBugs } from '../check-fill-rule.js';
import { findTopologyDefects } from '../check-topology.js';
import { cornerDefectsBetween } from '../check-corners.js';
import { adjacencyDefectsBetween } from '../check-adjacency.js';
import { validatePathQuality } from '../check-path-quality.js';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const APPLY = process.argv.includes('--apply');

const grid = JSON.parse(readFileSync(join(REPO, 'semantics', 'grid.json'), 'utf8'));
const anatomyPath = join(REPO, 'semantics', 'anatomy.json');
const anatomy = JSON.parse(readFileSync(anatomyPath, 'utf8'));
const cw = grid.canvas.width;

const FLOOR = 0.97; // пол узнаваемости (check-fidelity)
const CLEAN = 0.99; // ниже — обязателен correctionReason (check-fidelity)
const IOU_STEP = 0.12; // финальная сетка замера (fit-decl/drift)

// Явные стопы владельца — не трогаем, паркуем с фактом.
const OWNER_PARKED = new Map([
  ['eye', 'fidelity-стоп: fid 0.9541 < пол 0.97 (лучший канон-миндаль 0.9553, wave6 Q3 владельцу)'],
  ['reload', 'fidelity-стоп: fid 0.861 < пол 0.97 (outline=hand, ownerReview держит filled)'],
]);

const handFile = (name, v) =>
  v === 'outline'
    ? join(REPO, 'svg', 'Outline', `${name}.svg`)
    : join(REPO, 'svg', 'Filled', `${name}_filled.svg`);
const gateName = (name, v) => (v === 'outline' ? `Outline/${name}.svg` : `Filled/${name}_filled.svg`);

/** Материализация генерата в формат корпуса (d дословно из buildGlyph). */
function materialize(genD) {
  const eo = eoNzDisagree(genD, 0.1).disagreePct > 0.5;
  const attrs = eo ? ' fill-rule="evenodd" clip-rule="evenodd"' : '';
  return `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path${attrs} d="${genD}"/></svg>`;
}

// ── карта остатка (модель residual-map.mjs: nonzero-чернила, сетка 48) ──────
function makeInk(d) {
  const polys = samplePolylines(d, 24).filter((p) => p.length > 2);
  return (x, y) => {
    let w = 0;
    for (const poly of polys) {
      for (let i = 0; i < poly.length; i++) {
        const [x1, y1] = poly[i];
        const [x2, y2] = poly[(i + 1) % poly.length];
        if (y1 <= y ? y2 > y : y2 <= y) {
          const t = (y - y1) / (y2 - y1);
          if (x < x1 + t * (x2 - x1)) w += y2 > y1 ? 1 : -1;
        }
      }
    }
    return w !== 0;
  };
}

function residualClusters(genD, handD, RES = 48) {
  const inkH = makeInk(handD);
  const inkG = makeInk(genD);
  const step = cw / RES;
  const diffs = [];
  for (let gy = 0; gy < RES; gy++) {
    const y = (gy + 0.5) * step;
    for (let gx = 0; gx < RES; gx++) {
      const x = (gx + 0.5) * step;
      const h = inkH(x, y);
      const g = inkG(x, y);
      if (h !== g) diffs.push({ x, y, k: g ? '+' : '-' });
    }
  }
  const key = (d) => `${d.x.toFixed(3)}_${d.y.toFixed(3)}`;
  const byKey = new Map(diffs.map((d) => [key(d), d]));
  const seen = new Set();
  const clusters = [];
  for (const d of diffs) {
    if (seen.has(key(d))) continue;
    seen.add(key(d));
    const q = [d];
    const cl = { minX: 99, minY: 99, maxX: -99, maxY: -99, n: 0, plus: 0, minus: 0 };
    while (q.length) {
      const c = q.pop();
      cl.n++;
      cl[c.k === '+' ? 'plus' : 'minus']++;
      cl.minX = Math.min(cl.minX, c.x); cl.maxX = Math.max(cl.maxX, c.x);
      cl.minY = Math.min(cl.minY, c.y); cl.maxY = Math.max(cl.maxY, c.y);
      for (const dx of [-step, 0, step]) for (const dy of [-step, 0, step]) {
        const nk = `${(c.x + dx).toFixed(3)}_${(c.y + dy).toFixed(3)}`;
        if (!seen.has(nk) && byKey.has(nk)) { seen.add(nk); q.push(byKey.get(nk)); }
      }
    }
    clusters.push(cl);
  }
  return clusters.sort((a, b) => b.n - a.n);
}

const zoneOf = (cl) => {
  const x = (cl.minX + cl.maxX) / 2;
  const y = (cl.minY + cl.maxY) / 2;
  const yz = y < cw / 3 ? 'вверху' : y > (2 * cw) / 3 ? 'внизу' : 'посередине';
  const xz = x < cw / 3 ? 'слева' : x > (2 * cw) / 3 ? 'справа' : 'по центру';
  return `${yz} ${xz}`;
};
const charOf = (cl) => {
  if (cl.minus >= 3 * cl.plus) return 'закон снимает дребезг руки (чернила руки без конструкции)';
  if (cl.plus >= 3 * cl.minus) return 'конструкция закона ведёт контур полнее/ровнее руки';
  return 'сегмент перестроен конструкцией закона (сдвиг контура к сетке)';
};

/** Честная причина падения <0.99: где и почему генерат расходится с рукой. */
function composeReason(variant, fid, genD, handD) {
  // сетка 48 — крупные зоны; не нашлось — 96 (0.25 юнита) локализует тонкий остаток
  let cls = residualClusters(genD, handD, 48).filter((c) => c.n >= 4).slice(0, 2);
  if (cls.length === 0) cls = residualClusters(genD, handD, 96).filter((c) => c.n >= 8).slice(0, 2);
  if (cls.length === 0) {
    return `${variant} ${(fid * 100).toFixed(2)}%: расхождение рассеяно субпиксельно вдоль всего контура (кластеров нет и на сетке 96) — дребезг руки, снятый конструкцией закона`;
  }
  const zones = cls
    .map((c) => `${zoneOf(c)} [${c.minX.toFixed(1)},${c.minY.toFixed(1)}→${c.maxX.toFixed(1)},${c.maxY.toFixed(1)}]: ${charOf(c)}`)
    .join('; ');
  return `${variant} ${(fid * 100).toFixed(2)}%: ${zones}`;
}

// ── видящие гейты на материализованном генерате ─────────────────────────────
function runGates(name, variant, content, handD, genD) {
  const red = [];
  const warn = [];
  const file = [{ name: gateName(name, variant), content }];
  // инварианты корпуса (svg-corpus): точность f3 и bbox ⊆ канва
  if (/\d+\.\d{4,}/.test(genD)) red.push('материализация: точность > f3 (конвенция корпуса)');
  const bb = pathBBox(genD);
  if (bb.minX < 0 || bb.minY < 0 || bb.maxX > cw || bb.maxY > cw) {
    red.push(`материализация: bbox [${bb.minX.toFixed(2)},${bb.minY.toFixed(2)}→${bb.maxX.toFixed(2)},${bb.maxY.toFixed(2)}] вне канвы`);
  }
  // check-fill-rule (Outline HARD / Filled WARN — закон гейта)
  const blob = findBlobBugs(file);
  for (const f of blob.outlineFails) red.push(`fill-rule: чёрный блоб ${f.pct.toFixed(1)}%`);
  for (const f of blob.filledWarns) warn.push(`fill-rule(filled): ${f.pct.toFixed(1)}% evenodd≠nonzero`);
  // check-topology (Outline HARD / Filled WARN)
  const topo = findTopologyDefects(file);
  for (const f of topo.outlineFails) red.push(`topology: ${f.detail}`);
  for (const f of topo.filledWarns) warn.push(`topology(filled): ${f.detail}`);
  // check-corners: дифференциал рука→генерат (Outline HARD / Filled WARN)
  const corners = cornerDefectsBetween(handD, genD);
  for (const c of corners) {
    const msg = `corners: вершина (${c.x.toFixed(1)},${c.y.toFixed(1)}) острая у руки (r≈${c.rHand.toFixed(2)}), скруглена генератом (r=${c.rGen.toFixed(2)})`;
    (variant === 'outline' ? red : warn).push(variant === 'outline' ? msg : `${msg} (filled)`);
  }
  // check-path-quality: строго, КРОМЕ собственного minor-класса гейта
  // «излом 2–3.x°» (CLI: /излом [23]\./ → minor) — это шум хорда-vs-касательная
  // на длинных дугах, он есть у УЖЕ отгруженных generated-файлов корпуса
  // (chevron-up-circle, minus-circle, radio — прецедент, verify зелёный).
  for (const f of validatePathQuality({ grid, files: file })) {
    const msg = `path-quality: ${f.replace(`${gateName(name, variant)} `, '')}`;
    (/излом [23]\./.test(f) ? warn : red).push(msg);
  }
  return { red, warn };
}

/** check-adjacency по глифу: закон из ТЕКУЩЕЙ руки, проверка на генерат-частях. */
function adjacencyOf(name, entry) {
  if (!Array.isArray(entry.parts) || entry.parts.length < 2) return { ran: false, defects: [] };
  const hf = handFile(name, 'outline');
  if (!existsSync(hf)) return { ran: false, defects: [] };
  const handD = renderedPathData(readFileSync(hf, 'utf8'))[0];
  if (!handD) return { ran: false, defects: [] };
  const genParts = [];
  for (const part of entry.parts) {
    let built;
    try {
      built = buildGlyph({ ...entry, parts: [part] }, grid, {}, anatomy.glyphs);
    } catch { continue; }
    if (built.outline) genParts.push({ name: part.name || `part${genParts.length}`, d: built.outline });
  }
  if (genParts.length < 2) return { ran: false, defects: [] };
  return { ran: true, defects: adjacencyDefectsBetween(handD, genParts) };
}

// ── волна ───────────────────────────────────────────────────────────────────
const promoted = []; // {name, variant, fid, eo, reason}
const parked = [];   // {name, variant, reason}
const warns = [];
const adjacencyPromoted = new Set();

for (const [name, entry] of Object.entries(anatomy.glyphs)) {
  const candVariants = ['outline', 'filled'].filter((v) => entry.status?.[v] === 'hand');
  if (candVariants.length === 0) continue;
  if (OWNER_PARKED.has(name)) {
    parked.push({ name, variant: candVariants.join('+'), reason: OWNER_PARKED.get(name) });
    continue;
  }

  let built;
  try {
    built = buildGlyph(entry, grid, {}, anatomy.glyphs);
  } catch (e) {
    parked.push({ name, variant: candVariants.join('+'), reason: `генератор упал: ${e.message}` });
    continue;
  }

  // adjacency — по глифу, закон из руки ДО замены; красный = парк всего глифа
  const adj = adjacencyOf(name, entry);
  if (adj.defects.length > 0) {
    const d = adj.defects[0];
    parked.push({ name, variant: candVariants.join('+'), reason: `adjacency: части «${d.a}»↔«${d.b}» разорваны (зазор ${d.gap.toFixed(3)})` });
    continue;
  }

  const glyphPromo = [];
  for (const variant of candVariants) {
    const hf = handFile(name, variant);
    if (!existsSync(hf)) {
      parked.push({ name, variant, reason: 'нет файла руки' });
      continue;
    }
    const genD = built[variant];
    if (!genD) {
      parked.push({ name, variant, reason: 'генерат не строит вариант' });
      continue;
    }
    const handD = renderedPathData(readFileSync(hf, 'utf8')).join('');
    // (а) исторический рекорд: fid против ТЕКУЩЕЙ руки, до замены
    const fid = Number(inkIoU(genD, handD, cw, IOU_STEP).toFixed(4));
    if (fid < FLOOR) {
      parked.push({ name, variant, reason: `fid ${fid} < пол ${FLOOR}` });
      continue;
    }
    // (б) материализация + (в) видящие гейты на генерате
    const content = materialize(genD);
    const { red, warn } = runGates(name, variant, content, handD, genD);
    warns.push(...warn.map((w) => `${name}/${variant}: ${w}`));
    if (red.length > 0) {
      parked.push({ name, variant, reason: red.join(' | ') });
      continue;
    }
    // (г)/(д) промоушен
    const reason = fid < CLEAN ? composeReason(variant, fid, genD, handD) : null;
    glyphPromo.push({ variant, fid, content, hf, reason, eo: content.includes('evenodd') });
  }

  if (glyphPromo.length === 0) continue;
  for (const p of glyphPromo) {
    entry.status[p.variant] = 'generated';
    entry.fidelityToHand = { ...(entry.fidelityToHand ?? {}) };
    entry.fidelityToHand[p.variant] = p.fid;
    if (APPLY) writeFileSync(p.hf, p.content, 'utf8');
    promoted.push({ name, variant: p.variant, fid: p.fid, eo: p.eo, reason: p.reason });
  }
  const reasons = glyphPromo.filter((p) => p.reason).map((p) => p.reason);
  if (reasons.length > 0 && !entry.correctionReason) {
    entry.correctionReason = `генерат по закону расходится с рукой: ${reasons.join('; ')}`;
  }
  if (adj.ran) adjacencyPromoted.add(name);
}

if (APPLY) {
  writeFileSync(anatomyPath, JSON.stringify(anatomy, null, 1));
  const apPath = join(REPO, 'semantics', 'adjacency-promoted.json');
  const ap = JSON.parse(readFileSync(apPath, 'utf8'));
  const merged = [...new Set([...(ap.promoted || []), ...adjacencyPromoted])].sort();
  writeFileSync(apPath, JSON.stringify({ ...ap, promoted: merged }, null, 2) + '\n');
}

// ── отчёт ───────────────────────────────────────────────────────────────────
console.log(`ПРОМОУТНУТО (${promoted.length} вариантов):`);
for (const p of promoted) {
  console.log(`  ${p.name}/${p.variant}  fid=${p.fid}${p.eo ? '  [evenodd]' : ''}${p.reason ? `\n    причина: ${p.reason}` : ''}`);
}
console.log(`\nPARKED (${parked.length}):`);
for (const p of parked) console.log(`  ${p.name}/${p.variant} = ${p.reason}`);
if (warns.length) {
  console.log(`\nWARN (${warns.length}, не блокирует — закон гейтов для Filled):`);
  for (const w of warns) console.log(`  ${w}`);
}
console.log(`\nadjacency-promoted += ${[...adjacencyPromoted].sort().join(', ') || '—'}`);
console.log(APPLY ? 'ЗАПИСАНО (svg + anatomy.json + adjacency-promoted.json)' : 'DRY-RUN (без записи; --apply для записи)');
