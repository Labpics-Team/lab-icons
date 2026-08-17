/**
 * Target-neutral motion contracts and trajectory proof.
 *
 * A gesture is data, not a renderer: progress is normalized to [0, 1], tracks
 * describe semantic part rotations, and the proof samples the resulting
 * boolean composition at target raster sizes and phases. Lottie/SF Symbols
 * adapters can consume the same frames without becoming a second geometry
 * source of truth.
 */

import { rotatePath } from './anatomy-gen.js';
import {
  DEFAULT_RASTER_PHASES,
  rasterizePathEntries,
  topologyOfMask,
} from './ink-raster.js';
import { sampleMotionGesture, validateMotionGesture } from './motion-sampler.js';
import { lowerModelComposition } from './model-composition.js';

export const DEFAULT_MOTION_PROGRESS = Object.freeze([
  0,
  0.125,
  0.25,
  0.375,
  0.5,
  0.625,
  0.75,
  0.875,
  1,
]);

export const DEFAULT_MOTION_RASTER_SIZES = Object.freeze([16, 20, 24, 32, 48]);

export { sampleMotionGesture } from './motion-sampler.js';

function compositionEntries(parts, composition, rotations, canvas) {
  const transformed = parts.map((part) => {
    const transform = rotations.get(part.id);
    const rotation = transform?.rotation;
    const d = rotation == null
      ? part.d
      : rotatePath(part.d, rotation, transform.anchor[0] * canvas, transform.anchor[1] * canvas);
    return {
      ...part,
      d,
      fillRule: part.fillRule ?? 'nonzero',
    };
  });
  return lowerModelComposition({
    built: transformed.map((part) => part.d).join(''),
    parts: transformed,
    composition,
    label: 'motion-trajectory',
  });
}

export function motionEntriesAt(parts, composition, gesture, progress, canvas = 24) {
  if (!Array.isArray(parts) || parts.length === 0) throw new TypeError('motion-trajectory: parts пуст');
  if (!composition || typeof composition.kind !== 'string') throw new TypeError('motion-trajectory: composition не задана');
  const sampled = sampleMotionGesture(gesture, progress);
  const rotations = new Map(sampled.map((track) => [track.partId, track]));
  const known = new Set(parts.map((part) => part.id));
  for (const track of sampled) {
    if (!known.has(track.partId)) throw new Error(`motion-trajectory: track ${track.partId} отсутствует среди parts`);
  }
  return compositionEntries(parts, composition, rotations, canvas);
}

function topologySignature(entries, size, phase, canvas) {
  const raster = rasterizePathEntries(entries, {
    width: canvas,
    height: canvas,
    step: canvas / size,
    phaseX: phase[0],
    phaseY: phase[1],
  });
  const topology = topologyOfMask(raster);
  return `${topology.components.length}:${topology.holes.length}`;
}

function topologySignaturesByPart(entries, size, phase, canvas) {
  return entries.map((entry) => topologySignature([entry], size, phase, canvas));
}

export function proveMotionTrajectory({
  parts,
  composition,
  gesture,
  canvas = 24,
  progressSamples = DEFAULT_MOTION_PROGRESS,
  rasterSizes = DEFAULT_MOTION_RASTER_SIZES,
  phases = DEFAULT_RASTER_PHASES,
} = {}) {
  validateMotionGesture(gesture);
  if (!Number.isFinite(canvas) || canvas <= 0) throw new RangeError('motion-trajectory: canvas обязан быть > 0');
  const findings = [];
  const samples = [];
  const entriesByProgress = new Map(
    [...new Set([0, ...progressSamples])].map((progress) => [
      progress,
      motionEntriesAt(parts, composition, gesture, progress, canvas),
    ]),
  );
  const baselineEntries = entriesByProgress.get(0);
  for (const size of rasterSizes) {
    if (!Number.isInteger(size) || size < 1) throw new RangeError(`motion-trajectory: raster size ${size} невалиден`);
    for (const phase of phases) {
      const baseline = composition.kind === 'layers'
        ? topologySignaturesByPart(baselineEntries, size, phase, canvas)
        : topologySignature(baselineEntries, size, phase, canvas);
      for (const progress of progressSamples) {
        const currentEntries = entriesByProgress.get(progress);
        const signature = composition.kind === 'layers'
          ? topologySignaturesByPart(currentEntries, size, phase, canvas)
          : topologySignature(currentEntries, size, phase, canvas);
        const sample = Object.freeze({ size, phase: Object.freeze([...phase]), progress, signature, baseline });
        samples.push(sample);
        if (JSON.stringify(signature) !== JSON.stringify(baseline)) {
          const scope = composition.kind === 'layers' ? 'part topology' : 'composite topology';
          findings.push(`progress=${progress} size=${size} phase=${phase.join(',')} ${scope} ${JSON.stringify(signature)} != ${JSON.stringify(baseline)}`);
        }
      }
    }
  }
  return Object.freeze({
    ok: findings.length === 0,
    gesture: gesture.id,
    samples: Object.freeze(samples),
    findings: Object.freeze(findings),
  });
}
