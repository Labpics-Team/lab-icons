import { describe, expect, it } from 'vitest';
import {
  MOTION_SCHEMA_VERSION,
  reducedMotionFrameCount,
  validateGestureSchema,
} from '../src/core/motion-schema.js';
import anatomy from '../semantics/anatomy.json';

const timeGesture = anatomy.glyphs.time.motion.gestures[0];

describe('MO-01 motion schema', () => {
  it('accepts valid time.advance gesture with reducedMotion field', () => {
    const gesture = { ...timeGesture, reducedMotion: 'static' };
    expect(() => validateGestureSchema(gesture)).not.toThrow();
    expect(validateGestureSchema(gesture)).toBe(gesture);
  });

  it('rejects gesture without reducedMotion (INV-19)', () => {
    const gesture = { ...timeGesture };
    delete gesture.reducedMotion;
    expect(() => validateGestureSchema(gesture)).toThrow(/reducedMotion/);
  });

  it('rejects invalid reducedMotion value', () => {
    const gesture = { ...timeGesture, reducedMotion: 'spin' };
    expect(() => validateGestureSchema(gesture)).toThrow(/reducedMotion/);
  });

  it('rejects unsupported schema version (fail-closed)', () => {
    const gesture = { ...timeGesture, reducedMotion: 'static', schemaVersion: 999 };
    expect(() => validateGestureSchema(gesture)).toThrow(/unsupported schema version/);
  });

  it('accepts current schema version explicitly', () => {
    const gesture = { ...timeGesture, reducedMotion: 'static', schemaVersion: MOTION_SCHEMA_VERSION };
    expect(() => validateGestureSchema(gesture)).not.toThrow();
  });

  it('rejects unknown track kind', () => {
    const gesture = {
      ...timeGesture,
      reducedMotion: 'static',
      tracks: [{ ...timeGesture.tracks[0], kind: 'teleport' }],
    };
    expect(() => validateGestureSchema(gesture)).toThrow(/track.kind.*teleport/);
  });

  it('rejects mismatched unit for track kind', () => {
    const gesture = {
      ...timeGesture,
      reducedMotion: 'static',
      tracks: [{ ...timeGesture.tracks[0], unit: 'px' }],
    };
    expect(() => validateGestureSchema(gesture)).toThrow(/track.unit.*px.*rotate/);
  });

  it('rejects duplicate track partId', () => {
    const gesture = {
      ...timeGesture,
      reducedMotion: 'static',
      tracks: [timeGesture.tracks[0], { ...timeGesture.tracks[0] }],
    };
    expect(() => validateGestureSchema(gesture)).toThrow(/duplicate track/);
  });

  it('rejects track partId not in gesture.partIds', () => {
    const gesture = {
      ...timeGesture,
      reducedMotion: 'static',
      tracks: [{ ...timeGesture.tracks[0], partId: 'ghost-part' }],
    };
    expect(() => validateGestureSchema(gesture)).toThrow(/не объявлен в gesture.partIds/);
  });

  it('rejects anchor out of [0,1] range', () => {
    const gesture = {
      ...timeGesture,
      reducedMotion: 'static',
      tracks: [{ ...timeGesture.tracks[0], anchor: [1.5, 0.5] }],
    };
    expect(() => validateGestureSchema(gesture)).toThrow(/anchor.*\[0,1\]/);
  });

  it('computes reduced-motion frame counts correctly', () => {
    const staticGesture = { ...timeGesture, reducedMotion: 'static' };
    const fadeGesture = { ...timeGesture, reducedMotion: 'fade-only' };
    const noneGesture = { ...timeGesture, reducedMotion: 'none' };

    expect(reducedMotionFrameCount(staticGesture, 60)).toBe(1);
    expect(reducedMotionFrameCount(fadeGesture, 60)).toBe(2);
    expect(reducedMotionFrameCount(noneGesture, 60)).toBe(60);
  });

  it('schema version constant is 1', () => {
    expect(MOTION_SCHEMA_VERSION).toBe(1);
  });
});