import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGlyph } from './lib/anatomy-gen.js';
import { renderedPathData } from './lib/icon-geometry.js';
import { inkIoU, validateAnatomy } from './check-anatomy-drift.js';

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

const escapeHtml = (value) => {
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
    .map((d) => `<path d="${escapeHtml(d)}" ${className ? `class="${className}"` : ''} fill-rule="evenodd"/>`)
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

const collectAnatomyReasons = () => {
  const readSvg = (variant, name) => {
    const file = SOURCE_FILES[variant](name);
    try {
      return readFileSync(file, 'utf8');
    } catch {
      return null;
    }
  };

  const { hard, report } = validateAnatomy({
    grid: GRID,
    anatomy: ANATOMY,
    readSvg,
  });

  const map = new Map();
  const addLine = (line) => {
    const p = line.indexOf(':');
    if (p <= 0) return;
    const key = line.slice(0, p).trim();
    const reason = line.slice(p + 1).trim();
    const bucket = map.get(key) || [];
    bucket.push(reason);
    map.set(key, bucket);
  };

  hard.forEach(addLine);
  report.forEach(addLine);

  return {
    reasons: map,
    hardCount: hard.length,
    reportCount: report.length,
  };
};

const selectVariantReason = (text, variant) => {
  const lower = text.toLowerCase();
  const tokens = [
    `${variant.toLowerCase()}:`,
    `${variant.toUpperCase()}:`,
    `${variant.toLowerCase()} `,
    `${variant.toUpperCase()} `,
  ];
  return tokens.find((token) => lower.includes(token)) ? text : '';
};

const buildReasonForVariant = (entry, variant, status, deviation, reasonsForVariant = []) => {
  const reasons = [];
  if (entry?.lawOverHand === true) {
    reasons.push(
      `law-over-hand: ${entry.correctionReason || 'geometry policy overrides handwritten draft; consistency and topology are prioritized'}`,
    );
  }
  if (status === 'hand') {
    reasons.push(
      'Source is marked as hand. Deviation is allowed only when this is explicitly accepted by visual-system owner.',
    );
  }

  for (const reason of reasonsForVariant) {
    const direct = selectVariantReason(reason, variant);
    reasons.push(direct || reason);
  }

  if (deviation > DEVIATION_WARNING_THRESHOLD) {
    reasons.push(
      `Deviation above threshold: ${deviation.toFixed(2)}% > ${DEVIATION_WARNING_THRESHOLD}%. Manual geometry review is required.`,
    );
  }

  return [...new Map(reasons.map((r) => [r, true])).keys()];
};

const rowForMatch = (entry, name, variant, status, sourcePaths, generated, reasonsMap) => {
  const genD = generated?.[variant] || '';
  const sourceSvg = renderPaths(sourcePaths);
  const genSvg = genD ? renderPaths([genD]) : '<span class="warn">No generated path</span>';
  const iou = inkIoU(sourcePaths.join(' '), genD || '', CW);
  const deviation = (1 - iou) * 100;
  const isBad = deviation > DEVIATION_WARNING_THRESHOLD;
  const reasonsForVariant = reasonsMap.get(`${name}/${variant}`) || [];
  const reasonParts = buildReasonForVariant(entry, variant, status, deviation, reasonsForVariant);
  const reason = reasonParts.length ? reasonParts.join(' | ') : '—';
  const badge = entry.lawOverHand
    ? '<span class="badge badge-law">law-over-hand</span>'
    : status === 'hand'
      ? '<span class="badge badge-hand">hand</span>'
      : '<span class="badge badge-generated">generated</span>';

  return {
    html: `
      <tr>
        <td class="glyph-cell">
          <div class="glyph-name">${escapeHtml(name)}</div>
          <div>${badge}</div>
          <div class="muted">${variant}</div>
        </td>
        <td class="cell source-cell">${sourceSvg}</td>
        <td class="cell gen-cell">${genSvg}</td>
        <td class="dev ${isBad ? 'bad' : 'ok'}">${deviation.toFixed(2)}%</td>
        <td class="arg-cell">${isBad ? escapeHtml(reason) : '&mdash;'}</td>
      </tr>`,
    isBad,
    deviation,
  };
};

const makeHtml = ({
  namesCount,
  rows,
  criticalRows,
  maxDeviation,
  skippedSource,
  missingGenerated,
  buildErrors,
  taggedCount,
  reasonsCount,
  hardCount,
  reportCount,
}) => `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>lab-icons preview &mdash; full original vs generated</title>
  <style>
    :root { color-scheme: light dark; }
    body { font: 14px/1.45 system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif; margin: 0; background: #fff; color: #111; }
    @media (prefers-color-scheme: dark) { body { background: #111; color: #f2f2f2; } }
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
      Icons: <strong>${namesCount}</strong>; variants: <strong>outline + filled</strong>.
      Rows processed: <strong>${rows.length}</strong>.
      Critical deviations (>${DEVIATION_WARNING_THRESHOLD}%): <strong>${criticalRows}</strong>.
      Max deviation: <strong>${maxDeviation.toFixed(2)}%</strong>.
      Reason keys: <strong>${reasonsCount}</strong>.
      Anatomy hard/report: <strong>${hardCount}/${reportCount}</strong>.
    </div>
    <table>
      <thead>
        <tr>
          <th>Icon</th>
          <th>Original</th>
          <th>Generated</th>
          <th>Deviation</th>
          <th>Argument</th>
        </tr>
      </thead>
      <tbody>
        ${rows.map((r) => r.html).join('\n')}
      </tbody>
    </table>
    <div class="footer">
      Missing source: ${skippedSource}, missing generated path: ${missingGenerated}, buildGlyph errors: ${buildErrors}, status badges: ${taggedCount}.
    </div>
  </div>
</body>
</html>`;

const buildFullPreview = ({ outputPath = join(REPO, 'preview', 'icon-preview-full.html') } = {}) => {
  const rows = [];
  let skippedSource = 0;
  let missingGenerated = 0;
  let buildErrors = 0;
  let maxDeviation = 0;

  const { reasons, hardCount, reportCount } = collectAnatomyReasons();
  const names = Object.keys(ANATOMY.glyphs || {}).sort((a, b) => a.localeCompare(b));
  const glyphs = ANATOMY.glyphs || {};
  const reasonsCount = reasons.size;

  for (const name of names) {
    const entry = glyphs[name];
    if (!entry) continue;

    let generated;
    try {
      generated = buildGlyph(entry, GRID, {}, glyphs);
    } catch (error) {
      buildErrors += 1;
      generated = { error: error.message };
    }

    for (const variant of CANONICAL_VARIANTS) {
      const status = entry?.status?.[variant];
      if (!status) continue;

      const source = readSourcePaths(name, variant);
      if (source.status !== 'ok') {
        skippedSource += 1;
        const missingHtml = `
      <tr>
        <td class="glyph-cell">
          <div class="glyph-name">${escapeHtml(name)}</div>
          <div><span class="badge badge-missing">Source missing</span></div>
          <div class="muted">${variant}</div>
        </td>
        <td colspan="3" class="muted">No ${variant} source for comparison</td>
        <td class="arg-cell">${escapeHtml(`Source ${source.file} missing or has no path`)}</td>
      </tr>`;
        rows.push({ html: missingHtml, isBad: false, deviation: 0 });
        continue;
      }

      if (!generated || typeof generated[variant] !== 'string' || !generated[variant].trim()) {
        missingGenerated += 1;
        const badGeneratedHtml = `
      <tr>
        <td class="glyph-cell">
          <div class="glyph-name">${escapeHtml(name)}</div>
          <div>${status === 'hand' ? '<span class="badge badge-hand">hand</span>' : '<span class="badge badge-generated">generated</span>'}</div>
          <div class="muted">${variant}</div>
        </td>
        <td class="source-cell">${renderPaths(source.paths)}</td>
        <td class="muted">Cannot build generated path</td>
        <td class="dev bad">—</td>
        <td class="arg-cell">${escapeHtml(generated?.error || `entry.status=${status} for ${variant}, buildGlyph returned no path`)}</td>
      </tr>`;
        rows.push({ html: badGeneratedHtml, isBad: true, deviation: 100 });
        continue;
      }

      const row = rowForMatch(entry, name, variant, status, source.paths, generated, reasons);
      rows.push(row);
      if (row.deviation > maxDeviation) maxDeviation = row.deviation;
    }
  }

  const criticalRows = rows.filter((r) => r.isBad).length;
  const taggedCount = (rows.map((r) => r.html).join(' ').match(/badge-law|badge-hand|badge-generated/g) || []).length;
  const html = makeHtml({
    namesCount: names.length,
    rows,
    criticalRows,
    maxDeviation,
    skippedSource,
    missingGenerated,
    buildErrors,
    taggedCount,
    reasonsCount,
    hardCount,
    reportCount,
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, html, 'utf8');

  return {
    names: names.length,
    rows: rows.length,
    criticalRows,
    maxDeviation,
    skippedSource,
    missingGenerated,
    buildErrors,
    taggedCount,
    reasonsCount,
    hardCount,
    reportCount,
    outputPath,
  };
};

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const summary = buildFullPreview();
  console.log(`preview: ${summary.rows} rows written to ${summary.outputPath}`);
  console.log(`  critical: ${summary.criticalRows}`);
  console.log(`  build errors: ${summary.buildErrors}; source missing: ${summary.skippedSource}; generated missing: ${summary.missingGenerated}`);
  console.log(`  hard/report: ${summary.hardCount}/${summary.reportCount}, reason keys: ${summary.reasonsCount}`);
  console.log(`  max deviation: ${summary.maxDeviation.toFixed(2)}%`);
}

export { buildFullPreview };
