/** Полный installed source surface проверяется отдельно от горячих измеряемых циклов. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadAuthorBaseline } from '../lib/author-baseline.js';
import { compileAuthorAnatomy } from '../lib/author-anatomy.js';
import { assertRemoteBenchmark } from './measurement.js';
import { expectedAuthorEffectTargets, inspectAuthorSvg, sha256, stableJSON, validateAuthorAdmission, validateAuthorObservation } from './author-oracle.js';

assertRemoteBenchmark();
const request = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const baseline = loadAuthorBaseline(request.sourceRoot);
const contracts = compileAuthorAnatomy(baseline, JSON.parse(readFileSync(join(request.sourceRoot, 'semantics/author-anatomy.json'), 'utf8')));
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
      const contract = contracts[`${icon}/${variant}`] ?? record.sourceContract;
      const sourceSvg = inspectAuthorSvg(record.artifactSvg);
      if (sourceSvg.pathFingerprintSha256 !== record.normalizedSource.pathFingerprintSha256) throw new Error(`${icon}/${variant}: author fingerprint не совпадает с manifest`);
      const glyph = module.glyph({ variant });
      if (glyph.provenance.kind !== 'source') throw new Error(`${icon}/${variant}: source выдаётся за модель`);
      const observed = inspectAuthorSvg(glyph.svg, { ir: true, expectedMetadata: contract.parts.map(({ id, role }) => ({ id, role })) });
      const expected = {
        icon, variant, master: record.master,
        author: record.author,
        anatomy: contract.anatomy ?? null,
        artifactSha256: sha256(record.artifactSvg),
        pathFingerprintSha256: record.normalizedSource.pathFingerprintSha256,
        priorGeometryFingerprint: record.normalizedSource.priorGeometryFingerprint,
        partsSha256: sha256(stableJSON(contract.parts.map((part, index) => ({ id: part.id, role: part.role, zIndex: part.zIndex, fillRule: part.fillRule, d: sourceSvg.paths[index].d })))),
      };
      validateAuthorObservation({ ...observed, icon: glyph.icon, variant: glyph.variant, sourceFile: glyph.provenance.file, compositionKind: glyph.composition.kind, author: glyph.provenance.author, anatomy: glyph.provenance.anatomy ?? null, staticArtifactSha256: sha256(module[variant]), parts: compactParts(glyph) }, expected);
      const caps = module.glyphCapabilities(variant);
      if (caps.icon !== icon || caps.variant !== variant) throw new Error(`${icon}/${variant}: capabilities другого symbol`);
      validateAuthorAdmission(glyph, caps, record, contract);
      if (module.glyph({ variant, modelMode: 'source-only' }) !== glyph) throw new Error(`${icon}/${variant}: source-only не сохраняет immutable default`);
      const refusals = [];
      for (const query of [{ variant, axes: { weight: 1.1 } }, { variant, modelMode: 'allow-candidate' }]) {
        try { module.glyph(query); throw new Error(`${icon}/${variant}: author parity bypass`); }
        catch (error) { if (error.code !== 'AUTHOR_PARITY_REQUIRED') throw error; refusals.push(error.code); }
      }
      try { module.glyph({ variant, axes: { weight: NaN } }); throw new Error(`${icon}/${variant}: невалидная axis принята`); }
      catch (error) { if (!(error instanceof TypeError)) throw error; }
      const motion = compileSymbolEffect(glyph, caps, 'time.advance', { duration: 360 });
      const motionRefusal = contract.anatomy ? 'GESTURE_UNSUPPORTED' : 'SEMANTIC_MOTION_UNAVAILABLE';
      if (motion.ok || motion.reason.code !== motionRefusal) throw new Error(`${icon}/${variant}: чужой motion не получил точный отказ`);
      for (const gesture of contract.gestures ?? []) {
        const result = compileSymbolEffect(glyph, caps, gesture.id, { duration: 360 });
        const targets = expectedAuthorEffectTargets(gesture);
        if (!result.ok || stableJSON(result.effect.targets) !== stableJSON(targets)) throw new Error(`${icon}/${variant}: объявленный motion не сохраняет цели, anchor или траекторию`);
      }
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
