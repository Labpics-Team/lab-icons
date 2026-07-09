import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGlyph } from './lib/anatomy-gen.js';
import { renderedPathData } from './lib/icon-geometry.js';
import { inkIoU } from './check-anatomy-drift.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const GRID = JSON.parse(readFileSync(join(REPO, 'semantics', 'grid.json'), 'utf8'));
const ANATOMY = JSON.parse(readFileSync(join(REPO, 'semantics', 'anatomy.json'), 'utf8'));

const CANONICAL_VARIANTS = ['outline', 'filled'];
const DEVIATION_WARNING_THRESHOLD = 3;
const CW = GRID.canvas.width;

const SVG_PATHS = {
  outline: join(REPO, 'svg', 'Outline'),
  filled: join(REPO, 'svg', 'Filled'),
};

const SOURCE_FILES = {
  outline: (name) => join(SVG_PATHS.outline, `${name}.svg`),
  filled: (name) => join(SVG_PATHS.filled, `${name}_filled.svg`),
};

const esc = (value) => {
  return String(value).replace(/[&<>\"]/g, (ch) => {
    switch (ch) {
      case '&':
        return '&amp;';
      case '<':
        return '&lt;';
      case '>':
        return '&gt;';
      case '"':
        return '&quot;';
      default:
        return ch;
    }
  });
};

const renderPaths = (paths, options = {}) => {
  if (!paths.length) return '';
  const className = options.className || '';
  const view = `0 0 ${CW} ${CW}`;
  const items = paths
    .map((d) => `<path d="${esc(d)}" ${className ? `class="${className}"` : ''} fill-rule="evenodd"/>`)
    .join('\n');
  return `<svg viewBox="${view}" width="88" height="88" aria-hidden="true"><g>${items}</g></svg>`;
};

const readSourcePaths = (name, variant) => {
  const file = SOURCE_FILES[variant](name);
  if (!existsSync(file)) {
    return { paths: [], status: 'missing', file };
  }

  const raw = readFileSync(file, 'utf8');
  const paths = renderedPathData(raw);
  if (!paths.length) {
    return { paths: [], status: 'empty', file };
  }

  return { paths, status: 'ok', file };
};

const variantReasonText = (text, variant) => {
  if (!text) return '';
  const lower = text.toLowerCase();
  const tokens = [
    `${variant.toLowerCase()}:`,
    `${variant.toUpperCase()}:`,
    `${variant.toLowerCase()} `,
    `${variant.toUpperCase()} `,
  ];

  const tokenHit = tokens.find((token) => lower.includes(token));
  if (!tokenHit) return '';

  return text;
};

const buildReasonForVariant = (entry, variant, status, deviation) => {
  const reasons = [];

  if (entry?.lawOverHand === true) {
    reasons.push(
      `law-over-hand: ${entry.correctionReason || 'слой по правилу приоритета закона над рукой (геометрия связности и согласованности)'}`,
    );
  }

  if (status === 'hand') {
    reasons.push('Исходник помечен как hand. Отклонение не считается дефектом, если это оговорено владельцем визуального решения.');
  }

  if (entry?.correctionReason) {
    const direct = variantReasonText(entry.correctionReason, variant);
    if (direct) {
      reasons.push(`Коррекция (${variant}): ${entry.correctionReason}`);
    } else if (!reasons.length) {
      reasons.push(`Коррекция: ${entry.correctionReason}`);
    }
  }

  if (deviation > DEVIATION_WARNING_THRESHOLD) {
    reasons.push(
      `Сигнал выше порога: отклонение ${deviation.toFixed(2)}% > ${DEVIATION_WARNING_THRESHOLD}%. ` +
        'Требуется визуальная проверка формально-плотностной разницы и пересчет ключевых контрольных метрик (вручную отмечаемые участки).',
    );
  }

  return reasons.length ? reasons.join(' | ') : '—';
};

const rowForMatch = (entry, name, variant, status, sourcePaths, generated) => {
  const genD = generated?.[variant] || '';
  const sourceSvg = renderPaths(sourcePaths);
  const genSvg = genD ? renderPaths([genD]) : '<span class="warn">Нет генерата</span>';
  const iou = inkIoU(sourcePaths.join(' '), genD || '', CW);
  const deviation = (1 - iou) * 100;
  const isBad = deviation > DEVIATION_WARNING_THRESHOLD;
  const reason = buildReasonForVariant(entry, variant, status, deviation);
  const badge = entry.lawOverHand
    ? '<span class="badge badge-law">law-over-hand</span>'
    : status === 'hand'
      ? '<span class="badge badge-hand">hand</span>'
      : '<span class="badge badge-generated">generated</span>';

  return {
    html: `
      <tr>
        <td class="glyph-cell">
          <div class="glyph-name">${esc(name)}</div>
          <div>${badge}</div>
          <div class="muted">${variant}</div>
        </td>
        <td class="cell source-cell">${sourceSvg}</td>
        <td class="cell gen-cell">${genSvg}</td>
        <td class="dev ${isBad ? 'bad' : 'ok'}">${deviation.toFixed(2)}%</td>
        <td class="arg-cell">${isBad ? esc(reason) : '&mdash;'}</td>
      </tr>`,
    isBad,
    deviation,
  };
};

const rows = [];
let skippedSource = 0;
let missingGenerated = 0;
let buildErrors = 0;
let maxDeviation = 0;

const names = Object.keys(ANATOMY.glyphs || {}).sort((a, b) => a.localeCompare(b));
const glyphs = ANATOMY.glyphs || {};

for (const name of names) {
  const entry = glyphs[name];
  if (!entry) continue;

  let generated;
  try {
    generated = buildGlyph(entry, GRID, {}, glyphs);
  } catch (e) {
    buildErrors += 1;
    generated = { error: e.message };
  }

  for (const variant of CANONICAL_VARIANTS) {
    const status = entry?.status?.[variant];
    if (!status) continue;

    const source = readSourcePaths(name, variant);
    if (source.status !== 'ok') {
      skippedSource += 1;
      rows.push({
        html: `
      <tr>
        <td class="glyph-cell">
          <div class="glyph-name">${esc(name)}</div>
          <div><span class="badge badge-missing">Исходник отсутствует</span></div>
          <div class="muted">${variant}</div>
        </td>
        <td colspan="3" class="muted">Нет ${variant} исходника для сравнения</td>
        <td class="arg-cell">${esc(`Источник ${source.file} не найден или не содержит path`)}</td>
      </tr>`,
        isBad: false,
        deviation: 0,
      });
      continue;
    }

    if (!generated || typeof generated[variant] !== 'string' || !generated[variant].trim()) {
      missingGenerated += 1;
      rows.push({
        html: `
      <tr>
        <td class="glyph-cell">
          <div class="glyph-name">${esc(name)}</div>
          <div>${status === 'hand' ? '<span class="badge badge-hand">hand</span>' : '<span class="badge badge-generated">generated</span>'}</div>
          <div class="muted">${variant}</div>
        </td>
        <td class="source-cell">${renderPaths(source.paths)}</td>
        <td class="muted">Не удалось построить генерат</td>
        <td class="dev bad">—</td>
        <td class="arg-cell">${esc(generated?.error || `entry.status=${status} для ${variant}, но buildGlyph не вернул path`)}</td>
      </tr>`,
        isBad: false,
        deviation: 0,
      });
      continue;
    }

    const row = rowForMatch(entry, name, variant, status, source.paths, generated);
    rows.push(row);
    if (row.deviation > maxDeviation) maxDeviation = row.deviation;
  }
}

const rowsHtml = rows.map((r) => r.html).join('\n');
const criticalRows = rows.filter((r) => r.isBad).length;
const taggedCount = (rowsHtml.match(/badge-law|badge-hand|badge-generated/g) || []).length;

const html = `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>lab-icons preview — full original vs generated</title>
  <style>
    :root { color-scheme: light dark; }
    body { font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; background: #fff; color: #111; }
    @media (prefers-color-scheme: dark) {
      body { background: #111; color: #f2f2f2; }
    }
    .wrap { max-width: 1400px; margin: 0 auto; padding: 22px; }
    h1 { margin: 0 0 14px; font-size: 24px; }
    .meta { font-size: 13px; margin-bottom: 18px; color: #666; }
    @media (prefers-color-scheme: dark) { .meta { color: #9a9a9a; } }
    table { border-collapse: collapse; width: 100%; table-layout: fixed; }
    th, td { border: 1px solid #8884; padding: 10px; text-align: center; vertical-align: top; }
    thead th { background: #f2f2f8; }
    @media (prefers-color-scheme: dark) { thead th { background: #1f1f29; } }
    .glyph-cell { text-align: left; width: 180px; }
    .glyph-name { font-weight: 700; margin-bottom: 4px; }
    .source-cell, .gen-cell { width: 28%; }
    .source-cell svg, .gen-cell svg { width: 88px; height: 88px; display: block; margin: 4px auto; }
    .source-cell path, .gen-cell path { fill: currentColor; }
    .gen-cell { background: #e9f4ff; }
    @media (prefers-color-scheme: dark) { .gen-cell { background: #17324f55; } }
    .muted { color: #666; }
    @media (prefers-color-scheme: dark) { .muted { color: #9a9a9a; } }
    .dev { font-variant-numeric: tabular-nums; font-weight: 700; }
    .dev.ok { color: #16895f; }
    .dev.bad { color: #b14a30; }
    .arg-cell { text-align: left; max-width: 420px; }
    .badge { display: inline-block; border-radius: 10px; padding: 2px 8px; font-size: 11px; color: #222; background: #ddd; }
    .badge-hand { background: #ffd37a; }
    .badge-generated { background: #bde3ff; }
    .badge-law { background: #d2d2ff; }
    .badge-missing { background: #ddd; color: #444; }
    .warn { color: #8a1f1f; }
    .footer { margin-top: 16px; color: #666; font-size: 12px; }
    @media (prefers-color-scheme: dark) { .footer { color: #9a9a9a; } }
  </style>
</head>
<body>
  <div class="wrap">
    <h1>Lab-icons: full preview original vs generated</h1>
    <div class="meta">
      Иконок: <strong>${esc(names.length)}</strong>; варианта: <strong>outline + filled</strong>.
      Обработано строк: <strong>${rows.length}</strong>.
      Критичные отклонения (>${DEVIATION_WARNING_THRESHOLD}%): <strong>${criticalRows}</strong>.
      Максимальное отклонение: <strong>${maxDeviation.toFixed(2)}%</strong>.
    </div>
    <table>
      <thead>
        <tr>
          <th>Иконка</th>
          <th>Оригинал</th>
          <th>Генерат</th>
          <th>Отклонение</th>
          <th>Аргументация</th>
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
    <div class="footer">
      Пропуски источника: ${skippedSource}, несуществующий/пустой генерируемый путь: ${missingGenerated}, ошибок buildGlyph: ${buildErrors}, пометок статуса: ${taggedCount}.
    </div>
  </div>
</body>
</html>`;

const OUT = join(REPO, 'preview', 'icon-preview-full.html');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf8');

console.log(`? preview: ${rows.length} рядов записано в ${OUT}`);
console.log(`  критичные отклонения: ${criticalRows}`);
console.log(`  build errors: ${buildErrors}; source missing: ${skippedSource}; generated missing: ${missingGenerated}`);
console.log(`  max deviation: ${maxDeviation.toFixed(2)}%`);
