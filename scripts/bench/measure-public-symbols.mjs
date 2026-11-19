#!/usr/bin/env node
/** Bounded observation of the installed public render/mount API, independent of the historical IR benchmark. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { cpus, platform, release, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, gzipSync } from 'node:zlib';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { localTarballSpecifier, pnpmInvocation } from '../check-package-artifact.js';
import { installPublicSymbolProbe } from './public-symbol-scene.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const args = process.argv.slice(2);
const option = name => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;
const output = resolve(option('--output') ?? join(root, 'preview/public-symbols/report.json'));
const repetitions = Number(option('--repetitions') ?? 3);
assert.ok(Number.isInteger(repetitions) && repetitions >= 1 && repetitions <= 10, '--repetitions must be 1…10');
const temporary = mkdtempSync(join(tmpdir(), 'lab-icons-public-symbols-'));
const consumer = join(temporary, 'consumer');
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const run = (file, arguments_, cwd = root) => execFileSync(file, arguments_, { cwd, encoding: 'utf8', windowsHide: true,
  timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
const pnpm = (arguments_, cwd) => { const invocation = pnpmInvocation(arguments_); return run(invocation.file, invocation.args, cwd); };
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const counts = [1, 100, 1000];
const report = { schema: 1, generatedAt: new Date().toISOString(), sourceSha: run('git', ['rev-parse', 'HEAD']).trim(),
  sourceChanges: run('git', ['status', '--porcelain']).trim(),
  environment: { node: process.version, os: `${platform()} ${release()}`, cpu: cpus()[0]?.model,
    logicalCpus: cpus().length, playwright: JSON.parse(readFileSync(join(root, 'node_modules/playwright/package.json'))).version },
  protocol: { counts, repetitions, api: ['@labpics/icons/render:renderIcon', '@labpics/icons/motion:createSymbolMotion.mount'],
    symbol: 'reload', options: { variant: 'outline', size: 20, weight: 500, opsz: 'auto' },
    isolation: 'independent Chromium process and profile per observation; HTTP cache disabled; OS cache shared',
    viewport: { width: 1280, height: 800 }, cpuSlowdown: 1, activeWindowMs: 300, quietWindowMs: 200,
    workloads: ['effect cycle, duration 2000ms, then stop', 'weight 500→600, duration 2000ms, then dispose while active'],
    timing: 'native FCP in initially empty document; frame callback timing includes instrumentation; CDP timeTicks',
    heap: 'CDP Runtime.getHeapUsage after forced GC; snapshots, not peak or proof of absent leaks',
    claim: 'local observations and lifecycle assertions; no old/new speedup, p95 confidence or production performance budget' },
  methodSha256: Object.fromEntries(['measure-public-symbols.mjs', 'public-symbol-scene.js'].map(file => [file,
    sha256(readFileSync(new URL(file, import.meta.url)))])), bundles: {}, observations: [] };
const persist = () => { mkdirSync(dirname(output), { recursive: true }); writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); };
let server, browser;
async function memory(cdp) {
  await cdp.send('HeapProfiler.collectGarbage');
  return { ...await cdp.send('Runtime.getHeapUsage'), ...await cdp.send('Memory.getDOMCounters') };
}
async function metrics(cdp) {
  const result = await cdp.send('Performance.getMetrics');
  return Object.fromEntries(result.metrics.map(({ name, value }) => [name, value]));
}
function delta(before, after) {
  return Object.fromEntries(['ScriptDuration', 'LayoutDuration', 'RecalcStyleDuration', 'TaskDuration']
    .map(key => [`${key}Ms`, (after[key] - before[key]) * 1000]));
}
try {
  mkdirSync(consumer);
  const existing = option('--tarball');
  if (!existing) { process.stdout.write('public symbols: production pack\n'); pnpm(['pack', '--pack-destination', temporary], root); }
  const tarball = existing ? resolve(existing) : join(temporary, readdirSync(temporary).find(file => file.endsWith('.tgz')));
  const bytes = readFileSync(tarball);
  report.package = { name: pkg.name, sha256: sha256(bytes), bytes: bytes.length, productionPrepack: !existing,
    sourceSha: existing ? null : report.sourceSha };
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'public-symbol-measurement', private: true, type: 'module',
    packageManager: pkg.packageManager, dependencies: { '@labpics/icons': localTarballSpecifier(consumer, tarball),
      '@labpics/motion': pkg.devDependencies['@labpics/motion'] } }));
  pnpm(['install', '--ignore-scripts', '--no-lockfile'], consumer);
  report.package.version = JSON.parse(readFileSync(join(consumer, 'node_modules/@labpics/icons/package.json'))).version;
  report.package.motionVersion = JSON.parse(readFileSync(join(consumer, 'node_modules/@labpics/motion/package.json'))).version;
  const files = new Map();
  for (const kind of ['render', 'motion']) {
    const contents = `export { default as symbol } from '@labpics/icons/symbols/reload';\n` + (kind === 'render'
      ? "export { renderIcon } from '@labpics/icons/render';"
      : "export { createSymbolMotion } from '@labpics/icons/motion'; export * as motion from '@labpics/motion';");
    const bundle = await build({ stdin: { contents, resolveDir: consumer }, bundle: true, write: false, metafile: true,
      minify: true, platform: 'browser', format: 'esm', target: 'es2022' });
    const js = bundle.outputFiles[0].contents;
    const inputs = Object.entries(Object.values(bundle.metafile.outputs)[0].inputs)
      .filter(([, entry]) => entry.bytesInOutput > 0)
      .map(([file, entry]) => ({ file: file.replaceAll('\\', '/').split('/node_modules/').at(-1), bytesInOutput: entry.bytesInOutput }));
    assert.deepEqual(inputs.filter(({ file }) => /\/symbols\/.*\.js$/.test(file)).map(({ file }) => file.split('/symbols/')[1]), ['reload.js']);
    assert.ok(!inputs.some(({ file }) => /\/(ir|authoring)\//.test(file)), `${kind} retained offline or legacy IR runtime`);
    if (kind === 'render') assert.ok(!inputs.some(({ file }) => file.includes('/motion/')), 'render retained motion');
    report.bundles[kind] = { rawBytes: js.length, gzipBytes: gzipSync(js).length, brotliBytes: brotliCompressSync(js).length,
      sha256: sha256(js), retainedInputs: inputs };
    files.set(`/${kind}.js`, js);
  }
  server = createServer((request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    // Isolated high-resolution clock; this is a local fixture, not an application deployment claim.
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    response.setHeader('Cross-Origin-Embedder-Policy', 'require-corp');
    const js = files.get(request.url);
    response.setHeader('Content-Type', js ? 'text/javascript' : 'text/html');
    response.end(js ?? '<!doctype html><html><head><style>body{margin:0;color:#263341}main{display:flex;flex-wrap:wrap;width:1200px}main>span{display:flex;width:24px;height:24px;align-items:center;justify-content:center}</style></head><body></body></html>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  for (let repeat = 0; repeat < repetitions; repeat++) for (const count of counts) {
    for (const kind of repeat % 2 ? ['motion', 'render'] : ['render', 'motion']) {
      browser = await chromium.launch({ headless: true, ...(args.includes('--chrome') && { channel: 'chrome' }) });
      report.environment.chromium = browser.version();
      const page = await browser.newPage({ viewport: report.protocol.viewport, reducedMotion: 'no-preference' });
      const errors = []; page.on('pageerror', error => errors.push(error.message));
      const cdp = await page.context().newCDPSession(page);
      await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      await cdp.send('Performance.enable', { timeDomain: 'timeTicks' });
      await page.goto(origin); await page.evaluate(installPublicSymbolProbe);
      const beforeMemory = await memory(cdp), beforeMetrics = await metrics(cdp);
      const loaded = await page.evaluate(({ url, kind, count }) => symbolProbe.load(url, kind, count), { url: `${origin}/${kind}.js`, kind, count });
      const loadedMetrics = await metrics(cdp), mountedMemory = await memory(cdp);
      const observation = { repeat, kind, count, loaded, loadCpu: delta(beforeMetrics, loadedMetrics), memory: { before: beforeMemory, mounted: mountedMemory } };
      if (kind === 'motion') {
        observation.active = {};
        for (const workload of ['effect', 'optical']) {
          const before = await metrics(cdp);
          const result = await page.evaluate(workload => symbolProbe.active(workload, 300), workload);
          const after = await metrics(cdp);
          result.cpu = delta(before, after);
          observation.active[workload] = result;
          if (workload === 'effect') observation.stopped = await page.evaluate(() => symbolProbe.stop());
        }
      }
      observation.disposed = await page.evaluate(() => symbolProbe.dispose());
      observation.memory.disposed = await memory(cdp);
      assert.deepEqual(errors, [], 'browser errors');
      report.observations.push(observation); persist();
      await browser.close(); browser = undefined;
      process.stdout.write(`public symbols: ${kind} ${count}, repeat ${repeat + 1}: FCP ${loaded.importToFcpMs.toFixed(2)}ms\n`);
    }
  }
  report.status = 'PASS'; persist();
  process.stdout.write(`public symbols: ${output}\n`);
} catch (error) { report.status = 'FAIL'; report.failure = error.stack; persist(); throw error; }
finally {
  if (browser) await browser.close();
  if (server) await new Promise(resolve => server.close(resolve));
  rmSync(temporary, { recursive: true, force: true });
}
