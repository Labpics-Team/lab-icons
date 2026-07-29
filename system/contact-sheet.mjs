/**
 * system/contact-sheet.mjs — КОНТАКТНЫЙ ЛИСТ: посмотреть глазами.
 *
 * Зачем, если есть проценты. Потому что процент — интеграл, и он врёт в обе
 * стороны. Глиф может набрать 2% и при этом быть перевёрнутым по fill-rule в
 * тонком месте, разорванным в одном узле или зеркальным. Площадь такое иногда
 * не ловит вовсе, а глаз ловит мгновенно.
 *
 * Лист рисует наложение: оригинал серым, генерат — цветом поверх. Совпало —
 * видно ровный цветной силуэт; разошлось — видно серую кайму или серую деталь,
 * которой в генерате нет.
 *
 *   node system/contact-sheet.mjs                 # outline, все объявленные
 *   node system/contact-sheet.mjs --filled
 *   node system/contact-sheet.mjs --only music,dice
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { buildAll, ROOT, ARGUE_AT } from './build.js';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = `${ROOT}/system/out`;

const argv = process.argv.slice(2);
const variant = argv.includes('--filled') ? 'filled' : 'outline';
const only = argv.includes('--only') ? new Set(argv[argv.indexOf('--only') + 1].split(',')) : null;
const cols = argv.includes('--cols') ? Number(argv[argv.indexOf('--cols') + 1]) : 8;

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inner = (svg) => (svg ?? '').replace(/<svg[^>]*>/, '').replace('</svg>', '');

const rows = buildAll()
  .filter((r) => r.variant === variant && !r.error && (!only || only.has(r.name)))
  .sort((a, b) => (b.deviation ?? 0) - (a.deviation ?? 0));

const cell = (r) => {
  const dev = r.deviation ?? null;
  const cls = dev == null ? '' : dev <= ARGUE_AT ? 'ok' : r.verdict?.kind === 'registration' ? 'reg' : 'bad';
  return `<figure class="${cls}">
    <div class="box"><svg viewBox="0 0 24 24">
      <g class="ref">${inner(r.reference)}</g>
      <path class="gen" d="${r.dRef ?? r.d}"/>
    </svg></div>
    <figcaption>${esc(r.name)}${r.refAxes ? '<i>сверка</i>' : ''}<b>${dev == null ? '—' : (dev * 100).toFixed(1) + '%'}</b></figcaption>
  </figure>`;
};

const html = `<!doctype html><meta charset="utf-8"><style>
body{margin:0;background:#0B0B0F;color:#E8E8EE;font:12px/1.4 ui-sans-serif,system-ui,sans-serif;padding:18px}
h1{font:600 15px/1.3 ui-sans-serif,system-ui;margin:0 0 3px}
p{color:#8C8C99;margin:0 0 14px;font-size:11.5px}
.grid{display:grid;grid-template-columns:repeat(${cols},1fr);gap:10px}
figure{margin:0}
.box{background:#15151B;border:1px solid #26262F;border-radius:10px;aspect-ratio:1;display:flex;align-items:center;justify-content:center}
svg{width:80%;height:80%;display:block}
.ref{fill:#6A6A78}
.gen{fill:#5AA9FF;fill-opacity:.62}
.ok .box{border-color:#2A6B4A}.reg .box{border-color:#6B5320}.bad .box{border-color:#7A2E20;background:#1E1114}
figcaption{margin-top:5px;display:flex;justify-content:space-between;gap:5px;font-size:10.5px;color:#9C9CAA}
figcaption b{font-variant-numeric:tabular-nums;color:#E8E8EE}
figcaption i{color:#6A6A78;font-style:normal;font-size:9.5px}
.bad figcaption b{color:#FF8B75}.reg figcaption b{color:#E8B44C}.ok figcaption b{color:#4FD08F}
</style>
<h1>Контактный лист — ${variant}, ${rows.length} глифов</h1>
<p>Оригинал серым, генерат синим поверх. Ровный синий силуэт = совпало. Серая кайма = смещение. Серая деталь = не построена.
Рамка: зелёная ≤${(ARGUE_AT * 100).toFixed(0)}%, жёлтая — вердикт registration, красная — спорное.</p>
<div class="grid">${rows.map(cell).join('')}</div>`;

mkdirSync(OUT, { recursive: true });
const htmlPath = `${OUT}/contact-${variant}.html`;
const pngPath = `${OUT}/contact-${variant}.png`;
writeFileSync(htmlPath, html);

const height = 150 + Math.ceil(rows.length / cols) * 132;
execFileSync(CHROME, [
  '--headless',
  '--disable-gpu',
  '--no-sandbox',
  '--hide-scrollbars',
  `--window-size=${cols * 128 + 40},${height}`,
  `--screenshot=${pngPath}`,
  `file://${htmlPath}`,
], { stdio: 'pipe' });

console.log(`${pngPath} — ${rows.length} глифов, ${variant}`);
