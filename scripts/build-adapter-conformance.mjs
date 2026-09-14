#!/usr/bin/env node
/**
 * scripts/build-adapter-conformance.mjs — ADAPTER-01 exit evidence.
 *
 * Runs Lottie and SF spike adapters against every declared gesture in the
 * proof matrix, verifies structural equivalence of outputs, and produces
 * a deterministic conformance report.
 *
 * Exit evidence for ADAPTER-01 (product-lab-icons r6):
 *   - Every PROVEN gesture in MO-04 matrix is adapted by both targets
 *   - Equivalence checks: track count, anchor preservation, range preservation,
 *     reduced-motion declaration, gesture ID propagation
 *   - Report is deterministic (sorted, no timestamps)
 *   - No core IR mutation; reads from semantics/*.json and existing adapters
 *
 * Invariants: INV-09, INV-12, INV-19, INV-21.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateLottieSpike } from './lib/adapter-lottie-spike.mjs';
import { generateSFSpike } from './lib/adapter-sf-spike.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadJSON(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
}

function checkEquivalence(gesture, lottie, sf) {
  const findings = [];

  // Track count
  if (lottie.layers.length !== gesture.tracks.length) {
    findings.push(`lottie layer count ${lottie.layers.length} != track count ${gesture.tracks.length}`);
  }
  if (sf.layers.length !== gesture.tracks.length) {
    findings.push(`sf layer count ${sf.layers.length} != track count ${gesture.tracks.length}`);
  }

  // Per-track checks
  const minLen = Math.min(lottie.layers.length, sf.layers.length, gesture.tracks.length);
  for (let i = 0; i < minLen; i++) {
    const track = gesture.tracks[i];
    const lLayer = lottie.layers[i];
    const sLayer = sf.layers[i];

    // Anchor preservation
    if (track.anchor) {
      const lAnchor = lLayer?.ks?.a?.k;
      if (lAnchor) {
        const lx = lAnchor[0] / 24;
        const ly = lAnchor[1] / 24;
        if (Math.abs(lx - track.anchor[0]) > 0.001 || Math.abs(ly - track.anchor[1]) > 0.001) {
          findings.push(`track ${track.partId}: lottie anchor [${lx},${ly}] != gesture [${track.anchor}]`);
        }
      }
      const sAnchor = sLayer?.anchor;
      if (sAnchor) {
        if (Math.abs(sAnchor.x - track.anchor[0]) > 0.001 || Math.abs(sAnchor.y - track.anchor[1]) > 0.001) {
          findings.push(`track ${track.partId}: sf anchor [${sAnchor.x},${sAnchor.y}] != gesture [${track.anchor}]`);
        }
      }
    }

    // Range preservation (rotate tracks)
    if (track.kind === 'rotate') {
      const lFrom = lLayer?.ks?.r?.k?.[0]?.s?.[0];
      const lTo = lLayer?.ks?.r?.k?.[1]?.s?.[0];
      if (lFrom !== track.from || lTo !== track.to) {
        findings.push(`track ${track.partId}: lottie rotate [${lFrom},${lTo}] != gesture [${track.from},${track.to}]`);
      }
      const sFrom = sLayer?.animation?.keyframes?.[0]?.value;
      const sTo = sLayer?.animation?.keyframes?.[1]?.value;
      if (sFrom !== track.from || sTo !== track.to) {
        findings.push(`track ${track.partId}: sf rotate [${sFrom},${sTo}] != gesture [${track.from},${track.to}]`);
      }
    }

    // Opacity/reveal range preservation
    if (track.kind === 'opacity' || track.kind === 'reveal') {
      const sFrom = sLayer?.animation?.keyframes?.[0]?.value;
      const sTo = sLayer?.animation?.keyframes?.[1]?.value;
      if (sFrom !== track.from || sTo !== track.to) {
        findings.push(`track ${track.partId}: sf ${track.kind} [${sFrom},${sTo}] != gesture [${track.from},${track.to}]`);
      }
    }
  }

  // Gesture ID propagation
  if (lottie.nm !== gesture.id) {
    findings.push(`lottie name '${lottie.nm}' != gesture id '${gesture.id}'`);
  }
  if (sf.symbolName !== gesture.id) {
    findings.push(`sf symbolName '${sf.symbolName}' != gesture id '${gesture.id}'`);
  }

  // Reduced-motion declaration (SF only — Lottie has no native field)
  if (sf.reducedMotionEquivalent !== 'static' && sf.reducedMotionEquivalent !== 'fade-only' && sf.reducedMotionEquivalent !== 'none') {
    findings.push(`sf reducedMotionEquivalent '${sf.reducedMotionEquivalent}' not in [static, fade-only, none]`);
  }

  return findings;
}

export function buildConformanceReport() {
  const anatomy = loadJSON('semantics/anatomy.json');
  const proofMatrix = loadJSON('epics/ds-icons/reports/mo-04/motion-proof-matrix.json');

  const report = {
    schemaVersion: 1,
    gestures: [],
    summary: { total: 0, passed: 0, failed: 0, skipped: 0 },
  };

  // Collect all proven gestures from proof matrix
  const provenGestures = new Map();
  for (const family of proofMatrix.families) {
    for (const iconEntry of family.icons) {
      if (iconEntry.status === 'proven' && iconEntry.gestureId) {
        const glyph = anatomy.glyphs?.[iconEntry.icon];
        const gesture = glyph?.motion?.gestures?.find((g) => g.id === iconEntry.gestureId);
        if (gesture) {
          provenGestures.set(gesture.id, { gesture, icon: iconEntry.icon, family: family.id });
        }
      }
    }
  }

  // Also include time.advance even if not "proven" in matrix (it's the only declared gesture)
  const timeGlyph = anatomy.glyphs?.time;
  if (timeGlyph?.motion?.gestures) {
    for (const g of timeGlyph.motion.gestures) {
      if (!provenGestures.has(g.id)) {
        provenGestures.set(g.id, { gesture: g, icon: 'time', family: 'declared' });
      }
    }
  }

  const sortedIds = [...provenGestures.keys()].sort();

  for (const gestureId of sortedIds) {
    const { gesture, icon, family } = provenGestures.get(gestureId);
    report.summary.total++;

    let lottie, sf;
    try {
      lottie = generateLottieSpike(gesture);
      sf = generateSFSpike(gesture);
    } catch (err) {
      report.gestures.push({
        gestureId,
        icon,
        family,
        status: 'adapter-error',
        error: err.message,
      });
      report.summary.failed++;
      continue;
    }

    const findings = checkEquivalence(gesture, lottie, sf);

    if (findings.length === 0) {
      report.gestures.push({
        gestureId,
        icon,
        family,
        status: 'pass',
        lottieLayers: lottie.layers.length,
        sfLayers: sf.layers.length,
        trackCount: gesture.tracks.length,
      });
      report.summary.passed++;
    } else {
      report.gestures.push({
        gestureId,
        icon,
        family,
        status: 'fail',
        findings,
      });
      report.summary.failed++;
    }
  }

  return report;
}

const isMain = process.argv[1] && import.meta.url.startsWith('file:') &&
  process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/');

if (isMain) {
  const outDir = join(ROOT, 'epics', 'ds-icons', 'reports', 'adapter-01');
  mkdirSync(outDir, { recursive: true });
  const report = buildConformanceReport();
  const outPath = join(outDir, 'adapter-conformance.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2) + '\n', 'utf8');

  console.log(`ADAPTER-01 conformance: ${report.summary.total} gestures`);
  console.log(`  passed: ${report.summary.passed}, failed: ${report.summary.failed}, skipped: ${report.summary.skipped}`);
  console.log(`  output: ${outPath}`);

  if (report.summary.failed > 0) {
    console.error('ADAPTER-01: FAIL — some gestures did not conform');
    for (const g of report.gestures) {
      if (g.status === 'fail') {
        console.error(`  ${g.gestureId}: ${g.findings.join('; ')}`);
      }
    }
    process.exit(1);
  }
  console.log('ADAPTER-01: PASS — all gestures conform across Lottie and SF adapters');
}