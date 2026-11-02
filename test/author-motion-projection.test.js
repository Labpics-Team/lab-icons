import { afterAll, describe, expect, it } from 'vitest';
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { authoredSymbolPayloads } from '../scripts/lib/authored-symbol-payload.js';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { authorMotionSymbolNames, projectAuthorMotionSymbol, renderAuthorMotionModule,
  authorMotionModuleDeclaration } from '../scripts/lib/author-motion.js';
import { renderSymbolModules, symbolReleaseProjection } from '../scripts/lib/symbol-modules.js';
import { validateReleaseContract, validateReleaseRuntimeDependencyGraph } from '../scripts/lib/release-contract.js';
import { compileSymbolEffect } from '../src/motion/index.ts';
import { authorPathEntries } from '../src/core/icon-geometry.js';
import { bundle } from '../scripts/build-ir.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const document = read('semantics/author-anatomy.json');
const names = ['reload', 'refresh', 'timer'].sort();
const source = await authoredSymbolPayloads(names);
const rich = await authoredSymbolPayloads(names, { scope: 'motion' });
const packets = Object.fromEntries(names.map(icon => [icon, projectAuthorMotionSymbol(rich[icon], compileSymbolEffect)]));
const fixture = mkdtempSync(join(tmpdir(), 'lab-icons-motion-projection-'));
afterAll(() => rmSync(fixture, { recursive: true, force: true }));

async function importBaseline(file) {
  const contents = execFileSync('git', ['show', `2bf18f9903511d5b0ed703118e7134188253571a:${file}`], { cwd: root, encoding: 'utf8' });
  const result = await build({ stdin: { contents, resolveDir: dirname(join(root, file)) },
    bundle: true, write: false, platform: 'node', format: 'esm', target: 'es2022', logLevel: 'silent' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

async function consume(icon, expression) {
  const result = await build({ stdin: { contents: expression, resolveDir: root },
    bundle: true, write: false, metafile: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'production-motion-projection', setup(builder) {
      builder.onResolve({ filter: /^packet$/ }, () => ({ path: icon, namespace: 'motion-packet' }));
      builder.onLoad({ filter: /.*/, namespace: 'motion-packet' }, () => ({
        contents: renderAuthorMotionModule(packets[icon]).replace('../ir/gesture-runtime.js',
          './src/motion/gesture-runtime.ts'), resolveDir: root, loader: 'js',
      }));
    } }],
  });
  const text = result.outputFiles[0].text;
  const retained = Object.entries(Object.values(result.metafile.outputs)[0].inputs)
    .filter(([, entry]) => entry.bytesInOutput > 0).map(([name]) => name);
  return { module: await import(`data:text/javascript;base64,${Buffer.from(text).toString('base64')}`), text, retained };
}

describe('авторский motion target без стоимости полного IR в consumer', () => {
  it('выбирает только существующий закон и сохраняет default source contracts и module bytes', async () => {
    expect(authorMotionSymbolNames(document)).toEqual(names);
    const manifest = read('semantics/figma-baseline.json');
    const author = loadAuthorBaseline(root, { manifest: { ...manifest, counts: { families: names.length, variants: names.length * 2 },
      icons: Object.fromEntries(names.map(icon => [icon, manifest.icons[icon]])) } });
    const old = await importBaseline('scripts/lib/author-anatomy.js');
    const legacyDocument = { ...document, icons: Object.fromEntries(['reload', 'refresh'].map(icon => [icon, document.icons[icon]])) };
    const selected = { ...document, icons: Object.fromEntries(names.map(icon => [icon, document.icons[icon]])) };
    expect(compileAuthorAnatomy(author, selected)).toEqual(old.compileAuthorAnatomy(author, legacyDocument));
    const oldModules = await importBaseline('scripts/lib/symbol-modules.js');
    for (const icon of names) expect(renderSymbolModules(source[icon])).toEqual(oldModules.renderSymbolModules(source[icon]));
    expect(source.timer.capabilities.outline.motion.state).toBe('source-only');
    expect(source.timer.source.outline.provenance.anatomy).toBeUndefined();
    expect(source.timer.source.filled).toEqual(rich.timer.source.filled);
    const noScope = structuredClone(selected); delete noScope.icons.timer.outline.scope;
    expect(compileAuthorAnatomy(author, noScope)).not.toEqual(compileAuthorAnatomy(author, selected));
  });

  it.each(names)('%s сохраняет настоящие authored paths, правила заливки и порядок', async icon => {
    const { module } = await consume(icon, 'export {renderMotionSvg,motionCapabilities,compileMotionEffect} from "packet";');
    for (const variant of Object.keys(packets[icon].variants)) {
      const rendered = module.renderMotionSvg(variant);
      expect(rendered).toEqual({ ok: true, svg: rich[icon].source[variant].svg });
      const raw = readFileSync(join(root, rich[icon].source[variant].provenance.file), 'utf8');
      expect(authorPathEntries(rendered.svg.replace(/ data-(?:part|role)="[^"]*"/g, '')).map(({ d, fillRule }) => ({ d, fillRule })))
        .toEqual(authorPathEntries(raw).map(({ d, fillRule }) => ({ d, fillRule })));
      const caps = module.motionCapabilities(variant);
      expect(caps.ok).toBe(true);
      expect(caps.capabilities.author).toEqual(rich[icon].source[variant].provenance.author);
      expect(Object.isFrozen(caps.capabilities.author)).toBe(true);
    }
  });

  it.each([[0, 1], [0.4, 0], [0.75, 0.25], [0.25, 0.75], [0.4, 0.4]])('timer %s → %s совпадает с прежним владельцем v1 и явным угловым oracle', async (from, to) => {
    const { module } = await consume('timer', 'export {compileMotionEffect} from "packet";');
    const result = module.compileMotionEffect('timer.advance', { duration: 800, from, to });
    expect(result).toEqual(compileSymbolEffect(rich.timer.source.outline, rich.timer.capabilities.outline,
      'timer.advance', { duration: 800, from, to }));
    expect(result.effect.targets).toEqual([{ partId: 'timer-hand', rotation: { from: 360 * from, to: 360 * to, unit: 'degrees' },
      style: { transformBox: 'view-box', transformOrigin: '50% 50%' },
      keyframes: [{ offset: 0, transform: `rotate(${360 * from}deg)` }, { offset: 1, transform: `rotate(${360 * to}deg)` }] }]);
    expect(result.effect.unchangedPartIds).toEqual(['timer-dial']);
    expect(result.effect.options.duration).toBe(from === to ? 0 : 800);
    expect(Object.isFrozen(result.effect.targets[0].keyframes[0])).toBe(true);
    const reduced = module.compileMotionEffect('timer.advance', { duration: 800, from, to, reducedMotion: true });
    expect(reduced.effect.options.duration).toBe(0);
    expect(reduced.effect.targets).toEqual(result.effect.targets);
  });

  it('старый публичный rotation compiler сохраняет результат и собственные типы', async () => {
    const old = await importBaseline('src/motion/index.ts');
    for (const icon of ['reload', 'refresh']) for (const variant of ['outline', 'filled']) {
      const glyph = source[icon].source[variant], caps = source[icon].capabilities[variant];
      for (const options of [{ duration: 600 }, { duration: 600, from: 0.4, to: 0 },
        { duration: 600, reducedMotion: true }, { duration: 600, from: 0.3, to: 0.3 }]) {
        expect(compileSymbolEffect(glyph, caps, `${icon}.cycle`, options)).toEqual(old.compileSymbolEffect(glyph, caps, `${icon}.cycle`, options));
      }
    }
    const oldTypes = execFileSync('git', ['show', '2bf18f9903511d5b0ed703118e7134188253571a:src/motion/index.ts'], { cwd: root, encoding: 'utf8' });
    const current = readFileSync(join(root, 'src/motion/index.ts'), 'utf8');
    expect(current.slice(current.indexOf('export type SymbolEffectRefusalCode'), current.indexOf('function refuse')))
      .toBe(oldTypes.slice(oldTypes.indexOf('export type SymbolEffectRefusalCode'), oldTypes.indexOf('function refuse')));
  });

  it('вариант, чужой жест и malformed запрос имеют точный отказ', async () => {
    const { module } = await consume('timer', 'export * from "packet";');
    for (const operation of [() => module.renderMotionSvg('filled'), () => module.motionCapabilities('filled'),
      () => module.compileMotionEffect('timer.advance', { duration: 600, variant: 'filled' })]) {
      expect(operation()).toMatchObject({ ok: false, reason: { code: 'VARIANT_UNSUPPORTED' } });
    }
    expect(module.compileMotionEffect('time.advance', { duration: 600 })).toMatchObject({ ok: false, reason: { code: 'GESTURE_UNSUPPORTED' } });
    for (const request of [null, [], {}, { duration: -1 }, { duration: Infinity }, { duration: 600, from: NaN },
      { duration: 600, to: 1.01 }, { duration: 600, reducedMotion: 'yes' }, { duration: 600, loop: true }, { duration: 600, variant: 'other' }]) {
      expect(module.compileMotionEffect('timer.advance', request)).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
    }
  });

  it.each([
    ['чужой master', value => { value.capabilities.outline.author.masterSha256 = '0'.repeat(64); }],
    ['чужой anchor', value => { value.capabilities.outline.motion.gestures[0].tracks[0].anchor[0] = 0.4; }],
    ['чужая part', value => { value.capabilities.outline.motion.gestures[0].tracks[0].partId = 'timer-dial'; }],
    ['compound', value => { value.source.outline.composition = { kind: 'compound', fillRule: 'evenodd' }; }],
    ['чужой SVG', value => { value.source.outline.svg = value.source.outline.svg.replace('timer-hand', 'other-hand'); }],
    ['подменённая geometry', value => { value.source.outline.parts[1].d += 'M0 0L1 1Z'; }],
  ])('%s не получает ложный подготовленный packet', (_, mutate) => {
    const input = structuredClone(rich.timer); mutate(input);
    expect(() => projectAuthorMotionSymbol(input, compileSymbolEffect)).toThrow(TypeError);
  });

  it('PURE consumers не удерживают чужие данные или общий compiler', async () => {
    for (const [entry, forbidden] of [
      ['compileMotionEffect', [rich.timer.source.outline.parts[1].d, rich.timer.capabilities.outline.author.masterSha256, 'timer-dial" data-role']],
      ['renderMotionSvg', ['projectRotationEffect', 'parseEffectRequest', rich.timer.capabilities.outline.author.masterSha256]],
      ['motionCapabilities', [rich.timer.source.outline.parts[1].d, 'projectRotationEffect', 'parseEffectRequest']],
    ]) {
      const { text, retained } = await consume('timer', `export {${entry}} from "packet";`);
      for (const needle of forbidden) expect(text).not.toContain(needle);
      expect(retained.filter(file => file.startsWith('src/'))).not.toEqual([]);
      expect(retained.some(file => /src\/(?:ir|core|authoring)\//.test(file))).toBe(false);
      expect(text).not.toMatch(/createGlyphCompiler|compileSymbolEffect|source-only|require\(/);
    }
  });

  it('exact release projection добавляет и удаляет только действительные motion targets', () => {
    const base = read('release/contract.json');
    const plain = symbolReleaseProjection(base, names);
    const expanded = symbolReleaseProjection(base, names, [], [], [], [], [], [], [], names);
    expect(validateReleaseContract(expanded)).toEqual([]);
    for (const [key, value] of Object.entries(plain.exports)) expect(expanded.exports[key]).toEqual(value);
    expect(expanded.files.filter(file => !plain.files.includes(file))).toEqual([
      ...names.flatMap(icon => [`dist/gestures/${icon}.d.ts`, `dist/gestures/${icon}.js`]),
      'dist/ir/gesture-runtime.js', 'dist/ir/gesture-types.d.ts',
    ].sort());
    expect(plain.runtimeDependencies).not.toContain('dist/ir/gesture-runtime.js');
    expect(() => symbolReleaseProjection(base, names, [], [], [], [], [], [], [], ['other'])).toThrow(TypeError);
    expect(authorMotionModuleDeclaration(packets.timer)).toContain('export type MotionVariant = "outline"');
  });

  it('native consumer использует фактическую ESM closure и публичный entrypoint', async () => {
    const pkg = join(fixture, 'node_modules/@labpics/icons'), out = join(pkg, 'dist');
    mkdirSync(join(out, 'ir'), { recursive: true }); mkdirSync(join(out, 'gestures'), { recursive: true });
    await bundle(root, out, 'src/motion/gesture-runtime.ts', 'ir/gesture-runtime.js');
    writeFileSync(join(out, 'gestures/timer.js'), renderAuthorMotionModule(packets.timer));
    const contract = { exports: { './gestures/timer': { import: './dist/gestures/timer.js' } },
      runtimeDependencies: ['dist/ir/gesture-runtime.js'], files: ['dist/gestures/timer.js', 'dist/ir/gesture-runtime.js'] };
    expect(validateReleaseRuntimeDependencyGraph({ contract, readText: file => readFileSync(join(pkg, file), 'utf8') })).toEqual([]);
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', exports: contract.exports }));
    const entry = join(fixture, 'consumer.mjs');
    writeFileSync(entry, 'export * from "@labpics/icons/gestures/timer";');
    const consumer = await import(pathToFileURL(entry).href);
    expect(consumer.renderMotionSvg()).toEqual({ ok: true, svg: rich.timer.source.outline.svg });
    expect(consumer.compileMotionEffect('timer.advance', { duration: 700, from: 0.4, to: 0 }).effect.targets[0].rotation)
      .toEqual({ from: 144, to: 0, unit: 'degrees' });
  });
});
