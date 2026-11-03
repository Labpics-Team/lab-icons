import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { gzipSync } from 'fflate';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bundle } from '../scripts/build-ir.mjs';
import { renderSymbolModules } from '../scripts/lib/symbol-modules.js';
import { runtimeModuleSpecifiers } from '../scripts/lib/release-contract.js';
import { authoredSymbolPayloads } from './helpers/authored-symbol-payload.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const baseline = process.env.LAB_ICONS_POLICY_BASELINE;
const reportPath = process.env.LAB_ICONS_POLICY_REPORT;
const ratchet = JSON.parse(readFileSync(join(root, 'release/consumer-size-ratchet.json'), 'utf8'));
const ratchetNames = ['glyph-one', 'authored-time', 'authored-static'];
const write = (file, contents) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, contents); };
const measure = bytes => ({ bytes: Buffer.byteLength(bytes), gzipBytes: gzipSync(Buffer.from(bytes), { level: 9, mtime: 0 }).length });
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8', windowsHide: true });
let temporary, payload, payloads, candidate, previous;

function nativeClosure(packageRoot, entry) {
  const files = new Map();
  function visit(file) {
    if (files.has(file)) return;
    const code = readFileSync(file, 'utf8'), parsed = runtimeModuleSpecifiers(code);
    expect(parsed.errors).toEqual([]);
    const imports = parsed.specifiers.map(specifier => {
      expect(specifier.startsWith('.')).toBe(true);
      const imported = resolve(dirname(file), specifier);
      expect(relative(packageRoot, imported).startsWith('..')).toBe(false);
      return imported;
    });
    files.set(file, { ...measure(code), sha256: sha256(code), imports });
    imports.forEach(visit);
  }
  visit(entry);
  const artifacts = Object.fromEntries([...files].map(([file, data]) => [relative(packageRoot, file).replaceAll('\\', '/'),
    { ...data, imports: data.imports.map(imported => relative(packageRoot, imported).replaceAll('\\', '/')) }]));
  return { artifacts, individualModuleTotals: Object.values(artifacts).reduce((total, data) =>
    ({ bytes: total.bytes + data.bytes, gzipBytes: total.gzipBytes + data.gzipBytes }), { bytes: 0, gzipBytes: 0 }) };
}

async function consumerBundle(consumerRoot, entry, execute = true) {
  const compiled = await build({ absWorkingDir: consumerRoot, entryPoints: [join(consumerRoot, entry)],
    bundle: true, minify: true, treeShaking: true, format: 'esm', platform: 'browser', target: 'es2022',
    metafile: true, write: false, logLevel: 'silent' });
  const code = compiled.outputFiles[0].text;
  const contributed = Object.entries(Object.values(compiled.metafile.outputs)[0].inputs)
    .filter(([file, input]) => file.includes('node_modules/@labpics/icons/') && input.bytesInOutput > 0)
    .map(([file, input]) => ({ file: file.replace(/^.*node_modules\/@labpics\/icons\//, ''), bytes: input.bytesInOutput }));
  return { ...measure(code), sha256: sha256(code), contributed,
    ...(execute && { module: await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) }), code };
}

async function installedSlice(label, emit) {
  const consumerRoot = join(temporary, label), packageRoot = join(consumerRoot, 'node_modules/@labpics/icons');
  mkdirSync(join(packageRoot, 'dist/ir'), { recursive: true });
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  write(join(packageRoot, 'package.json'), JSON.stringify({ name: manifest.name, version: manifest.version,
    type: manifest.type, sideEffects: manifest.sideEffects, exports: { './symbols/*': manifest.exports['./symbols/*'] } }));
  for (const [icon, item] of Object.entries(payloads)) {
    const modules = renderSymbolModules(item);
    write(join(packageRoot, `dist/symbols/${icon}.js`), modules.symbol);
    if (modules.data) write(join(packageRoot, `dist/ir/symbol-data/${icon}.js`), modules.data);
  }
  await emit(join(packageRoot, 'dist'));
  write(join(consumerRoot, 'direct.mjs'), 'export { glyph, glyphCapabilities, outline, filled } from "@labpics/icons/symbols/plus-circle";');
  write(join(consumerRoot, 'glyph.mjs'), 'import { glyph } from "@labpics/icons/symbols/plus-circle"; export const value = glyph();');
  write(join(consumerRoot, 'static.mjs'), 'import { outline } from "@labpics/icons/symbols/plus-circle"; export const value = outline;');
  const direct = await import(pathToFileURL(join(consumerRoot, 'direct.mjs')).href);
  const nativeFunctions = JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e',
    `const { glyph, glyphCapabilities } = await import(${JSON.stringify(pathToFileURL(join(consumerRoot, 'direct.mjs')).href)});` +
    'process.stdout.write(JSON.stringify({glyph:{name:glyph.name,length:glyph.length},glyphCapabilities:{name:glyphCapabilities.name,length:glyphCapabilities.length}}));'],
  { cwd: consumerRoot, encoding: 'utf8', windowsHide: true }));
  const scenarios = {}, symbols = {};
  for (const name of ratchetNames) {
    write(join(consumerRoot, `${name}.mjs`), ratchet.scenarios[name].entry);
    scenarios[name] = await consumerBundle(consumerRoot, `${name}.mjs`, false);
  }
  for (const icon of ['alert', 'time']) {
    write(join(consumerRoot, `direct-${icon}.mjs`),
      `export { glyph, glyphCapabilities, outline, filled } from "@labpics/icons/symbols/${icon}";`);
    symbols[icon] = await import(pathToFileURL(join(consumerRoot, `direct-${icon}.mjs`)).href);
  }
  return { consumerRoot, packageRoot, direct, nativeFunctions, glyph: await consumerBundle(consumerRoot, 'glyph.mjs'),
    static: await consumerBundle(consumerRoot, 'static.mjs'),
    native: nativeClosure(packageRoot, join(packageRoot, 'dist/symbols/plus-circle.js')), scenarios, symbols };
}

beforeAll(async () => {
  temporary = mkdtempSync(join(tmpdir(), 'lab-icons-runtime-policy-'));
  payloads = await authoredSymbolPayloads(['plus-circle', 'alert', 'time']);
  payload = payloads['plus-circle'];
  candidate = await installedSlice('current', async staging => {
    await bundle(root, staging, 'src/ir/request.ts', 'ir/request.js');
    await bundle(root, staging, 'src/ir/author-request-runtime.ts', 'ir/author-request-runtime.js', ['./request.js']);
    await bundle(root, staging, 'src/ir/symbol-runtime.ts', 'ir/symbol-runtime.js', ['./request.js', './author-request-runtime.js']);
  });
  if (baseline) {
    expect(baseline).toMatch(/^[a-f0-9]{40}$/);
    const snapshot = join(temporary, 'baseline-source');
    for (const file of ['src/ir/request.ts', 'src/ir/author-request-runtime.ts', 'src/ir/symbol-runtime.ts', 'src/ir/catalog.generated.ts', 'tsconfig.json']) {
      write(join(snapshot, file), git(['show', `${baseline}:${file}`]));
    }
    // Один production compiler для двух исходников: lexical dependencies не
    // извлекаются из чужой функции, policy delta не смешивается с runtime delta.
    previous = await installedSlice('baseline', async staging => {
      await bundle(snapshot, staging, 'src/ir/request.ts', 'ir/request.js');
      await bundle(snapshot, staging, 'src/ir/author-request-runtime.ts', 'ir/author-request-runtime.js', ['./request.js']);
      await bundle(snapshot, staging, 'src/ir/symbol-runtime.ts', 'ir/symbol-runtime.js', ['./request.js', './author-request-runtime.js']);
    });
  }
  if (reportPath) {
    const recorded = item => ({ nativeFunctions: item.nativeFunctions, native: item.native,
      glyph: { ...measure(item.glyph.code), sha256: item.glyph.sha256, contributed: item.glyph.contributed },
      static: { ...measure(item.static.code), sha256: item.static.sha256, contributed: item.static.contributed },
      scenarios: Object.fromEntries(Object.entries(item.scenarios).map(([name, result]) => [name,
        { entry: ratchet.scenarios[name].entry, maxBytes: ratchet.scenarios[name].maxBytes,
          maxGzipBytes: ratchet.scenarios[name].maxGzipBytes, ...measure(result.code),
          sha256: result.sha256, contributed: result.contributed }])) });
    const files = ['scripts/build-ir.mjs', 'scripts/lib/symbol-modules.js', 'src/ir/request.ts',
      'src/ir/author-request-runtime.ts', 'src/ir/symbol-runtime.ts', 'test/compiled-runtime-policy.test.js',
      'test/helpers/authored-symbol-payload.js', 'release/consumer-size-ratchet.json'];
    write(reportPath, JSON.stringify({ capturedAt: new Date().toISOString(), head: git(['rev-parse', 'HEAD']).trim(), baseline,
      scope: 'isolated installed-layout slice; three real authored families; exact canonical alert/time entries; same payload, current symbol emitter and current production build policy for both frozen runtime sources; no full build, pack, registry install, browser or timing qualification',
      environment: { node: process.version, esbuild: '0.28.1', gzip: { fflate: '0.8.3', level: 9, mtime: 0 }, platform: process.platform, arch: process.arch },
      sourceDigests: Object.fromEntries(files.map(file => [file, sha256(readFileSync(join(root, file)))])),
      candidate: recorded(candidate), ...(previous && { previous: recorded(previous) }) }, null, 2) + '\n');
  }
});

afterAll(() => {
  if (temporary) {
    expect(dirname(temporary)).toBe(resolve(tmpdir()));
    expect(temporary.startsWith(join(tmpdir(), 'lab-icons-runtime-policy-'))).toBe(true);
    rmSync(temporary, { recursive: true, force: true });
  }
});

describe('настоящий компактный build в отдельном symbol consumer', () => {
  it.each(ratchetNames)('%s удерживает исходный consumer-size-ratchet на точном entry', name => {
    const actual = candidate.scenarios[name], limit = ratchet.scenarios[name];
    expect(actual.bytes).toBeLessThanOrEqual(limit.maxBytes);
    expect(actual.gzipBytes).toBeLessThanOrEqual(limit.maxGzipBytes);
    if (previous) {
      const icon = name === 'glyph-one' ? 'alert' : 'time';
      expect(candidate.symbols[icon].glyph()).toEqual(previous.symbols[icon].glyph());
      expect(candidate.symbols[icon].outline).toBe(previous.symbols[icon].outline);
      expect(candidate.symbols[icon].filled).toBe(previous.symbols[icon].filled);
    }
  });

  it('сохраняет имена, arity, frozen identity и буквальный SVG в native import', () => {
    const { glyph, glyphCapabilities, outline, filled } = candidate.direct;
    expect(candidate.nativeFunctions).toEqual({ glyph: { name: 'glyph', length: 1 }, glyphCapabilities: { name: 'glyphCapabilities', length: 1 } });
    expect([glyph.name, glyphCapabilities.name]).toEqual(['glyph', 'glyphCapabilities']);
    expect([glyph.length, glyphCapabilities.length]).toEqual([1, 1]);
    expect([outline, filled]).toEqual([payload.staticSvg.outline, payload.staticSvg.filled]);
    expect(glyph().svg).toBe(payload.source.outline.svg);
    expect(glyph()).toBe(glyph({ modelMode: 'source-only' }));
    expect(Object.isFrozen(glyph().parts)).toBe(true);
    expect(Object.isFrozen(glyph().parts[0].provenance)).toBe(true);
    expect(Object.isFrozen(glyphCapabilities())).toBe(true);
    expect(glyphCapabilities()).not.toHaveProperty('variation');
  });

  it('сохраняет исходные getters, Filled selection и точные отказы после emit', () => {
    const { glyph, glyphCapabilities } = candidate.direct;
    class Request { #variant = 'filled'; get variant() { return this.#variant; } }
    expect(glyph(new Request())).toBe(glyph({ variant: 'filled' }));
    expect(glyph(Object.defineProperty({}, 'variant', { value: 'filled' })).variant).toBe('filled');
    for (const request of [{ variant: 'filled', variation: {} }, { variation: undefined }]) {
      expect(() => glyph(request)).toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
    }
    for (const request of [{ axes: { weight: 1.1 } }, Object.create({ modelMode: 'allow-candidate' })]) {
      expect(() => glyph(request)).toThrow(expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
    }
    for (const request of [null, [], { variant: null }, { axes: null }, { unexpected: 1 }]) {
      expect(() => glyph(request)).toThrow(TypeError);
    }
    expect(() => glyphCapabilities(null)).toThrow(TypeError);
  });

  it('literal-only bundle удаляет admission, runtime и semantic metadata', () => {
    expect(candidate.static.module.value).toBe(payload.staticSvg.outline);
    expect(candidate.static.contributed.every(item => item.file === 'dist/ir/symbol-data/plus-circle.js')).toBe(true);
    expect(candidate.static.contributed).toHaveLength(1);
    expect(candidate.static.code).not.toContain(payload.source.outline.provenance.author.masterSha256);
    // Положительный контроль: glyph действительно удерживает semantic runtime.
    expect(candidate.glyph.module.value).toEqual(payload.source.outline);
    expect(candidate.glyph.contributed.some(item => item.file === 'dist/ir/author-request-runtime.js')).toBe(true);
    expect(candidate.glyph.code).toContain(payload.source.outline.provenance.author.masterSha256);
  });

  it('native closure учитывает новый import hop и сравнивает одинаковый consumer', () => {
    const source = candidate.native.artifacts['dist/ir/symbol-runtime.js'];
    expect(source.imports).toContain('dist/ir/author-request-runtime.js');
    expect(candidate.native.artifacts['dist/ir/author-request-runtime.js'].imports).toEqual(['dist/ir/request.js']);
    if (previous) {
      expect(candidate.direct.glyph()).toEqual(previous.direct.glyph());
      expect(candidate.direct.glyphCapabilities()).toEqual(previous.direct.glyphCapabilities());
      expect(candidate.glyph.module.value).toEqual(previous.glyph.module.value);
      expect(candidate.static.code).toBe(previous.static.code);
    }
  });
});
