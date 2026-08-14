import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  buildSourceVariantContract,
  validateCatalogRatchet,
  validateIconCatalog,
} from '../scripts/lib/icon-catalog.js';
import {
  proveVariantAxes,
  resolvePublicAxes,
  validateAxisQuality,
} from '../scripts/lib/axis-quality.js';
import { validateModelQuality } from '../scripts/lib/model-quality.js';

const root = join(import.meta.dirname, '..');
const catalog = validateIconCatalog(JSON.parse(readFileSync(join(root, 'semantics/catalog.json'), 'utf8')));
const anatomy = JSON.parse(readFileSync(join(root, 'semantics/anatomy.json'), 'utf8'));
const grid = JSON.parse(readFileSync(join(root, 'semantics/grid.json'), 'utf8'));
const axisQuality = JSON.parse(readFileSync(join(root, 'semantics/axis-quality.json'), 'utf8'));
const tempRoots = [];

afterEach(() => {
  for (const tempRoot of tempRoots.splice(0)) rmSync(tempRoot, { recursive: true, force: true });
});

describe('полный icon catalog', () => {
  it('покрывает все 222 имени и 444 точных source fallback', () => {
    expect(Object.keys(catalog.icons)).toHaveLength(222);
    expect(Object.values(catalog.icons).flatMap((icon) => Object.keys(icon.source))).toHaveLength(444);
  });

  it('не выдаёт немоделированные source-only SVG за параметрический закон', () => {
    expect(catalog.icons.earth.model).toBeNull();
    expect(catalog.icons.fire.model).toBeNull();
    expect(catalog.icons.paw.model).toBeNull();
    expect(catalog.icons['musical-note'].model).toBeNull();
  });

  it('различает принятую и кандидатную реконструкцию по вариантам', () => {
    expect(catalog.icons.cog.model.variants.outline.state).toBe('candidate');
    expect(catalog.icons.apps.model.variants.filled.state).toBe('accepted');
    expect(catalog.icons.reload.model.variants.outline.state).toBe('candidate');
    expect(catalog.icons.reload.model.variants.filled.state).toBe('candidate');
  });

  it('source identity честно geometry-derived, model identity явно declared', () => {
    expect(catalog.icons.accessibility.source.outline.parts.every((part) => part.identity === 'geometry-derived')).toBe(true);
    expect(catalog.icons.accessibility.source.outline.parts[0].sourceFingerprint).toMatch(/^sha256:/);
    expect(catalog.icons.accessibility.source.outline.parts[0].artifactFingerprint).toMatch(/^sha256:/);
    expect(catalog.icons.reload.model.variants.filled.parts.every((part) => part.identity === 'declared')).toBe(true);
    expect(catalog.icons.cog.model.variants.outline.composition).toEqual({
      kind: 'compound',
      fillRule: 'evenodd',
    });
    expect(catalog.icons['arrow-back'].model.variants.outline.composition).toEqual({
      kind: 'compound',
      fillRule: 'nonzero',
    });
  });

  it('fail-closed запрещает расширять закрытый контракт незамеченным полем', () => {
    const broken = structuredClone(catalog);
    broken.icons.reload.model.variants.filled.parts[0].magic = 42;
    expect(() => validateIconCatalog(broken)).toThrow(/неизвестные поля magic/);
    const brokenAxis = structuredClone(catalog);
    brokenAxis.axes.opsz.autoClamp = true;
    expect(() => validateIconCatalog(brokenAxis)).toThrow(/неизвестные поля autoClamp/);
  });

  it('catalog gate отклоняет source clip, который IR не умеет воспроизвести', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'lab-icons-clip-bite-'));
    tempRoots.push(tempRoot);
    mkdirSync(join(tempRoot, 'svg', 'Outline'), { recursive: true });
    writeFileSync(
      join(tempRoot, 'svg', 'Outline', 'hostile.svg'),
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="#101012" xmlns="http://www.w3.org/2000/svg"><g clip-path="url(#half)">' +
        '<path d="M0 0H24V24H0Z"/></g><defs><clipPath id="half">' +
        '<path d="M0 0H12V24H0Z"/></clipPath></defs></svg>',
      'utf8',
    );

    expect(() => buildSourceVariantContract(tempRoot, 'hostile', 'outline', { plugins: [] }))
      .toThrow(/неэквивалентный clipPath запрещён/);
  });

  it('catalog gate отклоняет nested viewport с тем же path fingerprint', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'lab-icons-viewport-bite-'));
    tempRoots.push(tempRoot);
    mkdirSync(join(tempRoot, 'svg', 'Outline'), { recursive: true });
    writeFileSync(
      join(tempRoot, 'svg', 'Outline', 'hostile.svg'),
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="#101012" xmlns="http://www.w3.org/2000/svg"><svg viewBox="0 0 48 48" width="24" height="24">' +
        '<path d="M0 0H24V24H0Z"/></svg></svg>',
      'utf8',
    );

    expect(() => buildSourceVariantContract(tempRoot, 'hostile', 'outline', { plugins: [] }))
      .toThrow(/ровно один корневой <svg>/);
  });

  it('catalog gate отклоняет CSS-escaped fill-rule с другим browser silhouette', () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'lab-icons-fill-rule-bite-'));
    tempRoots.push(tempRoot);
    mkdirSync(join(tempRoot, 'svg', 'Outline'), { recursive: true });
    writeFileSync(
      join(tempRoot, 'svg', 'Outline', 'hostile.svg'),
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="#101012" xmlns="http://www.w3.org/2000/svg"><path fill-rule="\\65 venodd" ' +
        'd="M0 0H10V10H0Z M2 2H8V8H2Z"/></svg>',
      'utf8',
    );

    expect(() => buildSourceVariantContract(tempRoot, 'hostile', 'outline', { plugins: [] }))
      .toThrow(/неканонический fill-rule/);
  });

  it.each([
    ['id', null],
    ['zIndex', 'front'],
    ['topologySignature', ''],
    ['anchorSource', null],
  ])('fail-closed отвергает hostile model %s', (field, value) => {
    const broken = structuredClone(catalog);
    broken.icons.reload.model.variants.filled.parts[0][field] = value;
    expect(() => validateIconCatalog(broken)).toThrow(/невалидн/);
  });

  it('валидирует схему ratchet до числовых сравнений', () => {
    const ratchet = JSON.parse(readFileSync(join(root, 'semantics/catalog-ratchet.json'), 'utf8'));
    expect(validateCatalogRatchet(ratchet)).toEqual(ratchet);
    const missing = structuredClone(ratchet);
    delete missing.minimumModeledNames;
    expect(() => validateCatalogRatchet(missing)).toThrow(/обязательных полей minimumModeledNames/);
    expect(() => validateCatalogRatchet({ ...ratchet, minimumModeledNames: Number.NaN }))
      .toThrow(/minimumModeledNames/);
  });

  it('валидирует закрытый карантин только для реально generated masters', () => {
    const quality = JSON.parse(readFileSync(join(root, 'semantics/model-quality.json'), 'utf8'));
    expect(validateModelQuality(quality, anatomy)).toEqual(quality);
    const typo = structuredClone(quality);
    typo.quarantined['reload/filled'].magic = true;
    expect(() => validateModelQuality(typo, anatomy)).toThrow(/неизвестные поля magic/);
    const stale = structuredClone(quality);
    stale.quarantined['earth/outline'] = stale.quarantined['reload/filled'];
    expect(() => validateModelQuality(stale, anatomy)).toThrow(/отсортирован ASCII|status=generated/);
  });

  it('не рекламирует ось до phase-stable proof на оптических растрах', () => {
    expect(validateAxisQuality(axisQuality, anatomy)).toEqual(axisQuality);
    expect(Object.keys(axisQuality.disabled)).toHaveLength(66);

    const ellipseProof = proveVariantAxes(
      anatomy.glyphs.ellipse,
      'outline',
      grid,
      anatomy.glyphs,
      catalog.icons.ellipse.model.variants.outline.composition.fillRule,
    );
    expect(ellipseProof).toEqual([{
      axis: 'weight',
      finding: expect.objectContaining({
        kind: 'axis-topology-drift',
        value: 0.6,
        rasterSize: 16,
      }),
    }]);
    expect(catalog.icons.ellipse.model.variants.outline.supportedAxes).toEqual([]);

    const arrowProof = proveVariantAxes(
      anatomy.glyphs['arrow-forward'],
      'filled',
      grid,
      anatomy.glyphs,
      catalog.icons['arrow-forward'].model.variants.filled.composition.fillRule,
    );
    expect(arrowProof[0]?.finding).toMatchObject({
      kind: 'default-phase-unstable',
      rasterSize: 24,
    });
    for (const direction of ['arrow-up', 'arrow-down', 'arrow-back', 'arrow-forward']) {
      expect(catalog.icons[direction].model.variants.outline.supportedAxes, direction).toEqual([]);
      expect(catalog.icons[direction].model.variants.filled.supportedAxes, direction).toEqual([]);
    }

    const betweenMastersProof = proveVariantAxes(
      anatomy.glyphs['swap-horizontal'],
      'outline',
      grid,
      anatomy.glyphs,
      catalog.icons['swap-horizontal'].model.variants.outline.composition.fillRule,
    );
    expect(betweenMastersProof[0]?.finding).toMatchObject({
      kind: 'axis-phase-unstable',
      value: 0.63242203125,
      rasterSize: 192,
    });
    expect(catalog.icons['swap-horizontal'].model.variants.outline.supportedAxes).toEqual([]);

    const chevronProof = proveVariantAxes(
      anatomy.glyphs['chevron-up'],
      'outline',
      grid,
      anatomy.glyphs,
      catalog.icons['chevron-up'].model.variants.outline.composition.fillRule,
    );
    expect(chevronProof).toEqual([{ axis: 'weight', finding: null }]);
    expect(catalog.icons['chevron-up'].model.variants.outline.supportedAxes).toEqual(['weight']);
  });

  it('axis gate требует reviewed debt и отклоняет устаревшее отключение', () => {
    const failing = [{
      axis: 'weight',
      finding: {
        kind: 'axis-topology-drift',
        value: 0.6,
        rasterSize: 16,
        signatures: ['1:1', '6:0'],
      },
    }];
    expect(() => resolvePublicAxes('ellipse/outline', failing, new Set()))
      .toThrow(/без reviewed debt/);
    expect(resolvePublicAxes(
      'ellipse/outline',
      failing,
      new Set(['ellipse/outline/weight']),
    )).toEqual([]);
    expect(() => resolvePublicAxes(
      'chevron-up/outline',
      [{ axis: 'weight', finding: null }],
      new Set(['chevron-up/outline/weight']),
    )).toThrow(/debt устарел/);

    const typo = structuredClone(axisQuality);
    typo.disabled['ellipse/outline/weight'].magic = true;
    expect(() => validateAxisQuality(typo, anatomy)).toThrow(/неизвестные поля magic/);
  });

  it('публично оставляет только доказанные axis capabilities', () => {
    const supported = Object.values(catalog.icons)
      .flatMap((icon) => Object.values(icon.model?.variants ?? {}))
      .flatMap((variant) => variant.supportedAxes);
    expect(supported).toHaveLength(22);
    expect(supported.filter((axis) => axis === 'weight')).toHaveLength(9);
    expect(supported.filter((axis) => axis === 'corner')).toHaveLength(13);
  });

  it('quality debt измеряется явно, а не скрывается зелёным полным корпусом', () => {
    const icons = Object.values(catalog.icons);
    const modeled = icons.flatMap((icon) => Object.values(icon.model?.variants ?? {}));
    expect(icons.filter((icon) => icon.model !== null)).toHaveLength(63);
    expect(modeled).toHaveLength(100);
    expect(modeled.filter((variant) => variant.state === 'accepted')).toHaveLength(54);
    expect(modeled.filter((variant) => variant.state === 'candidate')).toHaveLength(46);
    expect(444 - modeled.length).toBe(344);
  });
});
