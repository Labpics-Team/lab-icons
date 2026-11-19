import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'esbuild';
import { unzipSync } from 'fflate';
import { parseDocumentation } from './lib/docs-markdown.js';

function playbackFinished(end) {
  return document.querySelector('#progress').value === String(end)
    && document.querySelector('#play-label').textContent === 'Воспроизвести';
}

async function verifyPlaybackBoundaries(browser, base) {
  const context = await browser.newContext({ reducedMotion: 'no-preference' });
  try {
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.clock.install({ time: new Date('2026-11-19T00:00:00Z') });
    await page.goto(`${base}/?icon=time`);
    await page.waitForFunction(() => document.querySelector('#settings')?.disabled === false);
    await page.clock.pauseAt(new Date('2026-11-19T00:01:00Z'));
    await page.locator('#animation').selectOption('advance');
    const geometry = () => page.locator('#stage svg').innerHTML();
    const scrub = value => page.locator('#progress').evaluate((node, value) => {
      node.value = String(value); node.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
    const click = id => page.locator(`#${id}`).evaluate(node => node.click());
    const start = await geometry();
    await scrub(0.5);
    const middle = await geometry();

    async function roundedEndpoint(id, end) {
      await scrub(0.5);
      // Clock schedules integer-ms frames. Start 0.1 ms after the integer tick
      // so the last pre-completion frame is inside the range's rounding window.
      const alignment = await page.evaluate(() => (16 - (performance.now() + 500) % 16) % 16);
      await page.clock.runFor(alignment);
      await page.locator(`#${id}`).evaluate(node => {
        const now = performance.now.bind(performance);
        Object.defineProperty(performance, 'now', { configurable: true, value: () => now() + 0.1 });
        try { node.click(); }
        finally { Object.defineProperty(performance, 'now', { configurable: true, value: now }); }
      });
      await page.clock.runFor(500);
      assert.equal(await page.locator('#progress').inputValue(), String(end));
      assert.equal(await page.evaluate(playbackFinished, end), false, 'A rounded range endpoint is not playback completion');
    }

    await roundedEndpoint('reverse', 0);
    const almostStart = await geometry();
    assert.notEqual(almostStart, start, 'The fractional frame must precede the exact starting pose');
    const roundedReverse = await page.evaluate(() => ({
      range: document.querySelector('#progress').value,
      label: document.querySelector('#play-label').textContent,
      minute: document.querySelector('[data-part="clock-minute"]').getAttribute('transform'),
    }));
    await click('play'); // Pause with a nonzero position that the range displays as 0.
    await click('reverse');
    assert.equal(await geometry(), almostStart, 'Reverse after pausing near zero must preserve the exact position');
    await page.clock.runFor(16);
    assert.equal(await page.evaluate(playbackFinished, 0), true);
    assert.equal(await geometry(), start, 'Reverse must finish at the exact starting pose');

    await scrub(1);
    const end = await geometry();
    await scrub(0.5);
    assert.equal(await geometry(), middle, 'Scrubbing back from a completed clip must restore the midpoint');
    await scrub(1);
    await click('reverse');
    await page.clock.runFor(1016);
    assert.equal(await page.evaluate(playbackFinished, 0), true);
    assert.equal(await geometry(), start, 'Reverse from the completed endpoint must restore the starting pose');

    await roundedEndpoint('play', 1);
    const almostEnd = await geometry();
    assert.notEqual(almostEnd, end, 'The rounded final range value must precede the exact final pose');
    await click('play');
    await click('play');
    assert.equal(await geometry(), almostEnd, 'Play after pausing near one must preserve the exact position');
    await page.clock.runFor(16);
    assert.equal(await page.evaluate(playbackFinished, 1), true);
    assert.equal(await geometry(), end, 'Forward playback must finish at the exact final pose');

    await scrub(0.5);
    await click('reduce-motion');
    assert.equal(await geometry(), end, 'Enabling reduced motion must finish a paused clip');
    await click('reverse');
    assert.equal(await page.evaluate(playbackFinished, 0), true, 'Reduced reverse must use the freshly prepared clip duration');
    assert.equal(await geometry(), start, 'Reduced reverse of a paused clip must restore the starting pose');
    await click('reduce-motion');

    await scrub(0);
    await click('play');
    await page.clock.runFor(400);
    assert.notEqual(await geometry(), start, 'Reduced-motion toggle must interrupt an existing moving clip');
    assert.notEqual(await geometry(), end, 'Reduced-motion toggle must happen before normal completion');
    await click('reduce-motion');
    assert.equal(await page.evaluate(playbackFinished, 1), true);
    assert.equal(await geometry(), end, 'Enabling reduced motion must finish the existing clip');
    await click('reverse');
    assert.equal(await page.evaluate(playbackFinished, 0), true, 'Reduced reverse after a toggle must finish immediately');
    assert.equal(await geometry(), start, 'Reduced reverse after a toggle must restore the starting pose');
    await page.clock.runFor(1100);
    assert.equal(await geometry(), start, 'The previous driver must not overwrite the reduced reverse pose');
    await click('play');
    assert.equal(await page.evaluate(playbackFinished, 1), true);
    assert.equal(await geometry(), end, 'Reduced forward after a toggle must show the final pose');
    await click('reduce-motion');
    await click('reverse');
    await page.clock.runFor(400);
    assert.equal(await page.locator('#play-label').textContent(), 'Пауза');
    assert.notEqual(await geometry(), start, 'Disabling reduced motion must restore animated reverse');
    assert.notEqual(await geometry(), end, 'Animated reverse must leave its final pose');
    await click('reduce-motion');
    assert.equal(await page.evaluate(playbackFinished, 0), true, 'Enabling reduced motion during reverse must finish in reverse');
    assert.equal(await geometry(), start, 'Reducing reverse motion must preserve its requested endpoint');
    await page.clock.runFor(1100);
    assert.equal(await page.evaluate(playbackFinished, 0), true);
    assert.equal(await geometry(), start);
    assert.deepEqual(errors, []);
    return { roundedReverse, checks: ['fractional endpoints', 'pause near both endpoints', 'scrub from completed clip', 'reverse from completed clip', 'toggle reduced motion on paused and playing clips'] };
  } finally { await context.close(); }
}

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
  const playbackBoundaries = await verifyPlaybackBoundaries(browser, base);
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
  await page.waitForFunction(playbackFinished, 0);
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
  // README demonstrates DOM consumers; compile and execute the exact published
  // blocks in a browser instead of pretending Node provides document.
  await page.evaluate(() => {
    for (const id of ['icon', 'microphone']) { const element = document.createElement('span'); element.id = id; document.body.append(element); }
  });
  const examples = parseDocumentation(await readFile(join(root, 'README.md'), 'utf8')).examples;
  assert.equal(examples.length, 3);
  for (const [index, source] of examples.entries()) {
    const result = await build({ stdin: { contents: source, resolveDir: root }, bundle: true, format: 'esm', write: false, platform: 'browser' });
    await page.addScriptTag({ type: 'module', content: result.outputFiles[0].text });
    if (index < 2) assert.equal(await page.locator('#icon svg').count(), 1);
    else assert.equal(await page.locator('#microphone svg').count(), 0, 'README must dispose its controller');
  }
  assert.deepEqual(errors, []); assert.deepEqual(failed, []);
  await writeFile(join(output, 'receipt.json'), JSON.stringify({ errors, failed, symbols: 330, fonts, playbackBoundaries, checks: ['light/dark/mobile', 'rendered Cyrillic font', 'working copied code and color', 'play/pause/scrub/reverse/reduced motion', 'SVG/Lottie/dotLottie/Kotlin downloads', 'date', 'mobile focus and async close'] }, null, 2) + '\n');
  console.log('Catalog: 330 symbols, rendered Geist, working copy, playback, four downloads, mobile focus and async close');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
