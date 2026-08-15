#!/usr/bin/env node
/**
 * scripts/build-corpus-preview.mjs — truth-first превью корпуса.
 *
 * Закон truth-reset (железное правило 4): shipped = truth. Превью обязано
 * показывать поставку svg/** как есть; модель — отдельная явно помеченная
 * колонка по явному переключателю, никогда не подменяющая shipped-слой.
 * Предыдущий corpus.html рендерил ВСЁ через glyph() (model с source-fallback)
 * — владелец видел не то, что реально в поставке; 14 новых иконок #78 были
 * невидимы.
 *
 * Outputs (preview/ игнорируется, воспроизводимые артефакты):
 *   preview/corpus.html          — грид: слой SHIPPED (img из shipped/**),
 *                                  опциональная MODEL-колонка через ir-bundle;
 *   preview/shipped/{Outline,Filled}/ — побайтовые копии svg/**.
 */

import { copyFileSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function buildCorpusPreview({ root = ROOT, outDir = join(ROOT, 'preview') } = {}) {
  let copied = 0;
  for (const variant of ['Outline', 'Filled']) {
    const srcDir = join(root, 'svg', variant);
    const dstDir = join(outDir, 'shipped', variant);
    mkdirSync(dstDir, { recursive: true });
    for (const f of readdirSync(srcDir).filter((f) => f.endsWith('.svg'))) {
      copyFileSync(join(srcDir, f), join(dstDir, f));
      copied++;
    }
  }
  writeFileSync(join(outDir, 'corpus.html'), CORPUS_HTML, 'utf8');
  return { copied };
}

const CORPUS_HTML = `<!doctype html>
<html lang="ru">
<meta charset="utf-8">
<title>lab-icons — корпус 444: shipped = truth</title>
<style>
  :root { color-scheme: light; }
  body { font: 14px/1.45 system-ui; margin: 0; background: #f5f5f7; color: #1d1d1f; }
  header { position: sticky; top: 0; z-index: 5; background: #fffc; backdrop-filter: blur(12px); border-bottom: 1px solid #e5e5ea; padding: 12px 20px; display: flex; gap: 18px; align-items: center; flex-wrap: wrap; }
  h1 { font-size: 16px; margin: 0 12px 0 0; }
  .seg { display: flex; border: 1px solid #d2d2d7; border-radius: 8px; overflow: hidden; }
  .seg button { border: 0; background: #fff; padding: 5px 12px; cursor: pointer; font: inherit; }
  .seg button.on { background: #1d1d1f; color: #fff; }
  label.sl { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #6e6e73; }
  input[type=range] { width: 130px; }
  input[type=search] { border: 1px solid #d2d2d7; border-radius: 8px; padding: 5px 10px; font: inherit; width: 180px; }
  .hint { font-size: 12px; color: #6e6e73; }
  main { padding: 16px 20px 60px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
  .cell { background: #fff; border: 1px solid #e9e9ee; border-radius: 10px; padding: 8px 4px 6px; text-align: center; position: relative; }
  .cell img, .cell .model-svg svg { width: 48px; height: 48px; display: block; margin: 0 auto; }
  .cell .nm { font-size: 10px; color: #6e6e73; margin-top: 4px; word-break: break-all; }
  .cell .layer-label { font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; margin-top: 2px; }
  .layer-label.shipped { color: #1d7a34; }
  .layer-label.model { color: #b25000; }
  .model-svg { border-top: 1px dashed #e5e5ea; margin-top: 6px; padding-top: 6px; }
  .cell.small img, .cell.small .model-svg svg { width: 16px; height: 16px; }
  .cell.mid img, .cell.mid .model-svg svg { width: 24px; height: 24px; }
  .count { margin: 8px 0 12px; color: #6e6e73; font-size: 12px; }
</style>
<header>
  <h1>lab-icons · 222 × 2 · shipped = truth</h1>
  <div class="seg" id="variantSeg">
    <button data-v="outline" class="on">Outline</button>
    <button data-v="filled">Filled</button>
  </div>
  <div class="seg" id="sizeSeg">
    <button data-s="48" class="on">48</button>
    <button data-s="24">24</button>
    <button data-s="16">16</button>
  </div>
  <label class="sl"><input type="checkbox" id="showModel"> показать MODEL-колонку (генерат, не поставка)</label>
  <label class="sl">weight <input type="range" id="axWeight" min="0.60" max="1.29" step="0.01" value="1" disabled> <span id="wv">1.00</span></label>
  <label class="sl">corner <input type="range" id="axCorner" min="0" max="1" step="0.05" value="0.6" disabled> <span id="cv">0.60</span></label>
  <input type="search" id="q" placeholder="фильтр по имени…">
  <span class="hint">Основной слой — SHIPPED: файлы svg/** как есть (копии в shipped/). MODEL — отдельная явно помеченная колонка; оси действуют только на неё.</span>
</header>
<main>
  <div class="count" id="count"></div>
  <div class="grid" id="grid"></div>
</main>
<script type="module">
  // SHIPPED = TRUTH: превью показывает поставку svg/**, а не модель.
  // Model — только по явному переключателю, отдельным слоем с меткой MODEL.
  import { glyph, glyphCapabilities, iconIds } from './ir-bundle.js';

  const grid = document.getElementById('grid');
  const state = { variant: 'outline', size: 48, weight: 1, corner: 0.6, q: '', model: false };

  const capsCache = new Map();
  function caps(id, variant) {
    const k = id + '/' + variant;
    if (!capsCache.has(k)) { try { capsCache.set(k, glyphCapabilities(id, variant)); } catch { capsCache.set(k, null); } }
    return capsCache.get(k);
  }

  function shippedSrc(id, variant) {
    return variant === 'outline'
      ? 'shipped/Outline/' + id + '.svg'
      : 'shipped/Filled/' + id + '_filled.svg';
  }

  function modelSvg(id) {
    const c = caps(id, state.variant);
    if (!c?.modelState) return null;
    const axes = {};
    for (const a of c.supportedAxes) {
      const lim = c.axes[a];
      if (a === 'weight') axes.weight = Math.min(lim.max, Math.max(lim.min, state.weight));
      if (a === 'corner') axes.corner = Math.min(lim.max, Math.max(lim.min, state.corner));
    }
    try {
      return {
        svg: glyph({ icon: id, variant: state.variant, modelMode: 'allow-candidate', axes }).svg,
        axes: Object.keys(axes),
        state: c.modelState,
      };
    } catch { return null; }
  }

  function render() {
    const frag = document.createDocumentFragment();
    let shown = 0, modeled = 0;
    for (const id of iconIds) {
      if (state.q && !id.includes(state.q)) continue;
      const cell = document.createElement('div');
      cell.className = 'cell' + (state.size === 16 ? ' small' : state.size === 24 ? ' mid' : '');
      let html =
        '<img src="' + shippedSrc(id, state.variant) + '" alt="' + id + '" loading="lazy">' +
        '<div class="layer-label shipped">shipped</div>';
      if (state.model) {
        const m = modelSvg(id);
        if (m) {
          modeled++;
          html += '<div class="model-svg">' + m.svg +
            '<div class="layer-label model">model · ' + m.state +
            (m.axes.length ? ' · ' + m.axes.join(',') : '') + '</div></div>';
        }
      }
      html += '<div class="nm">' + id + '</div>';
      cell.innerHTML = html;
      frag.appendChild(cell);
      shown++;
    }
    grid.replaceChildren(frag);
    document.getElementById('count').textContent =
      shown + ' глифов (' + state.variant + '), слой: shipped из svg/**' +
      (state.model ? '; model-колонка: ' + modeled : '');
  }

  document.getElementById('variantSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of e.currentTarget.querySelectorAll('button')) x.classList.toggle('on', x === b);
    state.variant = b.dataset.v; render();
  });
  document.getElementById('sizeSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button'); if (!b) return;
    for (const x of e.currentTarget.querySelectorAll('button')) x.classList.toggle('on', x === b);
    state.size = Number(b.dataset.s); render();
  });
  document.getElementById('showModel').addEventListener('change', (e) => {
    state.model = e.target.checked;
    document.getElementById('axWeight').disabled = !state.model;
    document.getElementById('axCorner').disabled = !state.model;
    render();
  });
  document.getElementById('axWeight').addEventListener('input', (e) => {
    state.weight = Number(e.target.value);
    document.getElementById('wv').textContent = state.weight.toFixed(2);
    render();
  });
  document.getElementById('axCorner').addEventListener('input', (e) => {
    state.corner = Number(e.target.value);
    document.getElementById('cv').textContent = state.corner.toFixed(2);
    render();
  });
  document.getElementById('q').addEventListener('input', (e) => { state.q = e.target.value.trim(); render(); });

  render();
</script>
</html>
`;

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const { copied } = buildCorpusPreview();
  console.log(`build-corpus-preview: corpus.html (truth-first) + ${copied} shipped-копий`);
}
