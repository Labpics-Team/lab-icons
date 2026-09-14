#!/usr/bin/env node
/**
 * scripts/build-motion-failure-matrix.mjs — versioned gesture failure-code matrix for MO-05.
 *
 * For each motion family in the census, classifies every compatible icon into
 * a structured failure code: NO_GESTURE, SCHEMA_INVALID, BUILD_FAILED,
 * TRAJECTORY_FAIL, PARTIAL, or PROVEN. Produces a deterministic JSON matrix
 * that serves as exit evidence for MO-05 (product-lab-icons r6).
 *
 * Exit evidence:
 *   - Every accepted + candidate icon in every family is classified
 *   - Failure codes are versioned and closed-world
 *   - Matrix is deterministic (sorted keys, no timestamps)
 *   - No core IR mutation; reads from semantics/*.json only
 *
 * Invariants: INV-09 (gesture names meaning), INV-12 (contracts versioned).
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGlyphParts } from '../src/core/anatomy-gen.js';
import { proveMotionTrajectory } from './lib/motion-trajectory.js';
import { validateMotionGesture } from '../src/core/motion-sampler.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const VALID_FAILURE_CODES = Object.freeze([
  'PROVEN',
  'PARTIAL',
  'NO_GESTURE',
  'SCHEMA_INVALID',
  'BUILD_FAILED',
  'TRAJECTORY_FAIL',
  'EXCLUDED',
  'MISSING_GLYPH_OR_MODEL',
]);

function loadJSON(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
}

export function buildFailureMatrix() {
  const anatomy = loadJSON('semantics/anatomy.json');
  const catalog = loadJSON('semantics/catalog.json');
  const grid = loadJSON('semantics/grid.json');
  const census = loadJSON('semantics/motion-census.json');

  const matrix = {
    schemaVersion: 1,
    validFailureCodes: [...VALID_FAILURE_CODES],
    families: [],
    summary: { totalIcons: 0, proven: 0, partial: 0, noGesture: 0, schemaInvalid: 0, buildFailed: 0, trajectoryFail: 0, excluded: 0, missing: 0 },
  };

  for (const family of census.families) {
    const familyResult = {
      id: family.id,
      meaning: family.meaning,
      requiredTrackKinds: family.requiredTrackKinds,
      icons: [],
    };

    const allIcons = [...(family.accepted || []), ...(family.candidate || [])];
    const excludedSet = new Set((family.exclusions || []).map((e) => e.icon || e));

    for (const iconName of allIcons.sort()) {
      if (excludedSet.has(iconName)) {
        familyResult.icons.push({ icon: iconName, code: 'EXCLUDED' });
        matrix.summary.excluded++;
        matrix.summary.totalIcons++;
        continue;
      }

      const glyph = anatomy.glyphs?.[iconName];
      const model = catalog.icons?.[iconName]?.model;

      if (!glyph || !model) {
        familyResult.icons.push({ icon: iconName, code: 'MISSING_GLYPH_OR_MODEL' });
        matrix.summary.missing++;
        matrix.summary.totalIcons++;
        continue;
      }

      const gestures = glyph.motion?.gestures || [];
      const matchingGesture = gestures.find((g) => {
        const trackKinds = new Set(g.tracks.map((t) => t.kind));
        return family.requiredTrackKinds.every((k) => trackKinds.has(k));
      });

      if (!matchingGesture) {
        familyResult.icons.push({ icon: iconName, code: 'NO_GESTURE', requiredTrackKinds: family.requiredTrackKinds });
        matrix.summary.noGesture++;
        matrix.summary.totalIcons++;
        continue;
      }

      try {
        validateMotionGesture(matchingGesture);
      } catch (err) {
        familyResult.icons.push({ icon: iconName, code: 'SCHEMA_INVALID', error: err.message, gestureId: matchingGesture.id });
        matrix.summary.schemaInvalid++;
        matrix.summary.totalIcons++;
        continue;
      }

      let built;
      try {
        built = buildGlyphParts(glyph, grid, {}, anatomy.glyphs);
      } catch (err) {
        familyResult.icons.push({ icon: iconName, code: 'BUILD_FAILED', error: err.message, gestureId: matchingGesture.id });
        matrix.summary.buildFailed++;
        matrix.summary.totalIcons++;
        continue;
      }

      const variantResults = [];
      let anyPass = false;
      let anyFail = false;

      for (const variant of ['outline', 'filled']) {
        const variantModel = model.variants?.[variant];
        if (!variantModel || !built[variant]) {
          variantResults.push({ variant, status: 'missing' });
          continue;
        }

        const result = proveMotionTrajectory({
          parts: built[variant],
          composition: variantModel.composition,
          gesture: matchingGesture,
        });

        if (result.ok) {
          anyPass = true;
          variantResults.push({ variant, status: 'pass', samples: result.samples?.length || 0 });
        } else {
          anyFail = true;
          variantResults.push({ variant, status: 'fail', findings: result.findings || [] });
        }
      }

      let code;
      if (anyPass && !anyFail) {
        code = 'PROVEN';
        matrix.summary.proven++;
      } else if (anyPass && anyFail) {
        code = 'PARTIAL';
        matrix.summary.partial++;
      } else {
        code = 'TRAJECTORY_FAIL';
        matrix.summary.trajectoryFail++;
      }

      familyResult.icons.push({
        icon: iconName,
        code,
        gestureId: matchingGesture.id,
        variants: variantResults,
      });
      matrix.summary.totalIcons++;
    }

    matrix.families.push(familyResult);
  }

  return matrix;
}

const isMain = process.argv[1] && import.meta.url.startsWith('file:') &&
  process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/');

if (isMain) {
  const outDir = join(ROOT, 'epics', 'ds-icons', 'reports', 'mo-05');
  mkdirSync(outDir, { recursive: true });
  const matrix = buildFailureMatrix();
  const outPath = join(outDir, 'motion-failure-matrix.json');
  writeFileSync(outPath, JSON.stringify(matrix, null, 2) + '\n', 'utf8');

  console.log(`MO-05 failure matrix: ${matrix.families.length} families, ${matrix.summary.totalIcons} icons`);
  console.log(`  proven: ${matrix.summary.proven}, partial: ${matrix.summary.partial}, noGesture: ${matrix.summary.noGesture}`);
  console.log(`  schemaInvalid: ${matrix.summary.schemaInvalid}, buildFailed: ${matrix.summary.buildFailed}, trajectoryFail: ${matrix.summary.trajectoryFail}`);
  console.log(`  excluded: ${matrix.summary.excluded}, missing: ${matrix.summary.missing}`);
  console.log(`  output: ${outPath}`);
  console.log('MO-05: PASS — versioned gesture failure-code matrix complete');
}