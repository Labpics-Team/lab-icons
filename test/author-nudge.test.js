import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline, authorSymbolPayload } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { symbolExportName } from '../scripts/lib/symbol-modules.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledSymbol } from '../src/ir/symbol-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';
import { authorPathEntries } from '../src/core/icon-geometry.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => JSON.parse(readFileSync(new URL(path, new URL('..', import.meta.url)), 'utf8'));
const manifest = read('semantics/figma-baseline.json');
const stored = read('semantics/author-anatomy.json');
const directions = {
  'arrow-back': ['left', 'x', -3], 'arrow-forward': ['right', 'x', 3],
  'arrow-up': ['up', 'y', -3], 'arrow-down': ['down', 'y', 3],
  'chevron-back': ['left', 'x', -3], 'chevron-forward': ['right', 'x', 3],
  'chevron-up': ['up', 'y', -3], 'chevron-down': ['down', 'y', 3],
};
const names = Object.keys(directions);
const circles = ['arrow-forward-circle', 'chevron-forward-circle'];
const selected = [...names, ...circles];
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest,
  counts: { families: selected.length, variants: selected.length * 2 },
  icons: Object.fromEntries(selected.map(name => [name, manifest.icons[name]])),
} });

function declaration(icon, variant, direction = directions[icon]?.[0] ?? 'right') {
  const source = baseline.icons[icon][variant];
  return { masterSha256: source.author.masterSha256,
    pathFingerprintSha256: source.author.pathFingerprintSha256,
    parts: source.sourceContract.parts.map((_, pathIndex) => ({ pathIndex,
      id: pathIndex === 0 ? 'direction-body' : `other-part-${pathIndex}`, role: 'control',
      anchor: [0.5, 0.5], anchorMeaning: 'canvas-center' })),
    gesture: { law: 'direction.nudge', partId: 'direction-body', direction } };
}
const document = { ...stored, icons: Object.fromEntries(names.map(icon => [icon,
  Object.fromEntries(['outline', 'filled'].map(variant => [variant, declaration(icon, variant)]))])) };

function consumers() {
  const anatomy = compileAuthorAnatomy(baseline, document);
  const sources = Object.fromEntries(Object.entries(baseline.icons).map(([icon, variants]) => [icon,
    Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant,
      { ...item, sourceContract: anatomy[`${icon}/${variant}`] ?? item.sourceContract }]))]));
  const compiler = createGlyphCompiler({ catalog: {
    canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
    icons: Object.fromEntries(Object.entries(sources).map(([icon, variants]) => [icon,
      { model: null, source: Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, item.sourceContract])) }])),
  }, anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
  staticIcons: Object.fromEntries(Object.entries(sources).flatMap(([icon, variants]) =>
    Object.entries(variants).map(([variant, item]) => [symbolExportName(icon, variant), item.artifactSvg]))),
  });
  return Object.fromEntries(selected.map(icon => [icon, createCompiledSymbol(authorSymbolPayload(icon, sources[icon], compiler))]));
}

describe('direction.nudge: общий закон настоящих directional silhouettes', () => {
  it('проводит один закон через стрелки и шевроны без изменения независимых masters', () => {
    const anatomy = compileAuthorAnatomy(baseline, document);
    expect(Object.keys(anatomy)).toHaveLength(names.length * 2);
    for (const [icon, [, axis, displacement]] of Object.entries(directions)) {
      for (const variant of ['outline', 'filled']) {
        const contract = anatomy[`${icon}/${variant}`], source = baseline.icons[icon][variant];
        expect(contract.parts.map(({ id, identity, role, anchor, anchorSource, ...geometry }) => geometry))
          .toEqual(source.sourceContract.parts.map(({ id, identity, role, ...geometry }) => geometry));
        expect(authorPathEntries(source.artifactSvg)).toEqual(authorPathEntries(source.normalizedSvg));
        expect(contract.parts[0]).toMatchObject({ id: 'direction-body', role: 'control',
          identity: 'declared', anchor: [0.5, 0.5], anchorSource: 'declared' });
        expect(contract.gestures).toEqual([{
          id: `${icon}.nudge`, kind: 'cycle',
          meaning: expect.any(String), partIds: ['direction-body'], progress: 'normalized-0-to-1',
          tracks: [{ partId: 'direction-body', kind: 'translate', axis, unit: 'viewBox', interpolation: 'linear',
            stops: [{ at: 0, value: 0 }, { at: 0.5, value: displacement }, { at: 1, value: 0 }] }],
        }]);
        expect(contract.anatomy.masterSha256).toBe(source.author.masterSha256);
        expect(contract.anatomy.pathFingerprintSha256).toBe(source.author.pathFingerprintSha256);
        expect(Object.isFrozen(contract.gestures[0].tracks[0].stops[1])).toBe(true);
        expect(stored.icons[icon][variant]).toEqual(document.icons[icon][variant]);
      }
      expect(anatomy[`${icon}/outline`].parts[0].sourceFingerprint)
        .not.toBe(anatomy[`${icon}/filled`].parts[0].sourceFingerprint);
    }
  });

  it('direction и вариант входят в annotation digest, порядок ключей его не меняет', () => {
    const original = compileAuthorAnatomy(baseline, document);
    const changed = structuredClone(document);
    changed.icons['chevron-forward'].outline.gesture.direction = 'left';
    const reverse = compileAuthorAnatomy(baseline, changed);
    expect(reverse['chevron-forward/outline'].anatomy.annotationSha256)
      .not.toBe(original['chevron-forward/outline'].anatomy.annotationSha256);
    expect(original['chevron-forward/outline'].anatomy.annotationSha256)
      .not.toBe(original['chevron-forward/filled'].anatomy.annotationSha256);
    expect(compileAuthorAnatomy(baseline, { icons: document.icons, source: document.source, schemaVersion: 1 }))
      .toEqual(original);
  });

  it.each([
    ['направление не объявлено', value => { value.icons['arrow-forward'].outline.gesture.direction = 'forward'; }, 'LAW_SEMANTICS_UNSUPPORTED'],
    ['неявный RTL', value => { value.icons['arrow-forward'].outline.gesture.rtl = true; }, 'ANNOTATION_INVALID'],
    ['per-icon amplitude', value => { value.icons['arrow-forward'].outline.gesture.amount = 9; }, 'ANNOTATION_INVALID'],
    ['подмена master', value => { value.icons['arrow-forward'].outline.masterSha256 = '0'.repeat(64); }, 'MASTER_MISMATCH'],
    ['перерисованный path', value => { value.icons['arrow-forward'].outline.parts[0].d = 'M1 1H2Z'; }, 'ANNOTATION_INVALID'],
    ['неадресуемая часть', value => { value.icons['arrow-forward'].outline.gesture.partId = 'missing'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
  ])('отказывает: %s', (_, mutate, code) => {
    const invalid = structuredClone(document); mutate(invalid);
    expect(() => compileAuthorAnatomy(baseline, invalid)).toThrow(expect.objectContaining({ code }));
  });

  it.each(circles)('%s: окружность не получает движение внутреннего знака по сходству', icon => {
    const modules = consumers();
    for (const variant of ['outline', 'filled']) {
      expect(modules[icon].glyphCapabilities(variant).motion.state).toBe('source-only');
      expect(compileSymbolEffect(modules[icon].glyph({ variant }), modules[icon].glyphCapabilities(variant), `${icon}.nudge`, { duration: 600 }))
        .toMatchObject({ ok: false, reason: { code: 'SEMANTIC_MOTION_UNAVAILABLE' } });
      const invalid = structuredClone(document);
      invalid.icons[icon] = { [variant]: declaration(icon, variant) };
      expect(() => compileAuthorAnatomy(baseline, invalid)).toThrow(expect.objectContaining({ code: 'LAW_TOPOLOGY_UNSUPPORTED' }));
    }
  });
});
