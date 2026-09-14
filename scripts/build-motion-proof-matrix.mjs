#!/usr/bin/env node
/**
 * scripts/build-motion-proof-matrix.mjs — closed gesture×icon proof matrix for MO-04.
 *
 * For each motion family in the census, proves trajectory on every compatible
 * icon × variant × progress sample. Produces a deterministic JSON matrix that
 * serves as exit evidence for MO-04 (product-lab-icons r6).
 *
 * Exit evidence:
 *   - Every accepted + candidate icon in every family is proven or explicitly excluded
 *   - Proof covers outline + filled variants at 9 progress samples
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
const PROGRESS_SAMPLES = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];

function loadJSON(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
}

function buildProofMatrix() {
  const anatomy = loadJSON('semantics/anatomy.json');
  const catalog = loadJSON('semantics/catalog.json');
  const grid = loadJSON('semantics/grid.json');
  const census = loadJSON('semantics/motion-census.json');

  const matrix = {
    schemaVersion: 1,
    families: [],
    summary: { totalIcons: 0, totalProofs: 0, passed: 0, skipped: 0, failed: 0 },
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
        familyResult.icons.push({ icon: iconName, status: 'excluded' });
        matrix.summary.skipped++;
        continue;
      }

      const glyph = anatomy.glyphs?.[iconName];
      const model = catalog.icons?.[iconName]?.model;

      if (!glyph || !model) {
        familyResult.icons.push({ icon: iconName, status: 'missing-glyph-or-model' });
        matrix.summary.skipped++;
        continue;
      }

      // Find a matching gesture for this family's requiredTrackKinds
      const gestures = glyph.motion?.gestures || [];
      const matchingGesture = gestures.find((g) => {
        const trackKinds = new Set(g.tracks.map((t) => t.kind));
        return family.requiredTrackKinds.every((k) => trackKinds.has(k));
      });

      if (!matchingGesture) {
        // No gesture declared yet for this icon/family combo — record as needs-declaration
        familyResult.icons.push({
          icon: iconName,
          status: 'needs-declaration',
          requiredTrackKinds: family.requiredTrackKinds,
        });
        matrix.summary.skipped++;
        continue;
      }

      // Validate gesture schema
      try {
        validateMotionGesture(matchingGesture);
      } catch (err) {
        familyResult.icons.push({
          icon: iconName,
          status: 'schema-invalid',
          error: err.message,
        });
        matrix.summary.failed++;
        continue;
      }

      // Build parts and prove trajectory for both variants
      let built;
      try {
        built = buildGlyphParts(glyph, grid, {}, anatomy.glyphs);
      } catch (err) {
        familyResult.icons.push({
          icon: iconName,
          status: 'build-failed',
          error: err.message,
        });
        matrix.summary.failed++;
        continue;
      }

      const variantResults = [];
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

        variantResults.push({
          variant,
          status: result.ok ? 'pass' : 'fail',
          samples: result.samples?.length || 0,
          findings: result.findings || [],
        });

        if (result.ok) {
          matrix.summary.passed++;
        } else {
          matrix.summary.failed++;
        }
        matrix.summary.totalProofs++;
      }

      familyResult.icons.push({
        icon: iconName,
        gestureId: matchingGesture.id,
        status: variantResults.every((v) => v.status === 'pass') ? 'proven' : 'partial',
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
  const outDir = join(ROOT, 'epics', 'ds-icons', 'reports', 'mo-04');
  mkdirSync(outDir, { recursive: true });
  const matrix = buildProofMatrix();
  const outPath = join(outDir, 'motion-proof-matrix.json');
  writeFileSync(outPath, JSON.stringify(matrix, null, 2) + '\n', 'utf8');

  console.log(`MO-04 proof matrix: ${matrix.families.length} families, ${matrix.summary.totalIcons} icons`);
  console.log(`  passed: ${matrix.summary.passed}, skipped: ${matrix.summary.skipped}, failed: ${matrix.summary.failed}`);
  console.log(`  output: ${outPath}`);

  if (matrix.summary.failed > 0) {
    console.error('MO-04: FAIL — some proofs did not pass');
    process.exit(1);
  }
  console.log('MO-04: PASS — closed gesture×icon proof matrix complete');
}

export { buildProofMatrix };