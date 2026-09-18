#!/usr/bin/env node
/**
 * scripts/build-motion-contract.mjs — MOTION-CONTRACT-01 exit evidence.
 *
 * Produces a versioned, target-neutral gesture contract package:
 *   1. Gesture snapshots: deterministic JSON of every declared gesture
 *   2. Semver marker: contract version for downstream consumers
 *   3. Packed fixture: self-contained artifact for release verification
 *   4. Census non-public proof: verifies motion-census.json is NOT in public IR exports
 *
 * Exit evidence for MOTION-CONTRACT-01 (product-lab-icons r6):
 *   - Snapshot covers all declared gestures with full track detail
 *   - Contract is versioned (semver-compatible schemaVersion)
 *   - Packed fixture is deterministic and JSON-serializable
 *   - Census is proven absent from public IR (export-surface.json)
 *
 * Invariants: INV-09, INV-12, INV-19, INV-21.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CONTRACT_VERSION = '1.0.0';

function loadJSON(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
}

function buildGestureSnapshots(anatomy) {
  const snapshots = [];
  for (const [iconName, glyph] of Object.entries(anatomy.glyphs ?? {})) {
    const gestures = glyph.motion?.gestures ?? [];
    for (const gesture of gestures) {
      snapshots.push({
        icon: iconName,
        gestureId: gesture.id,
        kind: gesture.kind,
        partIds: [...gesture.partIds],
        progress: gesture.progress,
        reducedMotion: gesture.reducedMotion,
        tracks: gesture.tracks.map((track) => ({
          partId: track.partId,
          kind: track.kind,
          anchor: track.anchor ? [...track.anchor] : undefined,
          from: track.from,
          to: track.to,
          unit: track.unit,
          interpolation: track.interpolation,
        })),
      });
    }
  }
  // Sort by icon then gestureId for determinism
  snapshots.sort((a, b) => {
    if (a.icon !== b.icon) return a.icon.localeCompare(b.icon);
    return a.gestureId.localeCompare(b.gestureId);
  });
  return snapshots;
}

function proveCensusNonPublic() {
  const findings = [];

  // Check export-surface.json for motion-census references
  let exportSurface;
  try {
    exportSurface = loadJSON('release/export-surface.json');
  } catch {
    // If release artifact doesn't exist yet, check src/ir/index.ts exports instead
    const irSource = readFileSync(join(ROOT, 'src', 'ir', 'index.ts'), 'utf8');
    if (irSource.includes('motion-census') || irSource.includes('motionCensus')) {
      findings.push('src/ir/index.ts exports motion-census reference');
    }
    if (irSource.includes('buildMotionCensus') || irSource.includes('MotionCensus')) {
      findings.push('src/ir/index.ts exports motion-census builder/type');
    }
    return findings;
  }

  // Check all exported symbols for census leakage
  const exports = exportSurface.exports ?? exportSurface.symbols ?? [];
  for (const exp of exports) {
    const name = typeof exp === 'string' ? exp : exp.name ?? '';
    if (name.toLowerCase().includes('census')) {
      findings.push(`export-surface.json exports census symbol: ${name}`);
    }
  }

  // Check if motion-census.json is listed as a public asset
  const assets = exportSurface.assets ?? [];
  for (const asset of assets) {
    const path = typeof asset === 'string' ? asset : asset.path ?? '';
    if (path.includes('motion-census')) {
      findings.push(`export-surface.json lists motion-census as public asset: ${path}`);
    }
  }

  return findings;
}

export function buildMotionContract() {
  const anatomy = loadJSON('semantics/anatomy.json');
  const snapshots = buildGestureSnapshots(anatomy);
  const censusFindings = proveCensusNonPublic();

  const contract = {
    schemaVersion: CONTRACT_VERSION,
    generatedAt: null, // Deterministic: no timestamps
    gestureCount: snapshots.length,
    snapshots,
    censusNonPublic: {
      verified: censusFindings.length === 0,
      findings: censusFindings,
    },
    metadata: {
      sourceFiles: ['semantics/anatomy.json'],
      excludedFromPublicIR: ['semantics/motion-census.json', 'semantics/motion-families.json'],
      invariants: ['INV-09', 'INV-12', 'INV-19', 'INV-21'],
    },
  };

  return contract;
}

const isMain = process.argv[1] && import.meta.url.startsWith('file:') &&
  process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/');

if (isMain) {
  const outDir = join(ROOT, 'epics', 'ds-icons', 'reports', 'motion-contract-01');
  mkdirSync(outDir, { recursive: true });

  const contract = buildMotionContract();
  const outPath = join(outDir, 'motion-contract.json');
  writeFileSync(outPath, JSON.stringify(contract, null, 2) + '\n', 'utf8');

  console.log(`MOTION-CONTRACT-01: ${contract.gestureCount} gesture snapshot(s)`);
  console.log(`  census non-public: ${contract.censusNonPublic.verified}`);
  if (!contract.censusNonPublic.verified) {
    console.error('  FAIL — census leaked to public IR:');
    for (const f of contract.censusNonPublic.findings) {
      console.error(`    - ${f}`);
    }
    process.exit(1);
  }
  console.log(`  output: ${outPath}`);
  console.log('MOTION-CONTRACT-01: PASS — versioned gesture contract + census non-public proof');
}