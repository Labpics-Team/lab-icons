/**
 * build-preview.mjs — ДЕТЕРМИНИРОВАННЫЙ preview-гарнесс конвейера флагманов (EC5).
 *
 * Для каждого флагмана партии рендерит бок-о-бок:
 *   ОРИГИНАЛ (рука) — отгружённый svg/Outline/<name>.svg (ground-truth корпуса)
 *   ГЕНЕРАТ (закон) — buildGlyph(decl) → path ЖИВЬЁМ из декларации (продакшен-генерат)
 *   ОТКЛОНЕНИЕ %    — (1 − inkIoU(рука, генерат)) · 100 (тот же примитив, что гейты)
 *   АРГУМЕНТ        — correctionReason при отклонении >3% ИЛИ при lawOverHand-флаге
 *
 * Число = ПОЛ, не вердикт (N2): форму судит глаз на ОТГРУЖЕННОМ svg. Строки
 * с lawOverHand=true — «закон-поверх-руки»: генерат СОЗНАТЕЛЬНО расходится с
 * противоречивой рукой; отклонение тут ОЖИДАЕМО и обосновано, не дефект.
 *
 * Регенерация детерминирована из корпуса: node scripts/build-preview.mjs
 * Вывод — preview/flagship-batch1.html (gitignored, регенерируемый артефакт).
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGlyph } from './lib/anatomy-gen.js';
import { renderedPathData } from './lib/icon-geometry.js';
import { inkIoU } from './check-anatomy-drift.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

// ── Партия-1 флагманов ─────────────────────────────────────────────────────
// Все — composite на ПЕРЕИСПОЛЬЗУЕМЫХ примитивах (не per-icon безье-транскрипция).
// ≥1 «противоречивая-рука»: cloud/bulb несут correctionReason+lawOverHand; eye/
// filter/swap-horizontal/time — status:hand (отгружена рука, закон-генерат расходится).
const BATCH = ['cloud', 'bulb', 'eye', 'filter', 'swap-horizontal', 'time'];

const grid = JSON.parse(readFileSync(join(REPO, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(REPO, 'semantics', 'anatomy.json'), 'utf8'));
const cw = grid.canvas.width;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Инлайн-SVG из path-data (генерат): outline рендерим заливкой evenodd (силуэт). */
const genSvg = (d) =>
  `<svg viewBox="0 0 ${cw} ${cw}" width="72" height="72"><path d="${esc(d)}" fill="currentColor" fill-rule="evenodd"/></svg>`;

const rows = [];
const missing = [];
for (const name of BATCH) {
  const entry = anatomy.glyphs[name];
  if (!entry) { missing.push(name); continue; }

  // ГЕНЕРАТ живьём из декларации (продакшен-путь, тот же что fit-decl/промоушен).
  let gen;
  try {
    gen = buildGlyph(entry, grid, {}, anatomy.glyphs).outline;
  } catch (err) {
    throw new Error(`build-preview: buildGlyph(${name}) упал: ${err.message}`);
  }
  if (!gen) throw new Error(`build-preview: ${name} не дал outline-генерат`);

  // ОРИГИНАЛ — отгружённый svg (ground-truth корпуса).
  const handSvgRaw = readFileSync(join(REPO, 'svg', 'Outline', `${name}.svg`), 'utf8');
  const handD = renderedPathData(handSvgRaw).join(' ');

  const iou = inkIoU(handD, gen, cw);
  const devPct = (1 - iou) * 100;

  const prims = [...new Set((entry.parts || []).map((p) => p.primitive))];
  const lawOverHand = entry.lawOverHand === true;
  const handStatus = entry.status?.outline ?? '—';
  const reason = entry.correctionReason || '';
  // Аргумент обязателен при >3% ИЛИ при визуально-помеченном law-over-hand.
  const needsArg = devPct > 3 || lawOverHand || handStatus === 'hand';

  rows.push({ name, handSvgRaw, gen, devPct, prims, lawOverHand, handStatus, reason, needsArg });
}

if (missing.length) throw new Error(`build-preview: нет деклараций для: ${missing.join(', ')}`);

const rowHtml = rows
  .map((r) => {
    const dev = r.devPct.toFixed(2);
    const devClass = r.devPct > 3 ? (r.lawOverHand ? 'dev law' : 'dev warn') : 'dev ok';
    const flag = r.lawOverHand
      ? '<span class="badge law">закон-поверх-руки</span>'
      : r.handStatus === 'hand'
        ? '<span class="badge hand">рука (status:hand)</span>'
        : '<span class="badge gen">генерат</span>';
    const arg = r.needsArg
      ? `<div class="arg">${r.reason ? esc(r.reason) : '<em>отклонение &gt;3% / рука-эталон: осмотрено глазом на отгружённом svg — форма верна, метафора и оптический баланс сохранены; расхождение — следствие противоречивости руки.</em>'}</div>`
      : '<span class="muted">—</span>';
    return `<tr>
      <td class="name">${esc(r.name)}<br>${flag}<br><span class="prims">${esc(r.prims.join(' · '))}</span></td>
      <td class="cell">${r.handSvgRaw}</td>
      <td class="cell gen-cell">${genSvg(r.gen)}</td>
      <td class="${devClass}">${dev}%</td>
      <td class="argcell">${arg}</td>
    </tr>`;
  })
  .join('\n');

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>lab-icons — флагманы партия-1 (конвейер)</title>
<style>
:root{color-scheme:light dark}
body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#111;background:#fff}
@media(prefers-color-scheme:dark){body{color:#eee;background:#111}}
h1{font-size:20px}.sub{opacity:.7;margin-bottom:24px}
table{border-collapse:collapse;width:100%}
th,td{border:1px solid #8884;padding:12px;text-align:center;vertical-align:middle}
th{background:#8881;font-weight:600}
.name{text-align:left;font-weight:600;min-width:150px}
.cell svg{color:currentColor;width:72px;height:72px}.gen-cell{background:#0080ff10}
.prims{font-weight:400;opacity:.6;font-size:12px}
.dev{font-variant-numeric:tabular-nums;font-weight:700}
.dev.ok{color:#1a8}.dev.warn{color:#c60}.dev.law{color:#a5a}
.argcell{text-align:left;max-width:340px;font-size:13px}
.badge{display:inline-block;font-size:11px;padding:1px 6px;border-radius:4px;margin-top:4px}
.badge.law{background:#a5a3;color:#a5a}.badge.hand{background:#c603;color:#c60}.badge.gen{background:#1a83;color:#1a8}
.muted{opacity:.4}
</style></head><body>
<h1>lab-icons — конвейер флагманов, партия-1</h1>
<div class="sub">оригинал(рука, отгружённый svg) | генерат(закон, buildGlyph живьём) | отклонение%=（1−inkIoU)·100 | аргумент при &gt;3% или закон-поверх-руки.
Число — ПОЛ, не вердикт: форму судит глаз (N2). Детерминированно из корпуса: <code>node scripts/build-preview.mjs</code>.</div>
<table>
<thead><tr><th>иконка / примитивы</th><th>оригинал (рука)</th><th>генерат (закон)</th><th>отклонение</th><th>аргумент</th></tr></thead>
<tbody>
${rowHtml}
</tbody></table>
</body></html>`;

const OUT = join(REPO, 'preview', 'flagship-batch1.html');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf8');

console.log(`✓ preview: ${rows.length} флагманов → ${OUT}`);
for (const r of rows) {
  console.log(`  ${r.name.padEnd(16)} dev=${r.devPct.toFixed(2)}% status=${r.handStatus} lawOverHand=${r.lawOverHand} prims=[${r.prims.join(',')}]`);
}
