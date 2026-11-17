import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';

const root = fileURLToPath(new URL('..', import.meta.url));
const site = resolve(root, 'preview/catalog');
const output = join(root, 'preview/catalog-check');
await mkdir(output, { recursive: true });
const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer(async (request, response) => {
  try {
    const path = resolve(site, `.${decodeURIComponent(new URL(request.url, 'http://localhost').pathname)}`);
    if (path !== site && !path.startsWith(`${site}${sep}`)) { response.writeHead(403).end(); return; }
    const file = path === site ? join(path, 'index.html') : path;
    response.setHeader('Content-Type', types[extname(file)] ?? 'text/plain'); response.end(await readFile(file));
  } catch { response.writeHead(404).end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }), headless: true, args: ['--mute-audio'] });
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1120 }, acceptDownloads: true, colorScheme: 'light', reducedMotion: 'no-preference' });
  const page = await context.newPage();
  const errors = [], failed = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('response', response => { if (response.status() >= 400) failed.push([response.status(), response.url()]); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: base });
  const ready = () => page.waitForFunction(() => document.querySelector('#settings')?.disabled === false);
  const change = (id, value) => page.locator(`#${id}`).evaluate((node, value) => { node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true })); }, value);
  const geometry = () => page.locator('#stage svg').innerHTML();
  async function download(format) {
    await page.locator('#format').selectOption(format);
    const result = page.waitForEvent('download');
    await page.locator('#download').click();
    const file = await result;
    return { name: file.suggestedFilename(), bytes: await readFile(await file.path()) };
  }
  async function copiedCode() {
    await page.locator('#copy').click();
    await page.waitForFunction(() => document.querySelector('#copy-status').textContent === 'Скопировано');
    return page.evaluate(() => navigator.clipboard.readText());
  }
  async function runSnippet(source) {
    await page.evaluate(() => { window.__copiedView?.dispose(); document.querySelector('#icon')?.remove(); const element = document.createElement('span'); element.id = 'icon'; document.body.append(element); });
    const result = await build({ stdin: { contents: source, resolveDir: root }, bundle: true, format: 'esm', write: false, platform: 'browser' });
    await page.addScriptTag({ type: 'module', content: result.outputFiles[0].text });
    await page.waitForFunction(() => !!document.querySelector('#icon svg'));
    assert.equal(await page.locator('#icon').evaluate(node => getComputedStyle(node).color), 'rgb(201, 53, 84)');
  }
  await page.goto(`${base}/?icon=time`);
  await ready();
  await page.evaluate(() => document.fonts.ready);
  assert.equal(await page.locator('.symbol-tile').count(), 330);
  const cdp = await context.newCDPSession(page);
  await cdp.send('DOM.enable'); await cdp.send('CSS.enable');
  const { root: documentNode } = await cdp.send('DOM.getDocument');
  const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: documentNode.nodeId, selector: '#library-title' });
  const { fonts } = await cdp.send('CSS.getPlatformFontsForNode', { nodeId });
  assert(fonts.length && fonts.every(font => font.isCustomFont && /Geist/.test(font.familyName)), `Unexpected rendered fonts: ${JSON.stringify(fonts)}`);
  await page.screenshot({ path: join(output, 'light.png') });
  await page.locator('#theme').click();
  await page.screenshot({ path: join(output, 'dark.png') });
  await page.locator('#theme').click();
  await change('color', '#c93554');
  await page.locator('#animation').selectOption('');
  await runSnippet(await copiedCode());
  assert.equal(await page.locator('#icon svg').getAttribute('width'), '24');
  assert(await page.locator('#icon svg path').count() > 0);
  await page.locator('#animation').selectOption('advance');
  await runSnippet((await copiedCode()) + '\nwindow.__copiedView = view;');
  await page.evaluate(() => { window.__copiedView.dispose(); document.querySelector('#icon').remove(); });
  await change('progress', 0);
  const start = await geometry();
  await change('progress', 0.5);
  assert.notEqual(await geometry(), start, 'Scrubbing did not change the symbol');
  await page.locator('#play').click();
  await page.waitForFunction(() => Number(document.querySelector('#progress').value) > .5);
  await page.locator('#play').click();
  assert.equal(await page.locator('#play-label').textContent(), 'Воспроизвести');
  await page.locator('#reverse').click();
  await page.waitForFunction(() => document.querySelector('#progress').value === '0');
  assert.equal(await geometry(), start, 'Reverse did not restore the starting pose');
  const svg = await download('svg');
  assert.equal(svg.name, 'time.svg'); assert.match(svg.bytes.toString(), /<svg/); assert.match(svg.bytes.toString(), /#c93554/);
  const lottie = JSON.parse((await download('lottie')).bytes);
  assert(lottie.layers.length && lottie.op > lottie.ip, 'Lottie has no animated layers');
  const dot = unzipSync((await download('dotlottie')).bytes);
  assert(dot['manifest.json']);
  const manifest = JSON.parse(new TextDecoder().decode(dot['manifest.json']));
  assert.equal(manifest.version, '2');
  assert(dot[`a/${manifest.animations[0].id}.json`]);
  const kotlin = await download('kotlin'); assert.match(kotlin.name, /\.kt$/); assert.match(kotlin.bytes.toString(), /SymbolData/);
  await page.locator('#reduce-motion').check();
  await page.locator('#play').click();
  assert.equal(await page.locator('#progress').inputValue(), '1');
  await page.locator('#reduce-motion').uncheck();
  await page.locator('#search').fill('calendar');
  await page.locator('[data-id="calendar-number"]').click();
  await page.waitForFunction(() => document.querySelector('#symbol-name').textContent === 'calendar-number' && !document.querySelector('#settings').disabled);
  await page.screenshot({ path: join(output, 'calendar.png') });
  await page.locator('#date').fill('2026-11-18');
  await page.locator('#date').dispatchEvent('change');
  assert.match(await page.locator('#import-code').textContent(), /2026-11-18/);
  await page.locator('#date').fill(''); await page.locator('#date').dispatchEvent('change');
  await page.locator('[data-id="calendar-clear"]').click(); await ready();
  assert.equal(await page.locator('#symbol-name').textContent(), 'calendar-clear');
  assert.equal(await page.locator('#stage svg').count(), 1);
  await page.locator('[data-id="calendar-number"]').click(); await ready();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator('#close-detail').click();
  await page.locator('#clear-search').evaluate(button => { document.querySelector('#search').value = ''; document.querySelector('#search').dispatchEvent(new Event('input')); });
  await page.screenshot({ path: join(output, 'mobile-grid.png') });
  await page.locator('[data-id="calendar-number"]').click();
  await page.waitForFunction(() => !document.querySelector('#settings').disabled);
  await page.screenshot({ path: join(output, 'mobile-detail.png') });
  await page.locator('#close-detail').click();
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'calendar-number');
  // A default mobile visit leaves search available; a deep link opens its detail.
  await page.goto(base); await ready();
  assert.equal(await page.locator('#inspector').isVisible(), false);
  assert.equal(await page.locator('#search').evaluate(node => !!node.closest('[inert]')), false);
  await page.locator('#search').fill('volume-high');
  await page.locator('[data-id="volume-high"]').click(); await ready();
  const volumeHigh = await geometry();
  await page.locator('[data-state="mute"]').click();
  await page.locator('#reduce-motion').check();
  await page.locator('#reverse').click();
  assert.equal(await page.locator('#progress').inputValue(), '0');
  assert.equal(await geometry(), volumeHigh, 'Reduced reverse must show the actual initial state');
  await page.keyboard.press('Escape');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'volume-high', 'Close should restore the actual opener after changing state');
  await page.goto(`${base}/?icon=time`); await ready();
  assert.equal(await page.locator('#inspector').getAttribute('aria-modal'), 'true');
  // Closing while an uncached module loads must not reopen the detail or steal focus.
  await page.locator('#close-detail').click();
  let releaseModule;
  const held = new Promise(resolve => { releaseModule = resolve; });
  await page.route('**/assets/*', async route => { await held; await route.continue(); });
  await page.locator('#search').fill('paw');
  await page.locator('[data-id="paw"]').click();
  await page.locator('#close-detail').click();
  releaseModule(); await ready(); await page.unroute('**/assets/*');
  assert.equal(await page.locator('#inspector').isVisible(), false);
  assert.equal(await page.evaluate(() => document.activeElement.dataset.id), 'paw');
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ errors, failed, symbols: 330, fonts, checks: ['light/dark/mobile', 'rendered Cyrillic font', 'working copied code and color', 'play/pause/scrub/reverse/reduced motion', 'SVG/Lottie/dotLottie/Kotlin downloads', 'date', 'mobile focus and async close'] }, null, 2) + '\n');
  console.log('Catalog: 330 symbols, rendered Geist, working copy, playback, four downloads, mobile focus and async close');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
