import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { gzipSync } from 'fflate';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundle } from '../scripts/build-ir.mjs';
import { optimize } from 'svgo';

const root = fileURLToPath(new URL('..', import.meta.url));
const baseline = process.env.LAB_ICONS_COMPILER_BASELINE ?? '8fbb434';
const svgo = createRequire(import.meta.url)(join(root, 'svgo.config.cjs'));
const npmExecutable = process.platform === 'win32'
  ? join(dirname(execFileSync('where.exe', ['npm.cmd'], { encoding: 'utf8', windowsHide: true }).trim().split(/\r?\n/)[0]), 'node_modules/npm/bin/npm-cli.js')
  : execFileSync('which', ['npm'], { encoding: 'utf8' }).trim();
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const write = (file, contents) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, contents); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const size = code => ({ bytes: Buffer.byteLength(code), gzipBytes: gzipSync(Buffer.from(code), { level: 9, mtime: 0 }).length });
const options = { bundle: true, charset: 'utf8', format: 'esm', legalComments: 'none', logLevel: 'silent',
  minify: false, minifyWhitespace: true, platform: 'browser', target: 'es2022', treeShaking: true, write: false };
let temporary, current, previous;
const errorResult = fn => {
  try { fn(); return null; } catch (error) { return { name: error.name, message: error.message, code: error.code }; }
};

async function slice(label, old = false) {
  const consumer = join(temporary, label), producer = join(temporary, `${label}-producer`);
  let pkg = producer;
  mkdirSync(join(pkg, 'dist/ir'), { recursive: true });
  const manifest = read('package.json');
  write(join(pkg, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version,
    type: manifest.type, sideEffects: manifest.sideEffects, files: ['dist'],
    exports: { '.': manifest.exports['.'], './ir': manifest.exports['./ir'] } }));
  const variants = { Outline: 'outline', Filled: 'filled' };
  write(join(pkg, 'dist/index.js'), ['reload', 'calendar-number', 'calendar-clear', 'time'].flatMap(icon =>
    Object.entries(variants).map(([directory, variant]) => {
      const file = join(root, read('semantics/catalog.json').icons[icon].source[variant].file);
      return `export const ${icon.replace(/-([a-z])/g, (_, c) => c.toUpperCase())}${directory} = ${JSON.stringify(optimize(readFileSync(file, 'utf8'), { ...svgo, path: file }).data)};`;
    })).join('\n'));
  await bundle(root, join(pkg, 'dist'), 'src/ir/request.ts', 'ir/request.js');
  for (const [entry, external] of [['compiler', ['./request.js']], ['index', ['@labpics/icons', './compiler.js']]]) {
    if (old) {
      const contents = execFileSync('git', ['show', `${baseline}:src/ir/${entry}.ts`], { cwd: root, encoding: 'utf8', windowsHide: true });
      const result = await build({ ...options, absWorkingDir: root, metafile: true,
        stdin: { contents, resolveDir: join(root, 'src/ir'), sourcefile: join(root, `src/ir/${entry}.ts`), loader: 'ts' }, external });
      const modules = Object.entries(Object.values(result.metafile.outputs)[0].inputs)
        .filter(([, input]) => input.bytesInOutput > 0).map(([name]) => name).sort();
      write(join(pkg, `dist/ir/${entry}.js`), modules.map(name => `// ${name}\n`).join('') + result.outputFiles[0].text);
    } else await bundle(root, join(pkg, 'dist'), `src/ir/${entry}.ts`, `ir/${entry}.js`, external);
  }
  const declarations = {};
  if (!old) {
    const staticTypes = join(producer, 'dist/index.d.ts');
    write(staticTypes, 'export const reloadOutline: string;\n');
    const config = join(producer, 'tsconfig.json');
    write(config, JSON.stringify({ extends: join(root, 'tsconfig.json'), include: [],
      files: [join(root, 'src/ir/compiler.ts'), join(root, 'src/ir/index.ts')],
      compilerOptions: { noEmit: false, declaration: true, emitDeclarationOnly: true, rootDir: root,
        outDir: join(producer, 'declarations'), paths: { '@labpics/icons': [staticTypes] } } }));
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project', config],
      { cwd: root, encoding: 'utf8', windowsHide: true });
    for (const name of readdirSync(join(producer, 'declarations/src/ir')).filter(name => name.endsWith('.d.ts'))) {
      const code = readFileSync(join(producer, 'declarations/src/ir', name), 'utf8');
      write(join(pkg, 'dist/ir', name), code);
      if (['compiler.d.ts', 'index.d.ts'].includes(name)) declarations[name] = { ...size(code), sha256: sha256(code) };
    }
    for (const [name, measured] of Object.entries(declarations)) {
      const limit = read('release/package-size-ratchet.json').artifacts[`dist/ir/${name}`];
      expect(measured.bytes).toBeLessThanOrEqual(limit.maxBytes);
      expect(measured.gzipBytes).toBeLessThanOrEqual(limit.maxGzipBytes);
    }
  }
  const packed = JSON.parse(execFileSync(process.execPath, [npmExecutable, 'pack', '--ignore-scripts', '--json'],
    { cwd: producer, encoding: 'utf8', windowsHide: true }))[0];
  const tarball = join(producer, packed.filename);
  write(join(consumer, 'package.json'), JSON.stringify({ name: `compiler-${label}-consumer`, private: true, type: 'module' }));
  execFileSync(process.execPath, [npmExecutable, 'install', '--offline', '--ignore-scripts', '--no-package-lock', '--no-audit', '--no-fund', tarball],
    { cwd: consumer, encoding: 'utf8', windowsHide: true });
  pkg = join(consumer, 'node_modules/@labpics/icons');
  for (const file of ['dist/index.js', 'dist/ir/index.js', 'dist/ir/compiler.js', 'dist/ir/request.js']) {
    expect(sha256(readFileSync(join(pkg, file)))).toBe(sha256(readFileSync(join(producer, file))));
  }
  const compilerBytes = readFileSync(join(pkg, 'dist/ir/compiler.js'));
  const nativeCompiler = { ...size(compilerBytes), sha256: sha256(compilerBytes) };
  if (!old) {
    const limit = read('release/package-size-ratchet.json').artifacts['dist/ir/compiler.js'];
    expect(nativeCompiler.bytes).toBeLessThanOrEqual(limit.maxBytes);
    expect(nativeCompiler.gzipBytes).toBeLessThanOrEqual(limit.maxGzipBytes);
    write(join(consumer, 'types.mts'), `import { glyph, parseGlyphRequest, type GlyphIR, type IconId } from '@labpics/icons/ir';
const value: GlyphIR = glyph({ icon: 'time', variant: 'filled', axes: { opsz: 24 } });
const id: IconId = parseGlyphRequest({ icon: 'reload' }).icon;
// @ts-expect-error — неизвестное имя не входит в публичный каталог.
glyph({ icon: 'unknown-icon' });
// @ts-expect-error — variant сохраняет исходный закрытый контракт.
glyph({ icon: id, variant: 'solid' });
// @ts-expect-error — значения осей обязаны быть числами.
glyph({ icon: id, axes: { opsz: 'large' } });
// @ts-expect-error — приватная сессия не экспортируется публичным entrypoint.
import { createGlyphCompilerSession } from '@labpics/icons/ir';
void value;
`);
    const typeConfig = join(consumer, 'tsconfig.json');
    write(typeConfig, JSON.stringify({ files: ['types.mts'], compilerOptions: {
      strict: true, noEmit: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'bundler', types: [], skipLibCheck: false } }));
    execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--project', typeConfig],
      { cwd: consumer, encoding: 'utf8', windowsHide: true });
  }
  const entries = {
    glyph: 'import { glyph } from "@labpics/icons/ir"; export const value = glyph({icon:"reload", modelMode:"source-only"});',
    capabilities: 'import { glyphCapabilities } from "@labpics/icons/ir"; export const value = glyphCapabilities("time");',
    calendar: 'import { calendarNumberGlyph } from "@labpics/icons/ir"; export const value = calendarNumberGlyph({date:new Date("2026-11-02T00:00:00Z"),timeZone:"UTC"});',
    parse: 'import { parseGlyphRequest } from "@labpics/icons/ir"; export const value = parseGlyphRequest({icon:"reload"});',
    namespace: 'import * as ir from "@labpics/icons/ir"; export { ir };',
  };
  const scenarios = {};
  for (const [name, entry] of Object.entries(entries)) {
    write(join(consumer, `${name}.mjs`), entry);
    const result = await build({ absWorkingDir: consumer, entryPoints: [join(consumer, `${name}.mjs`)],
      bundle: true, minify: true, treeShaking: true, format: 'esm', platform: 'browser', target: 'es2022',
      metafile: true, write: false, logLevel: 'silent' });
    const code = result.outputFiles[0].text;
    const diagnostic = await build({ absWorkingDir: consumer, entryPoints: [join(consumer, `${name}.mjs`)],
      bundle: true, minify: false, treeShaking: true, format: 'esm', platform: 'browser', target: 'es2022',
      write: false, logLevel: 'silent' });
    const output = join(consumer, `${name}-bundle.mjs`);
    write(output, code);
    scenarios[name] = { ...size(code), sha256: sha256(code), code, diagnostic: diagnostic.outputFiles[0].text,
      contributed: Object.values(result.metafile.outputs)[0].inputs,
      module: await import(pathToFileURL(output).href) };
  }
  return { consumer, pkg, scenarios, nativeCompiler, declarations, tarball: { sha256: sha256(readFileSync(tarball)), files: packed.files.map(file => file.path) }, native: await import(pathToFileURL(join(pkg, 'dist/ir/index.js')).href),
    compiler: await import(pathToFileURL(join(pkg, 'dist/ir/compiler.js')).href) };
}

beforeAll(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'lab-icons-compiler-entries-'));
  current = await slice('current');
  previous = await slice('baseline', true);
  if (process.env.LAB_ICONS_COMPILER_REPORT) {
    const recorded = item => ({ tarball: item.tarball, nativeCompiler: item.nativeCompiler, declarations: item.declarations, scenarios: Object.fromEntries(Object.entries(item.scenarios).map(([name, scenario]) => [name,
      { bytes: scenario.bytes, gzipBytes: scenario.gzipBytes, sha256: scenario.sha256, contributed: scenario.contributed,
        retainedFunctions: Object.fromEntries(['calendarNumberGlyph', 'compileCalendarNumberGlyph', 'motionCapabilities', 'registerCandidateAnatomy', 'registerCandidateAnatomyValue'].map(name =>
          [name, scenario.diagnostic.includes(`function ${name}(`)])) }])) });
    write(process.env.LAB_ICONS_COMPILER_REPORT, JSON.stringify({ capturedAt: new Date().toISOString(), baseline,
      scope: 'production compiler/index/request emit, npm pack and offline install in isolated external consumer; bounded static source fixture; no full build, registry parity or full-consumer ratchet qualification',
      environment: { node: process.version, esbuild: '0.28.1', platform: process.platform, arch: process.arch },
      sourceDigests: Object.fromEntries(['src/ir/compiler.ts', 'src/ir/index.ts', 'test/compiler-entrypoints.test.js',
        'scripts/build-ir.mjs', 'svgo.config.cjs', 'semantics/catalog.json', 'semantics/grid.json',
        'semantics/anatomy.runtime.json', 'semantics/anatomy.candidates.json', 'semantics/candidate-variants.json',
        'release/package-size-ratchet.json'].map(file => [file, sha256(readFileSync(join(root, file)))])),
      current: recorded(current), previous: recorded(previous) }, null, 2) + '\n');
  }
}, 120_000);

afterAll(() => {
  if (!temporary) return;
  expect(dirname(temporary)).toBe(resolve(tmpdir()));
  expect(temporary.startsWith(join(tmpdir(), 'lab-icons-compiler-entries-'))).toBe(true);
  rmSync(temporary, { recursive: true, force: true });
});

describe('отдельные exports полного IR', () => {
  it('glyph consumer удаляет calendar recipe и writer capabilities', () => {
    expect(previous.scenarios.glyph.code.includes('calendar-number-v1')).toBe(true);
    expect(previous.scenarios.glyph.diagnostic.includes('function motionCapabilities(')).toBe(true);
    expect(current.scenarios.glyph.code.includes('calendar-number-v1')).toBe(false);
    expect(current.scenarios.glyph.diagnostic.includes('function motionCapabilities(')).toBe(false);
    expect(current.scenarios.glyph.diagnostic.includes('function registerCandidateAnatomyValue(')).toBe(false);
    expect(current.scenarios.glyph.bytes).toBeLessThan(previous.scenarios.glyph.bytes);
    expect(current.scenarios.glyph.gzipBytes).toBeLessThan(previous.scenarios.glyph.gzipBytes);
  });

  it('parser consumer удаляет построение SVG, calendar и motion capabilities', () => {
    expect(current.scenarios.parse.code.includes('calendar-number-v1')).toBe(false);
    expect(current.scenarios.parse.code.includes('fingerprint drift')).toBe(false);
    expect(current.scenarios.parse.diagnostic.includes('function motionCapabilities(')).toBe(false);
  });

  it('bounded consumers сохраняют исходные значения', () => {
    for (const name of ['glyph', 'parse', 'capabilities', 'calendar']) {
      expect(current.scenarios[name].module.value).toEqual(previous.scenarios[name].module.value);
    }
    expect(Object.keys(current.scenarios.namespace.module.ir)).toEqual(Object.keys(previous.scenarios.namespace.module.ir));
    for (const name of ['glyph', 'glyphCapabilities', 'parseGlyphRequest', 'parseIconId', 'isIconId', 'registerCandidateAnatomy', 'calendarNumberGlyph']) {
      expect(current.native[name].name).toBe(previous.native[name].name);
      expect(current.native[name].length).toBe(previous.native[name].length);
    }
  });

  it('полный constructor сохраняет фасад, чтение getters, field order и frozen snapshots', async () => {
    const observed = async item => {
      const events = [], values = { catalog: read('semantics/catalog.json'), anatomy: read('semantics/anatomy.runtime.json'),
        grid: read('semantics/grid.json'), staticIcons: await import(pathToFileURL(join(item.pkg, 'dist/index.js')).href) };
      const catalog = values.catalog, grid = values.grid;
      values.catalog = new Proxy(catalog, { get(target, key) { events.push(`catalog.${String(key)}`); return target[key]; } });
      values.grid = new Proxy(grid, { get(target, key) { events.push(`grid.${String(key)}`); return target[key]; } });
      const input = Object.fromEntries(Object.keys(values).map(key => [key, null]));
      for (const key of Object.keys(values)) Object.defineProperty(input, key, { enumerable: true, get() { events.push(`input.${key}`); return values[key]; } });
      const facade = item.compiler.createGlyphCompiler(input);
      return { facade, events };
    };
    const candidate = await observed(current), control = await observed(previous);
    expect(candidate.events).toEqual(control.events);
    expect(Object.keys(candidate.facade)).toEqual(Object.keys(control.facade));
    for (const name of Object.keys(control.facade)) {
      const actual = candidate.facade[name], old = control.facade[name];
      if (typeof old === 'function') {
        expect({ name: actual.name, length: actual.length }).toEqual({ name: old.name, length: old.length });
      } else expect(actual).toEqual(old);
    }
    expect(Object.isFrozen(candidate.facade)).toBe(true);
    expect(candidate.facade.iconDesignContract.axes).toBe(candidate.facade.axisContracts);
    for (const variant of ['outline', 'filled']) {
      for (const request of [{ icon: 'reload', variant, modelMode: 'source-only' }, { icon: 'time', variant }]) {
        const actual = candidate.facade.glyph(request), old = control.facade.glyph(request);
        expect(actual).toEqual(old);
        expect(Object.keys(actual)).toEqual(Object.keys(old));
        actual.parts.forEach((part, index) => expect(Object.keys(part)).toEqual(Object.keys(old.parts[index])));
      }
    }
    for (const request of [null, { icon: 'reload', variant: 'solid' }, { icon: 'reload', typo: true },
      { icon: 'reload', axes: { opsz: 25 } }, { icon: 'reload', modelMode: 'allow-candidate' }]) {
      expect(errorResult(() => candidate.facade.glyph(request))).toEqual(errorResult(() => control.facade.glyph(request)));
    }
  });

  it('раздельные reader/writer используют одну сессию и не открывают другую', async () => {
    const input = { catalog: read('semantics/catalog.json'), anatomy: read('semantics/anatomy.runtime.json'),
      grid: read('semantics/grid.json'), staticIcons: await import(pathToFileURL(join(current.pkg, 'dist/index.js')).href) };
    const first = current.compiler.createGlyphCompilerSession(input), second = current.compiler.createGlyphCompilerSession(input);
    const glyph = request => current.compiler.compileGlyph(first, request), otherGlyph = request => current.compiler.compileGlyph(second, request);
    const capabilities = (icon, variant) => current.compiler.readGlyphCapabilities(first, icon, variant);
    const registration = (glyphs, variants) => current.compiler.registerCandidateAnatomyValue(first, glyphs, variants);
    const request = { icon: 'reload', modelMode: 'allow-candidate' };
    expect(errorResult(() => glyph(request)).code).toBe('CANDIDATES_REQUIRED');
    registration(read('semantics/anatomy.candidates.json').glyphs, read('semantics/candidate-variants.json').variants);
    const registered = glyph(request);
    expect(registered.provenance.kind).toBe('model');
    registration({ reload: { parts: [] } }, ['reload/outline']);
    expect(glyph(request)).toEqual(registered);
    expect(errorResult(() => otherGlyph(request)).code).toBe('CANDIDATES_REQUIRED');
    for (const [name, axis] of Object.entries(capabilities('chevron-up', 'filled').axes)) expect(axis).toBe(first.axisContracts[name]);
    expect(Object.isFrozen(first.axisContracts.opsz)).toBe(true);
    // Экспорт writer и glyph из одного установленного entrypoint также делят сессию.
    expect(errorResult(() => current.native.glyph(request)).code).toBe('CANDIDATES_REQUIRED');
    current.native.registerCandidateAnatomy(read('semantics/anatomy.candidates.json').glyphs, read('semantics/candidate-variants.json').variants);
    expect(current.native.glyph(request).provenance.kind).toBe('model');
    expect(errorResult(() => previous.native.glyph(request)).code).toBe('CANDIDATES_REQUIRED');
  });

  it('сессия остаётся внутренней границей пакета', () => {
    const result = execFileSync(process.execPath, ['--input-type=module', '-e',
      'try { await import("@labpics/icons/dist/ir/compiler.js"); } catch (error) { process.stdout.write(error.code); }'],
    { cwd: current.consumer, encoding: 'utf8', windowsHide: true });
    expect(result).toBe('ERR_PACKAGE_PATH_NOT_EXPORTED');
    expect(current.native.createGlyphCompilerSession).toBeUndefined();
  });
});
