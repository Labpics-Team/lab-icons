#!/usr/bin/env node
/** Чистые packed consumers; тяжёлая работа допускается только удалённым CI job. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, freemem, hostname, platform, release, tmpdir, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { localTarballSpecifier, pnpmInvocation } from '../check-package-artifact.js';
import { assertRemoteBenchmark, summarize } from './measurement.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = '03a4ca3ac1bf7978f9e8f554106c132a69668afb';
const COUNTS = [1, 100, 10000];
const CASES = [
  { id: 'static-accessibility', kind: 'static', icon: 'accessibility' },
  { id: 'source-alert', kind: 'glyph', icon: 'alert' },
  { id: 'model-time', kind: 'glyph', icon: 'time' },
  { id: 'axes-chevron-forward', kind: 'glyph', icon: 'chevron-forward', axes: { weight: 1.1, opsz: 32 } },
];
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
function command(file, args, cwd) {
  return execFileSync(file, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' } });
}
function pnpm(args, cwd) {
  const invocation = pnpmInvocation(args);
  return command(invocation.file, invocation.args, cwd);
}
function prepare(temp, label, revision) {
  const source = join(temp, label, 'source');
  const consumer = join(temp, label, 'consumer');
  const pack = join(temp, label, 'pack');
  mkdirSync(pack, { recursive: true });
  mkdirSync(consumer, { recursive: true });
  command('git', ['clone', '--quiet', '--no-hardlinks', '--no-checkout', ROOT, source], temp);
  command('git', ['checkout', '--quiet', '--detach', revision], source);
  process.stdout.write(`${label}: frozen install и clean prepack ${revision}\n`);
  pnpm(['install', '--frozen-lockfile'], source);
  const packStarted = performance.now();
  pnpm(['pack', '--pack-destination', pack], source);
  const packMs = performance.now() - packStarted;
  const tarballs = readdirSync(pack).filter(name => name.endsWith('.tgz'));
  if (tarballs.length !== 1) throw new Error(`${label}: pack должен создать один tarball`);
  const tarball = join(pack, tarballs[0]);
  const pkg = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'));
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: `lab-icons-bench-${label}`, private: true, type: 'module', packageManager: pkg.packageManager, dependencies: { '@labpics/icons': localTarballSpecifier(consumer, tarball), '@labpics/motion': '0.5.0' } }));
  const installStarted = performance.now();
  pnpm(['install', '--offline', '--ignore-scripts', '--no-lockfile'], consumer);
  const installMs = performance.now() - installStarted;
  const packageRoot = realpathSync(join(consumer, 'node_modules/@labpics/icons'));
  const installed = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
  if (installed.version !== pkg.version) throw new Error(`${label}: installed package identity не совпадает`);
  return { label, source, consumer, packageRoot, revision, packageVersion: pkg.version, packageManager: pkg.packageManager, lockSha256: sha256(readFileSync(join(source, 'pnpm-lock.yaml'))), tarballSha256: sha256(readFileSync(tarball)), tarballBytes: readFileSync(tarball).length, packMs, installMs };
}
function caseImport(testCase, label) {
  return testCase.kind === 'static' ? '@labpics/icons' : label === 'candidate' ? `@labpics/icons/symbols/${testCase.icon}` : '@labpics/icons/ir';
}
function createExpression(testCase, label) {
  if (testCase.kind === 'static') return '() => symbol.accessibilityOutline';
  const request = { ...(label === 'baseline' ? { icon: testCase.icon } : {}), ...(testCase.axes ? { axes: testCase.axes } : {}) };
  return `() => symbol.glyph(${Object.keys(request).length ? JSON.stringify(request) : ''}).svg`;
}
async function makeBundle(prepared, testCase, outdir) {
  const entry = join(prepared.consumer, `${testCase.id}.mjs`);
  writeFileSync(entry, `import * as symbol from ${JSON.stringify(caseImport(testCase, prepared.label))};\nimport { measureScene } from ${JSON.stringify(join(ROOT, 'scripts/bench/browser-scene.js'))};\nexport const run = count => measureScene(${createExpression(testCase, prepared.label)}, count);\n`);
  const outfile = join(outdir, `${prepared.label}-${testCase.id}.js`);
  const started = performance.now();
  const result = await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, metafile: true, logLevel: 'silent' });
  const bytes = readFileSync(outfile);
  return { file: outfile, bundleCompileMs: performance.now() - started, rawBytes: bytes.length, gzipBytes: gzipSync(bytes, { level: 9 }).length, brotliBytes: brotliCompressSync(bytes).length, sha256: sha256(bytes), inputs: Object.entries(result.metafile.inputs).map(([file, input]) => ({ file, bytes: input.bytes })) };
}
async function makeMotionBundle(prepared, outdir) {
  const entry = join(prepared.consumer, 'motion.mjs');
  writeFileSync(entry, `import { glyph, glyphCapabilities } from '@labpics/icons/symbols/time';\nimport { renderGlyphSvg } from '@labpics/icons/ir/render';\nimport { compileSymbolEffect } from '@labpics/icons/motion';\nimport { animate } from '@labpics/motion';\nimport { measureMotion } from ${JSON.stringify(join(ROOT, 'scripts/bench/browser-scene.js'))};\nconst executeLabMotion = (root, effect) => effect.targets.map(target => { const element = root.querySelector('[data-part="' + target.partId + '"]'); Object.assign(element.style, target.style); return animate(element, { rotate: target.rotation.to }, { duration: effect.options.duration, ease: effect.options.easing, reducedMotion: effect.options.duration === 0 ? 'always' : 'user' }); });\nexport const run = (count, executor) => measureMotion({glyph, glyphCapabilities, renderGlyphSvg, compileSymbolEffect, executeLabMotion}, count, executor);\n`);
  const outfile = join(outdir, 'candidate-motion.js');
  await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, logLevel: 'silent' });
  return outfile;
}
async function browserMeasurement(browser, origin, filename, count, slowdown, executor) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const session = await context.newCDPSession(page);
  try {
    await page.exposeFunction('sampleMountedMetrics', async () => {
      const values = await session.send('Performance.getMetrics');
      return Object.fromEntries(values.metrics.map(metric => [metric.name, metric.value]));
    });
    await session.send('Emulation.setCPUThrottlingRate', { rate: slowdown });
    await session.send('Performance.enable', { timeDomain: 'timeTicks' });
    await page.goto(origin, { waitUntil: 'load' });
    const before = await session.send('Performance.getMetrics');
    const result = await page.evaluate(async ({ filename, count, executor }) => {
      const started = performance.now();
      const consumer = await import(`/bundles/${filename}`);
      const coldImportMs = performance.now() - started;
      const warmStarted = performance.now();
      await import(`/bundles/${filename}`);
      const warmImportMs = performance.now() - warmStarted;
      return { coldImportMs, warmImportMs, ...(await consumer.run(count, executor)) };
    }, { filename, count, executor });
    const allocated = await session.send('Performance.getMetrics');
    await session.send('HeapProfiler.collectGarbage');
    const retained = await session.send('Performance.getMetrics');
    const metrics = values => Object.fromEntries(values.metrics.map(metric => [metric.name, metric.value]));
    return { ...result, cpuSlowdown: slowdown, cdpBefore: metrics(before), cdpAfterCleanupBeforeGc: metrics(allocated), cdpRetainedAfterGc: metrics(retained) };
  } finally { await context.close(); }
}
function aggregate(rows, keys) {
  return Object.fromEntries(keys.map(key => [key, summarize(rows.map(row => row[key]))]));
}

assertRemoteBenchmark();
const output = resolve(process.argv[2] ?? join(ROOT, 'benchmark-results'));
mkdirSync(output, { recursive: true });
const temp = mkdtempSync(join(tmpdir(), 'lab-icons-benchmark-'));
let browser, server, report;
try {
  const revision = command('git', ['rev-parse', 'HEAD'], ROOT).trim();
  report = { version: 1, baseline: BASELINE, candidate: revision, timestamp: new Date().toISOString(), environment: { node: process.version, v8: process.versions.v8, platform: platform(), osRelease: release(), hostname: hostname(), cpus: cpus().map(cpu => ({ model: cpu.model, speed: cpu.speed })), totalmem: totalmem(), freemem: freemem(), runnerEnvironment: process.env.BENCHMARK_RUNNER_ENVIRONMENT, githubRunId: process.env.GITHUB_RUN_ID, githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT }, protocol: { serverRepetitions: 7, browserRepetitions: 3, counts: COUNTS, cpuSlowdowns: [1, 4], comparison: 'baseline/candidate чередуются; каждый server sample — новый Node process; каждый browser sample — новый context', caveats: ['4× CDP slowdown — синтетическое замедление, не физическое constrained hardware', '10000 mounted symbols включают offscreen DOM; viewport 1280×800', 'rAF интервал — frame opportunity, не GPU presentation time', 'peak heap не заявляется: CDP и Node сохраняют точечные наблюдения', '7/3 повторов характеризуют среднее и разброс, не редкие хвосты', 'pack/install и bundler compile — одиночные наблюдения, не latency distribution', 'server измеряет создание SVG, browser измеряет DOM/layout', 'motion — новая возможность, baseline speedup не заявляется'] }, packages: [], cases: [], motion: [] };
  writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
  const prepared = [prepare(temp, 'baseline', BASELINE), prepare(temp, 'candidate', revision)];
  report.packages = prepared.map(({ source, consumer, packageRoot, ...facts }) => facts);
  const outdir = join(temp, 'bundles');
  mkdirSync(outdir);
  for (const testCase of CASES) {
    const result = { ...testCase, bundles: [], server: [], browser: [] };
    report.cases.push(result);
    for (const packageCase of prepared) result.bundles.push({ label: packageCase.label, ...(await makeBundle(packageCase, testCase, outdir)) });
    for (const count of COUNTS) {
      const observations = { baseline: [], candidate: [] };
      const serverRows = ['baseline', 'candidate'].map(label => ({ label, count, observations: observations[label] }));
      result.server.push(...serverRows);
      for (let repeat = 0; repeat < 7; repeat++) {
        for (const packageCase of repeat % 2 ? [...prepared].reverse() : prepared) {
          const request = { ...testCase, count, sliced: packageCase.label === 'candidate', modulePath: join(packageCase.packageRoot, testCase.kind === 'static' ? 'dist/index.js' : packageCase.label === 'baseline' ? 'dist/ir/index.js' : `dist/symbols/${testCase.icon}.js`) };
          const input = join(temp, 'request.json');
          writeFileSync(input, JSON.stringify(request));
          const sample = JSON.parse(command(process.execPath, ['--expose-gc', join(ROOT, 'scripts/bench/probe.mjs'), input], packageCase.consumer));
          observations[packageCase.label].push(sample);
        }
      }
      if (observations.baseline.some((row, index) => row.svgSha256 !== observations.candidate[index].svgSha256)) throw new Error(`${testCase.id}: baseline/candidate geometry или SVG отличаются`);
      for (const row of serverRows) row.summary = aggregate(row.observations, ['importMs', 'firstSvgMs', 'svgGenerationMs', 'warmImportMs', 'cleanupMs', 'lifecycleMs', 'heapAfterGeneration', 'heapRetained', 'rss']);
      writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
    }
  }
  server = createServer((request, response) => {
    const name = request.url?.match(/^\/bundles\/([a-z-]+\.js)$/)?.[1];
    response.setHeader('Cache-Control', 'no-store');
    if (name) { response.setHeader('Content-Type', 'text/javascript'); response.end(readFileSync(join(outdir, name))); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><style>body{margin:0}#stage{display:grid;grid-template-columns:repeat(auto-fill,44px)}button{width:44px;height:44px}svg{width:24px;height:24px}</style><div id="stage"></div>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  report.environment.chromium = browser.version();
  for (const result of report.cases) {
    for (const slowdown of [1, 4]) for (const count of COUNTS) {
      const observations = { baseline: [], candidate: [] };
      const browserRows = ['baseline', 'candidate'].map(label => ({ label, count, slowdown, observations: observations[label] }));
      result.browser.push(...browserRows);
      for (let repeat = 0; repeat < 3; repeat++) for (const label of repeat % 2 ? ['candidate', 'baseline'] : ['baseline', 'candidate']) {
        observations[label].push(await browserMeasurement(browser, origin, `${label}-${result.id}.js`, count, slowdown));
      }
      for (const row of browserRows) row.summary = aggregate(row.observations, ['coldImportMs', 'warmImportMs', 'firstCreateMs', 'createDomMs', 'mountLayoutMs', 'firstPaintOpportunityMs', 'cleanupMs', 'lifecycleMs', 'domElements']);
    }
    writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
    process.stdout.write(`${result.id}: server/browser observations сохранены\n`);
  }
  await makeMotionBundle(prepared[1], outdir);
  for (const executor of ['waapi', 'lab-motion']) for (const slowdown of [1, 4]) for (const count of COUNTS) {
    const observations = [];
    const motionRow = { executor, slowdown, count, observations };
    report.motion.push(motionRow);
    for (let repeat = 0; repeat < 3; repeat++) observations.push(await browserMeasurement(browser, origin, 'candidate-motion.js', count, slowdown, executor));
    motionRow.summary = aggregate(observations, ['startMs', 'interruptMs', 'interruptArrivalDelayMs', 'cleanupMs']);
    writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
  }
  writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
  // Instrumentation читает уже собранные candidate artifacts; не меняет ratchet в CI.
  command(process.execPath, [join(prepared[1].source, 'scripts/measure-platform-artifacts.mjs'), '--output', join(output, 'platform-artifacts.json')], prepared[1].source);
  process.stdout.write(`benchmark: полный отчёт ${join(output, 'consumer-comparison.json')}\n`);
} catch (error) {
  if (report) {
    report.failure = { message: error.message, at: new Date().toISOString() };
    writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
  }
  throw error;
} finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(temp, { recursive: true, force: true });
}
