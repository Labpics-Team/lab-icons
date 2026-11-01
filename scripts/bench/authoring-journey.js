import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertAuthoringRender, tutorialCircleExpectations } from './verify-authoring.mjs';

/** Работает на настоящем sibling page; caller выбирает source или packed site. */
export async function verifyAuthoringPlayground({ browser, origin, output }) {
  mkdirSync(output, { recursive: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const report = { version: 1, scope: 'authoring page -> JSON -> public compile -> SVG download', browser: browser.version() };
  try {
    await page.goto(new URL('authoring.html', `${origin}/`).href);
    const editor = page.getByLabel('DesignSpec JSON', { exact: true });
    const build = page.getByRole('button', { name: 'Построить превью' });
    const download = page.getByRole('button', { name: 'Скачать SVG' });
    await page.waitForFunction(() => !document.querySelector('#authoring-download').disabled);
    const starter = JSON.parse(await editor.inputValue());
    const observe = () => page.evaluate(async () => {
      const { compileDesignSpec, renderGlyphSvg } = await import('./package/authoring/index.js');
      const spec = JSON.parse(document.querySelector('#authoring-spec').value);
      const icon = document.querySelector('#authoring-name').value;
      return [...document.querySelectorAll('#authoring-samples svg')].map(svg => {
      const bounds = svg.getBoundingClientRect();
      const size = Number(svg.getAttribute('width'));
      const expected = document.createElement('div');
      expected.innerHTML = renderGlyphSvg(compileDesignSpec(spec, { icon, size }), { instanceId: `authoring-sample-${size}` });
      expected.querySelector('svg').setAttribute('aria-hidden', 'true');
      return { size, width: bounds.width, height: bounds.height,
        viewBox: svg.getAttribute('viewBox'), staticMatches: svg.outerHTML === expected.innerHTML,
        parts: [...svg.querySelectorAll('[data-part]')].map(part => part.dataset.part),
        paths: [...svg.querySelectorAll('path')].map(path => {
          const bounds = path.getBBox(), style = getComputedStyle(path);
          return { d: path.getAttribute('d'), length: path.getTotalLength(),
            bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
            fill: style.fill, stroke: style.stroke, strokeWidth: parseFloat(style.strokeWidth),
            opacity: parseFloat(style.opacity), visibility: style.visibility, display: style.display };
        }),
      };
      });
    });
    report.initial = await observe();
    assert.deepEqual(report.initial.map(row => row.size), [16, 24, 48]);
    assertAuthoringRender(report.initial, tutorialCircleExpectations(starter));
    await page.screenshot({ path: join(output, 'authoring-wide.png'), fullPage: true });
    const changed = structuredClone(starter);
    changed.parts[0].geometry.radius -= 0.01;
    await editor.fill(JSON.stringify(changed, null, 2));
    assert(await download.isDisabled());
    assert.equal(await page.locator('#authoring-stage svg').count(), 0);
    await build.click();
    report.edited = await observe();
    assertAuthoringRender(report.edited, tutorialCircleExpectations(changed));
    assert.notEqual(report.edited[0].paths[0].d, report.initial[0].paths[0].d);

    await editor.fill('{"version":');
    await build.click();
    report.jsonError = await page.locator('#authoring-error').textContent();
    assert(report.jsonError.startsWith('Ошибка JSON\n'));
    assert.equal(await editor.getAttribute('aria-invalid'), 'true');
    assert(await download.isDisabled());
    const invalid = { ...changed, '<img src=x onerror=alert(1)>': 1 };
    await editor.fill(JSON.stringify(invalid));
    await build.click();
    report.specError = await page.locator('#authoring-error').textContent();
    assert(report.specError.includes('UNKNOWN_FIELD'));
    assert(report.specError.includes('<img src=x onerror=alert(1)>'));
    assert.equal(await page.locator('#authoring-error img').count(), 0);
    assert(await download.isDisabled());
    assert.equal(await page.locator('#authoring-stage svg').count(), 0);

    await editor.fill(JSON.stringify(changed));
    await build.click();
    assert(await page.locator('#authoring-error').isHidden());
    await page.getByLabel('Имя символа', { exact: true }).fill('new-beacon');
    assert(await download.isDisabled());
    assert.equal(await page.locator('#authoring-stage svg').count(), 0);
    await build.click();
    await page.getByLabel('Размер SVG', { exact: true }).selectOption('16');
    const pending = page.waitForEvent('download');
    await download.click();
    const file = await pending;
    const svg = readFileSync(await file.path(), 'utf8');
    const expected = await page.evaluate(async spec => {
      const { compileDesignSpec, renderGlyphSvg } = await import('./package/authoring/index.js');
      return renderGlyphSvg(compileDesignSpec(spec, { icon: document.querySelector('#authoring-name').value, size: 16 }),
        { instanceId: 'authoring-export' });
    }, changed);
    assert.equal(svg, expected);
    assert.equal(file.suggestedFilename(), 'new-beacon-16.svg');
    report.download = { filename: file.suggestedFilename(), size: 16, currentSvgMatches: true };

    const maskSpec = { version: 1, anchors: [{ id: 'center', kind: 'canvas', at: 'center' }],
      parts: [
        { id: 'body', role: 'body', geometry: { kind: 'circle', center: 'center', radius: 0.3 }, paint: { kind: 'fill' } },
        { id: 'hole', role: 'decorator', geometry: { kind: 'circle', center: 'center', radius: 0.16 }, paint: { kind: 'fill' } },
      ], composition: { kind: 'mask-subtract', basePartIds: ['body'], subtractPartIds: ['hole'] },
      decorators: [{ id: 'hole-knockout', kind: 'knockout', partId: 'hole', targetPartIds: ['body'] }], negativeSpace: [] };
    await editor.fill(JSON.stringify(maskSpec));
    await build.click();
    report.resources = await page.evaluate(() => {
      const ids = [...document.querySelectorAll('.authoring-preview svg [id]')].map(node => node.id);
      const references = [...document.querySelectorAll('.authoring-preview svg [mask]')].map(node => node.getAttribute('mask'));
      return { ids, references };
    });
    assert.equal(report.resources.ids.length, 4);
    assert.equal(new Set(report.resources.ids).size, 4);
    for (const reference of report.resources.references) assert(report.resources.ids.includes(reference.slice(5, -1)));

    await page.getByRole('button', { name: 'Вернуть пример' }).click();
    assertAuthoringRender(await observe(), tutorialCircleExpectations(starter));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: join(output, 'authoring-narrow.png'), fullPage: true });
    report.narrow = await page.evaluate(() => ({ viewport: innerWidth, content: document.documentElement.scrollWidth,
      textareaWidth: document.querySelector('#authoring-spec').getBoundingClientRect().width }));
    assert(report.narrow.content <= report.narrow.viewport);
    assert(report.narrow.textareaWidth > 300);
    const requests = [];
    page.on('request', request => requests.push(request.url()));
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(new URL('index.html', `${origin}/`).href);
    await page.waitForFunction(() => document.querySelector('#symbol-stage svg'));
    assert.equal(await page.getByRole('link', { name: 'Создать символ', exact: true }).count(), 1);
    report.catalogAuthoringRequests = requests.filter(url => /authoring(?:-example)?\.js|\/package\/authoring\//.test(url));
    assert.deepEqual(report.catalogAuthoringRequests, []);
    await page.screenshot({ path: join(output, 'authoring-catalog-reference.png'), fullPage: true });
    assert.deepEqual(errors, []);
    report.complete = true;
    writeFileSync(join(output, 'authoring-journey.json'), JSON.stringify(report, null, 2));
    return report;
  } finally { await context.close(); }
}
