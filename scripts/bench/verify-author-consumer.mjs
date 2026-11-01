/** Полный installed source surface проверяется отдельно от горячих измеряемых циклов. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAuthorBaseline } from '../lib/author-baseline.js';
import { assertRemoteBenchmark } from './measurement.js';
import { inspectAuthorSvg, sha256, stableJSON, validateAuthorObservation } from './author-oracle.js';

assertRemoteBenchmark();
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const baseline = loadAuthorBaseline(request.sourceRoot);
const manifestBytes = readFileSync(join(request.sourceRoot, 'semantics/figma-baseline.json'));
const { compileSymbolEffect } = await import(pathToFileURL(join(request.packageRoot, 'dist/motion/index.js')).href);
const report = { version: 1, source: baseline.source, manifestSha256: sha256(manifestBytes), expectedCounts: baseline.counts, completed: 0, icons: {} };
const compactParts = glyph => glyph.parts.map(part => ({ id: part.id, role: part.role, zIndex: part.zIndex, fillRule: part.fillRule, d: part.d }));
try {
  for (const [icon, variants] of Object.entries(baseline.icons)) {
    const module = await import(pathToFileURL(join(request.packageRoot, `dist/symbols/${icon}.js`)).href);
    report.icons[icon] = {};
    for (const variant of ['outline', 'filled']) {
      const record = variants[variant];
      const sourceSvg = inspectAuthorSvg(record.artifactSvg);
      if (sourceSvg.pathFingerprintSha256 !== record.normalizedSource.pathFingerprintSha256) throw new Error(`${icon}/${variant}: author fingerprint не совпадает с manifest`);
      const glyph = module.glyph({ variant });
      if (glyph.provenance.kind !== 'source') throw new Error(`${icon}/${variant}: source выдаётся за модель`);
      const observed = inspectAuthorSvg(glyph.svg, { ir: true });
      const expected = {
        icon, variant, master: record.master,
        author: record.author,
        artifactSha256: sha256(record.artifactSvg),
        pathFingerprintSha256: record.normalizedSource.pathFingerprintSha256,
        priorGeometryFingerprint: record.normalizedSource.priorGeometryFingerprint,
        partsSha256: sha256(stableJSON(record.sourceContract.parts.map((part, index) => ({ id: part.id, role: part.role, zIndex: part.zIndex, fillRule: part.fillRule, d: sourceSvg.paths[index].d })))),
      };
      validateAuthorObservation({ ...observed, icon: glyph.icon, variant: glyph.variant, sourceFile: glyph.provenance.file, compositionKind: glyph.composition.kind, author: glyph.provenance.author, staticArtifactSha256: sha256(module[variant]), parts: compactParts(glyph) }, expected);
      const caps = module.glyphCapabilities(variant);
      if (caps.icon !== icon || caps.variant !== variant) throw new Error(`${icon}/${variant}: capabilities другого symbol`);
      if (caps.modelState !== null || caps.supportedAxes.length || Object.keys(caps.axes).length || caps.motion.state !== 'source-only' || caps.motion.partIds.length || caps.motion.tracks.length || caps.motion.gestures.length || caps.motion.adapters.lottie !== 'not-exported' || caps.motion.adapters.sfSymbols !== 'not-exported' || stableJSON(caps.author) !== stableJSON(record.author)) throw new Error(`${icon}/${variant}: неподтверждённые current capabilities`);
      if (module.glyph({ variant, modelMode: 'source-only' }) !== glyph) throw new Error(`${icon}/${variant}: source-only не сохраняет immutable default`);
      const refusals = [];
      for (const query of [{ variant, axes: { weight: 1.1 } }, { variant, modelMode: 'allow-candidate' }]) {
        try { module.glyph(query); throw new Error(`${icon}/${variant}: author parity bypass`); }
        catch (error) { if (error.code !== 'AUTHOR_PARITY_REQUIRED') throw error; refusals.push(error.code); }
      }
      try { module.glyph({ variant, axes: { weight: NaN } }); throw new Error(`${icon}/${variant}: невалидная axis принята`); }
      catch (error) { if (!(error instanceof TypeError)) throw error; }
      const motion = compileSymbolEffect(glyph, caps, 'time.advance', { duration: 360 });
      if (motion.ok || motion.reason.code !== 'SEMANTIC_MOTION_UNAVAILABLE') throw new Error(`${icon}/${variant}: не подтверждённое motion принято`);
      report.icons[icon][variant] = { ...expected, svgSha256: observed.svgSha256, complexity: observed.complexity, refusals, motionRefusal: motion.reason.code };
      report.completed++;
    }
    writeFileSync(request.output, JSON.stringify(report, null, 2));
  }
  if (report.completed !== baseline.counts.variants) throw new Error('author consumer: неполная variant coverage');
  writeFileSync(request.output, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ completed: report.completed, manifestSha256: report.manifestSha256 }));
} catch (error) {
  report.failure = { message: error.message, completed: report.completed };
  writeFileSync(request.output, JSON.stringify(report, null, 2));
  throw error;
}
