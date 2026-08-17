import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  buildDeviationReason,
  buildObservatory,
  isSubstantiveObservatoryReason,
} from '../scripts/build-observatory.mjs';
import {
  EXPECTED_ICON_NAMES,
  EXPECTED_SOURCE_VARIANTS,
} from '../scripts/lib/corpus-contract.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const catalog = JSON.parse(readFileSync(join(root, 'semantics', 'catalog.json'), 'utf8'));
const expectedModeledVariants = Object.values(catalog.icons)
  .flatMap((icon) => Object.values(icon.model?.variants ?? {}))
  .length;
let temporaryRoot;
let first;
let second;

beforeAll(() => {
  temporaryRoot = mkdtempSync(join(tmpdir(), 'lab-icons-observatory-'));
  first = buildObservatory({ repo: root, outDir: join(temporaryRoot, 'first') });
  second = buildObservatory({ repo: root, outDir: join(temporaryRoot, 'second') });
// Это два полных corpus/raster proof, а не ожидание внешнего IO. Их wall time
// зависит от CPU и конкуренции worker-ов; произвольный timeout изображал бы
// perf-контракт без benchmark. CI-level timeout остаётся предохранителем от
// зависания процесса, а 0 здесь означает только отсутствие ложного локального SLA.
}, 0);

afterAll(() => {
  if (temporaryRoot) rmSync(temporaryRoot, { recursive: true, force: true });
});

describe('Quality Observatory corpus contract', () => {
  it('covers every one of the 238 glyphs in both variants exactly once', () => {
    const outlineNames = readdirSync(join(root, 'svg', 'Outline'))
      .filter((file) => file.endsWith('.svg'))
      .map((file) => file.slice(0, -4))
      .sort();
    const filledNames = readdirSync(join(root, 'svg', 'Filled'))
      .filter((file) => file.endsWith('_filled.svg'))
      .map((file) => file.slice(0, -'_filled.svg'.length))
      .sort();
    const ids = first.report.rows.map((row) => row.id);

    expect(outlineNames).toHaveLength(EXPECTED_ICON_NAMES);
    expect(filledNames).toEqual(outlineNames);
    expect(first.report.summary).toMatchObject({
      glyphs: EXPECTED_ICON_NAMES,
      variants: EXPECTED_SOURCE_VARIANTS,
    });
    expect(ids).toHaveLength(EXPECTED_SOURCE_VARIANTS);
    expect(new Set(ids).size).toBe(EXPECTED_SOURCE_VARIANTS);
    for (const name of outlineNames) {
      expect(ids).toContain(`${name}/outline`);
      expect(ids).toContain(`${name}/filled`);
    }
  });

  it('uses historical hand only for generated shipments and current SVG otherwise', () => {
    for (const row of first.report.rows) {
      if (row.model.anatomyStatus === 'generated') {
        expect(row.original.kind, row.id).toBe('HISTORICAL_HAND');
        expect(row.original.commitSha, row.id).toMatch(/^[0-9a-f]{40}$/);
        expect(row.original.blobSha, row.id).toMatch(/^[0-9a-f]{40}$/);
      } else {
        expect(row.original.kind, row.id).toBe('CURRENT_SHIPMENT');
        expect(row.original.sha256, row.id).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });

  it('keeps visible paths currentColor-painted without overriding SVG mask paint', () => {
    const html = first.html;
    const historicalStart = html.indexOf('data-source-kind="HISTORICAL_HAND"');
    const historicalEnd = html.indexOf('</tr>', historicalStart);
    const historicalRow = html.slice(historicalStart, historicalEnd);

    expect(historicalStart).toBeGreaterThan(-1);
    expect(html).toContain('@media(prefers-color-scheme:dark)');
    expect(html).toContain(':root[data-theme="dark"]');
    expect(html).not.toContain('.icon path{fill:currentColor}');
    expect(historicalRow).toMatch(
      /class="icon original"[\s\S]*?<path[^>]+fill="currentColor"/,
    );
  });

  it('never turns absence of a model into a false 0% similarity', () => {
    const notModeled = first.report.rows.filter((row) => row.model.status === 'NOT_MODELED');

    expect(notModeled).toHaveLength(EXPECTED_SOURCE_VARIANTS - expectedModeledVariants);
    for (const row of notModeled) {
      expect(row.metrics, row.id).toBeNull();
      expect(row.reason.status, row.id).toBe('NOT_APPLICABLE');
      expect(row.verdict.status, row.id).toBe('NOT_MODELED');
    }
    expect(first.report.policy.missingModel).toContain('never 0%');
  });
});

describe('Quality Observatory truthfulness', () => {
  it('requires a structured, substantive reason over 3% and fails placeholders closed', () => {
    const overThreshold = first.report.rows.filter(
      (row) => row.metrics && row.metrics.deviationPct > 3,
    );
    expect(overThreshold.length).toBeGreaterThan(0);

    for (const row of overThreshold) {
      expect(row.reason.required, row.id).toBe(true);
      expect(['EXPLAINED', 'UNEXPLAINED'], row.id).toContain(row.reason.status);
      if (row.reason.status === 'EXPLAINED') {
        expect(isSubstantiveObservatoryReason(row.reason.text), row.id).toBe(true);
      } else {
        expect(row.reason.code, row.id).toBe('UNEXPLAINED');
        expect(row.verdict.status, row.id).toBe('FAIL');
        expect(row.verdict.issues, row.id).toContain('UNEXPLAINED_DEVIATION');
      }
    }

    const placeholder = buildDeviationReason({
      deviationPct: 3.01,
      variant: 'outline',
      entry: { correctionReason: 'TODO: add a proper reason later' },
    });
    expect(placeholder).toMatchObject({
      required: true,
      status: 'UNEXPLAINED',
      code: 'UNEXPLAINED',
      rejection: 'PLACEHOLDER',
    });
    expect(placeholder.text).toBeNull();
  });

  it('emits byte-identical machine JSON on independent builds', () => {
    expect(first.json).toBe(second.json);
    expect(readFileSync(first.jsonPath, 'utf8')).toBe(readFileSync(second.jsonPath, 'utf8'));
    expect(JSON.parse(first.json)).toEqual(first.report);
  });

  it('reports all mandated metric dimensions for every modeled row', () => {
    const modeled = first.report.rows.filter((row) => row.model.status === 'MODELED');
    expect(modeled).toHaveLength(expectedModeledVariants);
    for (const row of modeled) {
      expect(row.metrics.deviationPct, row.id).not.toBeNull();
      expect(row.metrics.silhouette, row.id).toMatchObject({
        symmetricDifferenceCells: expect.any(Number),
        unionCells: expect.any(Number),
      });
      expect(row.metrics.boundary, row.id).toMatchObject({
        p95: expect.any(Number),
        max: expect.any(Number),
      });
      expect(row.metrics.topology, row.id).toHaveProperty('mismatch');
      expect(row.metrics.ink.area, row.id).toHaveProperty('deltaPctOriginal');
      expect(row.metrics.ink.centroid, row.id).toHaveProperty('delta');
      expect(row.metrics.raster.map((sample) => sample.size), row.id).toEqual([
        16, 20, 24, 32, 48,
      ]);
    }
    expect(first.report.policy.targetRaster).toContain('diagnostic-only');
    expect(first.report.policy.targetRaster).toContain('target topology is acceptance-gated');
    expect(first.html).toContain('diagnostic occupancy 16–48');
  });

  it('measures the declared model composition instead of a hardcoded fill rule', () => {
    const arrow = first.visuals.get('arrow-back/outline');
    const cog = first.visuals.get('cog/outline');
    expect(arrow.candidateEntries).toMatchObject([{ fillRule: 'nonzero' }]);
    expect(cog.candidateEntries).toMatchObject([{ fillRule: 'evenodd' }]);
  });

  it('renders mask-subtract candidates with their declared silhouette in every visual', () => {
    const start = first.html.indexOf('data-id="time/filled"');
    const end = first.html.indexOf('</tr>', start);
    const row = first.html.slice(start, end);
    const cells = row.match(/<td class="visual-cell">[\s\S]*?<\/td>/g) ?? [];

    expect(start).toBeGreaterThan(-1);
    expect(cells).toHaveLength(4);
    expect(cells[1]).toMatch(/mask="url\(#compose-time-filled-candidate\)"/);
    expect(cells[1]).toMatch(/<mask id="compose-time-filled-candidate"/);
    expect(cells[2]).toMatch(/mask="url\(#compose-time-filled-overlay-candidate\)"/);
    expect(cells[2]).toMatch(/<mask id="compose-time-filled-overlay-candidate"/);
    expect(cells[3]).toMatch(/mask="url\(#compose-time-filled-difference-candidate\)"/);
    expect(cells[3]).toMatch(/<mask id="compose-time-filled-difference-candidate"/);
    expect(cells[1]).toMatch(/fill="#000"[^>]*fill-rule="nonzero"/);
  });

  it('не называет fail-closed uncertainty доказанным topology mismatch', () => {
    const uncertainRows = first.report.rows.filter((item) => item.metrics?.topology?.uncertain);
    const resolvedDifferences = first.report.rows.filter((item) => item.metrics?.topology?.difference);
    const start = first.html.indexOf('data-id="component/outline"');
    const end = first.html.indexOf('</tr>', start);
    const row = first.html.slice(start, end);

    expect(first.report.schemaVersion).toBe(3);
    expect(uncertainRows.length).toBeGreaterThan(0);
    expect(uncertainRows.every((item) => item.metrics.topology.mismatch === false)).toBe(true);
    expect(first.report.summary).toMatchObject({
      topologyDifferences: resolvedDifferences.length,
      topologyUncertain: uncertainRows.length,
    });
    expect(first.report.summary).not.toHaveProperty('topologyMismatches');
    expect(start).toBeGreaterThan(-1);
    expect(row).toContain('UNCERTAIN');
    expect(row).not.toContain('>MISMATCH<');
  });

  it('не допускает accepted ∩ non-PASS и держит карантин точной проекцией отчёта', () => {
    const quality = JSON.parse(readFileSync(join(root, 'semantics/model-quality.json'), 'utf8'));
    const nonPassGenerated = first.report.rows
      .filter((row) => row.model.anatomyStatus === 'generated' && row.verdict.status !== 'PASS')
      .map((row) => row.id)
      .sort();
    const acceptedNonPass = first.report.rows
      .filter((row) => row.model.catalogState === 'accepted' && row.verdict.status !== 'PASS')
      .map((row) => row.id);

    expect(acceptedNonPass).toEqual([]);
    expect(Object.keys(quality.quarantined)).toEqual(nonPassGenerated);
    expect(first.report.policy.acceptance).toContain('accepted');
  });
});
