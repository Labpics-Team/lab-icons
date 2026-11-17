import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'preview/calendar-optical');
mkdirSync(output, { recursive: true });
const source = `
import * as motion from '@labpics/motion';
import { createSymbolMotion } from '@labpics/icons/motion';
import { renderIcon } from '@labpics/icons/render';
import calendar from '@labpics/icons/symbols/calendar-number';

const assert = (value, message) => { if (!value) throw new Error(message); };
let live = 0;
const icons = createSymbolMotion({ ...motion, value(initial) {
  live++;
  const value = motion.value(initial), dispose = value.dispose.bind(value);
  let released = false;
  value.dispose = () => { if (!released) { live--; released = true; } dispose(); };
  return value;
} });
const date = day => new Date(Date.UTC(2026, 0, day, 12));
const options = (day, variant = 'outline', weight = 400, opsz = 24, size = 96) =>
  ({ date: date(day), timeZone: 'UTC', variant, weight, opsz, size });
const serialize = element => new XMLSerializer().serializeToString(element);
const image = async svg => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 96;
  const context = canvas.getContext('2d'), bitmap = new Image();
  bitmap.src = 'data:image/svg+xml,' + encodeURIComponent(svg);
  await bitmap.decode(); context.drawImage(bitmap, 0, 0, 96, 96);
  return context.getImageData(0, 0, 96, 96).data;
};
const staticSvg = request => {
  const template = document.createElement('template'); template.innerHTML = renderIcon(calendar, request);
  template.content.firstChild.style.color = 'rgba(0,0,0,.37)';
  return serialize(template.content.firstChild);
};
const alphaDelta = (a, b) => {
  let sum = 0; for (let i = 3; i < a.length; i += 4) sum += Math.abs(a[i] - b[i]);
  return sum / (a.length / 4);
};

async function verify() {
  let comparisons = 0, maximumMeanAlphaDifference = 0;
  for (const variant of ['outline', 'filled']) {
    const icon = icons.mount(document.body, calendar, options(1, variant));
    icon.element.style.color = 'rgba(0,0,0,.37)';
    for (const weight of [300, 400, 600]) for (const opsz of [16, 24, 48]) {
      const source = await image(staticSvg({ variant, weight, opsz, size: 96 }));
      for (let day = 1; day <= 31; day++) {
        const request = options(day, variant, weight, opsz);
        icon.set(request, { reducedMotion: true });
        const actual = await image(serialize(icon.element)), expected = await image(staticSvg(request));
        const delta = alphaDelta(actual, expected); comparisons++;
        maximumMeanAlphaDifference = Math.max(maximumMeanAlphaDifference, delta);
        assert(delta < .5, 'Static and motion calendar differ: ' + variant + '/' + weight + '/' + opsz + '/' + day + ': ' + delta);
        let outside = 0, count = 0;
        for (let y = 0; y < 96; y++) for (let x = 0; x < 96; x++) {
          const index = (y * 96 + x) * 4 + 3;
          assert(actual[index] <= 95, 'Calendar overpainted translucent ink');
          if (x >= 16 && x <= 80 && y >= 35 && y <= 82) continue;
          outside += Math.abs(actual[index] - source[index]); count++;
        }
        assert(outside / count < .5, 'Calendar changed the accepted shell');
      }
    }
    icon.set(options(8, variant), { reducedMotion: true });
    const shell = icon.element.querySelector('[data-part="calendar-' + (variant === 'filled' ? 'body' : 'shell') + '"]');
    const first = icon.set(options(28, variant), { duration: 1000 }); first.pause(); first.seek(500);
    assert(icon.element.contains(shell), 'Changing the day recreated the shared shell');
    assert(shell.getAttribute('opacity') === '1', 'Changing the day faded the shared shell');
    const next = icon.set(options(29, variant), { duration: 1000 }); next.pause(); next.seek(500);
    assert((await first.finished).status === 'stopped', 'Interrupted date transition retained its control');
    assert(shell.getAttribute('opacity') === '1', 'Interrupted date change faded the shell');
    next.finish(); await next.finished;
    assert(alphaDelta(await image(serialize(icon.element)), await image(staticSvg(options(29, variant)))) < .5, 'Interrupted date change missed its endpoint');
    const state = icon.setState('selected', { duration: 1000 }); state.pause(); state.seek(500); state.finish(); await state.finished;
    // Explicit variant continues to have priority over selected/unselected.
    assert(alphaDelta(await image(serialize(icon.element)), await image(staticSvg(options(29, variant)))) < .5, 'Selection lost the explicit calendar date or variant');
    const retained = serialize(icon.element);
    try { icon.set({ date: new Date(NaN), timeZone: 'UTC' }); throw new Error('Invalid date was accepted'); }
    catch (error) { assert(error instanceof RangeError, 'Invalid date returned the wrong failure'); }
    assert(serialize(icon.element) === retained, 'Invalid request changed the visible calendar');
    const removed = icon.set(options(1, variant), { duration: 1000 }); icon.dispose();
    assert((await removed.finished).status === 'stopped', 'Dispose retained a date transition');
  }
  const instant = new Date('2026-01-01T00:30:00Z');
  for (const [timeZone, day] of [['UTC', 1], ['Asia/Tokyo', 1], ['America/Los_Angeles', 31]]) {
    assert(renderIcon(calendar, { date: instant, timeZone }) === renderIcon(calendar, { date: date(day), timeZone: 'UTC' }), 'IANA day resolution changed the expected date');
  }
  assert(renderIcon(calendar, { date: new Date('2024-02-29T12:00:00Z'), timeZone: 'UTC' }) === renderIcon(calendar, { date: date(29), timeZone: 'UTC' }), 'Leap day changed');
  const selected = icons.mount(document.body, calendar, { state: 'selected', date: date(8), timeZone: 'UTC', size: 96 });
  selected.element.style.color = 'rgba(0,0,0,.37)';
  const retainedDate = date(28);
  selected.setDate(retainedDate, 'UTC', { reducedMotion: true });
  retainedDate.setUTCDate(31);
  selected.setState('selected', { reducedMotion: true });
  assert(selected.state === 'selected', 'setDate replaced selection');
  assert(alphaDelta(await image(serialize(selected.element)), await image(staticSvg(options(28, 'filled', 400, 48)))) < .5, 'setDate lost selected appearance or size');
  selected.dispose();
  await Promise.resolve(); assert(live === 0, 'Calendar retained Motion values');

  for (const dark of [false, true]) {
    const section = document.createElement('section'); if (dark) section.className = 'dark'; document.body.append(section);
    section.innerHTML = '<h1>' + (dark ? 'Тёмный фон' : 'Светлый фон') + '</h1>';
    for (const variant of ['outline', 'filled']) {
      const title = document.createElement('h2'); title.textContent = 'calendar-number · ' + variant; section.append(title);
      const header = document.createElement('div'); header.className = 'row header';
      header.innerHTML = '<span></span>' + [1, 8, 10, 11, 28, 29, 31, 'Source'].map(value => '<small>' + value + '</small>').join(''); section.append(header);
      for (const weight of [300, 400, 600]) for (const opsz of [16, 24, 48]) {
        const row = document.createElement('div'); row.className = 'row';
        row.innerHTML = '<span>' + weight + ' / ' + opsz + '</span>';
        for (const day of [1, 8, 10, 11, 28, 29, 31]) {
          const cell = document.createElement('div'); cell.innerHTML = renderIcon(calendar, options(day, variant, weight, opsz, opsz)); row.append(cell);
        }
        const reference = document.createElement('div'); reference.innerHTML = renderIcon(calendar, { variant, weight, opsz, size: opsz }); row.append(reference);
        section.append(row);
      }
    }
  }
  window.result = { ok: true, comparisons, maximumMeanAlphaDifference, live,
    cases: ['31 days × 9 optical supports × 2 variants', 'accepted source enclosure', 'translucent tint', 'explicit Date/IANA', 'shared shell', 'interrupted date change', 'selection', 'Date mutation snapshot', 'invalid date is atomic', 'dispose'] };
}
verify().catch(error => { window.failure = error.stack; });
`;
const bundle = await build({ stdin: { contents: source, resolveDir: root, sourcefile: 'calendar-consumer.mjs' }, bundle: true, format: 'esm', write: false, target: 'es2022' });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;gap:20px;padding:20px;background:#e4e4e8;font:14px system-ui}section{padding:24px;background:#fafafa;color:#235d9b;border-radius:14px}.dark{background:#19191e;color:#a9cdf3}h1{font-size:20px;margin:0 0 16px}h2{font-size:15px;margin:20px 0 8px}.row{display:flex;align-items:center;gap:12px;height:60px}.row>span{width:76px}.row>div,.row>small{display:grid;place-items:center;width:48px;height:48px}.header{height:24px;color:#80808b}</style></head><body><script type="module">${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
writeFileSync(join(output, 'index.html'), html);
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1340, height: 1300 }, deviceScaleFactor: 2 });
  await page.setContent(html);
  await page.waitForFunction(() => window.result || window.failure, undefined, { timeout: 30000 });
  const result = await page.evaluate(() => window.result ?? { error: window.failure });
  assert.equal(result.ok, true, result.error);
  await page.screenshot({ path: join(output, 'calendar-motion.png'), fullPage: true });
  writeFileSync(join(output, 'receipt.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify(result));
} finally { await browser?.close(); }
