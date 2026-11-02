import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { symbolModuleDeclaration } from '../scripts/lib/symbol-modules.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const compiler = join(root, 'node_modules/typescript/bin/tsc');

it('generated public declarations distinguish named variation from exact source requests', () => {
  const consumer = mkdtempSync(join(tmpdir(), 'lab-icons-authored-types-'));
  try {
    const pkg = join(consumer, 'node_modules/@labpics/icons');
    mkdirSync(join(pkg, 'dist/symbols'), { recursive: true });
    // Узкая declaration-сборка замыкает реальные типы двух публичных symbols;
    // runtime, каталог геометрии, общий build и установка пакета не запускаются.
    execFileSync(process.execPath, [compiler, '--ignoreConfig', '--declaration', '--emitDeclarationOnly',
      '--strict', '--skipLibCheck', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler',
      '--resolveJsonModule', '--rootDir', join(root, 'src'), '--outDir', join(pkg, 'dist'),
      join(root, 'src/ir/authored-variation.ts')], { cwd: root, stdio: 'pipe' });
    for (const [icon, variation] of [['ellipsis-horizontal', true], ['ellipse', false]]) {
      writeFileSync(join(pkg, 'dist/symbols', `${icon}.d.ts`), symbolModuleDeclaration(icon, variation));
    }
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', exports: {
      './symbols/ellipsis-horizontal': { types: './dist/symbols/ellipsis-horizontal.d.ts' },
      './symbols/ellipse': { types: './dist/symbols/ellipse.d.ts' },
    } }));
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    writeFileSync(join(consumer, 'smoke.ts'), [
      "import { glyph, glyphCapabilities } from '@labpics/icons/symbols/ellipsis-horizontal';",
      "import { glyph as ellipseGlyph, glyphCapabilities as ellipseCapabilities } from '@labpics/icons/symbols/ellipse';",
      'type AuthorVariationGlyphRequest = Parameters<typeof glyph>[0];',
      'const typedRequest: AuthorVariationGlyphRequest = { variation: { dotScale: 1.1 } };',
      "const defaultKind: 'source' = glyph().provenance.kind;",
      "const sourceKind: 'source' = glyph({ variant: 'filled', modelMode: 'source-only' }).provenance.kind;",
      "const variableKind: 'source' | 'authored-variation' = glyph(typedRequest).provenance.kind;",
      "const inlineKind: 'source' | 'authored-variation' = glyph({ variation: { dotScale: 1.1 } }).provenance.kind;",
      "const variableIcon: 'ellipsis-horizontal' = glyph(typedRequest).icon;",
      "const sourceIcon: 'ellipse' = ellipseGlyph().icon;",
      "const capabilityLaw: 'dots.affine' = glyphCapabilities().variation.law;",
      "const lastSignatureKind: ReturnType<typeof glyph>['provenance']['kind'] = 'authored-variation';",
      '// @ts-expect-error: named variation не обещает exact source.',
      "const falseSourcePromise: 'source' = glyph(typedRequest).provenance.kind;",
      '// @ts-expect-error: inline variation тоже не обещает exact source.',
      "const falseInlinePromise: 'source' = glyph({ variation: { dotScale: 1.1 } }).provenance.kind;",
      '// @ts-expect-error: неподдержанный symbol отвергает named variation.',
      'ellipseGlyph(typedRequest);',
      '// @ts-expect-error: статический symbol не обещает variation capabilities.',
      "const falseStaticLaw: 'dots.affine' = ellipseCapabilities().variation.law;",
      'void [defaultKind, sourceKind, variableKind, inlineKind, falseSourcePromise, falseInlinePromise];',
    ].join('\n'));
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: false,
    }, include: ['smoke.ts'] }));
    let diagnostics = '';
    try {
      execFileSync(process.execPath, [compiler, '-p', join(consumer, 'tsconfig.json')], { cwd: consumer, stdio: 'pipe' });
    } catch (error) {
      diagnostics = [error.stdout, error.stderr].filter(Boolean).join('\n');
    }
    expect(diagnostics, `actual generated public type consumer:\n${diagnostics}`).toBe('');
    writeFileSync(join(consumer, 'smoke-negative.ts'), readFileSync(join(consumer, 'smoke.ts'), 'utf8')
      .replace(/^\/\/ @ts-expect-error:.*\n/gm, ''));
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', strict: true, noEmit: true, skipLibCheck: false,
    }, include: ['smoke-negative.ts'] }));
    diagnostics = '';
    try {
      execFileSync(process.execPath, [compiler, '-p', join(consumer, 'tsconfig.json')], { cwd: consumer, stdio: 'pipe' });
    } catch (error) {
      diagnostics = [error.stdout, error.stderr].filter(Boolean).join('\n');
    }
    expect([...diagnostics.matchAll(/error TS(\d+):/g)].map(match => Number(match[1])), diagnostics)
      .toEqual([2322, 2322, 2345, 2532]);
    writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: {
      target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', strict: true, noEmit: true, skipLibCheck: false,
    }, include: ['smoke.ts'] }));
    diagnostics = '';
    try {
      execFileSync(process.execPath, [compiler, '-p', join(consumer, 'tsconfig.json')], { cwd: consumer, stdio: 'pipe' });
    } catch (error) {
      diagnostics = [error.stdout, error.stderr].filter(Boolean).join('\n');
    }
    expect(diagnostics, `actual NodeNext generated type consumer:\n${diagnostics}`).toBe('');
  } finally {
    rmSync(consumer, { recursive: true, force: true });
  }
});
