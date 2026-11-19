import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { installedBrowserInputs } from './lib/installed-browser-inputs.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), output = process.env.LAB_ICONS_EVIDENCE_DIR ?? join(root, 'preview/symbol-dotlottie');
mkdirSync(output, { recursive: true });
const wasm = readFileSync(join(root, 'node_modules/@lottiefiles/dotlottie-web/dist/dotlottie-player.wasm')).toString('base64');
const source = `
import { DotLottie } from '@lottiefiles/dotlottie-web';
import { exportLottie, packDotLottie } from '@labpics/icons/lottie';
import calendar from '@labpics/icons/symbols/calendar-number';
import time from '@labpics/icons/symbols/time';
import checkmark from '@labpics/icons/symbols/checkmark-circle';
import volume from '@labpics/icons/states/volume';
DotLottie.setWasmUrl('data:application/wasm;base64,${wasm}');
const assert = (value, message) => { if (!value) throw new Error(message); };
async function mount(data, width, height) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  canvas.style.width = width + 'px'; canvas.style.height = height + 'px'; document.body.append(canvas);
  const player = new DotLottie({ canvas, data, autoplay: false, loop: false, volume: 0,
    renderConfig: { devicePixelRatio: 1, autoResize: false, freezeOnOffscreen: false } });
  await new Promise((resolve, reject) => { player.addEventListener('load', resolve); player.addEventListener('loadError', reject); });
  return { player, canvas, dispose() { player.destroy(); canvas.remove(); } };
}
async function run() {
  await DotLottie.preload();
  const receipts = [], date = day => new Date(Date.UTC(2026, 0, day, 12));
  for (const variant of ['outline', 'filled']) for (const [symbol, request] of [
    [time, { gesture: 'advance', from: -.5, to: 2.5, duration: 1000 }],
    [time, { transition: { from: { weight: 300, opsz: 48 }, to: { weight: 600, opsz: 16 } }, duration: 300 }],
    [checkmark, { gesture: 'draw', duration: 300 }],
    [calendar, { date: date(8), timeZone: 'UTC', transition: { from: {}, to: { date: date(28) } }, duration: 300 }],
    [volume, { transition: { from: { state: 'high' }, to: { state: 'mute' } }, duration: 300 }],
  ]) {
    const exported = exportLottie(symbol, { ...request, variant, color: '#0000005e' }); assert(exported.ok, JSON.stringify(exported));
    const animation = exported.animation, width = animation.w * 4, height = animation.h * 4;
    const packed = packDotLottie(animation);
    const zip = await mount(packed.buffer, width, height), json = await mount(JSON.stringify(animation), width, height);
    assert(zip.player.isLoaded && json.player.isLoaded, 'player must load both formats');
    const inks = [];
    for (const progress of [0, .125, .25, .437, .5, .75, 1]) {
      const frame = animation.meta.labIcons.terminalFrame * progress;
      zip.player.setFrame(frame); json.player.setFrame(frame);
      const a = zip.canvas.getContext('2d').getImageData(0, 0, width, height).data;
      const b = json.canvas.getContext('2d').getImageData(0, 0, width, height).data;
      let maximum = 0, ink = 0;
      for (let index = 0; index < a.length; index++) { maximum = Math.max(maximum, Math.abs(a[index] - b[index])); if (index % 4 === 3) ink += a[index]; }
      receipts.push({ symbol: symbol.id, variant, motion: request.gesture ?? 'transition', progress, maximum, ink, archiveBytes: packed.length });
      inks.push(ink);
      assert(maximum === 0, 'dotLottie must render the same JSON: ' + JSON.stringify(receipts.at(-1)));
      if (progress === 1) assert(ink > 0, 'terminal pose must be visible');
    }
    assert(new Set(inks).size > 1, 'setFrame must change the rendered pose');
    if (symbol === checkmark) assert(variant === 'filled' ? inks[0] > inks.at(-1) : inks[0] < inks.at(-1), 'draw must subtract in Filled and add in Outline');
    zip.dispose(); json.dispose();
  }
  window.result = receipts;
}
run().catch(error => { window.failure = error?.stack ?? JSON.stringify(error); });
`;
const bundle = await build({ stdin: { contents: source, resolveDir: process.env.LAB_ICONS_CONSUMER_DIR ?? root, sourcefile: 'dotlottie-consumer.ts' },
  absWorkingDir: root, nodePaths: [join(root, 'node_modules')], bundle: true, format: 'esm', write: false, metafile: true, target: 'es2022' });
writeFileSync(join(output, 'inputs.json'), JSON.stringify(installedBrowserInputs(bundle.metafile, root, process.env.LAB_ICONS_CONSUMER_DIR), null, 2) + '\n');
let browser;
try {
  browser = await chromium.launch({ ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }), headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><body><script type="module">${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`);
  await page.waitForFunction(() => window.result || window.failure, undefined, { timeout: 60000 });
  const result = await page.evaluate(() => window.result ?? { error: window.failure });
  assert(Array.isArray(result), JSON.stringify(result)); assert.equal(result.length, 70);
  writeFileSync(join(output, 'receipt.json'), JSON.stringify(result, null, 2) + '\n');
  const summary = { player: '@lottiefiles/dotlottie-web@0.83.2', browser: browser.version(), comparisons: result.length, maxDelta: Math.max(...result.map(item => item.maximum)) };
  writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
} finally { await browser?.close(); }
