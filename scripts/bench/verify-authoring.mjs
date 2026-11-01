import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { build } from 'esbuild';
import { assertRemoteBenchmark } from './measurement.js';

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Исполняется первый самостоятельный пример из публичного tutorial. */
export function authoringTutorialExample(document) {
  const code = document.match(/```ts\r?\n([\s\S]*?)\r?\n```/)?.[1];
  if (!code || !code.includes("from '@labpics/icons/authoring'") ||
      !/\bconst\s+glyph\s*=\s*compileDesignSpec\(/.test(code)) {
    throw new Error('authoring consumer: tutorial не содержит самостоятельного public compile примера');
  }
  return code;
}

/** Types проверяются в consumer без source aliases; каждый запрет имеет свой diagnostic. */
export function authoringTypeConsumer(example) {
  return `${example}
import type { CompileDesignSpecOptions, DesignSpecGlyph, DesignGeometry } from '@labpics/icons/authoring';
const options: CompileDesignSpecOptions = { icon: 'focus-beacon', variant: 'filled', size: 16 };
const typedGlyph: DesignSpecGlyph = compileDesignSpec(beacon, options);
const shape: DesignGeometry = { kind: 'circle', center: 'center', radius: 0.2 };
void typedGlyph; void shape;
// @ts-expect-error — оптические оси здесь не принимаются.
compileDesignSpec(beacon, { icon: 'invalid', axes: { weight: 1 } });
// @ts-expect-error — variant является закрытым контрактом.
compileDesignSpec(beacon, { icon: 'invalid', variant: 'bold' });
// @ts-expect-error — произвольный path не входит в геометрическую грамматику.
const rawShape: DesignGeometry = { kind: 'path', d: 'M0 0L1 1' };
// @ts-expect-error — внутренний модуль не является public subpath.
import { parseDesignSpec as privateParser } from '@labpics/icons/authoring/design-spec';
void rawShape; void privateParser;
`;
}

/** Проверка actual tarball после замеров; компилятор не попадает в готовый SVG consumer. */
export async function verifyAuthoringConsumer({ browser, prepared, origin, outdir, output }) {
  assertRemoteBenchmark();
  const document = readFileSync(join(prepared.source, 'docs/authoring.md'), 'utf8');
  const example = authoringTutorialExample(document);
  const typeSource = join(prepared.consumer, 'authoring-types.ts');
  writeFileSync(typeSource, authoringTypeConsumer(example));
  const requireSource = createRequire(join(prepared.source, 'package.json'));
  const typescriptPackagePath = requireSource.resolve('typescript/package.json');
  const typescriptPackage = JSON.parse(readFileSync(typescriptPackagePath, 'utf8'));
  const typescript = join(dirname(typescriptPackagePath), typescriptPackage.bin.tsc);
  const typescriptVersion = typescriptPackage.version;
  execFileSync(process.execPath, [typescript, '--noEmit', '--strict', '--module', 'nodenext',
    '--target', 'es2022', '--lib', 'es2022,dom', typeSource],
  { cwd: prepared.consumer, stdio: 'inherit', windowsHide: true });
  const source = join(prepared.consumer, 'authoring-tutorial.ts');
  const program = `${example}
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { DesignSpecError } from '@labpics/icons/authoring';
function refuses(action, code) {
  assert.throws(action, error => error instanceof DesignSpecError && error.code === code);
}
refuses(() => compileDesignSpec({ ...beacon, d: 'M0 0L1 1' }, { icon: 'unsafe' }), 'RAW_PATH_FORBIDDEN');
refuses(() => compileDesignSpec(beacon, { icon: 'unsafe', axes: { weight: 1 } }), 'UNKNOWN_FIELD');
refuses(() => compileDesignSpec({ ...beacon, composition: { kind: 'compound', fillRule: 'evenodd' } }, { icon: 'unsafe' }), 'UNSUPPORTED_COMPOSITION');
const repeat = compileDesignSpec(beacon, { icon: 'focus-beacon', size: 24 });
assert.deepEqual(repeat, glyph);
assert.equal(glyph.provenance.kind, 'design-spec');
assert.equal(glyph.provenance.state, 'candidate');
assert.equal(glyph.parts.length, beacon.parts.length);
for (const [index, part] of glyph.parts.entries()) {
  assert.equal(part.id, beacon.parts[index].id);
  assert.equal(part.role, beacon.parts[index].role);
  assert.equal(part.zIndex, index);
}
const renderings = [16,24,48].map(size => ({ size, svg: renderGlyphSvg(
  compileDesignSpec(beacon, { icon: 'focus-beacon', size }), { instanceId: 'docs-' + size }),
}));
writeFileSync(process.argv[2], JSON.stringify({ glyph, renderings, refusals: 3 }));
`;
  writeFileSync(source, program);
  const executable = join(prepared.consumer, 'authoring-tutorial.mjs');
  const compiled = await build({ entryPoints: [source], outfile: executable, bundle: true, platform: 'node',
    format: 'esm', target: 'es2022', metafile: true, logLevel: 'silent' });
  const inputs = Object.keys(compiled.metafile.inputs).map(path => path.replaceAll('\\', '/'));
  assert(inputs.some(path => path.endsWith('/dist/authoring/index.js')), 'tutorial не импортировал installed authoring entrypoint');
  assert(!inputs.some(path => /catalog\.json|anatomy\.json|\/dist\/(?:motion|lottie)\//.test(path)), 'authoring импортировал чужой каталог или motion');
  const material = join(output, 'authoring-material.json');
  execFileSync(process.execPath, [executable, material], { cwd: prepared.consumer, stdio: 'inherit', windowsHide: true });
  const result = JSON.parse(readFileSync(material, 'utf8'));
  const exportedSvg = result.renderings.find(row => row.size === 24).svg;

  const staticSource = join(prepared.consumer, 'authoring-static.mjs');
  writeFileSync(staticSource, `export const svg = ${JSON.stringify(exportedSvg)};\n`);
  const staticBundle = await build({ entryPoints: [staticSource], outfile: join(outdir, 'authoring-static.js'),
    bundle: true, format: 'esm', platform: 'browser', minify: true, metafile: true, logLevel: 'silent' });
  assert.equal(Object.keys(staticBundle.metafile.inputs).length, 1, 'готовый SVG импортирует authoring runtime');
  const page = await browser.newPage({ viewport: { width: 560, height: 180 }, deviceScaleFactor: 1 });
  try {
    await page.goto(origin);
    const observed = await page.evaluate(async renderings => {
      const { svg } = await import('/bundles/authoring-static.js');
      document.head.querySelectorAll('style').forEach(style => style.remove());
      document.body.innerHTML = '<main aria-label="Авторский символ"><div id="sizes"></div></main>';
      const host = document.querySelector('#sizes');
      Object.assign(host.style, { display: 'flex', gap: '48px', padding: '32px', color: '#202124' });
      return renderings.map(({ size, svg: instance }) => {
        const container = document.createElement('span');
        container.innerHTML = size === 24 ? svg : instance;
        host.append(container);
        const element = container.querySelector('svg');
        element.setAttribute('role', 'img'); element.setAttribute('aria-label', 'Фокус активен');
        const bounds = element.getBoundingClientRect();
        return { size, width: bounds.width, height: bounds.height,
          parts: [...element.querySelectorAll('[data-part]')].map(part => part.dataset.part),
          viewBox: element.getAttribute('viewBox'), staticMatches: svg === renderings.find(row => row.size === 24).svg };
      });
    }, result.renderings);
    for (const row of observed) {
      assert.equal(row.width, row.size); assert.equal(row.height, row.size);
      assert.equal(row.viewBox, '0 0 1 1'); assert(row.staticMatches);
      assert.deepEqual(row.parts, result.glyph.parts.map(part => part.id));
    }
    assert.equal(await page.getByRole('img', { name: 'Фокус активен' }).count(), 3);
    await page.screenshot({ path: join(output, 'authoring-consumer.png') });
    const report = { sourceSha: prepared.revision, tarballSha256: prepared.tarballSha256,
      tutorialSha256: sha256(document), exampleSha256: sha256(example), browser: browser.version(),
      types: { version: typescriptVersion, resolution: 'nodenext', strict: true, negativeControls: 4, consumerSha256: sha256(readFileSync(typeSource)) },
      authoringInputs: inputs, staticInputs: Object.keys(staticBundle.metafile.inputs),
      glyphDigest: result.glyph.provenance.specSha256, refusals: result.refusals, observed,
      scope: 'installed public tutorial -> compile -> exported static SVG; no optical-axis or performance claim', complete: true };
    writeFileSync(join(output, 'authoring-consumer.json'), JSON.stringify(report, null, 2));
    return report;
  } finally { await page.close(); }
}
