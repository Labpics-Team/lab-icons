import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { expandReleaseExports } from '../scripts/lib/release-contract.js';
import { exportSurfaceEntryErrors } from '../scripts/lib/export-surface.js';
import { importSourceBundle, reflectAddedSourceSurface } from './helpers/source-export-surface.js';

const contract = JSON.parse(readFileSync(new URL('../release/contract.json', import.meta.url), 'utf8'));
const snapshot = JSON.parse(readFileSync(new URL('../release/export-surface.json', import.meta.url), 'utf8'));
const anatomy = JSON.parse(readFileSync(new URL('../semantics/author-anatomy.json', import.meta.url), 'utf8'));

describe('полная публичная runtime-поверхность', () => {
  it('снимок покрывает ровно раскрытые entrypoints действующего контракта', () => {
    const errors = exportSurfaceEntryErrors(contract, snapshot);
    expect(errors.length, errors.slice(0, 4).join('\n')).toBe(0);
  });

  it('обнаруживает потерю группы symbol modules и отдельного публичного адаптера', () => {
    const incomplete = Object.fromEntries(Object.entries(snapshot).filter(([key]) => !key.startsWith('./symbols/') && key !== './motion'));
    const errors = exportSurfaceEntryErrors(contract, incomplete);
    for (const entry of Object.keys(expandReleaseExports(contract)).filter(key => key.startsWith('./symbols/') || key === './motion')) {
      expect(errors).toContain(`export-surface: отсутствует публичный entrypoint ${entry}`);
    }
    expect(exportSurfaceEntryErrors(contract, { ...snapshot, './private-helper': [] })).toContain('export-surface: неизвестный entrypoint ./private-helper');
    expect(exportSurfaceEntryErrors(contract, [])).toHaveLength(1);
  });

  it('обнаруживает точную потерю любого объявленного annulus entrypoint', () => {
    const declared = Object.entries(anatomy.icons).filter(([, variants]) => variants.outline?.variation?.law === 'annulus.counter-scale')
      .map(([icon]) => `./variations/${icon}`).sort();
    const entries = Object.keys(expandReleaseExports(contract)).filter(entry => declared.includes(entry)).sort();
    expect(declared.length).toBeGreaterThan(0);
    expect(entries).toEqual(declared);
    expect(exportSurfaceEntryErrors(contract, snapshot)).toEqual([]);
    for (const entry of entries) {
      const incomplete = { ...snapshot }; delete incomplete[entry];
      expect(exportSurfaceEntryErrors(contract, incomplete), entry)
        .toEqual([`export-surface: отсутствует публичный entrypoint ${entry}`]);
    }
  });

  it('публичные source/template modules подтверждают имена snapshot и сохраняют настоящие static payloads', async () => {
    const names = ['accessibility', 'align-bottom', 'chevron-forward', 'reload', 'time', 'volume-high'];
    const root = fileURLToPath(new URL('..', import.meta.url));
    const { surface, modules, bundles } = await reflectAddedSourceSurface(root, names);
    for (const [entry, exports] of Object.entries(surface)) expect(exports, entry).toEqual(snapshot[entry]);
    for (const name of names) {
      const module = modules[`./symbols/${name}`];
      expect(module.glyph().icon).toBe(name);
      expect(module.glyph().svg).toBe(module.outline);
      expect(module.glyph({ variant: 'filled' }).svg).toBe(module.filled);
    }
    expect(typeof modules['./ir/render'].renderGlyphSvg).toBe('function');
    expect(typeof modules['./motion'].compileSymbolEffect).toBe('function');
    const leak = await importSourceBundle(`${bundles['./symbols/reload']}\nexport const __unexpectedPublicExport = 1;`);
    expect(Object.keys(leak).sort()).not.toEqual(snapshot['./symbols/reload']);
  });
});
