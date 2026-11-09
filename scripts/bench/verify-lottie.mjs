import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { assertRemoteBenchmark } from './measurement.js';
import { referenceLottieGestures } from './lottie-render.js';

const HERE = fileURLToPath(new URL('.', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** Проверка настоящего packed target, выполненная после сравнительных замеров. */
export async function verifyLottieConsumer({ browser, prepared, origin, outdir, output }) {
  assertRemoteBenchmark();
  const manifest = JSON.parse(readFileSync(join(prepared.source, 'semantics/figma-baseline.json'), 'utf8'));
  const annotations = JSON.parse(readFileSync(join(prepared.source, 'semantics/author-anatomy.json'), 'utf8'));
  // Новая принятая семья автоматически попадает в consumer; неизвестная law
  // требует независимого oracle и не может исчезнуть из проверки по списку имён.
  const names = Object.keys(annotations.icons).sort();
  const requireSource = createRequire(join(prepared.source, 'package.json'));
  const playerPath = requireSource.resolve('lottie-web/build/player/lottie_light.min.js');
  const playerPackage = JSON.parse(readFileSync(requireSource.resolve('lottie-web/package.json'), 'utf8'));
  if (playerPackage.version !== '5.13.0') throw new Error('Lottie consumer: нужен pinned SVG player 5.13.0');
  const cases = names.flatMap(name => ['outline', 'filled'].flatMap(variant => {
    const master = manifest.icons[name][variant], raw = readFileSync(join(prepared.source, master.master));
    if (sha256(raw) !== master.sha256) throw new Error(`${name}/${variant}: raw master SHA drift`);
    const declared = annotations.icons[name]?.[variant];
    // Motion-only anatomy не назначает жест default Lottie target.
    const annotation = declared?.scope === 'motion' ? undefined : declared;
    if (annotation && annotation.masterSha256 !== master.sha256) throw new Error(`${name}/${variant}: raw annotation SHA drift`);
    const common = { name, rawSvg: raw.toString('utf8'), masterSha256: master.sha256, annotation };
    const gestures = referenceLottieGestures(name, annotation);
    return [{ ...common, request: { variant, color: '#123456' } },
      ...gestures.flatMap(gesture => {
        const request = { variant, gesture, duration: 1000, from: 0, to: 1, color: '#123456' };
        return [{ ...common, request }, ...annotation.gesture.law === 'confirmation.presence' ? [
          { ...common, request: { ...request, from: 1, to: 0 } },
          { ...common, request: { ...request, from: 1, to: 0, reducedMotion: true } },
        ] : annotation.gesture.law === 'notification.ring' ? [
          { ...common, request: { ...request, from: 1, to: 0 } },
          { ...common, request: { ...request, from: 0.13, to: 0.87 } },
          { ...common, request: { ...request, from: 0.87, to: 0.13 } },
          { ...common, request: { ...request, from: 0.87, to: 0.13, reducedMotion: true } },
          { ...common, request: { ...request, from: 0.37, to: 0.37 } },
        ] : []];
      })];
  }));
  const entry = join(prepared.consumer, 'lottie-render-consumer.mjs');
  writeFileSync(entry, `${names.map((name, index) => `import { exportLottie as icon${index} } from ${JSON.stringify(`@labpics/icons/lottie/${name}`)};`).join('\n')}
import { runLottieRenderCases } from ${JSON.stringify(join(HERE, 'lottie-render.js'))};
const icons = {${names.map((name, index) => `${JSON.stringify(name)}:icon${index}`).join(',')}};
export const run = cases => runLottieRenderCases((name, request) => icons[name](request), cases);
`);
  const bundle = await build({ entryPoints: [entry], outfile: join(outdir, 'candidate-lottie.js'), bundle: true, format: 'esm',
    platform: 'browser', target: 'es2022', minify: true, metafile: true, logLevel: 'silent' });
  if (Object.keys(bundle.metafile.inputs).some(path => /src\/core\/path-data|author-anatomy|catalog\.json/.test(path.replaceAll('\\', '/')))) {
    throw new Error('Lottie consumer: target импортирует author parser/catalog');
  }
  const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });
  const report = { sourceSha: prepared.revision, tarballSha256: prepared.tarballSha256, playerVersion: playerPackage.version,
    playerSha256: sha256(readFileSync(playerPath)), browser: browser.version(), rawSource: manifest.source,
    scope: 'packed lottie-web SVG profile; exact cubic geometry and semantic poses; native SVG raster drift recorded separately', complete: false };
  try {
    await page.goto(origin);
    await page.addScriptTag({ path: playerPath });
    Object.assign(report, await page.evaluate(async cases => { const module = await import('/bundles/candidate-lottie.js'); return module.run(cases); }, cases));
    await page.screenshot({ path: join(output, 'lottie-render.png'), fullPage: true });
    writeFileSync(join(output, 'lottie-render.json'), JSON.stringify(report, null, 2));
    return report;
  } catch (error) {
    report.error = error.message;
    report.failure = await page.evaluate(() => window.__lottieFailure ?? null).catch(() => null);
    writeFileSync(join(output, 'lottie-render.json'), JSON.stringify(report, null, 2));
    throw error;
  } finally { await page.close(); }
}
