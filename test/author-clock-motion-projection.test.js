import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { describe, expect, it } from 'vitest';
import { compileAuthorAnatomy, AuthorAnatomyError } from '../scripts/lib/author-anatomy.js';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { authorClockMotionSymbolNames, compileAuthorClockMotionSymbols, renderAuthorClockMotionModule,
  authorClockMotionModuleDeclaration } from '../scripts/lib/author-clock-motion.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const captured = read('semantics/author-anatomy.json');
const document = { ...captured, icons: { time: captured.icons.time, history: captured.icons.history } };
const manifest = read('semantics/figma-baseline.json');
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest, counts: { families: 2, variants: 4 },
  icons: { time: manifest.icons.time, history: manifest.icons.history } } });
const grid = read('semantics/grid.json');
const catalog = read('semantics/catalog.json');
const compile = (spec = document, factory = createGlyphCompiler) => compileAuthorClockMotionSymbols(baseline, spec,
  { grid, catalog, createGlyphCompiler: factory });
const payloads = compile();
const positive = [
  { icon: 'time', variant: 'outline', pathIndex: 0 },
  { icon: 'history', variant: 'outline', pathIndex: 1 },
  { icon: 'history', variant: 'filled', pathIndex: 1 },
];
// Oracle читает captured literals независимо от compiler SVG assembly.
const rawPaths = svg => [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
  d: /\bd="([^"]+)"/.exec(tag)[1],
  fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
  id: /\bdata-part="([^"]+)"/.exec(tag)?.[1] ?? null,
}));
const drawing = svg => rawPaths(svg).map(({ d, fillRule }) => ({ d, fillRule }));

async function emitted(payload, exported = '*', source = renderAuthorClockMotionModule(payload)) {
  const output = await build({ stdin: {
    contents: exported === '*' ? 'export * from "clock-target";' : `export { ${exported} } from "clock-target";`,
    loader: 'js', resolveDir: root,
  }, bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022',
  logLevel: 'silent', metafile: true,
  plugins: [{ name: 'authored-clock-target', setup(plugin) {
    plugin.onResolve({ filter: /^clock-target$/ }, () => ({ path: payload.icon, namespace: 'clock-target' }));
    plugin.onLoad({ filter: /.*/, namespace: 'clock-target' }, () => ({ contents: source, loader: 'js', resolveDir: root }));
    plugin.onResolve({ filter: /clock-motion-runtime\.js$/ }, () => ({ path: join(root, 'src/ir/author-clock-motion-runtime.ts') }));
  } }],
  });
  const code = output.outputFiles[0].text;
  return { code, inputs: Object.keys(output.metafile.inputs),
    api: await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`) };
}
function noCompilerClosure(result) {
  expect(result.inputs.some(file => /(?:catalog\.generated|compiler\.|scripts\/lib|author-anatomy|author-clock-joint)/.test(file))).toBe(false);
  expect(result.code).not.toContain('@labpics/motion');
  expect(result.code).not.toContain('createGlyphCompiler');
}
function capabilitiesClosure(result) {
  noCompilerClosure(result);
  for (const operand of ['originalD', 'packetSha256', 'turnsPerHour', '<svg', 'Math.cos', 'Math.sin']) {
    expect(result.code).not.toContain(operand);
  }
  expect(Object.keys(result.api)).toEqual(['motionCapabilities']);
  expect(result.api.motionCapabilities().ok).toBe(true);
}

describe('clock motion: авторский compiler и публичная target projection', () => {
  it('census выбирает явный semantic law, порядок документа не влияет на target', () => {
    expect(authorClockMotionSymbolNames(captured)).toEqual(['history', 'time']);
    const unrelated = { ...document, icons: { unclaimed: { outline: { joint: { law: 'cycle.clockwise' } } },
      history: document.icons.history, time: document.icons.time } };
    expect(authorClockMotionSymbolNames(unrelated)).toEqual(['history', 'time']);
    expect(authorClockMotionSymbolNames({ icons: { time: { outline: { gesture: { law: 'cycle.clockwise' } } } } })).toEqual([]);
    expect(compile({ ...document, icons: {} })).toEqual({});
    expect(compile({ ...document, icons: { history: document.icons.history, time: document.icons.time } })).toEqual(payloads);
    expect(Object.keys(payloads)).toEqual(['history', 'time']);
    for (const payload of Object.values(payloads)) expect(Object.keys(payload.variants)).toEqual(['outline', 'filled']);
  });

  it.each(positive)('$icon/$variant связывает selected physical path с exact authored d, порядком и fill-rule', ({ icon, variant, pathIndex }) => {
    const source = baseline.icons[icon][variant];
    const { motion, capabilities } = payloads[icon].variants[variant];
    const physical = rawPaths(motion.svg), authored = rawPaths(source.rawSvg);
    expect(drawing(motion.svg)).toEqual(drawing(source.rawSvg));
    expect(motion.originalD).toBe(authored[pathIndex].d);
    expect(physical[pathIndex]).toEqual({ ...authored[pathIndex], id: 'clock-hands' });
    expect(motion.renderTarget).toEqual({ selector: '[data-part="clock-hands"]', attribute: 'd',
      partIds: ['clock-minute', 'clock-hour'], unchangedPartIds: ['clock-enclosure'] });
    expect(physical.filter((_, index) => index !== pathIndex)).toEqual([{ ...authored[1 - pathIndex], id: 'clock-enclosure' }]);
    expect(motion.viewBox).toEqual(/\bviewBox="([^"]+)"/.exec(source.rawSvg)[1].split(/\s+/).map(Number));
    expect(motion.coordinateSpace).toBe('viewBox');
    expect(capabilities.author).toEqual(source.author);
    expect(capabilities).toMatchObject({ version: 1, icon, variant, law: 'joint.authored-elbow',
      reference: 'authored-pose', parameter: 'elapsed-hours', formats: ['svg', 'prepared-clock-hands'],
      gesture: { id: 'clock.advance-hour', kind: 'state', from: 0, to: 1, unit: 'elapsed-hours' } });
    expect(capabilities.gesture.meaning.length).toBeGreaterThan(0);
    expect(capabilities.geometrySha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it('refusal неподдержанного target не удерживает его authored geometry в gesture consumer', () => {
    const negative = payloads.time.variants.filled.motion;
    const module = renderAuthorClockMotionModule(payloads.time);
    expect(module).not.toContain(JSON.stringify(negative.svg));
    expect(module).not.toContain(negative.packetSha256);
    expect(module).not.toContain(JSON.stringify(negative.originalD));
    expect(negative.polarity).toBe('negative');
  });

  it('negative time остаётся явно недоступным: неподдерживаемая union subtraction не притворяется слоями', () => {
    const { motion, capabilities } = payloads.time.variants.filled;
    expect(motion.polarity).toBe('negative');
    expect(drawing(motion.svg)).toEqual(drawing(baseline.icons.time.filled.rawSvg));
    expect(capabilities).toMatchObject({ ok: false, reason: { code: 'COMPOSITION_UNSUPPORTED' } });
    expect(Object.hasOwn(capabilities, 'formats')).toBe(false);
    expect(payloads.time.variants.outline.capabilities.formats).toEqual(['svg', 'prepared-clock-hands']);
  });

  it('motion scope не меняет default source contracts или captured masters', () => {
    const before = JSON.stringify(baseline);
    expect(compileAuthorAnatomy(baseline, document, grid)).toEqual({});
    compile();
    expect(JSON.stringify(baseline)).toBe(before);
    for (const variants of Object.values(baseline.icons)) for (const source of Object.values(variants)) {
      expect(Object.hasOwn(source.sourceContract, 'anatomy')).toBe(false);
      expect(Object.hasOwn(source.sourceContract, 'gestures')).toBe(false);
      expect(drawing(source.artifactSvg)).toEqual(drawing(source.rawSvg));
    }
  });

  it('source receipt и отдельный motion scope обязательны до target compilation', () => {
    for (const [mutate, code] of [
      [spec => { spec.source.version += '-stale'; }, 'SOURCE_MISMATCH'],
      [spec => { spec.icons.time.outline.masterSha256 = '0'.repeat(64); }, 'MASTER_MISMATCH'],
      [spec => { delete spec.icons.time.outline.scope; }, 'LAW_SEMANTICS_UNSUPPORTED'],
    ]) {
      const stale = structuredClone(document); mutate(stale);
      try { compile(stale); throw new Error('Неверная annotation принята'); }
      catch (error) { expect(error).toBeInstanceOf(AuthorAnatomyError); expect(error.code).toBe(code); }
    }
    expect(compile()).toEqual(payloads);
  });

  it('physical target должен сохранять drawing, winding и composition до выдачи motion packet', () => {
    for (const mutate of [
      glyph => { glyph.parts[0].d = 'M0 0L1 0L0 1Z'; },
      glyph => { glyph.parts[0].fillRule = 'evenodd'; },
      glyph => { glyph.composition.kind = 'mask-subtract'; },
    ]) {
      const factory = input => {
        const actual = createGlyphCompiler(input);
        return { ...actual, glyph: request => {
          const glyph = actual.glyph(request);
          if (request.icon !== 'time' || request.variant !== 'outline') return glyph;
          const changed = structuredClone(glyph); mutate(changed); return changed;
        } };
      };
      expect(() => compile(document, factory)).toThrow('physical target');
    }
  });

  it.each(['time', 'history'])('%s: generated ESM expose ровно подготовку и capabilities; SVG живёт в prepared', async icon => {
    const { api, inputs, code } = await emitted(payloads[icon]);
    expect(Object.keys(api).sort()).toEqual(['motionCapabilities', 'prepareClockHands']);
    expect(Object.keys(api).sort()).toEqual(read('release/export-surface.json')[`./gestures/${icon}`]);
    noCompilerClosure({ inputs, code });
    for (const variant of ['outline', 'filled']) {
      const prepared = api.prepareClockHands(variant), caps = api.motionCapabilities(variant);
      if (icon === 'time' && variant === 'filled') {
        expect(prepared).toMatchObject({ ok: false, reason: { code: 'COMPOSITION_UNSUPPORTED' } });
        expect(caps).toMatchObject({ ok: false, reason: { code: 'COMPOSITION_UNSUPPORTED' } });
      } else {
        expect(prepared.ok).toBe(true); expect(caps.ok).toBe(true);
        expect(prepared.prepared.svg).toBe(payloads[icon].variants[variant].motion.svg);
        expect(prepared.prepared.sample(0).d).toBe(payloads[icon].variants[variant].motion.originalD);
        expect(prepared.prepared.sample(0.125).ok).toBe(true);
      }
    }
    expect(api.prepareClockHands('duotone')).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
    expect(api.motionCapabilities(null)).toMatchObject({ ok: false, reason: { code: 'INVALID_REQUEST' } });
    expect(api.prepareClockHands().ok).toBe(true);
  });

  it.each(['time', 'history'])('%s: independent consumer roots исключают чужой payload и compiler', async icon => {
    const preparation = await emitted(payloads[icon], 'prepareClockHands');
    noCompilerClosure(preparation);
    expect(Object.keys(preparation.api)).toEqual(['prepareClockHands']);
    for (const metadata of ['geometrySha256', 'normalizedSha256', 'clock.advance-hour']) expect(preparation.code).not.toContain(metadata);
    expect(preparation.api.prepareClockHands().ok).toBe(true);
    const capabilities = await emitted(payloads[icon], 'motionCapabilities');
    capabilitiesClosure(capabilities);
    for (const other of Object.keys(payloads).filter(name => name !== icon)) {
      expect(preparation.code).not.toContain(`"icon":"${other}"`);
      expect(capabilities.code).not.toContain(`"icon":"${other}"`);
    }
  });

  it('metadata-only oracle обнаруживает валидную eager preparation мутацию с сохранёнными capabilities', async () => {
    const source = renderAuthorClockMotionModule(payloads.time);
    const changed = source.replace('/* @__PURE__ */ createCompiledClockPreparation', 'createCompiledClockPreparation');
    expect(changed).not.toBe(source);
    const healthy = await emitted(payloads.time, 'motionCapabilities'); capabilitiesClosure(healthy);
    const eager = await emitted(payloads.time, 'motionCapabilities', changed);
    expect(eager.api.motionCapabilities()).toEqual(healthy.api.motionCapabilities());
    expect(() => capabilitiesClosure(eager)).toThrow();
    expect(eager.code).toContain('originalD');
  });

  it('NodeNext source-layout consumer исполняет настоящие imports, закрывает private subpaths и сохраняет типы', async () => {
    const temporaryRoot = resolve(tmpdir()), directory = mkdtempSync(join(temporaryRoot, 'lab-icons-clock-projection-'));
    try {
      const pkg = join(directory, 'node_modules/@labpics/icons'), dist = join(pkg, 'dist');
      mkdirSync(join(dist, 'ir'), { recursive: true }); mkdirSync(join(dist, 'gestures'), { recursive: true });
      const runtime = await build({ entryPoints: [join(root, 'src/ir/author-clock-motion-runtime.ts')],
        bundle: true, write: false, minify: true, format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent' });
      writeFileSync(join(dist, 'ir/clock-motion-runtime.js'), runtime.outputFiles[0].text);
      // Exact type-only sources проверяют layout; packed/install proof выполняется отдельно в CI.
      for (const name of ['author-clock-motion-types', 'author-provenance', 'author-catalog.generated']) {
        copyFileSync(join(root, `src/ir/${name}.ts`), join(dist, `ir/${name}.d.ts`));
      }
      for (const payload of Object.values(payloads)) {
        writeFileSync(join(dist, 'gestures', `${payload.icon}.js`), renderAuthorClockMotionModule(payload));
        writeFileSync(join(dist, 'gestures', `${payload.icon}.d.ts`), authorClockMotionModuleDeclaration(payload));
      }
      const exports = { './gestures/*': read('package.json').exports['./gestures/*'] };
      writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module', sideEffects: false, exports }));
      writeFileSync(join(directory, 'consumer.mjs'), [
        "import assert from 'node:assert/strict';",
        "import * as time from '@labpics/icons/gestures/time';",
        "import * as history from '@labpics/icons/gestures/history';",
        "for (const api of [time, history]) { assert.deepEqual(Object.keys(api).sort(), ['motionCapabilities','prepareClockHands']);",
        "const a=api.prepareClockHands(), b=api.prepareClockHands('outline'); assert.equal(a.ok,true); assert.equal(a.prepared,b.prepared);",
        "assert.equal(a.prepared.sample(0.125).ok,true); assert.equal(api.motionCapabilities().capabilities.gesture.to,1); }",
        "assert.equal(time.prepareClockHands('filled').reason.code,'COMPOSITION_UNSUPPORTED');",
        "assert.equal(history.prepareClockHands('filled').ok,true);",
        "await assert.rejects(import('@labpics/icons/ir/clock-motion-runtime'), { code:'ERR_PACKAGE_PATH_NOT_EXPORTED' });",
        "await assert.rejects(import('@labpics/icons/ir/author-clock-motion-types'), { code:'ERR_PACKAGE_PATH_NOT_EXPORTED' });",
      ].join('\n'));
      expect(() => execFileSync(process.execPath, ['consumer.mjs'], { cwd: directory, stdio: 'pipe', windowsHide: true })).not.toThrow();

      const consumer = join(directory, 'consumer.mts');
      const source = [
        "import * as time from '@labpics/icons/gestures/time';",
        "import * as history from '@labpics/icons/gestures/history';",
        'type Equal<A,B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;',
        'type Assert<T extends true> = T;',
        "type Variants = Assert<Equal<time.MotionVariant, 'outline' | 'filled'>>;",
        "const result=time.prepareClockHands(); history.prepareClockHands('filled');",
        'if(result.ok){ const svg:string=result.prepared.svg; const sample=result.prepared.sample(0.25);',
        "  type Parameter=Assert<Equal<typeof result.prepared.parameter,'elapsed-hours'>>;",
        '  if(sample.ok){const d:string=sample.d; const hours:number=sample.elapsedHours; void d; void hours;}',
        "  else {const code:'INVALID_REQUEST'|'VARIANT_UNSUPPORTED'|'COMPOSITION_UNSUPPORTED'=sample.reason.code; void code;}",
        "  // @ts-expect-error: sample принимает конечное число, не строку.",
        "  result.prepared.sample('1');",
        '  // @ts-expect-error: target владельца immutable.',
        "  result.prepared.renderTarget.attribute='transform';",
        '  void svg; }',
        'const caps=history.motionCapabilities(); if(caps.ok){',
        "  type Gesture=Assert<Equal<typeof caps.capabilities.gesture.id,'clock.advance-hour'>>;",
        '  type OneHour=Assert<Equal<typeof caps.capabilities.gesture.to,1>>;',
        "  const formats:readonly ['svg','prepared-clock-hands']=caps.capabilities.formats; void formats; }",
        '// @ts-expect-error: незаявленное начертание не входит в API.',
        "time.prepareClockHands('duotone');",
        '// @ts-expect-error: internal compiler packet не экспортируется.',
        "import type { CompiledClockHands } from '@labpics/icons/gestures/time';",
        '// @ts-expect-error: private types subpath закрыт exports.',
        "import type { ClockHandsCapabilities } from '@labpics/icons/ir/author-clock-motion-types';",
      ].join('\n');
      const diagnostics = text => {
        writeFileSync(consumer, text);
        try {
          return String(execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '--ignoreConfig',
            '--noEmit', '--strict', '--noUncheckedIndexedAccess', '--target', 'ES2022', '--module', 'NodeNext',
            '--moduleResolution', 'NodeNext', '--skipLibCheck', 'false', consumer],
          { cwd: directory, stdio: 'pipe', windowsHide: true }));
        } catch (error) {
          if (error.status !== 1 && error.status !== 2) throw error;
          return String(error.stdout) + String(error.stderr);
        }
      };
      expect(diagnostics(source)).toBe('');
      const negative = diagnostics(source.replace(/^\s*\/\/ @ts-expect-error:.*$/gm, ''));
      expect([...negative.matchAll(/consumer\.mts\(\d+,\d+\): error TS(\d+):/g)].map(([, code]) => Number(code)), negative)
        .toEqual([2345, 2540, 2345, 2305, 2307]);
    } finally {
      if (dirname(resolve(directory)) !== temporaryRoot) throw new Error('cleanup вне собственного временного каталога');
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
