import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { authorIconNames, authorSymbolPayload, loadAuthorBaseline, renderAuthorTypeProjection } from '../scripts/lib/author-baseline.js';
import { symbolExportName, symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
import { authorPathEntries, renderedPathEntries } from '../src/core/icon-geometry.js';
import { pathBBox } from '../src/core/path-data.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledSymbol } from '../src/ir/symbol-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const captured = read('semantics/figma-baseline.json');
const tempRoots = [];
const sha256 = value => createHash('sha256').update(value).digest('hex');

function oneManifest() {
  return structuredClone({
    schemaVersion: captured.schemaVersion, source: captured.source,
    counts: { families: 1, variants: 2 }, icons: { time: captured.icons.time },
  });
}

function copiedMasters() {
  const local = mkdtempSync(join(tmpdir(), 'lab-icons-author-test-'));
  tempRoots.push(local);
  const manifest = oneManifest();
  for (const variant of ['outline', 'filled']) {
    const record = manifest.icons.time[variant];
    const target = join(local, record.master);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(root, record.master)));
  }
  return { local, manifest };
}

afterEach(() => {
  for (const path of tempRoots.splice(0)) rmSync(path, { recursive: true, force: true });
});

function compileTime(baseline) {
  const sources = baseline.icons.time;
  const compiler = createGlyphCompiler({
    catalog: {
      canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
      icons: { time: { model: null, source: {
        outline: sources.outline.sourceContract, filled: sources.filled.sourceContract,
      } } },
    },
    anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
    staticIcons: Object.fromEntries(['outline', 'filled'].map(variant =>
      [symbolExportName('time', variant), sources[variant].artifactSvg])),
  });
  return authorSymbolPayload('time', sources, compiler);
}

describe('текущий author baseline в production compiler', () => {
  it('проекция охватывает все закреплённые имена и обе независимые авторские формы', () => {
    const names = authorIconNames(captured);
    expect(names).toHaveLength(captured.counts.families);
    expect(names).toContain('align-bottom');
    expect(captured.counts.variants).toBe(names.length * 2);
    const contract = symbolReleaseProjection(read('release/contract.json'), names);
    expect(contract.files.filter(file => /^dist\/symbols\/.*\.js$/.test(file))).toHaveLength(names.length);
    expect(renderAuthorTypeProjection(captured)).toContain("| 'align-bottom'");
    expect(readFileSync(join(root, 'src/ir/author-catalog.generated.ts'), 'utf8')).toBe(renderAuthorTypeProjection(captured));
  });

  it('source-only compile сохраняет raw master paths, fill-rule, z-order и независимый Filled', () => {
    const baseline = loadAuthorBaseline(root, { manifest: oneManifest() });
    const payload = compileTime(baseline);
    const symbol = createCompiledSymbol(payload);
    for (const variant of ['outline', 'filled']) {
      const glyph = symbol.glyph({ variant });
      const authored = baseline.icons.time[variant];
      const originalD = [...authored.rawSvg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1]);
      expect(glyph.parts.map(part => part.d)).toEqual(originalD);
      expect(glyph.parts.map(({ d, fillRule }) => ({ d, fillRule }))).toEqual(
        authorPathEntries(authored.normalizedSvg).map(({ d, fillRule }) => ({ d, fillRule })),
      );
      expect(renderedPathEntries(glyph.svg).map(({ d, fillRule }) => ({ d, fillRule }))).toEqual(
        authorPathEntries(authored.normalizedSvg).map(({ d, fillRule }) => ({ d, fillRule })),
      );
      expect(glyph.parts.map(part => part.zIndex)).toEqual(glyph.parts.map((_, index) => index));
      expect(glyph.parts.every(part => part.role === 'unclassified' && part.provenance.identity === 'geometry-derived' && part.morphGroup === null)).toBe(true);
      expect(glyph.composition).toEqual({ kind: 'layers' });
      expect(glyph.provenance.author).toEqual(authored.author);
      expect(glyph.provenance.author.masterSha256).toBe(sha256(authored.rawSvg));
      expect(glyph.provenance.author.normalizedSha256).toBe(sha256(authored.normalizedSvg));
      expect(symbol.glyph({ variant, modelMode: 'source-only' })).toBe(glyph);
      expect(Object.isFrozen(glyph.provenance.author)).toBe(true);
      expect(symbol.glyphCapabilities(variant).author).toEqual(authored.author);
      expect(symbol.glyphCapabilities(variant).modelState).toBeNull();
      expect(symbol.glyphCapabilities(variant).supportedAxes).toEqual([]);
    }
    expect(symbol.glyph().svg).not.toBe(symbol.glyph({ variant: 'filled' }).svg);
    expect(symbol.glyph()).toBe(symbol.glyph());
    const effect = compileSymbolEffect(symbol.glyph(), symbol.glyphCapabilities(), 'time.advance', { duration: 200 });
    expect(effect).toMatchObject({ ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' } });
  });

  it('контрпример time: authored radius10.5 и два fill scopes сохраняются; recorded radius11 не подменяет их', () => {
    const baseline = loadAuthorBaseline(root, { manifest: oneManifest() });
    const payload = compileTime(baseline);
    const current = payload.source.outline;
    expect(current.parts).toHaveLength(2);
    expect(current.parts.map(part => part.fillRule)).toEqual(['nonzero', 'evenodd']);
    const currentBounds = current.parts.map(part => pathBBox(part.d));
    expect(currentBounds).toContainEqual({ minX: 1.5, minY: 1.5, maxX: 22.5, maxY: 22.5 });
    const recordedSvg = readFileSync(join(root, 'svg/Outline/time.svg'), 'utf8');
    expect(authorPathEntries(recordedSvg)).toHaveLength(1);
    expect(pathBBox(authorPathEntries(recordedSvg)[0].d)).toEqual({ minX: 1, minY: 1, maxX: 23, maxY: 23 });
    expect(current.svg).not.toBe(recordedSvg);
  });

  it('source master с правильными bytes не наследует принятую capability от записанной модели', () => {
    const baseline = loadAuthorBaseline(root, { manifest: oneManifest() });
    const payload = compileTime(baseline);
    const substituted = {
      glyph: ({ variant }) => payload.source[variant],
      glyphCapabilities: (_, variant) => ({ ...payload.capabilities[variant], modelState: 'accepted' }),
    };
    expect(() => authorSymbolPayload('time', baseline.icons.time, substituted)).toThrow(
      expect.objectContaining({ code: 'SOURCE_CAPABILITY_DRIFT' }),
    );
  });

  it('изменённые raw bytes отклоняются до production materialization', () => {
    const { local, manifest } = copiedMasters();
    const target = join(local, manifest.icons.time.outline.master);
    writeFileSync(target, readFileSync(target, 'utf8').replace(/d="M/, 'd="M0 0L'));
    expect(() => loadAuthorBaseline(local, { manifest })).toThrow(expect.objectContaining({ code: 'MASTER_HASH_MISMATCH' }));
  });

  it('подмена текущего рисунка старым не проходит один только обновлённый raw receipt', () => {
    const { local, manifest } = copiedMasters();
    const item = manifest.icons.time.outline;
    const old = readFileSync(join(root, 'svg/Outline/time.svg'));
    writeFileSync(join(local, item.master), old);
    item.bytes = old.length;
    item.sha256 = sha256(old);
    expect(() => loadAuthorBaseline(local, { manifest })).toThrow(expect.objectContaining({ code: 'NORMALIZED_HASH_MISMATCH' }));
  });

  it.each([
    ['normalized SHA', manifest => { manifest.icons.time.outline.normalizedSource.sha256 = 'a'.repeat(64); }, 'NORMALIZED_HASH_MISMATCH'],
    ['path fingerprint', manifest => { manifest.icons.time.outline.normalizedSource.pathFingerprintSha256 = 'b'.repeat(64); }, 'PATH_FINGERPRINT_MISMATCH'],
    ['source path', manifest => { manifest.icons.time.outline.master = '../time.svg'; }, 'MASTER_PATH_INVALID'],
    ['missing variant', manifest => { delete manifest.icons.time.filled; }, 'MANIFEST_INVALID'],
    ['false census', manifest => { manifest.counts.variants = 1; }, 'MANIFEST_INVALID'],
    ['missing node receipt', manifest => { delete manifest.icons.time.outline.nodeSha256; }, 'MANIFEST_INVALID'],
  ])('точный отказ для %s', (_, mutate, code) => {
    const manifest = oneManifest();
    mutate(manifest);
    expect(() => loadAuthorBaseline(root, { manifest })).toThrow(expect.objectContaining({ code }));
  });
});
