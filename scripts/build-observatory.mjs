#!/usr/bin/env node
/**
 * Quality Observatory: one deterministic, corpus-complete hand-vs-law view.
 *
 * Outputs (ignored, reproducible artifacts):
 *   preview/observatory.html  — self-contained, filterable visual report;
 *   preview/observatory.json  — machine-readable facts for all 444 variants.
 *
 * Generated shipments are compared with the last proven hand blob from git
 * history. Hand and unmodelled shipments are compared from the current file.
 * Missing history, shallow history and malformed corpus parity fail closed.
 */

import { createHash } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGlyphParts } from './lib/anatomy-gen.js';
import { createHandHistory } from './lib/hand-history.js';
import { renderedPathEntries } from './lib/icon-geometry.js';
import {
  compareSilhouettes,
  DEFAULT_OBSERVATORY_RASTER_SIZES,
} from './lib/quality-metrics.js';
import { AUTO_ACCEPTANCE_DEVIATION_PCT } from './lib/quality-policy.js';

const DEFAULT_REPO = join(dirname(fileURLToPath(import.meta.url)), '..');
const VARIANTS = Object.freeze(['outline', 'filled']);
const DEVIATION_REASON_THRESHOLD_PCT = AUTO_ACCEPTANCE_DEVIATION_PCT;
const PLACEHOLDER_REASON =
  /(?:\b(?:todo|tbd|fixme|placeholder|pending|unknown|n\/?a)\b|аргумент\s+не\s+задекларирован|не\s+объяснен|не\s+объяснён|без\s+объяснения)/iu;

const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const compareAscii = (a, b) => (a < b ? -1 : a > b ? 1 : 0);

function variantPath(name, variant) {
  return variant === 'outline'
    ? `svg/Outline/${name}.svg`
    : `svg/Filled/${name}_filled.svg`;
}

function corpusNames(repo) {
  const outline = readdirSync(join(repo, 'svg', 'Outline'))
    .filter((file) => file.endsWith('.svg'))
    .map((file) => file.slice(0, -4))
    .sort(compareAscii);
  const filled = readdirSync(join(repo, 'svg', 'Filled'))
    .filter((file) => file.endsWith('_filled.svg'))
    .map((file) => file.slice(0, -'_filled.svg'.length))
    .sort(compareAscii);

  if (new Set(outline).size !== outline.length || new Set(filled).size !== filled.length) {
    throw new Error('build-observatory: дубли имён в SVG-корпусе запрещены');
  }
  const outlineOnly = outline.filter((name) => !filled.includes(name));
  const filledOnly = filled.filter((name) => !outline.includes(name));
  if (outlineOnly.length > 0 || filledOnly.length > 0) {
    throw new Error(
      `build-observatory: variant parity нарушен; только Outline=[${outlineOnly.join(', ')}], ` +
        `только Filled=[${filledOnly.join(', ')}]`,
    );
  }
  return outline;
}

function variantText(value, variant) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object' && typeof value[variant] === 'string') {
    return value[variant].trim();
  }
  return '';
}

function declaredReason(entry, variant) {
  for (const field of ['correctionReason', 'ownerReview']) {
    const text = variantText(entry?.[field], variant);
    if (text) return { field, text };
  }
  return null;
}

export function isSubstantiveObservatoryReason(text) {
  const normalized = typeof text === 'string' ? text.trim() : '';
  return normalized.length >= 24 && !PLACEHOLDER_REASON.test(normalized);
}

export function buildDeviationReason({ deviationPct, entry, variant }) {
  if (!(Number.isFinite(deviationPct) && deviationPct > DEVIATION_REASON_THRESHOLD_PCT)) {
    const declared = declaredReason(entry, variant);
    return declared && isSubstantiveObservatoryReason(declared.text)
      ? {
          required: false,
          status: 'DECLARED',
          code: declared.field === 'correctionReason' ? 'CORRECTION_REASON' : 'OWNER_REVIEW',
          sourceField: declared.field,
          text: declared.text,
        }
      : { required: false, status: 'NOT_REQUIRED', code: null, sourceField: null, text: null };
  }

  const declared = declaredReason(entry, variant);
  if (declared && isSubstantiveObservatoryReason(declared.text)) {
    return {
      required: true,
      status: 'EXPLAINED',
      code: declared.field === 'correctionReason' ? 'CORRECTION_REASON' : 'OWNER_REVIEW',
      sourceField: declared.field,
      text: declared.text,
    };
  }
  return {
    required: true,
    status: 'UNEXPLAINED',
    code: 'UNEXPLAINED',
    sourceField: declared?.field ?? null,
    text: null,
    rejectedText: declared?.text ?? null,
    rejection:
      declared == null
        ? 'MISSING'
        : PLACEHOLDER_REASON.test(declared.text)
          ? 'PLACEHOLDER'
          : 'TOO_SHORT',
  };
}

function modelFor(entry, built, buildError, variant, catalogState) {
  if (buildError) {
    return {
      status: 'MODEL_ERROR',
      catalogState,
      anatomyStatus: entry?.status?.[variant] ?? null,
      archetype: entry?.archetype ?? null,
      error: buildError.message,
      pathDataSha256: null,
    };
  }
  const d = built?.[variant];
  if (typeof d !== 'string' || d.trim() === '') {
    return {
      status: 'NOT_MODELED',
      catalogState,
      anatomyStatus: entry?.status?.[variant] ?? null,
      archetype: entry?.archetype ?? null,
      error: null,
      pathDataSha256: null,
    };
  }
  return {
    status: 'MODELED',
    catalogState,
    anatomyStatus: entry?.status?.[variant] ?? null,
    archetype: entry?.archetype ?? null,
    error: null,
    pathDataSha256: sha256(d),
  };
}

function verdictFor(model, metrics, reason) {
  if (model.status === 'MODEL_ERROR') {
    return { status: 'FAIL', issues: ['MODEL_ERROR'] };
  }
  if (model.status === 'NOT_MODELED') {
    return { status: 'NOT_MODELED', issues: ['NOT_MODELED'] };
  }

  const issues = [];
  if (metrics.deviationPct == null) issues.push('UNDEFINED_DEVIATION');
  if (metrics.topology.uncertain) {
    issues.push('TOPOLOGY_UNCERTAIN');
  } else if (metrics.topology.mismatch) {
    issues.push('TOPOLOGY_MISMATCH');
  }
  if (metrics.raster.some((sample) => sample.topology.mismatch)) {
    issues.push('RASTER_TOPOLOGY_MISMATCH');
  }
  if (reason.status === 'UNEXPLAINED') issues.push('UNEXPLAINED_DEVIATION');
  if (issues.length > 0) return { status: 'FAIL', issues };
  if (metrics.deviationPct > DEVIATION_REASON_THRESHOLD_PCT) {
    return { status: 'REVIEW', issues: ['EXPLAINED_DEVIATION_OVER_THRESHOLD'] };
  }
  return { status: 'PASS', issues: [] };
}

function readCurrentOriginal(repo, relativePath) {
  const svg = readFileSync(join(repo, relativePath), 'utf8');
  return {
    svg,
    source: {
      kind: 'CURRENT_SHIPMENT',
      path: relativePath,
      sha256: sha256(svg),
      commitSha: null,
      blobSha: null,
      date: null,
    },
  };
}

function readHistoricalOriginal(history, relativePath, name, variant) {
  const hand = history.handFromHistory(relativePath, name, variant);
  if (!hand) {
    throw new Error(
      `build-observatory: ${name}/${variant} status=generated, но доказанный hand blob не найден`,
    );
  }
  return {
    svg: hand.svg,
    source: {
      kind: 'HISTORICAL_HAND',
      path: hand.path,
      currentPath: relativePath,
      sha256: sha256(hand.svg),
      commitSha: hand.commitSha,
      shortCommitSha: hand.shortCommitSha,
      blobSha: hand.blobSha,
      date: hand.date,
    },
  };
}

function sanitizeEntries(svg, label) {
  const entries = renderedPathEntries(svg).map(({ d, fillRule }) => ({ d, fillRule }));
  if (entries.length === 0) throw new Error(`build-observatory: ${label} не содержит рендерящихся path`);
  return entries;
}

function summarize(rows, glyphCount) {
  const count = (predicate) => rows.filter(predicate).length;
  return {
    glyphs: glyphCount,
    variants: rows.length,
    modeled: count((row) => row.model.status === 'MODELED'),
    notModeled: count((row) => row.model.status === 'NOT_MODELED'),
    modelErrors: count((row) => row.model.status === 'MODEL_ERROR'),
    historicalHandOriginals: count((row) => row.original.kind === 'HISTORICAL_HAND'),
    currentShipmentOriginals: count((row) => row.original.kind === 'CURRENT_SHIPMENT'),
    pass: count((row) => row.verdict.status === 'PASS'),
    review: count((row) => row.verdict.status === 'REVIEW'),
    fail: count((row) => row.verdict.status === 'FAIL'),
    unexplained: count((row) => row.reason.status === 'UNEXPLAINED'),
    topologyDifferences: count((row) => row.metrics?.topology?.difference === true),
    topologyUncertain: count((row) => row.metrics?.topology?.uncertain === true),
  };
}

/** Build the report model without writing artifacts. */
export function createObservatoryReport({ repo = DEFAULT_REPO } = {}) {
  const root = resolve(repo);
  const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
  const anatomy = JSON.parse(readFileSync(join(root, 'semantics', 'anatomy.json'), 'utf8'));
  const catalog = JSON.parse(readFileSync(join(root, 'semantics', 'catalog.json'), 'utf8'));
  const names = corpusNames(root);
  const history = createHandHistory(root);

  if (history.isShallow()) {
    throw new Error(
      'build-observatory: shallow git history не доказывает historical-hand provenance; нужен полный clone',
    );
  }

  const rows = [];
  const visuals = new Map();
  for (const name of names) {
    const entry = anatomy.glyphs?.[name] ?? null;
    let built = null;
    let builtParts = null;
    let buildError = null;
    if (entry) {
      try {
        builtParts = buildGlyphParts(entry, grid, {}, anatomy.glyphs);
        built = Object.fromEntries(VARIANTS.map((variant) => [
          variant,
          builtParts[variant]?.map((part) => part.d).join('') ?? null,
        ]));
      } catch (error) {
        buildError = error instanceof Error ? error : new Error(String(error));
      }
    }

    for (const variant of VARIANTS) {
      const relativePath = variantPath(name, variant);
      const anatomyStatus = entry?.status?.[variant] ?? null;
      if (anatomyStatus != null && anatomyStatus !== 'generated' && anatomyStatus !== 'hand') {
        throw new Error(
          `build-observatory: ${name}/${variant} имеет неизвестный anatomy status ${JSON.stringify(anatomyStatus)}`,
        );
      }

      const original =
        anatomyStatus === 'generated'
          ? readHistoricalOriginal(history, relativePath, name, variant)
          : readCurrentOriginal(root, relativePath);
      const originalEntries = sanitizeEntries(original.svg, `${name}/${variant} original`);
      const catalogState = catalog.icons?.[name]?.model?.variants?.[variant]?.state ?? null;
      const model = modelFor(entry, built, buildError, variant, catalogState);

      if (anatomyStatus === 'generated' && model.status !== 'MODELED') {
        throw new Error(
          `build-observatory: ${name}/${variant} status=generated, но buildGlyph не отдал candidate`,
        );
      }

      let candidateEntries = null;
      let metrics = null;
      if (model.status === 'MODELED') {
        const composition = catalog.icons?.[name]?.model?.variants?.[variant]?.composition;
        if (!composition || composition.kind !== 'compound') {
          throw new Error(`build-observatory: ${name}/${variant} потерял model composition`);
        }
        candidateEntries = [{ d: built[variant], fillRule: composition.fillRule }];
        metrics = compareSilhouettes(originalEntries, candidateEntries, {
          canvas: grid.canvas.width,
          rasterSizes: DEFAULT_OBSERVATORY_RASTER_SIZES,
        });
      }
      const reason =
        metrics == null
          ? { required: false, status: 'NOT_APPLICABLE', code: null, sourceField: null, text: null }
          : buildDeviationReason({ deviationPct: metrics.deviationPct, entry, variant });
      const verdict = verdictFor(model, metrics, reason);
      const id = `${name}/${variant}`;

      rows.push({
        id,
        name,
        variant,
        original: original.source,
        model,
        metrics,
        reason,
        verdict,
      });
      visuals.set(id, { originalEntries, candidateEntries });
    }
  }

  const report = {
    schemaVersion: 3,
    title: 'Lab Icons Quality Observatory',
    policy: {
      originalForGenerated: 'last-proven-hand-blob-from-git-history',
      originalForHandOrUnmodeled: 'current-shipment',
      missingModel: 'NOT_MODELED; metrics are null, never 0%',
      deviation: 'binary centre-sampled occupancy symmetric-difference / union',
      deviationReasonThresholdPct: DEVIATION_REASON_THRESHOLD_PCT,
      boundary: 'symmetric nearest distance between boundary-cell centres, in canvas units',
      topology: 'adaptive vector-guided multiphase occupancy; uncertainty fails closed',
      analysisStep: 0.12,
      rasterSizes: [...DEFAULT_OBSERVATORY_RASTER_SIZES],
      targetRaster: 'binary centre-sampled occupancy, not alpha coverage; deviation/boundary/centroid are diagnostic-only until an alpha-coverage renderer is calibrated, while target topology is acceptance-gated',
      reasonPlaceholderVerdict: 'FAIL/UNEXPLAINED',
      acceptance: 'accepted catalog state is permitted only for Observatory PASS rows',
    },
    summary: summarize(rows, names.length),
    rows,
  };
  return { report, visuals };
}

function pathMarkup(entries, { fill = 'currentColor' } = {}) {
  return entries
    .map(
      (entry) =>
        `<path d="${escapeHtml(entry.d)}" fill="${escapeHtml(fill)}" fill-rule="${entry.fillRule === 'evenodd' ? 'evenodd' : 'nonzero'}"/>`,
    )
    .join('');
}

function iconSvg(entries, canvas, className, extra = '') {
  return `<svg class="icon ${className}" viewBox="0 0 ${canvas} ${canvas}" role="img" ${extra}>${pathMarkup(entries)}</svg>`;
}

function comparisonVisual(entries, canvas, id, kind) {
  const { originalEntries, candidateEntries } = entries;
  if (!candidateEntries) return '<div class="not-modeled">NOT MODELED</div>';
  if (kind === 'overlay') {
    return `<svg class="icon overlay" viewBox="0 0 ${canvas} ${canvas}" role="img" aria-label="overlay">
      <g class="overlay-original">${pathMarkup(originalEntries)}</g>
      <g class="overlay-candidate">${pathMarkup(candidateEntries)}</g>
    </svg>`;
  }

  const safeId = `diff-${id.replace(/[^a-z0-9-]/gi, '-')}`;
  return `<svg class="icon difference" viewBox="0 0 ${canvas} ${canvas}" role="img" aria-label="difference">
    <defs>
      <mask id="${safeId}-without-candidate" maskUnits="userSpaceOnUse" x="0" y="0" width="${canvas}" height="${canvas}">
        <rect width="${canvas}" height="${canvas}" fill="#fff"/>${pathMarkup(candidateEntries, { fill: '#000' })}
      </mask>
      <mask id="${safeId}-without-original" maskUnits="userSpaceOnUse" x="0" y="0" width="${canvas}" height="${canvas}">
        <rect width="${canvas}" height="${canvas}" fill="#fff"/>${pathMarkup(originalEntries, { fill: '#000' })}
      </mask>
    </defs>
    <g class="difference-original" mask="url(#${safeId}-without-candidate)">${pathMarkup(originalEntries)}</g>
    <g class="difference-candidate" mask="url(#${safeId}-without-original)">${pathMarkup(candidateEntries)}</g>
  </svg>`;
}

const metric = (value, suffix = '') =>
  value == null ? '—' : `${Number(value).toFixed(2)}${suffix}`;

function sourceLabel(row) {
  if (row.original.kind === 'HISTORICAL_HAND') {
    return `hand@${row.original.shortCommitSha} · blob ${row.original.blobSha.slice(0, 8)} · ${row.original.date}`;
  }
  return 'current shipment';
}

function reasonMarkup(reason) {
  if (reason.status === 'UNEXPLAINED') {
    const rejected = reason.rejectedText
      ? `<div class="rejected">rejected ${escapeHtml(reason.rejection)}: ${escapeHtml(reason.rejectedText)}</div>`
      : '';
    return `<strong class="bad">FAIL / UNEXPLAINED</strong>${rejected}`;
  }
  if (reason.text) {
    return `<span class="reason-code">${escapeHtml(reason.code)}</span><div>${escapeHtml(reason.text)}</div>`;
  }
  return '<span class="muted">not required</span>';
}

function metricsMarkup(metrics) {
  if (!metrics) return '<span class="muted">metrics unavailable</span>';
  const topology = metrics.topology;
  const signature = ({ components, holes }) =>
    components == null || holes == null ? '?:?' : `${components}:${holes}`;
  const confidence = topology.confidence.status === 'UNCERTAIN'
    ? '<b class="bad">UNCERTAIN / FAIL-CLOSED</b>'
    : '<span class="good">RESOLVED</span>';
  const topologyVerdict = topology.uncertain
    ? '<b class="bad">UNCERTAIN</b>'
    : topology.difference
      ? '<b class="bad">MISMATCH</b>'
      : '<span class="good">match</span>';
  return `<div>boundary p95 <b>${metric(metrics.boundary.p95)}</b> · max <b>${metric(metrics.boundary.max)}</b></div>
    <div>topology ${signature(topology.original)} → ${signature(topology.candidate)}
      ${topologyVerdict}</div>
    <div>oracle ${confidence} · step <b>${metric(topology.resolution.step)}</b> · ${topology.resolution.phases.length} phases</div>`;
}

function inkMarkup(metrics) {
  if (!metrics) return '<span class="muted">—</span>';
  const area = metrics.ink.area;
  const centroid = metrics.ink.centroid.delta;
  return `<div>area Δ <b>${metric(area.deltaPctOriginal, '%')}</b> <span class="muted">(${metric(area.delta)})</span></div>
    <div>centroid Δ <b>${metric(centroid?.distance)}</b> <span class="muted">(${metric(centroid?.x)}, ${metric(centroid?.y)})</span></div>`;
}

function rasterMarkup(metrics) {
  if (!metrics) return '<span class="muted">—</span>';
  return `<div class="raster-list">${metrics.raster
    .map(
      (sample) =>
        `<span class="raster-chip${sample.topology.mismatch ? ' raster-bad' : ''}" title="${sample.differingPixels} differing binary-occupancy samples; topology ${sample.topology.original.components}:${sample.topology.original.holes} → ${sample.topology.candidate.components}:${sample.topology.candidate.holes}">${sample.size}px · ${metric(sample.deviationPct, '%')}</span>`,
    )
    .join('')}</div>`;
}

function severityRank(status) {
  return ({ FAIL: 0, REVIEW: 1, NOT_MODELED: 2, PASS: 3 })[status] ?? 4;
}

export function renderObservatoryHtml(report, visuals, canvas = 24) {
  const sortedRows = report.rows.slice().sort((a, b) => {
    const severity = severityRank(a.verdict.status) - severityRank(b.verdict.status);
    if (severity !== 0) return severity;
    const deviation = (b.metrics?.deviationPct ?? -1) - (a.metrics?.deviationPct ?? -1);
    return deviation || compareAscii(a.id, b.id);
  });

  const body = sortedRows
    .map((row) => {
      const visual = visuals.get(row.id);
      const deviation = row.metrics?.deviationPct ?? null;
      return `<tr data-id="${escapeHtml(row.id)}" data-search="${escapeHtml(`${row.name} ${row.variant} ${row.model.archetype ?? ''}`.toLowerCase())}" data-verdict="${row.verdict.status}" data-model="${row.model.status}" data-variant="${row.variant}" data-deviation="${deviation ?? ''}" data-source-kind="${row.original.kind}">
        <th scope="row"><span class="glyph-name">${escapeHtml(row.name)}</span><span class="variant">/${row.variant}</span>
          <div><span class="verdict verdict-${row.verdict.status.toLowerCase()}">${row.verdict.status}</span></div>
          <div class="source">${escapeHtml(sourceLabel(row))}</div>
          <div class="source">${escapeHtml(row.model.archetype ?? 'no anatomy')}</div>
        </th>
        <td class="visual-cell">${iconSvg(visual.originalEntries, canvas, 'original', `aria-label="${escapeHtml(row.id)} original"`)}</td>
        <td class="visual-cell">${visual.candidateEntries ? iconSvg(visual.candidateEntries, canvas, 'candidate', `aria-label="${escapeHtml(row.id)} generated candidate"`) : `<div class="not-modeled">${row.model.status === 'MODEL_ERROR' ? 'MODEL ERROR' : 'NOT MODELED'}</div>`}</td>
        <td class="visual-cell">${comparisonVisual(visual, canvas, row.id, 'overlay')}</td>
        <td class="visual-cell">${comparisonVisual(visual, canvas, row.id, 'difference')}</td>
        <td class="deviation ${deviation != null && deviation > DEVIATION_REASON_THRESHOLD_PCT ? 'over' : ''}">${metric(deviation, '%')}</td>
        <td class="facts">${metricsMarkup(row.metrics)}</td>
        <td class="facts">${inkMarkup(row.metrics)}</td>
        <td class="facts">${rasterMarkup(row.metrics)}</td>
        <td class="reason">${reasonMarkup(row.reason)}</td>
      </tr>`;
    })
    .join('\n');

  const summary = report.summary;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>${escapeHtml(report.title)}</title>
<style>
  :root{color-scheme:light dark;--bg:#f5f5f3;--panel:#fff;--ink:#171716;--muted:#6d6b66;--line:#d8d6d0;--soft:#ebe9e3;--red:#c72727;--red-bg:#fff0ef;--amber:#955d00;--amber-bg:#fff6dc;--green:#167447;--green-bg:#eaf8f0;--blue:#087e9b;--original:#df2b2b;--candidate:#008da8}
  :root[data-theme="dark"]{color-scheme:dark;--bg:#101110;--panel:#181918;--ink:#f1f0ed;--muted:#aaa8a1;--line:#343532;--soft:#222321;--red:#ff6961;--red-bg:#361b1b;--amber:#ffc25c;--amber-bg:#352b15;--green:#69d39d;--green-bg:#153126;--blue:#62cee5;--original:#ff625b;--candidate:#4fd4ec}
  :root[data-theme="light"]{color-scheme:light}
  @media(prefers-color-scheme:dark){:root:not([data-theme]){--bg:#101110;--panel:#181918;--ink:#f1f0ed;--muted:#aaa8a1;--line:#343532;--soft:#222321;--red:#ff6961;--red-bg:#361b1b;--amber:#ffc25c;--amber-bg:#352b15;--green:#69d39d;--green-bg:#153126;--blue:#62cee5;--original:#ff625b;--candidate:#4fd4ec}}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:13px/1.45 ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}header{padding:24px;display:grid;gap:14px;background:var(--bg);border-bottom:1px solid var(--line)}h1{font-size:24px;line-height:1.1;margin:0;letter-spacing:-.025em}.summary{display:flex;gap:8px;flex-wrap:wrap}.stat{padding:4px 8px;border:1px solid var(--line);border-radius:999px;background:var(--panel)}.stat.bad{border-color:var(--red);color:var(--red)}.controls{display:flex;gap:8px;flex-wrap:wrap}.controls input,.controls select,.controls button{font:inherit;color:inherit;background:var(--panel);border:1px solid var(--line);border-radius:6px;padding:7px 9px}.controls input[type="search"]{min-width:250px}.legend{color:var(--muted);max-width:1100px}.table-wrap{overflow:auto;padding:0 0 40px}table{border-collapse:separate;border-spacing:0;width:max-content;min-width:100%;background:var(--panel)}thead{position:sticky;top:0;z-index:10}thead th{background:var(--soft);font-size:11px;text-transform:uppercase;letter-spacing:.06em;color:var(--muted);text-align:left;border-bottom:1px solid var(--line);padding:8px}tbody th,tbody td{border-bottom:1px solid var(--line);padding:10px 8px;vertical-align:top}tbody th{position:sticky;left:0;z-index:4;background:var(--panel);width:190px;text-align:left}tbody tr[data-verdict="FAIL"] th{box-shadow:inset 4px 0 var(--red)}tbody tr[data-verdict="REVIEW"] th{box-shadow:inset 4px 0 var(--amber)}.glyph-name{font-weight:750}.variant{color:var(--muted)}.source{font-size:10px;color:var(--muted);max-width:180px;overflow-wrap:anywhere;margin-top:3px}.verdict{display:inline-block;font-size:9px;line-height:1;padding:4px 5px;margin-top:5px;border-radius:4px;font-weight:800;letter-spacing:.05em}.verdict-fail{color:var(--red);background:var(--red-bg)}.verdict-review{color:var(--amber);background:var(--amber-bg)}.verdict-pass{color:var(--green);background:var(--green-bg)}.verdict-not_modeled{color:var(--muted);background:var(--soft)}.visual-cell{width:92px;text-align:center}.icon{display:block;width:72px;height:72px;margin:auto;color:var(--ink);overflow:visible}.icon path{fill:currentColor}.overlay-original{color:var(--original);opacity:.62}.overlay-candidate{color:var(--candidate);opacity:.62}.difference-original{color:var(--original)}.difference-candidate{color:var(--candidate)}.not-modeled{width:72px;height:72px;display:grid;place-items:center;border:1px dashed var(--line);border-radius:7px;color:var(--muted);font-size:9px;font-weight:800;letter-spacing:.04em}.deviation{width:84px;font-size:16px;font-variant-numeric:tabular-nums;font-weight:750}.deviation.over{color:var(--red)}.facts{width:220px;font-size:11px}.reason{width:360px;max-width:360px;font-size:11px}.reason-code{display:inline-block;color:var(--muted);font-size:9px;font-weight:800;letter-spacing:.06em;margin-bottom:4px}.rejected{margin-top:4px;color:var(--muted)}.bad{color:var(--red)}.good{color:var(--green)}.muted{color:var(--muted)}.raster-list{display:flex;flex-wrap:wrap;gap:4px}.raster-chip{padding:2px 4px;border:1px solid var(--line);border-radius:4px;font-variant-numeric:tabular-nums}.raster-bad{color:var(--red);border-color:var(--red)}[hidden]{display:none!important}
</style>
</head>
<body>
<header>
  <h1>${escapeHtml(report.title)}</h1>
  <div class="summary">
    <span class="stat">${summary.glyphs} glyphs</span><span class="stat">${summary.variants} variants</span>
    <span class="stat">${summary.modeled} modeled</span><span class="stat">${summary.notModeled} not modeled</span>
    <span class="stat bad">${summary.fail} fail</span><span class="stat">${summary.review} review</span>
    <span class="stat bad">${summary.unexplained} unexplained &gt;3%</span>
  </div>
  <div class="controls">
    <input id="search" type="search" placeholder="glyph, variant, archetype" aria-label="Search"/>
    <select id="verdict" aria-label="Verdict"><option value="">all verdicts</option><option>FAIL</option><option>REVIEW</option><option>NOT_MODELED</option><option>PASS</option></select>
    <select id="model" aria-label="Model"><option value="">all model states</option><option>MODELED</option><option>NOT_MODELED</option><option>MODEL_ERROR</option></select>
    <select id="variant" aria-label="Variant"><option value="">both variants</option><option>outline</option><option>filled</option></select>
    <label><input id="problems" type="checkbox"/> problems only</label>
    <button id="theme" type="button">theme: system</button>
  </div>
  <div class="legend">Rows are severity-first (red first). Original = historical hand for generated shipments, current shipment for hand/unmodelled. Deviation and target-size raster use binary centre-sampled occupancy, not alpha coverage. Target-size deviation is diagnostic; target topology is acceptance-gated. Topology is a separate adaptive vector-guided, multiphase oracle; unresolved confidence fails closed. Difference: <span class="bad">red is original-only</span>, <span style="color:var(--candidate)">cyan is candidate-only</span>. Missing anatomy is NOT MODELED and never reported as 0%.</div>
</header>
<div class="table-wrap">
<table>
  <thead><tr><th>glyph / provenance</th><th>original</th><th>generated candidate</th><th>overlay</th><th>difference</th><th>deviation</th><th>boundary / topology</th><th>ink / centroid</th><th>diagnostic occupancy 16–48</th><th>reason &gt;3%</th></tr></thead>
  <tbody>${body}</tbody>
</table>
</div>
<script>
(() => {
  const rows = [...document.querySelectorAll('tbody tr')];
  const search = document.querySelector('#search');
  const verdict = document.querySelector('#verdict');
  const model = document.querySelector('#model');
  const variant = document.querySelector('#variant');
  const problems = document.querySelector('#problems');
  const apply = () => {
    const query = search.value.trim().toLowerCase();
    for (const row of rows) {
      row.hidden = Boolean(
        (query && !row.dataset.search.includes(query)) ||
        (verdict.value && row.dataset.verdict !== verdict.value) ||
        (model.value && row.dataset.model !== model.value) ||
        (variant.value && row.dataset.variant !== variant.value) ||
        (problems.checked && row.dataset.verdict === 'PASS')
      );
    }
  };
  for (const input of [search, verdict, model, variant, problems]) input.addEventListener('input', apply);
  const themes = ['', 'light', 'dark']; let themeIndex = 0;
  document.querySelector('#theme').addEventListener('click', (event) => {
    themeIndex = (themeIndex + 1) % themes.length;
    const theme = themes[themeIndex];
    if (theme) document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    event.currentTarget.textContent = 'theme: ' + (theme || 'system');
  });
})();
</script>
</body>
</html>\n`;
}

export function serializeObservatoryReport(report) {
  return `${JSON.stringify(report, null, 2)}\n`;
}

export function buildObservatory({ repo = DEFAULT_REPO, outDir = join(repo, 'preview') } = {}) {
  const root = resolve(repo);
  const output = resolve(outDir);
  const { report, visuals } = createObservatoryReport({ repo: root });
  const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
  const json = serializeObservatoryReport(report);
  const html = renderObservatoryHtml(report, visuals, grid.canvas.width);
  mkdirSync(output, { recursive: true });
  const jsonPath = join(output, 'observatory.json');
  const htmlPath = join(output, 'observatory.html');
  writeFileSync(jsonPath, json, 'utf8');
  writeFileSync(htmlPath, html, 'utf8');
  return { report, visuals, json, html, jsonPath, htmlPath };
}

function cliOptions(argv) {
  let outDir = join(DEFAULT_REPO, 'preview');
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--out-dir') {
      const value = argv[++index];
      if (!value) throw new Error('build-observatory: --out-dir требует путь');
      outDir = resolve(process.cwd(), value);
    } else {
      throw new Error(`build-observatory: неизвестный аргумент ${argv[index]}`);
    }
  }
  return { outDir };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  try {
    const result = buildObservatory({ repo: DEFAULT_REPO, ...cliOptions(process.argv.slice(2)) });
    console.log(
      `build-observatory: REPORT — ${result.report.summary.variants} variants; ` +
        `${result.report.summary.modeled} modeled; ${result.report.summary.notModeled} NOT_MODELED; ` +
        `${result.report.summary.fail} FAIL; ${result.htmlPath}; ${result.jsonPath}`,
    );
  } catch (error) {
    console.error(`build-observatory: FAIL — ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
