import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { contentVariationModuleDeclaration, symbolModuleDeclaration, variationModuleDeclaration } from '../scripts/lib/symbol-modules.js';

const root = fileURLToPath(new URL('..', import.meta.url)), compiler = join(root, 'node_modules/typescript/bin/tsc');

it('public content declarations accept the joint Outline contract and refuse unrelated axes/Filled in both resolutions', () => {
  const consumer = mkdtempSync(join(tmpdir(), 'lab-icons-content-types-'));
  try {
    const pkg = join(consumer, 'node_modules/@labpics/icons'), out = join(pkg, 'dist');
    execFileSync(process.execPath, [compiler, '--ignoreConfig', '--declaration', '--emitDeclarationOnly', '--stripInternal',
      '--strict', '--noUncheckedIndexedAccess', '--isolatedModules', '--resolveJsonModule', '--skipLibCheck', '--lib', 'ES2022,DOM',
      '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--rootDir', join(root, 'src'), '--outDir', out,
      join(root, 'src/ir/author-content-types.ts')], { cwd: root, stdio: 'pipe', windowsHide: true });
    for (const directory of ['symbols', 'variations', 'content-variations']) mkdirSync(join(out, directory));
    writeFileSync(join(out, 'symbols/plus-circle.d.ts'), symbolModuleDeclaration('plus-circle'));
    writeFileSync(join(out, 'variations/plus-circle.d.ts'), variationModuleDeclaration('plus-circle', 'annulus.counter-scale'));
    writeFileSync(join(out, 'content-variations/plus-circle.d.ts'), contentVariationModuleDeclaration('plus-circle'));
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', exports: {
      './symbols/*': { types: './dist/symbols/*.d.ts' }, './variations/*': { types: './dist/variations/*.d.ts' },
      './content-variations/*': { types: './dist/content-variations/*.d.ts' } } }));
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    const positive = [
      "import { glyph, glyphCapabilities } from '@labpics/icons/content-variations/plus-circle';",
      "import { glyph as sourceGlyph } from '@labpics/icons/symbols/plus-circle';",
      "import { glyph as ringGlyph } from '@labpics/icons/variations/plus-circle';",
      "const exactKind: 'source' = glyph().provenance.kind;",
      "const filledKind: 'source' = glyph({variant:'filled'}).provenance.kind;",
      "const outline: 'outline' = glyph({variation:{contentScale:0.9,enclosureEmphasis:1.1}}).variant;",
      "const scaleOnly: 'outline' = glyph({variation:{contentScale:0.9}}).variant;",
      "const ringOnly: 'outline' = glyph({variation:{enclosureEmphasis:1.1}}).variant;",
      "const modifiedKind: 'source' | 'authored-variation' = glyph({variation:{contentScale:0.9}}).provenance.kind;",
      "const law: 'annulus.content-counter-scale' = glyphCapabilities().variation.law;",
      "const contentDefault: 1 = glyphCapabilities('outline').variation.defaults.contentScale;",
      "const enclosureDefault: 1 = glyphCapabilities('outline').variation.defaults.enclosureEmphasis;",
      "const filled = glyphCapabilities('filled'); const filledVariant: 'filled' = filled.variant;",
      "declare const variant: 'outline' | 'filled'; const capability = glyphCapabilities(variant);",
      "if (capability.variant === 'outline') { const value: 'annulus.content-counter-scale' = capability.variation.law; }",
      '// @ts-expect-error: Filled не получает совместную геометрию даже с defaults.',
      "glyph({variant:'filled',variation:{contentScale:1,enclosureEmphasis:1}});",
      '// @ts-expect-error: старый annulus import не получает новый параметр.',
      "ringGlyph({variation:{contentScale:0.9}});",
      '// @ts-expect-error: source import не получает новую вариацию.',
      "sourceGlyph({variation:{contentScale:0.9}});",
      '// @ts-expect-error: независимый dot закон не принимается.',
      "glyph({variation:{dotScale:0.9}});",
      '// @ts-expect-error: совместное масштабирование не обещает вес.',
      "glyph({variation:{weight:1.1}});",
      '// @ts-expect-error: совместное масштабирование не обещает полную opsz.',
      "glyph({variation:{opsz:16}});",
      '// @ts-expect-error: Filled capability не имеет variation.',
      'filled.variation;',
      '// @ts-expect-error: metadata immutable.',
      'glyphCapabilities().variation.defaults.contentScale = 2;',
      '// @ts-expect-error: изменённая геометрия не обещает точный source.',
      "const falseExact: 'source' = glyph({variation:{contentScale:0.9}}).provenance.kind;",
      'void [exactKind, filledKind, outline, scaleOnly, ringOnly, modifiedKind, law, contentDefault, enclosureDefault, filledVariant];',
    ].join('\n');
    const negative = positive.replace(/^\/\/ @ts-expect-error:.*\n/gm, '');
    const diagnostics = (source, mode) => {
      writeFileSync(join(consumer, 'consumer.ts'), source);
      writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, noEmit: true,
        skipLibCheck: false, target: 'ES2022', module: mode === 'Bundler' ? 'ESNext' : 'NodeNext', moduleResolution: mode }, files: ['consumer.ts'] }));
      try { execFileSync(process.execPath, [compiler, '-p', join(consumer, 'tsconfig.json')], { cwd: consumer, stdio: 'pipe', windowsHide: true }); return ''; }
      catch (error) { if (error.status !== 1 && error.status !== 2) throw error; return String(error.stdout) + String(error.stderr); }
    };
    for (const mode of ['Bundler', 'NodeNext']) {
      expect(diagnostics(positive, mode), mode).toBe('');
      const actual = diagnostics(negative, mode);
      expect([...actual.matchAll(/error TS(\d+):/g)].map(match => Number(match[1])), actual)
        .toEqual([2769, 2769, 2322, 2769, 2769, 2769, 2339, 2540, 2322]);
    }
  } finally { rmSync(consumer, { recursive: true, force: true }); }
});
