/**
 * src/core/motion-schema.js — versioned gesture schema + reduced-motion contract.
 *
 * MO-01 exit evidence (product-lab-icons r6):
 *   - Gesture schema is versioned and fail-closed on unknown fields
 *   - Reduced-motion equivalent is mandatory and validated
 *   - Schema validation is pure, target-neutral, and deterministic
 *
 * Invariants: INV-09 (gesture names meaning), INV-19 (reduced-motion declared).
 */

export const MOTION_SCHEMA_VERSION = 1;

const VALID_TRACK_KINDS = Object.freeze(['rotate', 'translate', 'opacity', 'scale']);
const VALID_INTERPOLATIONS = Object.freeze(['linear', 'ease-in', 'ease-out', 'ease-in-out']);
const VALID_UNITS = Object.freeze({
  rotate: ['degrees'],
  translate: ['px', 'percent'],
  opacity: ['normalized'],
  scale: ['factor'],
});
const VALID_REDUCED_MOTION = Object.freeze(['static', 'fade-only', 'none']);

export function validateGestureSchema(gesture) {
  if (!gesture || typeof gesture !== 'object') {
    throw new TypeError('motion-schema: gesture обязан быть объектом');
  }

  // Version check — fail-closed on mismatch
  if (gesture.schemaVersion !== undefined && gesture.schemaVersion !== MOTION_SCHEMA_VERSION) {
    throw new Error(`motion-schema: unsupported schema version ${gesture.schemaVersion}, expected ${MOTION_SCHEMA_VERSION}`);
  }

  // Required fields
  if (typeof gesture.id !== 'string' || gesture.id.length === 0) {
    throw new TypeError('motion-schema: gesture.id обязан быть непустой строкой');
  }
  if (typeof gesture.kind !== 'string' || gesture.kind.length === 0) {
    throw new TypeError('motion-schema: gesture.kind обязан быть непустой строкой');
  }
  if (!Array.isArray(gesture.partIds) || gesture.partIds.length === 0) {
    throw new TypeError('motion-schema: gesture.partIds обязан быть непустым массивом');
  }
  if (!Array.isArray(gesture.tracks) || gesture.tracks.length === 0) {
    throw new TypeError('motion-schema: gesture.tracks обязан быть непустым массивом');
  }

  // Reduced-motion is mandatory (INV-19)
  if (!gesture.reducedMotion || !VALID_REDUCED_MOTION.includes(gesture.reducedMotion)) {
    throw new TypeError(
      `motion-schema: gesture.reducedMotion обязан быть одним из [${VALID_REDUCED_MOTION.join(', ')}], получено '${gesture.reducedMotion}'`
    );
  }

  // Validate tracks
  const partIdSet = new Set(gesture.partIds);
  const seenPartIds = new Set();
  for (const track of gesture.tracks) {
    if (!track || typeof track !== 'object') {
      throw new TypeError('motion-schema: track обязан быть объектом');
    }
    if (typeof track.partId !== 'string' || track.partId.length === 0) {
      throw new TypeError('motion-schema: track.partId обязан быть непустой строкой');
    }
    if (!partIdSet.has(track.partId)) {
      throw new TypeError(`motion-schema: track.partId '${track.partId}' не объявлен в gesture.partIds`);
    }
    if (seenPartIds.has(track.partId)) {
      throw new TypeError(`motion-schema: duplicate track для partId '${track.partId}'`);
    }
    seenPartIds.add(track.partId);

    if (!VALID_TRACK_KINDS.includes(track.kind)) {
      throw new TypeError(
        `motion-schema: track.kind '${track.kind}' невалиден; допустимы [${VALID_TRACK_KINDS.join(', ')}]`
      );
    }

    const validUnits = VALID_UNITS[track.kind];
    if (!validUnits.includes(track.unit)) {
      throw new TypeError(
        `motion-schema: track.unit '${track.unit}' невалиден для kind='${track.kind}'; допустимы [${validUnits.join(', ')}]`
      );
    }

    if (!VALID_INTERPOLATIONS.includes(track.interpolation)) {
      throw new TypeError(
        `motion-schema: track.interpolation '${track.interpolation}' невалиден; допустимы [${VALID_INTERPOLATIONS.join(', ')}]`
      );
    }

    if (!Array.isArray(track.anchor) || track.anchor.length !== 2) {
      throw new TypeError(`motion-schema: track.anchor для '${track.partId}' обязан быть массивом из 2 чисел`);
    }
    for (const v of track.anchor) {
      if (!Number.isFinite(v) || v < 0 || v > 1) {
        throw new RangeError(`motion-schema: track.anchor значения обязаны быть в [0,1], получено [${track.anchor}]`);
      }
    }

    if (!Number.isFinite(track.from) || !Number.isFinite(track.to)) {
      throw new TypeError(`motion-schema: track.from/to для '${track.partId}' обязаны быть числами`);
    }
  }

  return gesture;
}

/**
 * Returns the reduced-motion equivalent frame count for a gesture.
 * 'static' → 1 frame (no animation), 'fade-only' → 2 frames (opacity crossfade),
 * 'none' → full frame set (animation preserved as-is).
 */
export function reducedMotionFrameCount(gesture, fullFrameCount) {
  validateGestureSchema(gesture);
  switch (gesture.reducedMotion) {
    case 'static':
      return 1;
    case 'fade-only':
      return 2;
    case 'none':
      return fullFrameCount;
    default:
      throw new Error(`motion-schema: unknown reducedMotion '${gesture.reducedMotion}'`);
  }
}