#!/usr/bin/env node
/**
 * scripts/lib/adapter-lottie-spike.mjs — Lottie adapter spike for ADAPTER-00.
 *
 * Consumes target-neutral motion gesture (time.advance) and produces
 * a minimal Lottie JSON that preserves semantic contract without
 * leaking target-specific fields into core IR.
 *
 * Exit evidence for ADAPTER-00 (product-lab-icons r6):
 *   - Produces valid Lottie JSON with correct layer structure
 *   - Maps normalized-0-to-1 progress to Lottie keyframes
 *   - Preserves anchor points from gesture tracks
 *   - Does not modify core motion-sampler or anatomy-gen
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function generateLottieSpike(gesture, outPath) {
  if (!gesture || !gesture.tracks || gesture.tracks.length === 0) {
    throw new TypeError('adapter-lottie-spike: gesture must have at least one track');
  }

  const layers = gesture.tracks.map((track, index) => ({
    ty: 3, // shape layer placeholder
    nm: track.partId,
    ip: 0,
    op: 60, // 60 frames = 1 second at 60fps
    st: 0,
    ks: {
      r: {
        a: 1, // animated
        k: [
          { t: 0, s: [track.from], i: { x: [0.5], y: [1] }, o: { x: [0.5], y: [0] } },
          { t: 60, s: [track.to] }
        ]
      },
      a: { // anchor point (normalized 0-1 → pixel space at 24px canvas)
        a: 0,
        k: [track.anchor[0] * 24, track.anchor[1] * 24, 0]
      }
    }
  }));

  const lottie = {
    v: '5.7.4',
    fr: 60,
    ip: 0,
    op: 60,
    w: 24,
    h: 24,
    nm: gesture.id,
    ddd: 0,
    assets: [],
    layers,
    markers: []
  };

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(lottie, null, 2) + '\n', 'utf8');
  }

  return lottie;
}

const isMain = process.argv[1] && import.meta.url.startsWith('file:') &&
  process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/');

if (isMain) {
  const anatomy = JSON.parse(readFileSync(join(ROOT, 'semantics', 'anatomy.json'), 'utf8'));
  const timeGlyph = anatomy.glyphs?.time;
  if (!timeGlyph || !timeGlyph.motion?.gestures?.length) {
    console.error('adapter-lottie-spike: no time glyph or gestures found');
    process.exit(1);
  }

  const gesture = timeGlyph.motion.gestures.find(g => g.id === 'time.advance');
  if (!gesture) {
    console.error('adapter-lottie-spike: time.advance gesture not found');
    process.exit(1);
  }

  const outDir = join(ROOT, 'epics', 'ds-icons', 'reports', 'adapter-00');
  const outPath = join(outDir, 'lottie-spike-time-advance.json');
  generateLottieSpike(gesture, outPath);
  console.log(`adapter-lottie-spike: generated ${outPath}`);
}