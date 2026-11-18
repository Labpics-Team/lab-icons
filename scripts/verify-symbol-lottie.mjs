import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';
import { installedBrowserInputs } from './lib/installed-browser-inputs.mjs';

const root = fileURLToPath(new URL('..', import.meta.url)), output = process.env.LAB_ICONS_EVIDENCE_DIR ?? join(root, 'preview/symbol-lottie');
mkdirSync(output, { recursive: true });
const corpus = process.argv[2]?.startsWith('corpus') ?? false;
const manifest = JSON.parse(readFileSync(join(root, 'semantics/figma-baseline.json')));
const names = [], raw = {}, expectedEffects = {};
for (const name of Object.keys(manifest.icons)) {
  if (corpus) {
    if (process.argv[2].includes(':') && name !== process.argv[2].split(':')[1]) continue;
    raw[name] = Object.fromEntries(['outline', 'filled'].map(variant => {
      const master = manifest.icons[name][variant], bytes = readFileSync(join(root, master.master));
      assert.equal(createHash('sha256').update(bytes).digest('hex'), master.sha256, name + '/' + variant + ': raw master SHA drift');
      return [variant, bytes.toString('utf8')];
    }));
  } else {
    const symbol = (await import(pathToFileURL(join(root, 'dist/symbols', name + '.js')).href)).default;
    const effects = Object.fromEntries(['outline', 'filled'].map(variant => [variant, Object.keys(symbol.semantics?.variants?.[variant]?.effects ?? {}).sort()]));
    if (!Object.values(effects).some(names => names.length)) continue;
    expectedEffects[name] = effects;
  }
  names.push(name);
}
const source = `
import lottie from 'lottie-web';
import * as motion from '@labpics/motion';
import { createSymbolMotion } from '@labpics/icons/motion';
import { exportLottie } from '@labpics/icons/lottie';
import { runSymbolLottieCases } from ${JSON.stringify(join(root, 'scripts/bench/symbol-lottie-render.js'))};
${names.map((name, i) => `import corpus${i} from '@labpics/icons/symbols/${name}';`).join('\n')}
import calendar from '@labpics/icons/symbols/calendar-number';
import time from '@labpics/icons/symbols/time';
import history from '@labpics/icons/symbols/history';
import checkmark from '@labpics/icons/symbols/checkmark-circle';
import database from '@labpics/icons/symbols/database-search';
import calendarFamily from '@labpics/icons/states/calendar';
import volumeFamily from '@labpics/icons/states/volume';
const corpus = ${corpus}, symbols = [${names.map((_, i) => `corpus${i}`).join(',')}], raw = ${JSON.stringify(raw)};
const expectedEffects = ${JSON.stringify(expectedEffects)};
const effectMembership = corpus ? [] : symbols.map(symbol => ({ symbol, expected: expectedEffects[symbol.id] }));
if (${JSON.stringify(process.env.LAB_ICONS_LOTTIE_CONTROL)} === 'missing-effect') {
  const row = effectMembership.find(row => row.expected.outline.length);
  const symbol = row.symbol, variant = symbol.semantics.variants.outline, effects = { ...variant.effects };
  delete effects[row.expected.outline[0]];
  row.symbol = { ...symbol, semantics: { ...symbol.semantics, variants: { ...symbol.semantics.variants, outline: { ...variant, effects } } } };
}
const date = day => new Date(Date.UTC(2026, 0, day, 12));
const semantic = symbols.flatMap(symbol => ['outline', 'filled'].flatMap(variant => Object.keys(symbol.semantics?.variants?.[variant]?.effects ?? {}).flatMap(gesture => [
  { name: symbol.id + '/' + gesture + '/forward', symbol, variant, semantic: true, complete: true, options: { gesture, duration: 317 } },
  { name: symbol.id + '/' + gesture + '/reverse', symbol, variant, semantic: true, options: { gesture, from: .83, to: .17, duration: 317 } },
  { name: symbol.id + '/' + gesture + '/reduced', symbol, variant, semantic: true, options: { gesture, from: .83, to: .17, duration: 317, reducedMotion: true } },
  { name: symbol.id + '/' + gesture + '/still', symbol, variant, semantic: true, options: { gesture, from: .37, to: .37, duration: 317 } },
])));
const cases = corpus ? symbols.map(symbol => ({ name: symbol.id, symbol, options: {}, raw: raw[symbol.id] })) : [
  ...semantic,
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
const selected = ${JSON.stringify(corpus ? null : process.argv[2] ?? null)};
runSymbolLottieCases({ lottie, icons: createSymbolMotion(motion), exportLottie: ${JSON.stringify(process.env.LAB_ICONS_LOTTIE_CONTROL)} === 'symbol' ? (_symbol, request) => exportLottie(time, request) : exportLottie, cases: cases.filter(item => !selected || item.name === selected), corpus, effectMembership,
  mutation: ${JSON.stringify(process.env.LAB_ICONS_LOTTIE_CONTROL ?? null)} }).then(result => { window.result = result; }).catch(error => { window.failure = error.stack; });
`;
const bundle = await build({ stdin: { contents: source, resolveDir: process.env.LAB_ICONS_CONSUMER_DIR ?? root, sourcefile: 'symbol-lottie-consumer.ts' },
  absWorkingDir: root, nodePaths: [join(root, 'node_modules')], bundle: true, format: 'esm', write: false, metafile: true, target: 'es2022' });
writeFileSync(join(output, 'inputs.json'), JSON.stringify(installedBrowserInputs(bundle.metafile, root, process.env.LAB_ICONS_CONSUMER_DIR), null, 2) + '\n');
let browser;
try {
  browser = await chromium.launch({ ...(existsSync(chromium.executablePath()) ? {} : { channel: 'chrome' }), headless: true, args: ['--mute-audio'] });
  const page = await browser.newPage();
  await page.setContent(`<!doctype html><html><body><script type="module">${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`);
  await page.waitForFunction(() => window.result || window.failure, undefined, { timeout: 120000 });
  const result = await page.evaluate(() => window.result ?? { error: window.failure });
  assert(Array.isArray(result), result.error); assert(result.length > 0);
  if (corpus) assert.equal(result.length, names.length * 2);
  writeFileSync(join(output, corpus ? 'corpus-receipt.json' : 'receipt.json'), JSON.stringify(result, null, 2) + '\n');
  const summary = { player: 'lottie-web@5.13.0', browser: browser.version(), comparisons: result.length, authored: result.filter(row => row.authored).length,
    naturalCompletion: result.filter(row => row.natural).length, worst: result.toSorted((a, b) => b.mean - a.mean).slice(0, 3) };
  writeFileSync(join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(JSON.stringify(summary));
} finally { await browser?.close(); }
