import { describe, expect, it } from 'vitest';
import { anatomyForSymbol, renderSymbolModule, symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
import { expandReleaseExports, runtimeModuleSpecifiers, validateReleaseContract, validateReleaseRuntimeDependencyGraph } from '../scripts/lib/release-contract.js';

const base = {
  packageName: '@labpics/icons', primary: { kind: 'npm', access: 'public', install: 'pnpm add @labpics/icons' },
  fallback: { kind: 'github-dist-tag', specifier: 'github:Labpics-Team/lab-icons#vX.Y.Z-dist', immutable: true },
  exports: Object.fromEntries([['.', 'index'], ['./ir', 'ir/index'], ['./ir/recipes', 'ir/recipes'], ['./ir/candidates', 'ir/candidates']].map(([key, file]) => [key, { types: `./dist/${file}.d.ts`, import: `./dist/${file}.js` }])),
};

describe('замкнутые symbol modules', () => {
  it('projection растёт от настоящего catalog и не требует фиксированного числа иконок', () => {
    const contract = symbolReleaseProjection(base, ['time', 'alert', 'new-symbol']);
    expect(validateReleaseContract(contract)).toEqual([]);
    const exports = expandReleaseExports(contract);
    expect(exports['./symbols/new-symbol']).toEqual({ types: './dist/symbols/new-symbol.d.ts', import: './dist/symbols/new-symbol.js' });
    expect(contract.files).toContain('dist/symbols/alert.js');
    expect(contract.files.some(file => file.includes('*'))).toBe(false);
    expect(() => symbolReleaseProjection(base, ['time', 'time'])).toThrow();
    expect(() => symbolReleaseProjection(base, ['../escape'])).toThrow();
  });

  it('source-only module не импортирует ни compiler, ни геометрию соседнего символа', () => {
    const shape = { icon: 'alert', svg: '<svg/>', parts: [] };
    const result = renderSymbolModule({ icon: 'alert', source: { outline: shape, filled: shape }, defaults: { outline: shape, filled: shape }, capabilities: {}, axes: {}, staticSvg: { outline: '<svg/>', filled: '<svg/>' } });
    expect(runtimeModuleSpecifiers(result).specifiers).toEqual(['../ir/symbol-runtime.js']);
    expect(result).not.toContain('createGlyphCompiler');
    expect(result).not.toContain('catalog.json');
    expect(result).toContain('outline: outlineSource, filled: filledSource');
  });

  it('mirror slice содержит ровно declaration и реальный mirror source', () => {
    const catalog = { icons: { back: { model: { declaration: 'back' } } } };
    const anatomy = { version: 1, glyphs: { back: { archetype: 'mirror', of: 'forward' }, forward: { archetype: 'arrow' }, unrelated: { archetype: 'circle' } } };
    expect(Object.keys(anatomyForSymbol('back', catalog, anatomy).glyphs).sort()).toEqual(['back', 'forward']);
    expect(() => anatomyForSymbol('back', catalog, { version: 1, glyphs: { back: { archetype: 'mirror', of: 'back' } } })).toThrow(/цикл/);
  });

  it('runtime parser различает настоящие imports, данные и template expressions', () => {
    const parsed = runtimeModuleSpecifiers('const text="import(fake)";export const x=`prefix${import("./one.js")}`;');
    expect(parsed).toEqual({ specifiers: ['./one.js'], errors: [] });
    expect(runtimeModuleSpecifiers('export const x=()=>import(name);').errors).toHaveLength(1);
    expect(runtimeModuleSpecifiers('export const x=()=>import("./"+name);').errors).toHaveLength(1);
    expect(runtimeModuleSpecifiers('export const object={import(value){return value;}};').errors).toEqual([]);
  });

  it('orphan или внешняя runtime dependency не становится разрешённой через manifest', () => {
    const contract = symbolReleaseProjection(base, ['alert']);
    const files = Object.fromEntries(contract.files.filter(file => file.endsWith('.js')).map(file => [file, 'export const value=1;']));
    files['dist/ir/index.js'] = 'import "./compiler.js";export const value=1;';
    files['dist/ir/compiler.js'] = 'import "./request.js";export const value=1;';
    files['dist/ir/symbol-runtime.js'] = 'import "./request.js";export const value=1;';
    files['dist/symbols/alert.js'] = 'import "../ir/symbol-runtime.js";export const value=1;';
    const readText = file => files[file];
    expect(validateReleaseRuntimeDependencyGraph({ contract, readText })).toEqual([]);
    files['dist/ir/compiler.js'] = 'import "node:fs";export const value=1;';
    expect(validateReleaseRuntimeDependencyGraph({ contract, readText }).join('\n')).toContain('внешнюю runtime-зависимость node:fs');
    files['dist/ir/compiler.js'] = 'import "./request.js";export const value=1;';
    const orphan = 'dist/ir/unreachable.js';
    files[orphan] = 'export const value=1;';
    const mutated = { ...contract, files: [...contract.files, orphan].sort(), runtimeDependencies: [...contract.runtimeDependencies, orphan].sort() };
    expect(validateReleaseRuntimeDependencyGraph({ contract: mutated, readText }).join('\n')).toContain('не равен import closure');
  });
});
