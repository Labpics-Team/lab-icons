import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url)), output = join(root, 'preview/symbol-lottie');
mkdirSync(output, { recursive: true });
const corpus = process.argv[2]?.startsWith('corpus') ?? false;
const names = corpus ? Object.keys(JSON.parse(readFileSync(join(root, 'semantics/figma-baseline.json'))).icons).filter(name => !process.argv[2].includes(':') || name === process.argv[2].split(':')[1]) : [];
const source = `
import lottie from 'lottie-web';
import * as motion from '@labpics/motion';
import { createSymbolMotion } from '@labpics/icons/motion';
import { exportLottie as exportSymbolLottie } from '@labpics/icons/lottie';
${names.map((name, i) => `import corpus${i} from '@labpics/icons/symbols/${name}';`).join('\n')}
import calendar from '@labpics/icons/symbols/calendar-number';
import time from '@labpics/icons/symbols/time';
import history from '@labpics/icons/symbols/history';
import checkmark from '@labpics/icons/symbols/checkmark-circle';
import database from '@labpics/icons/symbols/database-search';
import calendarFamily from '@labpics/icons/states/calendar';
import volumeFamily from '@labpics/icons/states/volume';
const icons = createSymbolMotion(motion), date = day => new Date(Date.UTC(2026, 0, day, 12));
const assert = (value, message) => { if (!value) throw new Error(message); };
async function raster(svg, width, height) {
  const bitmap = new Image(); bitmap.src = 'data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  await bitmap.decode(); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}
const cases = [
  ${names.map((name, i) => `{ name: ${JSON.stringify(name)}, symbol: corpus${i}, options: {} },`).join('\n')}
  { name: 'calendar-static', symbol: calendar, options: { date: date(28), timeZone: 'UTC' } },
  { name: 'independent-paints', symbol: database, options: {} },
  ...[time, history].map(symbol => ({ name: symbol.id + '-advance', symbol, options: { gesture: 'advance', from: -.3, to: 1.8, duration: 1000 } })),
  { name: 'positive-negative-draw', symbol: checkmark, options: { gesture: 'draw', duration: 360 } },
  { name: 'reverse-draw', symbol: checkmark, options: { gesture: 'draw', from: 1, to: 0, duration: 360 } },
  { name: 'date-transition', symbol: calendar, options: { date: date(8), timeZone: 'UTC', transition: { from: {}, to: { date: date(28) } }, duration: 300 } },
  { name: 'calendar-state', symbol: calendarFamily, options: { date: date(8), timeZone: 'UTC', transition: { from: { state: 'date' }, to: { state: 'grid' } }, duration: 300 } },
  { name: 'volume-state', symbol: volumeFamily, options: { transition: { from: { state: 'high' }, to: { state: 'mute' } }, duration: 300 } },
  { name: 'optical-transition', symbol: time, options: { transition: { from: { weight: 300, opsz: 48 }, to: { weight: 600, opsz: 16 } }, duration: 300 } },
  { name: 'date-optical-transition', symbol: calendar, options: { date: date(8), timeZone: 'UTC', transition: { from: { weight: 300, opsz: 48 }, to: { date: date(28), weight: 600, opsz: 16 } }, duration: 300 } },
];
const selectedCase = ${JSON.stringify(corpus ? null : process.argv[2] ?? null)};
const corpusCount = ${names.length};
async function run() {
  const receipts = [];
  for (const item of (corpusCount ? cases.slice(0, corpusCount) : cases).filter(item => !selectedCase || item.name === selectedCase)) for (const variant of ['outline', 'filled']) for (const weight of corpusCount ? [400] : [300, 400, 600]) for (const opsz of corpusCount ? [24] : [16, 24, 48]) {
    const request = { ...item.options, variant, weight, opsz, color: '#0000005e' };
    const result = exportSymbolLottie(item.symbol, request); assert(result.ok, item.name + ': ' + JSON.stringify(result));
    const animation = result.animation, metadata = animation.meta.labIcons;
    const width = animation.w * 4, height = animation.h * 4;
    const container = document.createElement('div'); document.body.append(container);
    const player = lottie.loadAnimation({ container, renderer: 'svg', loop: false, autoplay: false, animationData: animation });
    await new Promise((resolve, reject) => { player.addEventListener('DOMLoaded', resolve); player.addEventListener('data_failed', reject); });
    const render = { variant, weight, opsz, ...Object.fromEntries(['date', 'timeZone', 'state'].filter(key => request[key] !== undefined).map(key => [key, request[key]])) };
    const icon = icons.mount(document.body, item.symbol, request.transition ? { ...render, ...request.transition.from } : render);
    icon.element.style.color = 'rgba(0,0,0,' + 94 / 255 + ')';
    let control;
    if (request.gesture) {
      icon.effect(request.gesture, { to: request.from ?? 0, reducedMotion: true });
      control = icon.effect(request.gesture, { to: request.to ?? 1, duration: metadata.durationMs }); control.pause();
    } else if (request.transition) { control = icon.set({ ...render, ...request.transition.to }, { duration: metadata.durationMs }); control.pause(); }
    for (const progress of metadata.durationMs ? [0, .125, .25, .437, .5, .75, 1] : [1]) {
      player.goToAndStop(metadata.terminalFrame * progress, true);
      control?.seek(metadata.durationMs * progress);
      const svg = container.querySelector('svg'); svg.setAttribute('width', width); svg.setAttribute('height', height);
      icon.element.setAttribute('width', width); icon.element.setAttribute('height', height);
      icon.element.setAttribute('viewBox', [-metadata.offset[0], -metadata.offset[1], animation.w, animation.h].join(' '));
      if (corpusCount && variant === 'filled' || item.name === 'volume-state' && variant === 'outline' && weight === 300 && opsz === 48 && progress === 1) {
        window.debug = { actual: new XMLSerializer().serializeToString(svg), expected: new XMLSerializer().serializeToString(icon.element) };
      }
      const actual = await raster(svg, width, height), expected = await raster(icon.element, width, height);
      let total = 0, maximum = 0, alpha = 0, expectedAlpha = 0;
      for (let index = 3; index < actual.length; index += 4) { const delta = Math.abs(actual[index] - expected[index]); total += delta; maximum = Math.max(maximum, delta); alpha = Math.max(alpha, actual[index]); expectedAlpha = Math.max(expectedAlpha, expected[index]); }
      receipts.push({ name: item.name, variant, weight, opsz, progress, mean: total / (actual.length / 4), maximum, alpha, expectedAlpha });
    }
    icon.dispose(); player.destroy(); container.remove();
  }
  window.result = receipts;
}
run().catch(error => { window.failure = error.stack; });
`;
const bundle = await build({ stdin: { contents: source, resolveDir: process.env.LAB_ICONS_CONSUMER_DIR ?? root, sourcefile: 'symbol-lottie-consumer.ts' },
  nodePaths: [join(root, 'node_modules')], bundle: true, format: 'esm', write: false, target: 'es2022' });
const html = `<!doctype html><html><body><script type="module">${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage(); await page.setContent(html);
  await page.waitForFunction(() => window.result || window.failure, undefined, { timeout: 60000 });
  const result = await page.evaluate(() => window.result ?? { error: window.failure });
  assert(Array.isArray(result), result.error);
  writeFileSync(join(output, corpus ? 'corpus-receipt.json' : 'receipt.json'), JSON.stringify(result, null, 2) + '\n');
  const debug = await page.evaluate(() => window.debug);
  if (debug) writeFileSync(join(output, 'debug.json'), JSON.stringify(debug, null, 2) + '\n');
  const summary = { comparisons: result.length, worst: result.toSorted((a, b) => b.mean - a.mean).slice(0, 10),
    alphaMismatches: result.filter(item => Math.abs(item.alpha - item.expectedAlpha) > 1).length };
  console.log(JSON.stringify(summary));
  // Lottie emits SVG C for source L. The same line locus can rasterize
  // differently at pixel edges (measured diagonal volume case: mean .0912).
  assert(result.every(item => item.mean < (corpus ? .05 : .125) && item.maximum <= 32 && Math.abs(item.alpha - item.expectedAlpha) <= 1),
    'Lottie and common Motion exceed the measured raster tolerance; see preview/symbol-lottie/receipt.json');
} finally { await browser?.close(); }
