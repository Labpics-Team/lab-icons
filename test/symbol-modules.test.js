import { describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { renderSymbolModule, symbolModuleDeclaration, symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
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
    const result = renderSymbolModule({ icon: 'alert', source: { outline: shape, filled: shape }, capabilities: {}, staticSvg: { outline: '<svg/>', filled: '<svg/>' } });
    expect(runtimeModuleSpecifiers(result).specifiers).toEqual(['../ir/symbol-runtime.js']);
    expect(result).not.toContain('createGlyphCompiler');
    expect(result).not.toContain('catalog.json');
    expect(result).toContain('source: { outline: outlineSource, filled: filledSource }');
  });

  it('declaration связывает реальное добавленное имя с author corpus', () => {
    const declaration = symbolModuleDeclaration('align-bottom');
    expect(declaration).toContain("AuthorSourceGlyph<'align-bottom'>");
    expect(declaration).toContain("AuthorSourceCapabilities<'align-bottom'>");
    expect(declaration).not.toContain('CatalogIconId');
    expect(() => symbolModuleDeclaration('../escape')).toThrow();
  });

  it('outline-only consumer удаляет настоящий runtime и весь IR payload; прежний member-read это нарушает', async () => {
    const shape = { icon: 'alert', svg: 'AUTHOR_IR_SENTINEL', parts: [] };
    const module = renderSymbolModule({ icon: 'alert', source: { outline: shape, filled: shape }, capabilities: { trace: 'AUTHOR_CAPS_SENTINEL' }, staticSvg: { outline: '<svg>SVG_STATIC_CONTROL</svg>', filled: '<svg>FILLED_UNUSED</svg>' } });
    async function consume(contents) {
      const output = await build({
        stdin: { contents: 'import { outline } from "test-symbol"; console.log(outline);', loader: 'js' },
        bundle: true, write: false, minify: true, platform: 'browser', format: 'esm', logLevel: 'silent',
        plugins: [{ name: 'single-symbol-control', setup(plugin) {
          plugin.onResolve({ filter: /^test-symbol$/ }, () => ({ path: 'symbol', namespace: 'symbol', sideEffects: false }));
          plugin.onLoad({ filter: /.*/, namespace: 'symbol' }, () => ({ contents, loader: 'js' }));
          plugin.onResolve({ filter: /symbol-runtime\.js$/ }, () => ({ path: fileURLToPath(new URL('../src/ir/symbol-runtime.ts', import.meta.url)) }));
        } }],
      });
      return output.outputFiles[0].text;
    }
    const actual = await consume(module);
    expect(actual).toContain('SVG_STATIC_CONTROL');
    expect(actual).not.toContain('AUTHOR_IR_SENTINEL');
    expect(actual).not.toContain('AUTHOR_CAPS_SENTINEL');
    expect(actual).not.toContain('FILLED_UNUSED');
    expect(actual).not.toContain('AUTHOR_PARITY_REQUIRED');
    const stale = module
      .replace('export function glyph(request) { return symbol.glyph(request); }', 'export const glyph = symbol.glyph;')
      .replace('export function glyphCapabilities(variant) { return symbol.glyphCapabilities(variant); }', 'export const glyphCapabilities = symbol.glyphCapabilities;');
    expect(await consume(stale)).toContain('AUTHOR_IR_SENTINEL');
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
