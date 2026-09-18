#!/usr/bin/env node
/**
 * scripts/lib/adapter-sf-spike.mjs — SF Symbols adapter spike for ADAPTER-00.
 *
 * Consumes target-neutral motion gesture (time.advance) and produces
 * a minimal SF Symbols JSON descriptor that preserves semantic contract
 * without leaking target-specific fields into core IR.
 *
 * Exit evidence for ADAPTER-00 (product-lab-icons r6):
 *   - Produces valid SF Symbols layer structure with rotation tracks
 *   - Maps normalized-0-to-1 progress to SF keyframe timing
 *   - Preserves anchor points from gesture tracks
 *   - Does not modify core motion-sampler or anatomy-gen
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

export function generateSFSpike(gesture, outPath) {
  if (!gesture || !gesture.tracks || gesture.tracks.length === 0) {
    throw new TypeError('adapter-sf-spike: gesture must have at least one track');
  }

  const layers = gesture.tracks.map((track) => ({
    name: track.partId,
    type: 'rotation',
    anchor: { x: track.anchor[0], y: track.anchor[1] },
    animation: {
      type: 'linear',
      duration: 1.0,
      keyframes: [
        { time: 0.0, value: track.from },
        { time: 1.0, value: track.to }
      ]
    }
  }));

  const sfSymbol = {
    version: '3.0',
    symbolName: gesture.id,
    canvasSize: { width: 24, height: 24 },
    reducedMotionEquivalent: 'static',
    layers
  };

  if (outPath) {
    mkdirSync(dirname(outPath), { recursive: true });
    writeFileSync(outPath, JSON.stringify(sfSymbol, null, 2) + '\n', 'utf8');
  }

  return sfSymbol;
}

const isMain = process.argv[1] && import.meta.url.startsWith('file:') &&
  process.argv[1].replace(/\\/g, '/') === fileURLToPath(import.meta.url).replace(/\\/g, '/');

if (isMain) {
  const anatomy = JSON.parse(readFileSync(join(ROOT, 'semantics', 'anatomy.json'), 'utf8'));
  const timeGlyph = anatomy.glyphs?.time;
  if (!timeGlyph || !timeGlyph.motion?.gestures?.length) {
    console.error('adapter-sf-spike: no time glyph or gestures found');
    process.exit(1);
  }

  const gesture = timeGlyph.motion.gestures.find(g => g.id === 'time.advance');
  if (!gesture) {
    console.error('adapter-sf-spike: time.advance gesture not found');
    process.exit(1);
  }

  const outDir = join(ROOT, 'epics', 'ds-icons', 'reports', 'adapter-00');
  const outPath = join(outDir, 'sf-spike-time-advance.json');
  generateSFSpike(gesture, outPath);
  console.log(`adapter-sf-spike: generated ${outPath}`);
}