import { execFileSync } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertRemoteBenchmark } from './measurement.js';
import { verifyLazyPause, verifyLazyStateSelection, verifyLazyGestureSelection } from './explorer-journey.js';
import { verifyAuthoringPlayground } from './authoring-journey.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png' };
const command = (file, args, cwd) => execFileSync(file, args, { cwd, encoding: 'utf8', windowsHide: true, maxBuffer: 16 * 1024 * 1024 });

/** Already-built frozen candidate; упаковка проверяется внешним consumer lane. */
export async function verifyExplorer({ browser, source, output }) {
  assertRemoteBenchmark();
  const root = realpathSync(source);
  const destination = resolve(output);
  mkdirSync(destination, { recursive: true });
  const sourceSha = command('git', ['rev-parse', 'HEAD'], root).trim();
  const temporary = mkdtempSync(join(tmpdir(), 'lab-icons-explorer-journey-'));
  const site = join(temporary, 'site');
  let server;
  let context;
  let page;
  const report = { version: 1, sourceSha, browser: browser.version(),
    scope: 'generated source Observatory; packed artifact has separate consumer evidence',
    complete: false, pageErrors: [] };
  try {
    command(process.execPath, [join(root, 'scripts/build-observatory.mjs'), '--out-dir', site], root);
    copyFileSync(join(HERE, 'explorer-journey.js'), join(site, 'journey.js'));
    const siteRoot = realpathSync(site);
    server = createServer((request, response) => {
      response.setHeader('Cache-Control', 'no-store');
      response.setHeader('X-Content-Type-Options', 'nosniff');
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405); response.end(); return; }
      try {
        const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
        const file = resolve(siteRoot, `.${pathname === '/' ? '/index.html' : pathname}`);
        if (!file.startsWith(`${siteRoot}${sep}`)) { response.writeHead(403); response.end(); return; }
        const actual = realpathSync(file);
        if (!actual.startsWith(`${siteRoot}${sep}`) || !statSync(actual).isFile()) { response.writeHead(403); response.end(); return; }
        response.setHeader('Content-Type', TYPES[extname(actual)] ?? 'application/octet-stream');
        response.end(request.method === 'HEAD' ? undefined : readFileSync(actual));
      } catch { response.writeHead(404); response.end(); }
    });
    await new Promise((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolveListen); });
    const origin = `http://127.0.0.1:${server.address().port}`;
    context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: 'no-preference' });
    page = await context.newPage();
    page.on('pageerror', error => report.pageErrors.push(error.message));
    report.lazyPause = await verifyLazyPause({ page, origin });
    report.lazyStateSelection = await verifyLazyStateSelection({ page, origin });
    report.lazyGestureSelection = await verifyLazyGestureSelection({ page, origin });
    await page.goto(origin, { waitUntil: 'load' });
    report.journey = await page.evaluate(async () => {
      try { return await (await import('/journey.js')).runExplorerJourney(); }
      catch (error) { return error.journey ?? { failure: error.message, checks: [] }; }
    });
    if (report.journey.failure) throw new Error(report.journey.failure);
    if (report.pageErrors.length) throw new Error(`explorer journey: page errors: ${report.pageErrors.join('; ')}`);
    await page.screenshot({ path: join(destination, 'explorer-desktop.png'), fullPage: true, scale: 'css' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#symbol-inspector').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(destination, 'explorer-mobile.png'), fullPage: true, scale: 'css' });
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.locator('#symbol-search').fill('question-circle');
    await page.locator('[data-symbol="question-circle"]').click();
    await page.locator('#symbol-inspector[aria-busy="false"]').waitFor();
    await page.screenshot({ path: join(destination, 'explorer-states-desktop.png'), fullPage: true, scale: 'css' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator('#symbol-inspector').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(destination, 'explorer-states-mobile.png'), fullPage: true, scale: 'css' });
    report.authoring = await verifyAuthoringPlayground({ browser, origin, output: destination });
    report.complete = true;
    writeFileSync(join(destination, 'explorer-journey.json'), JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    report.failure = { message: error.message };
    if (page) {
      try { await page.screenshot({ path: join(destination, 'explorer-failure.png'), fullPage: true, scale: 'css' }); }
      catch { /* Незакрытая страница не превращает исходный отказ в успех. */ }
    }
    writeFileSync(join(destination, 'explorer-journey.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally {
    if (context) await context.close();
    if (server) await new Promise(resolveClose => server.close(resolveClose));
    rmSync(temporary, { recursive: true, force: true });
  }
}
