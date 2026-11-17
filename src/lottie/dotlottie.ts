import { strToU8, zipSync } from 'fflate';
import type { LottieAnimation } from './types.js';

export interface DotLottieOptions {
  /** Archive-local animation ID; defaults to "animation". */
  readonly id?: string;
}

/** Packages the existing animation JSON as dotLottie v2; no geometry or timing changes. */
export function packDotLottie(animation: LottieAnimation, options: DotLottieOptions = {}): Uint8Array {
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(key => key !== 'id')) throw new TypeError('Invalid dotLottie options');
  const id = options.id === undefined ? 'animation' : options.id;
  // The v2 manifest schema permits this filename alphabet; path separators,
  // control characters and Unicode IDs are outside its contract.
  if (typeof id !== 'string' || id.length === 0 || /[^a-zA-Z0-9._ -]/.test(id)) {
    throw new RangeError('dotLottie id must contain only ASCII letters, digits, dot, underscore, space or hyphen');
  }
  if (!animation || typeof animation !== 'object' || Array.isArray(animation)) {
    throw new TypeError('dotLottie requires an existing Lottie animation');
  }
  const json = JSON.stringify(animation);
  if (json === undefined) throw new TypeError('dotLottie animation must serialize as JSON');
  const manifest = JSON.stringify({ version: '2', animations: [{ id }] });
  return zipSync({
    'manifest.json': strToU8(manifest),
    [`a/${id}.json`]: strToU8(json),
  }, {
    level: 9,
    // ZIP stores local calendar fields. An explicit local DOS epoch keeps the
    // header identical across time zones and never consults the current clock.
    mtime: new Date(1980, 0, 1, 0, 0, 0),
  });
}
