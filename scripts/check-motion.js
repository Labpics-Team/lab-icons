#!/usr/bin/env node

/** Executable proof for declared semantic motion contracts. */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildGlyphParts } from './lib/anatomy-gen.js';
import { proveMotionTrajectory } from './lib/motion-trajectory.js';
import { validateMotionGesture } from './lib/motion-sampler.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export function checkMotionContracts({ anatomy, catalog, grid }) {
  const findings = [];
  for (const [name, entry] of Object.entries(anatomy.glyphs ?? {})) {
    const gestures = entry.motion?.gestures ?? [];
    if (gestures.length === 0) continue;
    const model = catalog.icons?.[name]?.model;
    if (!model) {
      findings.push(`${name}: motion gesture has no catalog model`);
      continue;
    }
    let built;
    try {
      built = buildGlyphParts(entry, grid, {}, anatomy.glyphs);
    } catch (cause) {
      findings.push(`${name}: cannot build motion parts (${cause.message})`);
      continue;
    }
    for (const gesture of gestures) {
      try {
        validateMotionGesture(gesture);
      } catch (cause) {
        findings.push(`${name}/${gesture.id ?? '<unknown>'}: ${cause.message}`);
        continue;
      }
      for (const variant of ['outline', 'filled']) {
        const variantModel = model.variants?.[variant];
        if (!variantModel || !built[variant]) {
          findings.push(`${name}/${variant}: motion gesture has no model variant`);
          continue;
        }
        const result = proveMotionTrajectory({
          parts: built[variant],
          composition: variantModel.composition,
          gesture,
        });
        if (!result.ok) {
          findings.push(
            `${name}/${variant}/${gesture.id}: ${result.findings.join('; ')}`,
          );
        }
      }
    }
  }
  return findings;
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isCli) {
  const anatomy = JSON.parse(readFileSync(join(ROOT, 'semantics', 'anatomy.json'), 'utf8'));
  const catalog = JSON.parse(readFileSync(join(ROOT, 'semantics', 'catalog.json'), 'utf8'));
  const grid = JSON.parse(readFileSync(join(ROOT, 'semantics', 'grid.json'), 'utf8'));
  const findings = checkMotionContracts({ anatomy, catalog, grid });
  if (findings.length > 0) {
    console.error(`check-motion: FAIL — ${findings.length} finding(s)`);
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
  }
  const count = Object.values(anatomy.glyphs ?? {})
    .flatMap((entry) => entry.motion?.gestures ?? []).length;
  console.log(`check-motion: PASS — ${count} gesture contract(s), trajectory proof resolved`);
}

