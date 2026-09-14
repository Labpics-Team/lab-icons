#!/usr/bin/env node
/**
 * scripts/build-gate3-sabotage-proof.mjs — GATE-3 exit evidence.
 *
 * Proves that the motion pipeline correctly rejects malformed inputs:
 *   1. Malformed trajectory: invalid anchor, out-of-range progress, unknown track kind
 *   2. Adapter sabotage: missing reducedMotion, duplicate partId, mismatched unit
 *
 * Each sabotage vector must throw; if any passes silently, the proof fails.
 * This is the "sabotage evidence" required by GATE-3 (product-lab-icons r6).
 *
 * Invariants: INV-01, INV-09, INV-12, INV-19.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateMotionGesture, sampleMotionGesture } from '../src/core/motion-sampler.js';
import { generateLottieSpike } from './lib/adapter-lottie-spike.mjs';
import { generateSFSpike } from './lib/adapter-sf-spike.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function loadJSON(relativePath) {
  return JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
}

function expectThrows(label, fn) {
  try {
    fn();
    return { label, passed: false, error: 'did not throw' };
  } catch (err) {
    return { label, passed: true, errorMessage: err.message };
  }
}

export function buildSabotageProof() {
  const anatomy = loadJSON('semantics/anatomy.json');
  const timeGlyph = anatomy.glyphs?.time;
  if (!timeGlyph || !timeGlyph.motion?.gestures?.length) {
    throw new Error('GATE-3 sabotage proof: no time glyph or gestures found');
  }
  const baseGesture = timeGlyph.motion.gestures.find((g) => g.id === 'time.advance');
  if (!baseGesture) {
    throw new Error('GATE-3 sabotage proof: time.advance gesture not found');
  }

  const vectors = [];

  // --- Malformed trajectory vectors ---

  // 1. Invalid anchor (out of [0,1] range)
  vectors.push(expectThrows('trajectory: anchor out of range', () => {
    const bad = structuredClone(baseGesture);
    bad.tracks[0].anchor = [1.5, 0.5];
    validateMotionGesture(bad);
  }));

  // 2. Progress below 0
  vectors.push(expectThrows('trajectory: progress < 0', () => {
    sampleMotionGesture(baseGesture, -0.01);
  }));

  // 3. Progress above 1
  vectors.push(expectThrows('trajectory: progress > 1', () => {
    sampleMotionGesture(baseGesture, 1.01);
  }));

  // 4. Unknown track kind
  vectors.push(expectThrows('trajectory: unknown track kind', () => {
    const bad = structuredClone(baseGesture);
    bad.tracks[0].kind = 'teleport';
    validateMotionGesture(bad);
  }));

  // 5. Mismatched unit for rotate track
  vectors.push(expectThrows('trajectory: rotate with unit=px', () => {
    const bad = structuredClone(baseGesture);
    bad.tracks[0].unit = 'px';
    validateMotionGesture(bad);
  }));

  // 6. Non-finite from/to
  vectors.push(expectThrows('trajectory: NaN from value', () => {
    const bad = structuredClone(baseGesture);
    bad.tracks[0].from = NaN;
    validateMotionGesture(bad);
  }));

  // --- Adapter sabotage vectors ---

  // 7. Missing reducedMotion field
  vectors.push(expectThrows('adapter: missing reducedMotion', () => {
    const bad = structuredClone(baseGesture);
    delete bad.reducedMotion;
    validateMotionGesture(bad);
  }));

  // 8. Duplicate track partId
  vectors.push(expectThrows('adapter: duplicate track partId', () => {
    const bad = structuredClone(baseGesture);
    bad.tracks.push(structuredClone(bad.tracks[0]));
    validateMotionGesture(bad);
  }));

  // 9. Track partId not in gesture.partIds
  vectors.push(expectThrows('adapter: track partId not declared', () => {
    const bad = structuredClone(baseGesture);
    bad.tracks[0].partId = 'ghost-part';
    validateMotionGesture(bad);
  }));

  // 10. Empty gesture.id
  vectors.push(expectThrows('adapter: empty gesture id', () => {
    const bad = structuredClone(baseGesture);
    bad.id = '';
    validateMotionGesture(bad);
  }));

  // 11. Lottie adapter rejects empty tracks
  vectors.push(expectThrows('adapter-lottie: empty tracks array', () => {
    const bad = structuredClone(baseGesture);
    bad.tracks = [];
    // validateMotionGesture catches this first, but we test adapter directly
    generateLottieSpike({ ...bad, tracks: [] });
  }));

  // 12. SF adapter rejects empty tracks
  vectors.push(expectThrows('adapter-sf: empty tracks array', () => {
    const bad = structuredClone(baseGesture);
    bad.tracks = [];
    generateSFSpike({ ...bad, tracks: [] });
  }));

  const allPassed = vectors.every((v) => v.passed);

  return {
    schemaVersion: 1,
    totalVectors: vectors.length,
    passed: vectors.filter((v) => v.passed).length,
    failed: vectors.filter((v) => !v.passed).length,
    allPassed,
    vectors,
  };
}

const isMain = process.argv[1] && import.meta.url.startsWith('file:') &&
  process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/');

if (isMain) {
  const proof = buildSabotageProof();
  console.log(`GATE-3 sabotage proof: ${proof.totalVectors} vectors`);
  console.log(`  passed: ${proof.passed}, failed: ${proof.failed}`);

  if (!proof.allPassed) {
    console.error('GATE-3: FAIL — some sabotage vectors did not throw');
    for (const v of proof.vectors) {
      if (!v.passed) {
        console.error(`  FAIL: ${v.label} — ${v.error}`);
      }
    }
    process.exit(1);
  }
  console.log('GATE-3: PASS — all sabotage vectors correctly rejected');
}