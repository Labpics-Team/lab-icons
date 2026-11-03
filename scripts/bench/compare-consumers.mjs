#!/usr/bin/env node
/** Чистые packed consumers; тяжёлая работа допускается только удалённым CI job. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { cpus, freemem, hostname, platform, release, tmpdir, totalmem } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'node:http';
import { performance } from 'node:perf_hooks';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { localTarballSpecifier, pnpmInvocation } from '../check-package-artifact.js';
import { assertRemoteBenchmark, summarize } from './measurement.js';
import { analyzeConsumerReport } from './report-analysis.js';
import { observeAuthorGlyph, validateAuthorObservation, validateRetainedPair } from './author-oracle.js';
import { verifyExplorer } from './verify-explorer.mjs';
import { verifyLottieConsumer } from './verify-lottie.mjs';
import { verifyAuthoringConsumer } from './verify-authoring.mjs';
import { bundleMeasurements, inspectStaticRuntime, staticAdapterSource } from './static-consumer.js';
import { inspectLoadingGraphs, loadingAdapterSource, validateLoadingIdentity, verifiedLoadingIcons, withIndependentBrowser } from './loading-consumer.js';
import { contractEntrypoints } from '../lib/export-surface.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const BASELINE = '03a4ca3ac1bf7978f9e8f554106c132a69668afb';
const COUNTS = [1, 100, 10000];
const CASES = [
  { id: 'retained-static-accessibility', lane: 'retained-identical-output', kind: 'static', icon: 'accessibility' },
  { id: 'retained-source-alert', lane: 'retained-identical-output', kind: 'glyph', icon: 'alert' },
  { id: 'retained-model-time', lane: 'retained-identical-output', kind: 'glyph', icon: 'time' },
  { id: 'retained-default-chevron-forward', lane: 'retained-identical-output', kind: 'glyph', icon: 'chevron-forward' },
  { id: 'retained-axes-chevron-forward', lane: 'retained-identical-output', kind: 'glyph', icon: 'chevron-forward', axes: { weight: 1.1, opsz: 32 } },
  { id: 'current-author-alert', lane: 'current-author', kind: 'glyph', icon: 'alert', baselineReference: 'retained-source-alert' },
  { id: 'current-author-time', lane: 'current-author', kind: 'glyph', icon: 'time', baselineReference: 'retained-model-time' },
  { id: 'current-author-chevron-forward', lane: 'current-author', kind: 'glyph', icon: 'chevron-forward', baselineReference: 'retained-default-chevron-forward' },
  { id: 'current-author-caret-forward', lane: 'current-author', kind: 'glyph', icon: 'caret-forward', candidateOnly: true },
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
  return testCase.kind === 'static' ? '@labpics/icons' : testCase.lane === 'current-author' && label === 'candidate' ? `@labpics/icons/symbols/${testCase.icon}` : '@labpics/icons/ir';
}
function createExpression(testCase, label) {
  if (testCase.kind === 'static') return '() => symbol.accessibilityOutline';
  const request = { ...(testCase.lane !== 'current-author' || label === 'baseline' ? { icon: testCase.icon } : {}), ...(testCase.axes ? { axes: testCase.axes } : {}) };
  return `() => symbol.glyph(${Object.keys(request).length ? JSON.stringify(request) : ''}).svg`;
}
async function makeBundle(prepared, testCase, outdir) {
  const entry = join(prepared.consumer, `${testCase.id}.mjs`);
  writeFileSync(entry, `import * as symbol from ${JSON.stringify(caseImport(testCase, prepared.label))};\nexport const create = ${createExpression(testCase, prepared.label)};\n`);
  const outfile = join(outdir, `${prepared.label}-${testCase.id}.js`);
  const started = performance.now();
  const result = await build({ entryPoints: [entry], outfile, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true, metafile: true, logLevel: 'silent' });
  const bytes = readFileSync(outfile);
  return { file: outfile, bundleCompileMs: performance.now() - started, ...bundleMeasurements(bytes, result.metafile) };
}

async function makeStaticPair(prepared, variant, outdir) {
  const installed = await import(pathToFileURL(join(prepared.packageRoot, 'dist/symbols/accessibility.js')).href);
  const svg = installed[variant];
  if (typeof svg !== 'string') throw new Error(`benchmark: installed static ${variant} отсутствует`);
  const pair = { icon: 'accessibility', variant, artifact: prepared.tarballSha256, svgSha256: sha256(svg),
    svgBytes: Buffer.byteLength(svg), completedBytes: svg.length, count: 1,
    comparison: 'same installed SVG string; imported adapter versus literal; no historical geometry comparison', bundles: [], browser: [] };
  for (const label of ['imported', 'literal']) {
    const entry = join(prepared.consumer, `static-${variant}-${label}.mjs`);
    writeFileSync(entry, staticAdapterSource(variant, label === 'literal' ? svg : undefined));
    const file = join(outdir, `${prepared.label}-static-accessibility-${variant}-${label}.js`);
    const result = await build({ entryPoints: [entry], outfile: file, bundle: true, format: 'esm', platform: 'browser',
      target: 'es2022', minify: true, metafile: true, logLevel: 'silent' });
    const facts = bundleMeasurements(readFileSync(file), result.metafile);
    if (inspectStaticRuntime(facts.retainedInputs).verdict !== 'PASS') {
      throw new Error(`benchmark: ${label}/${variant} retained catalog/authoring/motion/IR runtime`);
    }
    pair.bundles.push({ label, file, ...facts });
  }
  return pair;
}

async function makeLoadingPair(prepared, authorConsumer, outdir) {
  const publicIcons = Object.keys(contractEntrypoints(prepared.source)).filter(name => name.startsWith('./symbols/')).map(name => name.slice('./symbols/'.length));
  const icons = verifiedLoadingIcons(authorConsumer, publicIcons);
  const icon = 'alert', author = authorConsumer.icons[icon]?.outline;
  const installed = JSON.parse(readFileSync(join(prepared.packageRoot, 'package.json'), 'utf8'));
  if (!author || installed.exports?.['./symbols/*']?.import !== './dist/symbols/*.js') throw new Error('loading control: installed public symbol contract отсутствует');
  const pair = { id: 'matched-loading-alert', lane: 'same-artifact-loading', icon, variant: 'outline',
    source: authorConsumer.source, manifestSha256: authorConsumer.manifestSha256, artifact: prepared.tarballSha256,
    expectedFamilies: icons.length, importedIcons: icons, author,
    comparison: 'same installed author GlyphIR/SVG/provenance; ordinary eager public registry versus direct public icon import',
    bundles: [], server: [], browser: [] };
  const packets = [];
  for (const label of ['eager-registry', 'direct-icon']) {
    const entry = join(prepared.consumer, `loading-${label}.mjs`);
    writeFileSync(entry, loadingAdapterSource(icons, icon, label));
    const adapter = await import(pathToFileURL(entry).href);
    const glyph = adapter.glyph();
    validateAuthorObservation(observeAuthorGlyph(glyph, adapter.outline), author);
    if (adapter.create() !== glyph.svg) throw new Error('loading control: create() изменяет выбранный author SVG');
    packets.push({ glyph, staticSvg: adapter.outline });
    const file = join(outdir, `candidate-loading-${label}.js`);
    const started = performance.now();
    const result = await build({ entryPoints: [entry], outfile: file, bundle: true, format: 'esm', platform: 'browser',
      target: 'es2022', minify: true, metafile: true, logLevel: 'silent' });
    pair.bundles.push({ label, entry, file, bundleCompileMs: performance.now() - started,
      ...bundleMeasurements(readFileSync(file), result.metafile) });
  }
  Object.assign(pair, validateLoadingIdentity(...packets));
  pair.control = inspectLoadingGraphs(pair.bundles, icons, icon);
  return pair;
}

function measureLoadingServer(pair, prepared, temp, output, report) {
  const labels = ['eager-registry', 'direct-icon'];
  for (const count of COUNTS) {
    const observations = Object.fromEntries(labels.map(label => [label, []]));
    const rows = labels.map(label => ({ label, count, observations: observations[label] }));
    pair.server.push(...rows);
    for (let repeat = 0; repeat < report.protocol.serverRepetitions; repeat++) {
      for (const label of repeat % 2 ? [...labels].reverse() : labels) {
        const input = join(temp, 'loading-request.json');
        writeFileSync(input, JSON.stringify({ kind: 'glyph', icon: pair.icon, variant: pair.variant, count,
          sliced: true, inspectAuthor: true, modulePath: pair.bundles.find(bundle => bundle.label === label).entry }));
        const sample = JSON.parse(command(process.execPath, ['--expose-gc', join(ROOT, 'scripts/bench/probe.mjs'), input], prepared.consumer));
        validateAuthorObservation(sample, pair.author);
        validateRetainedPair({ svgSha256: pair.svgSha256, completedBytes: pair.completedBytes * count, completed: count }, sample);
        observations[label].push(sample);
      }
    }
    observations['eager-registry'].forEach((sample, index) => validateRetainedPair(sample, observations['direct-icon'][index]));
    for (const row of rows) row.summary = aggregate(row.observations, ['importMs', 'firstSvgMs', 'svgGenerationMs', 'warmImportMs', 'cleanupMs', 'lifecycleMs', 'heapAfterGeneration', 'heapRetained', 'rss']);
    writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
  }
}
async function makeMotionBundle(prepared, outdir) {
  const entry = join(prepared.consumer, 'motion.mjs');
  writeFileSync(entry, `import { glyph as recordedGlyph, glyphCapabilities as recordedCapabilities } from '@labpics/icons/ir';\nimport { renderGlyphSvg } from '@labpics/icons/ir/render';\nimport { compileSymbolEffect } from '@labpics/icons/motion';\nimport { animate } from '@labpics/motion';\nimport { measureMotion, executeLabMotion as execute } from ${JSON.stringify(join(ROOT, 'scripts/bench/browser-scene.js'))};\nconst glyph = request => recordedGlyph({icon:'time', ...request});\nconst glyphCapabilities = variant => recordedCapabilities('time', variant);\nconst executeLabMotion = (roots, effect) => execute(animate, roots, effect);\nexport const run = (count, executor) => measureMotion({glyph, glyphCapabilities, renderGlyphSvg, compileSymbolEffect, executeLabMotion}, count, executor);\n`);
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
    await session.send('Network.enable');
    await session.send('Network.setCacheDisabled', { cacheDisabled: true });
    await session.send('Performance.enable', { timeDomain: 'timeTicks' });
    await page.goto(origin, { waitUntil: 'load' });
    if (!executor) await page.evaluate(async () => { window.benchmarkScene = await import('/measurement/browser-scene.js'); });
    const before = await session.send('Performance.getMetrics');
    const result = await page.evaluate(async ({ filename, count, executor }) => {
      let result;
      if (executor) {
        const started = performance.now();
        const consumer = await import(`/bundles/${filename}`);
        const coldImportMs = performance.now() - started;
        result = { coldImportMs, ...(await consumer.run(count, executor)) };
      } else {
        result = await window.benchmarkScene.measureColdScene(async () => {
          const consumer = await import(`/bundles/${filename}`);
          return consumer.create ?? (() => consumer.svg);
        }, count);
      }
      const warmStarted = performance.now();
      await import(`/bundles/${filename}`);
      const warmImportMs = performance.now() - warmStarted;
      return { ...result, warmImportMs };
    }, { filename, count, executor });
    if (result.firstSvg) {
      result.svgSha256 = sha256(result.firstSvg);
      delete result.firstSvg;
    }
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
  report = { version: 2, baseline: BASELINE, candidate: revision, timestamp: new Date().toISOString(), environment: { node: process.version, v8: process.versions.v8, platform: platform(), osRelease: release(), hostname: hostname(), cpus: cpus().map(cpu => ({ model: cpu.model, speed: cpu.speed })), totalmem: totalmem(), freemem: freemem(), runnerEnvironment: process.env.BENCHMARK_RUNNER_ENVIRONMENT, githubRunId: process.env.GITHUB_RUN_ID, githubRunAttempt: process.env.GITHUB_RUN_ATTEMPT }, protocol: { serverRepetitions: 7, browserRepetitions: 3, counts: COUNTS, cpuSlowdowns: [1, 4], comparison: 'baseline/candidate чередуются; каждый server sample — новый Node process; каждый browser sample — новый context', lanes: { 'retained-identical-output': 'root/full IR: тот же SVG, без снятия equality oracle', 'current-author': 'sliced current master против recorded baseline: geometry/representation confound; не same-geometry speedup' }, caveats: ['4× CDP slowdown — синтетическое замедление, не физическое constrained hardware', '10000 mounted symbols включают offscreen DOM; viewport 1280×800', 'rAF интервал — frame opportunity, не GPU presentation time', 'peak heap не заявляется: CDP и Node сохраняют точечные наблюдения', '7/3 повторов характеризуют среднее и разброс, не редкие хвосты', 'pack/install и bundler compile — одиночные наблюдения, не latency distribution', 'server измеряет создание SVG, browser измеряет DOM/layout', 'motion принадлежит recorded full IR, не текущим source-only Figma masters', 'current-author lane меняет author geometry и representation: причинный same-geometry speedup не заявляется'] }, packages: [], cases: [], motion: [] };
  writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
  const prepared = [prepare(temp, 'baseline', BASELINE), prepare(temp, 'candidate', revision)];
  report.packages = prepared.map(({ source, consumer, packageRoot, ...facts }) => facts);
  const authorRequest = join(temp, 'author-request.json');
  writeFileSync(authorRequest, JSON.stringify({ sourceRoot: prepared[1].source, packageRoot: prepared[1].packageRoot, output: join(output, 'author-consumer.json') }));
  command(process.execPath, [join(ROOT, 'scripts/bench/verify-author-consumer.mjs'), authorRequest], prepared[1].consumer);
  const authorConsumer = JSON.parse(readFileSync(join(output, 'author-consumer.json'), 'utf8'));
  report.currentAuthor = { source: authorConsumer.source, manifestSha256: authorConsumer.manifestSha256, counts: authorConsumer.expectedCounts, completed: authorConsumer.completed };
  const outdir = join(temp, 'bundles');
  mkdirSync(outdir);
  report.benchmarkStatus = 'INCOMPLETE';
  report.protocol.coldRender = { endpoint: 'native first-contentful-paint.startTime after import/create/mount in an empty document',
    warmImport: 'after useful scene', isolation: 'fresh context/document/module graph; HTTP cache disabled; browser process and OS cache shared',
    paintDeadlineMs: 30_000, interpretation: 'context/module cold; no GPU presentation claim or statistical acceptance',
    sources: ['https://w3c.github.io/paint-timing/', 'https://developer.mozilla.org/en-US/docs/Web/API/PerformancePaintTiming', 'https://playwright.dev/docs/browser-contexts'] };
  report.protocol.bundleScope = 'static/glyph adapters: harness outside bundle and cold interval; recorded motion: one harness inside its legacy measurement bundle';
  report.protocol.loadingControl = { version: 1, selectedIcon: 'alert', variant: 'outline',
    sourceSha256: sha256(readFileSync(join(ROOT, 'scripts/bench/loading-consumer.js'))),
    artifact: 'one clean installed candidate tarball', imports: 'all verified public author glyph modules versus selected public glyph module',
    bundler: 'same ordinary minified esbuild configuration; no global retention or disabled tree shaking',
    nodeIsolation: 'each sample is a fresh Node process importing the unbundled adapter',
    browserIsolation: 'each sample launches and closes an independent Chromium process/profile; fresh context/document; HTTP cache disabled; OS cache shared',
    browserLaunch: 'outside the import-to-useful-render timer', serverRepetitions: report.protocol.serverRepetitions,
    browserRepetitions: report.protocol.browserRepetitions, counts: COUNTS, cpuSlowdowns: [1, 4],
    inference: 'descriptive raw observations/mean/spread only; no p95 confidence, BENCH-01 PASS or historical speedup',
    falsifier: 'if actual retained graph does not contain all verified glyph modules versus one, loading attribution remains INCOMPLETE',
    sources: ['https://v8.dev/blog/code-caching-for-devs', 'https://kar.kent.ac.uk/33611/45/p63-kaliber.pdf',
      'https://raw.githubusercontent.com/evanw/esbuild/v0.28.1/lib/shared/types.ts', 'https://www.itl.nist.gov/div898/handbook/pri/section3/pri33.htm'] };
  writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
  report.protocol.analysis = { version: 1, method: 'exact-binomial-order-statistics/bonferroni-ratio-v1',
    methodSha256: sha256(readFileSync(join(ROOT, 'scripts/bench/adjudication.js'))),
    reportAnalysisSha256: sha256(readFileSync(join(ROOT, 'scripts/bench/report-analysis.js'))),
    graphOwnerSha256: sha256(readFileSync(join(ROOT, 'scripts/bench/static-consumer.js'))),
    decimalBudgets: { defaultGlyphBytes: '1/20', staticByteOverhead: '21/20', coldRatio: '4/5', confidence: '19/20' },
    samplingQualified: false, calibration: 'not executed by this descriptive protocol; BENCH-01 remains INCOMPLETE' };
  report.staticPairs = [];
  for (const variant of ['outline', 'filled']) report.staticPairs.push(await makeStaticPair(prepared[1], variant, outdir));
  report.loadingPairs = [await makeLoadingPair(prepared[1], authorConsumer, outdir)];
  measureLoadingServer(report.loadingPairs[0], prepared[1], temp, output, report);
  for (const testCase of CASES) {
    const result = { ...testCase, bundles: [], server: [], browser: [] };
    const selected = testCase.candidateOnly ? [prepared[1]] : prepared;
    const labels = selected.map(item => item.label);
    const author = testCase.lane === 'current-author' ? authorConsumer.icons[testCase.icon]?.outline : null;
    if (testCase.lane === 'current-author' && !author) throw new Error(`${testCase.icon}: нет проверенного current master`);
    result.comparison = testCase.lane === 'retained-identical-output'
      ? { outputContract: 'identical SVG bytes', sameGeometryComparison: true }
      : { outputContract: 'exact current author manifest', sameGeometryComparison: false, attribution: testCase.candidateOnly ? 'новый авторский символ; baseline отсутствует' : 'geometry-and-representation-confounded', author, baselineReference: testCase.baselineReference ?? null };
    report.cases.push(result);
    for (const packageCase of selected) result.bundles.push({ label: packageCase.label, ...(await makeBundle(packageCase, testCase, outdir)) });
    for (const count of COUNTS) {
      const observations = { baseline: [], candidate: [] };
      const serverRows = labels.map(label => ({ label, count, observations: observations[label] }));
      result.server.push(...serverRows);
      for (let repeat = 0; repeat < 7; repeat++) {
        for (const packageCase of repeat % 2 ? [...selected].reverse() : selected) {
          const sliced = testCase.lane === 'current-author' && packageCase.label === 'candidate';
          const request = { ...testCase, count, sliced, inspectAuthor: sliced, modulePath: join(packageCase.packageRoot, testCase.kind === 'static' ? 'dist/index.js' : sliced ? `dist/symbols/${testCase.icon}.js` : 'dist/ir/index.js') };
          const input = join(temp, 'request.json');
          writeFileSync(input, JSON.stringify(request));
          const sample = JSON.parse(command(process.execPath, ['--expose-gc', join(ROOT, 'scripts/bench/probe.mjs'), input], packageCase.consumer));
          observations[packageCase.label].push(sample);
          if (sliced) validateAuthorObservation(sample, author);
          else if (testCase.lane === 'current-author') {
            const reference = report.cases.find(item => item.id === testCase.baselineReference)?.server.find(item => item.label === 'baseline' && item.count === count)?.observations[0];
            if (!reference) throw new Error(`${testCase.id}: recorded baseline reference отсутствует`);
            validateRetainedPair(reference, sample);
          }
        }
      }
      if (testCase.lane === 'retained-identical-output') observations.baseline.forEach((row, index) => validateRetainedPair(row, observations.candidate[index]));
      for (const row of serverRows) row.summary = aggregate(row.observations, ['importMs', 'firstSvgMs', 'svgGenerationMs', 'warmImportMs', 'cleanupMs', 'lifecycleMs', 'heapAfterGeneration', 'heapRetained', 'rss']);
      writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
    }
  }
  server = createServer((request, response) => {
    const name = request.url?.match(/^\/bundles\/([a-z-]+\.js)$/)?.[1];
    response.setHeader('Cache-Control', 'no-store');
    const measurement = request.url?.match(/^\/measurement\/(browser-scene|measurement)\.js$/)?.[1];
    if (measurement) { response.setHeader('Content-Type', 'text/javascript'); response.end(readFileSync(join(ROOT, 'scripts/bench', `${measurement}.js`))); }
    else if (name) { response.setHeader('Content-Type', 'text/javascript'); response.end(readFileSync(join(outdir, name))); }
    else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><meta charset="utf-8"><style>body{margin:0}#stage{display:grid;grid-template-columns:repeat(auto-fill,44px)}button{width:44px;height:44px}svg{width:24px;height:24px}</style><div id="stage"></div>'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  browser = await chromium.launch({ headless: true });
  report.environment.chromium = browser.version();
  report.explorer = await verifyExplorer({ browser, source: prepared[1].source, output });
  for (const pair of report.loadingPairs) {
    const labels = ['eager-registry', 'direct-icon'];
    for (const slowdown of report.protocol.loadingControl.cpuSlowdowns) for (const count of COUNTS) {
      const observations = Object.fromEntries(labels.map(label => [label, []]));
      const rows = labels.map(label => ({ label, count, slowdown, observations: observations[label] }));
      pair.browser.push(...rows);
      for (let repeat = 0; repeat < report.protocol.loadingControl.browserRepetitions; repeat++) {
        for (const label of repeat % 2 ? [...labels].reverse() : labels) {
          const sample = await withIndependentBrowser(chromium, async isolated => {
            if (isolated.version() !== report.environment.chromium) throw new Error('loading control: Chromium version изменилась между samples');
            const bundle = pair.bundles.find(bundle => bundle.label === label);
            return browserMeasurement(isolated, origin, basename(bundle.file), count, slowdown);
          });
          validateRetainedPair({ svgSha256: pair.svgSha256, completedBytes: pair.completedBytes * count, completed: count }, sample);
          observations[label].push({ ...sample, repeat, isolation: 'independent-browser-launch' });
        }
      }
      observations['eager-registry'].forEach((sample, index) => validateRetainedPair(sample, observations['direct-icon'][index]));
      for (const row of rows) row.summary = aggregate(row.observations, ['coldImportMs', 'coldImportToUsefulRenderMs', 'warmImportMs', 'firstCreateMs', 'createDomMs', 'mountLayoutMs', 'firstPaintOpportunityMs', 'cleanupMs', 'lifecycleMs', 'domElements']);
      writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
    }
  }
  for (const pair of report.staticPairs) {
    for (const slowdown of [1, 4]) {
      const observations = { imported: [], literal: [] };
      pair.browser.push(...['imported', 'literal'].map(label => ({ label, count: 1, slowdown, observations: observations[label] })));
      for (let repeat = 0; repeat < 3; repeat++) for (const label of repeat % 2 ? ['literal', 'imported'] : ['imported', 'literal']) {
        const bundle = pair.bundles.find(bundle => bundle.label === label);
        const observation = await browserMeasurement(browser, origin, basename(bundle.file), 1, slowdown);
        validateRetainedPair({ svgSha256: pair.svgSha256, completedBytes: pair.completedBytes, completed: 1 }, observation);
        observations[label].push(observation);
      }
    }
    writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
  }
  for (const result of report.cases) {
    const labels = result.candidateOnly ? ['candidate'] : ['baseline', 'candidate'];
    for (const slowdown of [1, 4]) for (const count of COUNTS) {
      const observations = { baseline: [], candidate: [] };
      const browserRows = labels.map(label => ({ label, count, slowdown, observations: observations[label] }));
      result.browser.push(...browserRows);
      for (let repeat = 0; repeat < 3; repeat++) for (const label of repeat % 2 ? [...labels].reverse() : labels) {
        const observation = await browserMeasurement(browser, origin, `${label}-${result.id}.js`, count, slowdown);
        observations[label].push(observation);
        const serverReference = result.server.find(row => row.label === label && row.count === count)?.observations[0];
        if (!serverReference) throw new Error(`${result.id}/${label}: проверенный server output отсутствует`);
        validateRetainedPair(serverReference, observation);
      }
      for (const row of browserRows) row.summary = aggregate(row.observations, ['coldImportMs', 'coldImportToUsefulRenderMs', 'warmImportMs', 'firstCreateMs', 'createDomMs', 'mountLayoutMs', 'firstPaintOpportunityMs', 'cleanupMs', 'lifecycleMs', 'domElements']);
    }
    writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
    process.stdout.write(`${result.id}: server/browser observations сохранены\n`);
  }
  await makeMotionBundle(prepared[1], outdir);
  for (const executor of ['waapi', 'lab-motion']) for (const slowdown of [1, 4]) for (const count of COUNTS) {
    const observations = [];
    const motionRow = { executor, slowdown, count, source: 'recorded @labpics/icons/ir time', authorParity: false, observations };
    report.motion.push(motionRow);
    for (let repeat = 0; repeat < 3; repeat++) observations.push(await browserMeasurement(browser, origin, 'candidate-motion.js', count, slowdown, executor));
    motionRow.summary = aggregate(observations, ['startMs', 'interruptMs', 'interruptArrivalDelayMs', 'cleanupMs']);
    writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
  }
  report.lottie = await verifyLottieConsumer({ browser, prepared: prepared[1], origin, outdir, output });
  report.authoring = await verifyAuthoringConsumer({ browser, prepared: prepared[1], origin, outdir, output });
  report.analysis = analyzeConsumerReport(report);
  report.benchmarkStatus = report.analysis.benchmarkVerdict;
  writeFileSync(join(output, 'consumer-comparison.json'), JSON.stringify(report, null, 2));
  if (report.benchmarkStatus === 'FAIL') throw new Error('benchmark: measured artifact budget failed; see analysis');
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
