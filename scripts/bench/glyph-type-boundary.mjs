/** Две семьи и публичные type consumers; без runtime/build/pack/browser. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import assert from 'node:assert/strict';
import { brotliCompressSync, constants } from 'node:zlib';
import { gzipSync } from 'fflate';
import { declarationModuleSpecifiers } from '../lib/release-contract.js';
import { symbolModuleDeclaration, variationModuleDeclaration } from '../lib/symbol-modules.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const compiler = join(root, 'node_modules/typescript/bin/tsc');
const names = ['ellipsis-horizontal', 'ellipse'];
const hash = text => createHash('sha256').update(text).digest('hex');
const measure = text => { const bytes = Buffer.from(text); return { bytes: bytes.length,
  gzipBytes: gzipSync(bytes, { level: 9, mtime: 0 }).length,
  brotliBytes: brotliCompressSync(bytes, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
  sha256: hash(bytes) }; };
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
const write = (file, text) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, text); };

/** Узкий installed-layout consumer без обращения к истории при обычном regression. */
export async function checkGlyphTypeBoundary({ baseline = null } = {}) {
  if (baseline !== null && !/^[a-f0-9]{40}$/.test(baseline)) throw new TypeError('Нужен полный baseline SHA.');
  const snapshotFiles = git(['ls-files', 'src']).trim().split('\n').filter(file => file.endsWith('.ts'));
  const baselineFiles = baseline === null ? [] : git(['ls-tree', '-r', '--name-only', baseline, '--', 'src'])
    .trim().split('\n').filter(file => file.endsWith('.ts'));
  const readSnapshot = (file, before) => before ? git(['show', `${baseline}:${file}`]) : readFileSync(join(root, file), 'utf8');
  const oldEmitter = baseline === null ? null : readSnapshot('scripts/lib/symbol-modules.js', true)
    .replace("'./generated-module.js'", JSON.stringify(new URL('../lib/generated-module.js', import.meta.url).href));
  const oldDeclarations = oldEmitter === null ? null : await import(`data:text/javascript;base64,${Buffer.from(oldEmitter).toString('base64')}`);
  const temporary = mkdtempSync(join(tmpdir(), 'lab-icons-glyph-types-'));
  function files(directory, prefix = '') {
    return Object.fromEntries(readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
      const name = posix.join(prefix, entry.name), path = join(directory, entry.name);
      return entry.isDirectory() ? Object.entries(files(path, name)) : [[name, readFileSync(path, 'utf8')]];
    }));
  }
  function closure(outputs, entrypoints) {
    const visited = new Set(), visit = file => {
      if (visited.has(file)) return;
      assert.ok(Object.hasOwn(outputs, file), `missing declaration ${file}`);
      visited.add(file);
      const parsed = declarationModuleSpecifiers(outputs[file]);
      assert.deepEqual(parsed.errors, []);
      for (const specifier of parsed.specifiers) {
        assert.ok(specifier.startsWith('.'), `external declaration ${specifier}`);
        const resolved = posix.normalize(posix.join(posix.dirname(file), specifier));
        visit(resolved.endsWith('.d.ts') ? resolved : resolved.replace(/\.js$/, '') + '.d.ts');
      }
    };
    entrypoints.forEach(visit);
    const selected = [...visited].sort(), total = { bytes: 0, gzipBytes: 0, brotliBytes: 0 };
    for (const file of selected) { const item = measure(outputs[file]); for (const key of Object.keys(total)) total[key] += item[key]; }
    return { files: selected, individuallyCompressedTotals: total,
      concatenated: measure(selected.map(file => outputs[file]).join('\n')) };
  }
  const positive = [
    "import { glyph, glyphCapabilities } from '@labpics/icons/variations/ellipsis-horizontal';",
    "import { glyph as exactDots } from '@labpics/icons/symbols/ellipsis-horizontal';",
    "import { glyph as exact, glyphCapabilities as exactCaps } from '@labpics/icons/symbols/ellipse';",
    "declare module '@labpics/icons/symbols/ellipse' { namespace glyph { let cache: string; } }",
    "declare module '@labpics/icons/variations/ellipsis-horizontal' { namespace glyphCapabilities { let cache: string; } }",
    "exact.cache = 'namespace'; glyphCapabilities.cache = 'namespace';",
    "type Request = Parameters<typeof glyph>[0]; const request: Request = { variation: { dotScale: 1.1 } };",
    "const icon: 'ellipsis-horizontal' = glyph(request).icon;",
    "const original: 'source' = glyph().provenance.kind;",
    "const explicitSource: 'source' = glyph({ variant: 'filled', modelMode: 'source-only' }).provenance.kind;",
    "const inline: 'source' | 'authored-variation' = glyph({ variation: { dotScale: 1.1 } }).provenance.kind;",
    "const variable: 'source' | 'authored-variation' = glyph(request).provenance.kind;",
    "const returned: ReturnType<typeof glyph>['provenance']['kind'] = 'authored-variation';",
    "const variant: 'outline' | 'filled' | undefined = undefined as Parameters<typeof glyphCapabilities>[0];",
    "const law: 'dots.affine' = glyphCapabilities(variant).variation.law;",
    "const exactIcon: 'ellipse' = exact({variant: 'filled'}).icon;",
  ].join('\n');
  const negative = positive + '\n' + [
    "const falseSource: 'source' = glyph(request).provenance.kind;",
    "const falseInline: 'source' = glyph({ variation: { dotScale: 1.1 } }).provenance.kind;",
    'exact(request);',
    'exactCaps().variation;',
    'exactDots(request);',
    "glyphCapabilities('foreign');",
  ].join('\n');
  const motionAugmentation = [
    "import type { SymbolEffect, SymbolSequenceEffect, SymbolTranslationEffect } from '@labpics/icons/motion';",
    "declare module '@labpics/icons/motion' {",
    ...['SymbolEffect', 'SymbolSequenceEffect', 'SymbolTranslationEffect'].map(name =>
      `interface ${name} { readonly consumerTag?: string; readonly icon: string; readonly gesture: string; }`),
    '}',
  ].join('\n');
  const motionAugmentationNegative = motionAugmentation.replaceAll('readonly icon: string; readonly gesture: string;',
    "icon: string; readonly gesture: 'specific-gesture';");
  const augmentation = [
    "import { glyph, glyphCapabilities, type IconId } from '@labpics/icons/ir';",
    "import { buildDirectionalArrow } from '@labpics/icons/ir/recipes';",
    "declare module '@labpics/icons/ir' {",
    "interface GlyphIR<TIcon extends string = IconId> { readonly consumerGlyphTag?: 'glyph'; }",
    "interface GlyphCapabilities<TIcon extends string = IconId> { readonly consumerCapsTag?: 'caps'; } }",
    "declare module '@labpics/icons/ir/recipes' {",
    "interface RecipePart { readonly consumerPartTag?: 'part'; }",
    "interface NormalizedPoint { readonly consumerPointTag?: 'point'; }",
    "interface RecipeStrokePaint { readonly consumerStrokeTag?: 'stroke'; }",
    "interface RecipeFillPaint { readonly consumerFillTag?: 'fill'; } }",
    "const g = glyph({icon: 'alert'}), c = glyphCapabilities('alert'), r = buildDirectionalArrow();",
    "const a: 'glyph' | undefined = g.consumerGlyphTag;",
    "const b: 'caps' | undefined = c.consumerCapsTag;",
    "const d: 'part' | undefined = r.parts[0].consumerPartTag;",
    "const e: 'point' | undefined = r.canvas.consumerPointTag;",
    'const originalIcon: string = g.icon, originalWidth: number = r.canvas.width;',
    "const paint = r.parts[0].paint; if(paint.kind === 'stroke') {",
    "const f: 'stroke' | undefined = paint.consumerStrokeTag; const w: number = paint.strokeWidth;",
    "} else { const f: 'fill' | undefined = paint.consumerFillTag; const color: 'currentColor' = paint.fill; }",
  ].join('\n');
  const augmentationNegative = augmentation + '\n' + [
    "const wrongGlyph: 'other' | undefined = g.consumerGlyphTag;",
    "const wrongCaps: 'other' | undefined = c.consumerCapsTag;",
    "const wrongPart: 'other' | undefined = r.parts[0].consumerPartTag;",
    "const wrongPoint: 'other' | undefined = r.canvas.consumerPointTag;",
  ].join('\n');
  function diagnostics(consumer, mode, contents) {
    write(join(consumer, 'consumer.ts'), contents);
    write(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, skipLibCheck: false,
      noEmit: true, target: 'ES2022', module: mode === 'Bundler' ? 'ESNext' : 'NodeNext', moduleResolution: mode }, files: ['consumer.ts'] }));
    let output = '';
    try { execFileSync(process.execPath, [compiler, '-p', join(consumer, 'tsconfig.json')], { cwd: consumer, encoding: 'utf8', stdio: 'pipe', windowsHide: true }); }
    catch (error) { if (error.status !== 1 && error.status !== 2) throw error; output = String(error.stdout) + String(error.stderr); }
    return { codes: [...output.matchAll(/error TS(\d+):/g)].map(match => Number(match[1])), output };
  }
  const observations = {};
  try {
    for (const before of baseline === null ? [false] : [true, false]) {
      const label = before ? 'baseline' : 'actual', sourceRoot = join(temporary, label), out = join(sourceRoot, 'consumer/node_modules/@labpics/icons/dist');
      for (const file of before ? baselineFiles : snapshotFiles) write(join(sourceRoot, file), readSnapshot(file, before));
      if (!before) for (const file of ['src/ir/glyph-types.ts', 'src/ir/paint-types.ts', 'src/ir/author-annulus-types.ts']) write(join(sourceRoot, file), readSnapshot(file, false));
      // Только два JSON источника используются type emit; geometry не строится.
      for (const file of ['semantics/catalog.json', 'semantics/anatomy.runtime.json', 'semantics/grid.json']) {
        const value = JSON.parse(readSnapshot(file, before));
        for (const key of ['icons', 'glyphs']) if (value[key]) value[key] = Object.fromEntries(names.filter(name => value[key][name]).map(name => [name, value[key][name]]));
        write(join(sourceRoot, file), JSON.stringify(value));
      }
      write(join(sourceRoot, 'node_modules/@labpics/icons/index.d.ts'), 'export declare const ellipsisHorizontalOutline: string; export declare const ellipseOutline: string;');
      write(join(sourceRoot, 'node_modules/@labpics/icons/package.json'), JSON.stringify({ name: '@labpics/icons', types: './index.d.ts' }));
      execFileSync(process.execPath, [compiler, '--ignoreConfig', '--declaration', '--emitDeclarationOnly', '--stripInternal',
        '--strict', '--noUncheckedIndexedAccess', '--isolatedModules', '--resolveJsonModule', '--skipLibCheck', '--lib', 'ES2022,DOM',
        '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler', '--rootDir', join(sourceRoot, 'src'), '--outDir', out,
        join(sourceRoot, 'src/ir/index.ts'), join(sourceRoot, 'src/ir/authored-variation.ts'),
        join(sourceRoot, 'src/motion/index.ts')], { cwd: root, stdio: 'pipe', windowsHide: true });
      const emitter = before ? oldDeclarations : { symbolModuleDeclaration, variationModuleDeclaration };
      for (const name of names) write(join(out, 'symbols', `${name}.d.ts`), emitter.symbolModuleDeclaration(name));
      write(join(out, 'variations/ellipsis-horizontal.d.ts'), emitter.variationModuleDeclaration('ellipsis-horizontal'));
      const consumer = join(sourceRoot, 'consumer'), pkg = join(consumer, 'node_modules/@labpics/icons');
      write(join(consumer, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
      write(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', exports: {
        './ir': { types: './dist/ir/index.d.ts' }, './ir/recipes': { types: './dist/ir/recipes.d.ts' },
        './motion': { types: './dist/motion/index.d.ts' },
        './symbols/*': { types: './dist/symbols/*.d.ts' }, './variations/*': { types: './dist/variations/*.d.ts' } } }));
      const emitted = files(out), consumers = {};
      for (const mode of ['Bundler', 'NodeNext']) {
        consumers[mode] = { positive: diagnostics(consumer, mode, positive), negative: diagnostics(consumer, mode, negative),
          augmentation: diagnostics(consumer, mode, augmentation), augmentationNegative: diagnostics(consumer, mode, augmentationNegative),
          motionAugmentation: diagnostics(consumer, mode, motionAugmentation),
          motionAugmentationNegative: diagnostics(consumer, mode, motionAugmentationNegative) };
        assert.deepEqual(consumers[mode].positive.codes, [], consumers[mode].positive.output);
        assert.deepEqual(consumers[mode].negative.codes, [2322, 2322, 2345, 2339, 2345, 2345], consumers[mode].negative.output);
        assert.deepEqual(consumers[mode].augmentation.codes, [], consumers[mode].augmentation.output);
        assert.deepEqual(consumers[mode].augmentationNegative.codes, [2322, 2322, 2322, 2322], consumers[mode].augmentationNegative.output);
        assert.deepEqual(consumers[mode].motionAugmentation.codes, [], consumers[mode].motionAugmentation.output);
        assert.deepEqual([...consumers[mode].motionAugmentationNegative.codes].sort(),
          [2687, 2687, 2687, 2687, 2687, 2687, 2717, 2717, 2717], consumers[mode].motionAugmentationNegative.output);
      }
      observations[label] = { artifacts: Object.fromEntries(Object.entries(emitted).map(([file, text]) => [file, measure(text)])),
        closures: Object.fromEntries(Object.entries({ source: ['symbols/ellipse.d.ts'], variation: ['variations/ellipsis-horizontal.d.ts'],
          compiler: ['ir/index.d.ts'], recipes: ['ir/recipes.d.ts'], all: Object.keys(emitted) }).map(([name, entries]) => [name, closure(emitted, entries)])),
        consumers, emitted };
    }
    const findings = [];
    for (const mode of ['Bundler', 'NodeNext']) if (baseline !== null && JSON.stringify(observations.actual.consumers[mode].augmentation.codes) !==
      JSON.stringify(observations.baseline.consumers[mode].augmentation.codes)) findings.push(`augmentation regression ${mode}`);
    for (const name of ['source', 'variation']) {
      assert.ok(!observations.actual.closures[name].files.includes('ir/compiler.d.ts'));
      assert.ok(!observations.actual.closures[name].files.includes('ir/recipes.d.ts'));
    }
    const report = { baseline, sourceSha: git(['rev-parse', 'HEAD']).trim(), capturedAt: new Date().toISOString(),
      scope: 'two families; actual declaration emit and public type consumers; no runtime/build/pack/browser/timing qualification',
      environment: { node: process.version, typescript: JSON.parse(readFileSync(join(root, 'node_modules/typescript/package.json'))).version,
        platform: process.platform, arch: process.arch, gzip: { fflate: '0.8.3', level: 9, mtime: 0 }, brotli: process.versions.brotli, quality: 11 },
      sourceDigests: Object.fromEntries([...new Set([...snapshotFiles, 'src/ir/glyph-types.ts', 'src/ir/paint-types.ts', 'src/ir/author-annulus-types.ts', 'scripts/lib/symbol-modules.js'])].map(file => [file, hash(readSnapshot(file, false))])), observations, findings };
    return report;
  } finally { rmSync(temporary, { recursive: true, force: true }); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await checkGlyphTypeBoundary({ baseline: process.argv[2] });
  if (process.argv[3]) writeFileSync(process.argv[3], `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ findings: report.findings,
    closures: Object.fromEntries(Object.entries(report.observations).map(([name, item]) => [name, item.closures])) }));
  if (report.findings.length) process.exitCode = 1;
}
