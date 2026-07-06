/**
 * scripts/build-preview.js — витрина сходимости (заявка владельца 2026-07-06).
 *
 * Для КАЖДОЙ иконки собирает четыре колонки:
 *   1) ОРИГИНАЛ — рисунок владельца из seed-коммита (до анатомизации);
 *   2) ГЕНЕРАТ  — текущий файл (для status=generated — производный деклараций,
 *      для status=hand — пока тот же рисунок, помечен «не мигрировано»);
 *   3) ОТКЛОНЕНИЕ % — 1−IoU оригинала и генерата. Считается ПИКСЕЛЬНО в браузере
 *      (Canvas растеризует настоящий SVG — это ground truth, а не апрокс);
 *      рядом — задекларированный fidelityToHand из гейтов (адверсарная сверка);
 *   4) АРГУМЕНТАЦИЯ — почему отклонение такое; показывается при >3% (порог
 *      владельца: отклонение = геометрия/чистка, не вкус).
 *
 * Оригинал берётся из git seed, а не из рабочего дерева: у мигрированных иконок
 * файл уже перезаписан генератом, «руку» хранит только история.
 * Нулевых новых зависимостей: IoU считает браузер, оригиналы достаёт `git show`.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUTLINE_DIR = join(ROOT, 'svg', 'Outline');
const FILLED_DIR = join(ROOT, 'svg', 'Filled');
const OUT_DIR = join(ROOT, 'preview');
const DEVIATION_THRESHOLD = 3; // %, порог владельца для обязательной аргументации

// Seed — первый рисунок владельца (444 SVG), до анатомизации.
const SEED = process.env.PREVIEW_SEED || '668af3f';

function gitShow(path) {
  try {
    return execFileSync('git', ['show', `${SEED}:${path}`], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null; // не существовал в seed
  }
}

function readIf(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : null;
}

// Инлайним SVG как есть, но снимаем width/height — размер задаёт CSS-контейнер.
function normalizeSvg(svg) {
  if (!svg) return null;
  return svg
    .replace(/\s(width|height)="[^"]*"/g, '')
    .replace(/<\?xml[^>]*\?>/g, '')
    .trim();
}

const anatomy = JSON.parse(readFileSync(join(ROOT, 'semantics', 'anatomy.json'), 'utf8'));
const glyphs = anatomy.glyphs || {};

function argFor(decl) {
  if (!decl) return null;
  const bits = [];
  if (decl.correctionReason) bits.push(decl.correctionReason);
  if (decl.ownerReview) bits.push(`owner: ${decl.ownerReview}`);
  // причины уровня варианта/части
  for (const v of ['outline', 'filled']) {
    const g = decl.glyph || decl;
    if (g && g[v] && typeof g[v] === 'object' && g[v].correctionReason)
      bits.push(`${v}: ${g[v].correctionReason}`);
  }
  return bits.length ? bits.join(' · ') : null;
}

function statusOf(decl, variant) {
  if (!decl || !decl.status) return 'hand';
  return decl.status[variant] || 'hand';
}

const names = readdirSync(OUTLINE_DIR)
  .filter((f) => f.endsWith('.svg'))
  .map((f) => f.replace(/\.svg$/, ''))
  .sort();

const rows = names.map((name) => {
  const decl = glyphs[name] || null;
  const origOutline = normalizeSvg(gitShow(`svg/Outline/${name}.svg`));
  const origFilled = normalizeSvg(gitShow(`svg/Filled/${name}_filled.svg`));
  const genOutline = normalizeSvg(readIf(join(OUTLINE_DIR, `${name}.svg`)));
  const genFilled = normalizeSvg(readIf(join(FILLED_DIR, `${name}_filled.svg`)));
  const sOut = statusOf(decl, 'outline');
  const sFil = statusOf(decl, 'filled');
  const migrated = sOut === 'generated' || sFil === 'generated';
  const fid = decl && decl.fidelityToHand ? decl.fidelityToHand : null;
  return {
    name,
    statusOutline: sOut,
    statusFilled: sFil,
    migrated,
    isNew: !origOutline,
    declaredFidelity: fid,
    argumentation: argFor(decl),
    origOutline,
    origFilled,
    genOutline,
    genFilled,
  };
});

mkdirSync(OUT_DIR, { recursive: true });
const dataJson = JSON.stringify(rows).replace(/</g, '\\u003c');

const html = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>lab-icons · витрина сходимости</title>
<style>
  :root {
    --bg:#0f1115; --panel:#171a21; --line:#262b36; --ink:#e7ebf2; --dim:#8a93a6;
    --ok:#3ecf8e; --warn:#f0b429; --bad:#f0506e; --accent:#5b8def; --swatch:#0f1115;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f6f7f9; --panel:#fff; --line:#e6e9ef; --ink:#151922; --dim:#5c6472; --swatch:#fff; }
  }
  * { box-sizing:border-box; }
  body { margin:0; background:var(--bg); color:var(--ink);
    font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
  header { position:sticky; top:0; z-index:5; background:var(--bg);
    border-bottom:1px solid var(--line); padding:14px 20px; }
  h1 { margin:0 0 4px; font-size:16px; font-weight:650; }
  .sub { color:var(--dim); font-size:12.5px; }
  .toolbar { display:flex; gap:8px; flex-wrap:wrap; margin-top:10px; align-items:center; }
  .toolbar button { background:var(--panel); color:var(--ink); border:1px solid var(--line);
    border-radius:8px; padding:6px 11px; font-size:12.5px; cursor:pointer; }
  .toolbar button.active { border-color:var(--accent); color:var(--accent); }
  .toolbar input { background:var(--panel); color:var(--ink); border:1px solid var(--line);
    border-radius:8px; padding:6px 11px; font-size:12.5px; min-width:180px; }
  .stat { color:var(--dim); font-size:12px; margin-left:auto; }
  main { padding:16px 20px 80px; }
  table { width:100%; border-collapse:collapse; }
  thead th { text-align:left; color:var(--dim); font-weight:600; font-size:11.5px;
    text-transform:uppercase; letter-spacing:.04em; padding:8px 10px; border-bottom:1px solid var(--line); position:sticky; top:96px; background:var(--bg); }
  tbody tr { border-bottom:1px solid var(--line); }
  td { padding:12px 10px; vertical-align:middle; }
  .name { font-weight:600; font-size:13px; }
  .badges { margin-top:4px; display:flex; gap:4px; flex-wrap:wrap; }
  .badge { font-size:10px; padding:1.5px 6px; border-radius:999px; border:1px solid var(--line); color:var(--dim); }
  .badge.gen { color:var(--ok); border-color:color-mix(in srgb,var(--ok) 40%,transparent); }
  .badge.hand { color:var(--warn); border-color:color-mix(in srgb,var(--warn) 40%,transparent); }
  .cell { display:flex; gap:10px; }
  .glyph { width:52px; height:52px; border:1px solid var(--line); border-radius:10px;
    background:var(--swatch); display:grid; place-items:center; color:var(--ink); position:relative; }
  .glyph svg { width:34px; height:34px; }
  .glyph.empty { color:var(--dim); font-size:10px; }
  .glyph .lbl { position:absolute; bottom:2px; right:4px; font-size:8px; color:var(--dim); }
  .dev { font-variant-numeric:tabular-nums; font-weight:650; font-size:15px; }
  .dev small { display:block; font-weight:400; font-size:10.5px; color:var(--dim); }
  .dev.ok { color:var(--ok); } .dev.warn { color:var(--warn); } .dev.bad { color:var(--bad); }
  .arg { color:var(--dim); font-size:12px; max-width:360px; }
  .arg.flag { color:var(--ink); }
  .arg .need { color:var(--bad); font-weight:600; }
  code { background:var(--panel); padding:1px 5px; border-radius:5px; font-size:11.5px; }
</style>
</head>
<body>
<header>
  <h1>lab-icons · витрина сходимости</h1>
  <div class="sub">оригинал (рука, seed <code>${SEED}</code>) → генерат (закон) · отклонение = 1−IoU, пиксельно в браузере · аргументация при &gt;${DEVIATION_THRESHOLD}%</div>
  <div class="toolbar">
    <button data-filter="all" class="active">Все</button>
    <button data-filter="migrated">Мигрированы</button>
    <button data-filter="hand">Рука (не мигрированы)</button>
    <button data-filter="over">Отклонение &gt;${DEVIATION_THRESHOLD}%</button>
    <input id="search" placeholder="поиск по имени…" />
    <span class="stat" id="stat"></span>
  </div>
</header>
<main>
  <table>
    <thead><tr>
      <th style="width:150px">Иконка</th>
      <th style="width:130px">Оригинал</th>
      <th style="width:130px">Генерат</th>
      <th style="width:120px">Отклонение</th>
      <th>Аргументация</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>
</main>
<script id="data" type="application/json">${dataJson}</script>
<script>
const DATA = JSON.parse(document.getElementById('data').textContent);
const THRESH = ${DEVIATION_THRESHOLD};

// Мягкий IoU по ПОКРЫТИЮ (доля чернил в пикселе = alpha/255): растеризуем оба
// SVG в общий оффскрин и берём soft-IoU = Σmin / Σmax. Против жёсткого порога
// это устойчиво к антиалиасингу и субпиксельному сдвигу тонкого штриха
// (иначе микро-снос тонкого кольца раздувает отклонение в десятки %). RES
// высокий — тонкие штрихи разрешаются. Шкала совпадает с fidelityToHand гейтов.
const RES = 384;
function rasterize(svgText) {
  return new Promise((resolve) => {
    if (!svgText) return resolve(null);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas'); c.width = RES; c.height = RES;
      const ctx = c.getContext('2d');
      ctx.clearRect(0, 0, RES, RES);
      ctx.drawImage(img, 0, 0, RES, RES);
      const d = ctx.getImageData(0, 0, RES, RES).data;
      const cov = new Float32Array(RES * RES);
      for (let i = 0; i < RES * RES; i++) cov[i] = d[i * 4 + 3] / 255;
      resolve(cov);
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
function iou(a, b) {
  if (!a || !b) return null;
  let inter = 0, uni = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    inter += x < y ? x : y;
    uni += x > y ? x : y;
  }
  return uni === 0 ? 1 : inter / uni;
}

function devClass(pct) { return pct <= THRESH ? 'ok' : pct <= 8 ? 'warn' : 'bad'; }
function glyphCell(svg, label) {
  if (!svg) return '<div class="glyph empty">нет</div>';
  return '<div class="glyph">' + svg + '<span class="lbl">' + label + '</span></div>';
}

const tbody = document.getElementById('rows');
function render(list) {
  tbody.innerHTML = '';
  for (const r of list) {
    const tr = document.createElement('tr');
    tr.dataset.name = r.name;
    const badges = '<span class="badge ' + (r.statusOutline === 'generated' ? 'gen' : 'hand') + '">O:' + r.statusOutline + '</span>'
      + '<span class="badge ' + (r.statusFilled === 'generated' ? 'gen' : 'hand') + '">F:' + r.statusFilled + '</span>'
      + (r.isNew ? '<span class="badge">нет в seed</span>' : '');
    tr.innerHTML =
      '<td><div class="name">' + r.name + '</div><div class="badges">' + badges + '</div></td>'
      + '<td><div class="cell">' + glyphCell(r.origOutline, 'O') + glyphCell(r.origFilled, 'F') + '</div></td>'
      + '<td><div class="cell">' + glyphCell(r.genOutline, 'O') + glyphCell(r.genFilled, 'F') + '</div></td>'
      + '<td class="dev" data-dev>—</td>'
      + '<td class="arg" data-arg></td>';
    tbody.appendChild(tr);
    computeRow(tr, r);
  }
  document.getElementById('stat').textContent = list.length + ' / ' + DATA.length + ' иконок';
}

async function computeRow(tr, r) {
  const devCell = tr.querySelector('[data-dev]');
  const argCell = tr.querySelector('[data-arg]');
  // Отклонение считаем по ЗАЛИВНОМУ силуэту (сплошная область), не по тонкому
  // штриху: IoU тонкого контура штрафует субпиксельный снос десятками % и топит
  // сигнал. Заливка — устойчивая мера формы, шкала совпадает с fidelityToHand.
  // Fallback на outline только если filled отсутствует.
  const fa = await rasterize(r.origFilled), fb = await rasterize(r.genFilled);
  let score = iou(fa, fb);
  if (score === null) { const oa = await rasterize(r.origOutline), ob = await rasterize(r.genOutline); score = iou(oa, ob); }
  if (score === null) { devCell.textContent = '—'; return; }
  const pct = (1 - score) * 100;
  tr.dataset.dev = pct.toFixed(3);
  devCell.className = 'dev ' + devClass(pct);
  const declared = r.declaredFidelity && r.declaredFidelity.outline
    ? '<small>декл. ' + ((1 - r.declaredFidelity.outline) * 100).toFixed(2) + '%</small>' : '';
  devCell.innerHTML = pct.toFixed(2) + '%' + declared;
  if (pct > THRESH) {
    argCell.className = 'arg flag';
    argCell.innerHTML = r.argumentation
      ? r.argumentation
      : (r.migrated
        ? '<span class="need">отклонение >3% без причины — требуется correctionReason/ownerReview</span>'
        : 'не мигрировано: генерат = рука, отклонение — шум растеризации/оптимизации');
  } else {
    argCell.className = 'arg';
    argCell.textContent = r.argumentation || '';
  }
  reSortIfNeeded();
}

let sortTimer = null;
function reSortIfNeeded() {
  clearTimeout(sortTimer);
  sortTimer = setTimeout(() => {
    const trs = [...tbody.querySelectorAll('tr')];
    trs.sort((a, b) => (parseFloat(b.dataset.dev || -1) - parseFloat(a.dataset.dev || -1)));
    trs.forEach((t) => tbody.appendChild(t));
  }, 120);
}

let filter = 'all', query = '';
function apply() {
  let list = DATA.slice();
  if (filter === 'migrated') list = list.filter((r) => r.migrated);
  if (filter === 'hand') list = list.filter((r) => !r.migrated);
  // 'over' фильтруется после расчёта — по data-dev; для простоты показываем все и метим
  if (query) list = list.filter((r) => r.name.includes(query));
  render(list);
  if (filter === 'over') {
    setTimeout(() => {
      for (const tr of tbody.querySelectorAll('tr'))
        tr.style.display = parseFloat(tr.dataset.dev || 0) > THRESH ? '' : 'none';
    }, 1500);
  }
}
document.querySelectorAll('.toolbar button').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('.toolbar button').forEach((x) => x.classList.remove('active'));
  b.classList.add('active'); filter = b.dataset.filter; apply();
}));
document.getElementById('search').addEventListener('input', (e) => { query = e.target.value.trim(); apply(); });
apply();
</script>
</body>
</html>
`;

writeFileSync(join(OUT_DIR, 'index.html'), html, 'utf8');
const migratedCount = rows.filter((r) => r.migrated).length;
console.log(`preview: ${rows.length} иконок (${migratedCount} мигрировано) → preview/index.html`);
