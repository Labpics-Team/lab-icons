import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline, authorSymbolPayload } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { symbolExportName } from '../scripts/lib/symbol-modules.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { createCompiledGlyph, createCompiledCapabilities } from '../src/ir/symbol-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => JSON.parse(readFileSync(new URL(path, new URL('..', import.meta.url)), 'utf8'));
const manifest = read('semantics/figma-baseline.json');
const selected = { ...manifest, counts: { families: 2, variants: 4 }, icons: {
  reload: manifest.icons.reload, refresh: manifest.icons.refresh,
} };
const baseline = loadAuthorBaseline(root, { manifest: selected });
const allAnnotations = read('semantics/author-anatomy.json');
const annotations = compileAuthorAnatomy(baseline, { ...allAnnotations, icons: { reload: allAnnotations.icons.reload, refresh: allAnnotations.icons.refresh } });
const sources = Object.fromEntries(Object.entries(baseline.icons).map(([icon, variants]) => [icon,
  Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, {
    ...item, sourceContract: annotations[`${icon}/${variant}`],
  }])),
]));
const compiler = createGlyphCompiler({
  catalog: {
    canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
    icons: Object.fromEntries(Object.entries(sources).map(([icon, variants]) => [icon, {
      model: null, source: { outline: variants.outline.sourceContract, filled: variants.filled.sourceContract },
    }])),
  },
  anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
  staticIcons: Object.fromEntries(Object.entries(sources).flatMap(([icon, variants]) =>
    Object.entries(variants).map(([variant, item]) => [symbolExportName(icon, variant), item.artifactSvg]))),
});

describe('авторская анатомия в production compiler и эффекте', () => {
  it.each(['reload', 'refresh'])('сохраняет независимые masters и делает %s.cycle адресуемым', icon => {
    const payload = authorSymbolPayload(icon, sources[icon], compiler);
    const symbol = { glyph: createCompiledGlyph(payload.icon, payload.source),
      glyphCapabilities: createCompiledCapabilities(payload.capabilities) };
    for (const variant of ['outline', 'filled']) {
      const glyph = symbol.glyph({ variant });
      const caps = symbol.glyphCapabilities(variant);
      expect(glyph.parts.map(part => part.d)).toEqual([...sources[icon][variant].rawSvg.matchAll(/\bd="([^"]+)"/g)].map(match => match[1]));
      expect(glyph.parts[0]).toMatchObject({ id: 'cycle-body', role: 'control', anchor: [0.5, 0.5], anchorSource: 'declared' });
      expect(glyph.svg).toContain('data-part="cycle-body"');
      expect(glyph.provenance.kind).toBe('source');
      expect(caps.modelState).toBeNull();
      expect(caps.supportedAxes).toEqual([]);
      expect(symbol.glyph({ variant, modelMode: 'source-only' })).toBe(glyph);
      expect(() => symbol.glyph({ variant, axes: { opsz: 16 } })).toThrow(expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
      const result = compileSymbolEffect(glyph, caps, `${icon}.cycle`, { duration: 800, from: 0.4, to: 0 });
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.effect.targets).toHaveLength(1);
      expect(result.effect.targets[0]?.rotation).toEqual({ from: 144, to: 0, unit: 'degrees' });
      expect(result.effect.targets[0]?.style).toEqual({ transformBox: 'view-box', transformOrigin: '50% 50%' });
      expect(result.effect.unchangedPartIds).toEqual([]);
      expect(result.effect.viewport).toEqual({ overflow: 'visible' });
      expect(Object.isFrozen(result.effect.viewport)).toBe(true);
      expect(compileSymbolEffect(glyph, caps, 'time.advance', { duration: 800 })).toMatchObject({ ok: false, reason: { code: 'GESTURE_UNSUPPORTED' } });
      const reduced = compileSymbolEffect(glyph, caps, `${icon}.cycle`, { duration: 800, reducedMotion: true });
      expect(reduced.ok && reduced.effect.options.duration).toBe(0);
    }
    expect(symbol.glyph().svg).not.toBe(symbol.glyph({ variant: 'filled' }).svg);
  });

  it('отказывает потерянному/чужому receipt и anchor; role сама не даёт admission', () => {
    const payload = authorSymbolPayload('reload', sources.reload, compiler);
    const symbol = { glyph: createCompiledGlyph(payload.icon, payload.source),
      glyphCapabilities: createCompiledCapabilities(payload.capabilities) };
    const glyph = symbol.glyph();
    const caps = symbol.glyphCapabilities();
    const refuse = (changed, capability = caps) => compileSymbolEffect(changed, capability, 'reload.cycle', { duration: 800 });
    expect(refuse({ ...glyph, provenance: { ...glyph.provenance, anatomy: undefined } })).toMatchObject({ ok: false });
    expect(refuse(glyph, { ...caps, anatomy: { ...caps.anatomy, annotationSha256: 'a'.repeat(64) } })).toMatchObject({ ok: false });
    expect(refuse(glyph, { ...caps, anatomy: { ...caps.anatomy, version: 2 } })).toMatchObject({ ok: false });
    expect(refuse(glyph, { ...caps, author: { ...caps.author, normalizedSha256: 'b'.repeat(64) } })).toMatchObject({ ok: false });
    expect(refuse(glyph, symbol.glyphCapabilities('filled'))).toMatchObject({ ok: false, reason: { code: 'CAPABILITY_MISMATCH' } });
    expect(refuse({ ...glyph, parts: glyph.parts.map(part => ({ ...part, anchor: [0.4, 0.5] })) })).toMatchObject({ ok: false, reason: { code: 'CAPABILITY_MISMATCH' } });
    expect(refuse({ ...glyph, parts: glyph.parts.map(part => ({ ...part, provenance: { ...part.provenance, identity: 'geometry-derived' } })) })).toMatchObject({ ok: false });
  });
});
