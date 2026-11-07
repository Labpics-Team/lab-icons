import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { symbolModuleDeclaration, variationModuleDeclaration } from '../scripts/lib/symbol-modules.js';

const root = fileURLToPath(new URL('..', import.meta.url)), compiler = join(root, 'node_modules/typescript/bin/tsc');

it('public annulus declarations accept Outline, narrow capabilities and reject Filled variation in both resolutions', () => {
  const consumer = mkdtempSync(join(tmpdir(), 'lab-icons-annulus-types-'));
  try {
    const pkg = join(consumer, 'node_modules/@labpics/icons'), out = join(pkg, 'dist');
    execFileSync(process.execPath, [compiler, '--ignoreConfig', '--declaration', '--emitDeclarationOnly', '--stripInternal',
      '--strict', '--noUncheckedIndexedAccess', '--isolatedModules', '--resolveJsonModule', '--skipLibCheck', '--lib', 'ES2022,DOM',
      '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--rootDir', join(root, 'src'), '--outDir', out,
      join(root, 'src/ir/author-annulus-types.ts')], { cwd: root, stdio: 'pipe', windowsHide: true });
    mkdirSync(join(out, 'symbols')); mkdirSync(join(out, 'variations'));
    writeFileSync(join(out, 'symbols/plus-circle.d.ts'), symbolModuleDeclaration('plus-circle'));
    writeFileSync(join(out, 'variations/plus-circle.d.ts'), variationModuleDeclaration('plus-circle', 'annulus.counter-scale'));
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', exports: {
      './symbols/*': { types: './dist/symbols/*.d.ts' }, './variations/*': { types: './dist/variations/*.d.ts' } } }));
    writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    const positive = [
      "import { glyph, glyphCapabilities } from '@labpics/icons/variations/plus-circle';",
      "import { glyph as sourceGlyph } from '@labpics/icons/symbols/plus-circle';",
      "declare module '@labpics/icons/variations/plus-circle' { namespace glyph { let cached: string; } }",
      "glyph.cached = 'consumer namespace';",
      "const exactKind: 'source' = glyph().provenance.kind;",
      "const filledKind: 'source' = glyph({variant:'filled'}).provenance.kind;",
      "const outline: 'outline' = glyph({variation:{enclosureEmphasis:1.1}}).variant;",
      "const modifiedKind: 'source' | 'authored-variation' = glyph({variation:{enclosureEmphasis:1.1}}).provenance.kind;",
      "const law: 'annulus.counter-scale' = glyphCapabilities().variation.law;",
      "const motion: 'existing-part-gestures' = glyphCapabilities().variation.targets.webEffect;",
      "const emphasis: 1 = glyphCapabilities('outline').variation.defaults.enclosureEmphasis;",
      "const filled = glyphCapabilities('filled'); const filledVariant: 'filled' = filled.variant;",
      "declare const variant: 'outline' | 'filled'; const capability = glyphCapabilities(variant);",
      "if (capability.variant === 'outline') { const value: 'annulus.counter-scale' = capability.variation.law; }",
      '// @ts-expect-error: отдельная Filled форма не получает variation.',
      "glyph({variant:'filled',variation:{enclosureEmphasis:1.1}});",
      '// @ts-expect-error: параметр другого закона не принимается.',
      "glyph({variation:{dotScale:1.1}});",
      '// @ts-expect-error: это не ось веса.',
      "glyph({variation:{weight:1.1}});",
      '// @ts-expect-error: обычный import сохраняет только source.',
      "sourceGlyph({variation:{enclosureEmphasis:1.1}});",
      '// @ts-expect-error: Filled capabilities не обещают variation.',
      'filled.variation;',
      '// @ts-expect-error: capability immutable.',
      "glyphCapabilities().variation.defaults.enclosureEmphasis = 2;",
      '// @ts-expect-error: nondefault не обещает точный source.',
      "const falseExact: 'source' = glyph({variation:{enclosureEmphasis:1.1}}).provenance.kind;",
      '// @ts-expect-error: explicit variation не принимает Filled.',
      "const falseFilled: 'filled' = glyph({variation:{enclosureEmphasis:1.1}}).variant;",
      'void [exactKind, filledKind, outline, modifiedKind, law, emphasis, filledVariant];',
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
        .toEqual([2769, 2769, 2769, 2322, 2339, 2540, 2322, 2322]);
    }
  } finally { rmSync(consumer, { recursive: true, force: true }); }
});
