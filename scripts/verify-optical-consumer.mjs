import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { localTarballSpecifier, pnpmInvocation } from './check-package-artifact.js';
import { compileOpticalCorpus } from './lib/optical-corpus.js';

// Verifies the assembled artifact, including an explicitly requested draft
// preview. Production pack additionally runs the normal clean prepack checks.
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = mkdtempSync(join(tmpdir(), 'lab-icons-optical-consumer-'));
const stage = join(temporary, 'package'), consumer = join(temporary, 'consumer');
const preview = process.argv.includes('--preview');
const optics = compileOpticalCorpus(root, { preview });
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const output = join(root, 'preview/optical-consumer');
const run = (file, args, cwd) => execFileSync(file, args, { cwd, encoding: 'utf8', windowsHide: true, timeout: 120_000, maxBuffer: 16 * 1024 * 1024 });
const pnpm = (args, cwd) => {
  const invocation = pnpmInvocation(args);
  return run(invocation.file, invocation.args, cwd);
};
let browser;
try {
  mkdirSync(stage); mkdirSync(consumer); mkdirSync(output, { recursive: true });
  const { scripts: _scripts, devDependencies: _devDependencies, ...artifactPackage } = pkg;
  writeFileSync(join(stage, 'package.json'), JSON.stringify(artifactPackage));
  for (const file of pkg.files) {
    const target = join(stage, file); mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, file), target);
  }
  pnpm(['pack', '--pack-destination', temporary], stage);
  const tarballs = readdirSync(temporary).filter(file => file.endsWith('.tgz'));
  assert.equal(tarballs.length, 1);
  writeFileSync(join(consumer, 'package.json'), JSON.stringify({ name: 'lab-icons-optical-consumer', private: true,
    type: 'module', packageManager: pkg.packageManager,
    dependencies: { '@labpics/icons': localTarballSpecifier(consumer, join(temporary, tarballs[0])) } }));
  pnpm(['install', '--offline', '--ignore-scripts', '--no-lockfile', '--store-dir', join(temporary, 'store')], consumer);

  writeFileSync(join(consumer, 'expected.json'), JSON.stringify(Object.fromEntries(Object.entries(optics.symbols).map(([id, symbol]) =>
    [id, { outline: symbol.outline, filled: symbol.filled, data: symbol.data }]))));
  writeFileSync(join(consumer, 'smoke.mjs'), `
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { renderIcon } from '@labpics/icons/render';
const expected = JSON.parse(readFileSync(new URL('./expected.json', import.meta.url), 'utf8'));
let renders = 0;
for (const [id, oracle] of Object.entries(expected)) {
  const { default: symbol } = await import('@labpics/icons/symbols/' + id);
  assert.deepEqual(symbol.data, oracle.data);
  for (const variant of ['outline', 'filled']) {
    assert.equal(renderIcon(symbol, { variant }), oracle[variant]);
    for (const weight of [300, 350, 400, 500, 600]) for (const opsz of [16, 20, 24, 36, 48]) {
      const svg = renderIcon(symbol, { variant, weight, opsz, size: 20 });
      assert.ok(svg.includes('width="20" height="20"'));
      assert.ok(!svg.includes('NaN') && !svg.includes('Infinity'));
      renders++;
    }
  }
}
console.log(JSON.stringify({ families: Object.keys(expected).length, renders }));
`);
  const runtime = JSON.parse(run(process.execPath, [join(consumer, 'smoke.mjs')], consumer));
  const consumerSource = `
import symbol from '@labpics/icons/symbols/plus-circle';
import { renderIcon, type IconSymbol, type RenderIconOptions } from '@labpics/icons/render';
const typed: IconSymbol = symbol;
const options: RenderIconOptions = { weight: 500, opsz: 'auto', size: 20 };
const rendered: string = renderIcon(typed, options);
document.body.innerHTML = '<h1>Installed Icons consumer</h1>' + ['outline', 'filled'].map(variant =>
  '<section><h2>' + variant + '</h2>' + [16, 24, 48].map(size => '<div>' + [300, 400, 600].map(weight =>
    '<span>' + renderIcon(symbol, { variant: variant as 'outline' | 'filled', size, weight }) + '<small>' + size + ' / ' + weight + '</small></span>'
  ).join('') + '</div>').join('') + '</section>').join('');
globalThis.document.body.dataset.ready = String(rendered.length > 0);
`;
  const entry = join(consumer, 'consumer.ts'); writeFileSync(entry, consumerSource);
  writeFileSync(join(consumer, 'tsconfig.json'), JSON.stringify({ compilerOptions: { target: 'ES2022', module: 'NodeNext',
    moduleResolution: 'NodeNext', lib: ['ES2022', 'DOM'], strict: true, noEmit: true, skipLibCheck: false }, files: ['consumer.ts'] }));
  run(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(consumer, 'tsconfig.json')], consumer);
  const bundle = await build({ absWorkingDir: consumer, entryPoints: [entry], bundle: true, write: false, metafile: true,
    platform: 'browser', format: 'iife', minify: true, target: 'es2022' });
  const included = Object.entries(Object.values(bundle.metafile.outputs)[0].inputs).filter(([, value]) => value.bytesInOutput > 0).map(([file]) => file);
  const symbolModules = included.filter(file => /\/symbols\/.*\.js$/.test(file));
  assert.equal(symbolModules.length, 1, `single-symbol import included ${symbolModules.length} families`);
  assert.ok(symbolModules[0].endsWith('/symbols/plus-circle.js'));
  assert.ok(!included.some(file => /\/(ir|motion|authoring)\//.test(file)), `unexpected runtime dependency: ${included}`);
  const staticBundle = await build({ absWorkingDir: consumer, stdin: { contents: "export { outline } from '@labpics/icons/symbols/plus-circle';", resolveDir: consumer },
    bundle: true, write: false, minify: true, format: 'esm', target: 'es2022' });
  assert.ok(!staticBundle.outputFiles[0].text.includes('coordinates'));
  assert.ok(staticBundle.outputFiles[0].text.length < optics.symbols['plus-circle'].outline.length + 100);

  browser = await chromium.launch({ ...(process.argv.includes('--chrome') ? { channel: 'chrome' } : {}), headless: true });
  const page = await browser.newPage({ viewport: { width: 780, height: 700 }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent('<!doctype html><html><head><style>body{font:16px system-ui;background:#f7f8fa;color:#263341;margin:40px}h1{font-size:22px}section{display:inline-block;vertical-align:top;margin-right:40px}h2{font-size:16px}section div{display:flex;gap:20px;margin:20px 0}span{display:flex;align-items:center;justify-content:center;flex-direction:column;gap:12px;width:72px;height:112px}small{font-size:12px;color:#697584}</style></head><body></body></html>');
  await page.evaluate(() => {
    window.__iconRafCalls = 0;
    const original = window.requestAnimationFrame;
    window.requestAnimationFrame = callback => { window.__iconRafCalls++; return original(callback); };
    window.ResizeObserver = class { constructor() { throw new Error('static Icon created ResizeObserver'); } };
  });
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  const observation = await page.evaluate(() => ({ ready: document.body.dataset.ready, svg: document.querySelectorAll('svg').length,
    frames: window.__iconRafCalls, overflow: document.documentElement.scrollWidth > innerWidth,
    widths: [...new Set([...document.querySelectorAll('svg')].map(svg => svg.getBoundingClientRect().width))] }));
  assert.deepEqual(errors, []); assert.equal(observation.ready, 'true'); assert.equal(observation.svg, 18);
  assert.equal(observation.frames, 0); assert.equal(observation.overflow, false); assert.deepEqual(observation.widths, [16, 24, 48]);
  await page.screenshot({ path: join(output, 'consumer.png'), fullPage: true });
  const report = { version: pkg.version, preview, ...runtime, browser: browser.version(), observation,
    singleSymbol: { bytes: bundle.outputFiles[0].contents.length, modules: included }, staticBytes: staticBundle.outputFiles[0].contents.length };
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser?.close();
  rmSync(temporary, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
}
