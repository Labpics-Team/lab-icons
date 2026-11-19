import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join } from 'node:path';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('../preview/optical-atlas/', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const output = join(root, 'screenshots'); mkdirSync(output, { recursive: true });
const browser = await chromium.launch({ channel: process.argv.includes('--chrome') ? 'chrome' : undefined, headless: true });
const results = [], queue = [...manifest.pages];
try {
  await Promise.all(Array.from({ length: 3 }, async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1 });
    try {
      while (queue.length) {
        const entry = queue.shift();
        await page.goto(pathToFileURL(join(root, entry.file)).href);
        await page.evaluate(() => document.fonts.ready);
        const inspection = await page.evaluate(() => ({
          symbols: Array.from(document.querySelectorAll('article'), node => node.dataset.symbol),
          svgCount: document.querySelectorAll('svg').length,
          overflow: document.documentElement.scrollWidth > innerWidth,
          fonts: Array.from(document.fonts, font => ({ family: font.family, weight: font.weight, status: font.status })),
        }));
        if (inspection.overflow || inspection.symbols.join(',') !== entry.symbols.join(',') ||
            inspection.svgCount !== entry.symbols.length * 30 || !inspection.fonts.some(font => font.family === 'Geist' && font.status === 'loaded')) {
          throw new Error(`Invalid atlas render ${entry.file}: ${JSON.stringify(inspection)}`);
        }
        const screenshot = entry.file.replace('.html', '.png');
        await page.screenshot({ path: join(output, screenshot), fullPage: true });
        results.push({ ...entry, ...inspection, screenshot });
        if (results.length % 10 === 0) console.log(`Rendered ${results.length}/${manifest.pages.length} pages`);
      }
    } finally { await page.close(); }
  }));
  results.sort((a, b) => a.file.localeCompare(b.file));
  const report = { browser: browser.version(), families: manifest.families, variants: manifest.variants,
    totalSvgCount: results.reduce((sum, page) => sum + page.svgCount, 0), pages: results };
  writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2));
  console.log(`${results.length} pages; ${report.totalSvgCount} SVG; ${report.browser}; ${output}`);
} finally { await browser.close(); }
