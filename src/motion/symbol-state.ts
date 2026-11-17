import type { IconSymbol, RenderIconOptions, SymbolGesture, SymbolPart, SymbolTrack, SymbolVariantSemantics } from '../render/index.js';
import { resolveIconRequest } from '../render/request.js';
import { opticalPathData, sampleOpticalPath } from '../render/optical-grid.js';
import type { SymbolMotionRuntime, SymbolPlayback } from './execution.js';

export interface IconTransitionOptions {
  readonly duration?: number;
  readonly reducedMotion?: boolean;
}
export interface IconEffectOptions extends IconTransitionOptions {
  /** Explicit endpoints continue from current phase (initially rest); omission plays/replays the gesture. */
  readonly to?: number;
}
export interface MountedIcon {
  readonly element: SVGSVGElement;
  readonly state: string | undefined;
  set(options: RenderIconOptions, transition?: IconTransitionOptions): SymbolPlayback;
  setState(state: string, transition?: IconTransitionOptions): SymbolPlayback;
  effect(name: string, options?: IconEffectOptions): SymbolPlayback;
  /** Stops all controls and removes the mounted SVG. Idempotent. */
  dispose(): void;
}
type Paint = { element: SVGPathElement; part: SymbolPart; alpha: number; opacity: number; x: number; y: number; rotate: number; draw: number; guide?: SVGPathElement; mask?: SVGMaskElement };
const ns = 'http://www.w3.org/2000/svg';
const rest = { opacity: 1, x: 0, y: 0, rotate: 0, draw: 1 };
const poseChannels = Object.keys(rest) as (keyof typeof rest)[];
let nextMask = 0;

function sample(track: SymbolTrack, progress: number): number {
  const stops = track.stops;
  if (progress <= stops[0]![0]) return stops[0]![1];
  for (let index = 1; index < stops.length; index++) {
    const left = stops[index - 1]!, right = stops[index]!;
    if (progress <= right[0]) return left[1] + (right[1] - left[1]) * (progress - left[0]) / (right[0] - left[0]);
  }
  return stops[stops.length - 1]![1];
}

/** No SVG parser, geometry inference, clock or subscriptions on a static mount. */
export function mountSymbol(runtime: SymbolMotionRuntime, root: Element, symbol: IconSymbol,
  initial: RenderIconOptions = {}): MountedIcon {
  const document = root.ownerDocument;
  const element = document.createElementNS(ns, 'svg');
  element.setAttribute('xmlns', ns); element.setAttribute('viewBox', '0 0 24 24');
  element.setAttribute('fill', 'currentColor'); element.setAttribute('aria-hidden', 'true');
  element.style.overflow = 'visible';
  const definitions = document.createElementNS(ns, 'defs'); element.append(definitions);
  const paints = new Map<string, Paint>();
  const layers = new Map<string, { positive: SVGGElement; negative: SVGMaskElement }>();
  const active = new Map<string, { playback: SymbolPlayback; release: () => void }>();
  const phases = new Map<string, number>();
  const stateChannels = new Map<Paint, Set<keyof typeof rest>>();
  let options = initial, disposed = false, epoch = 0;
  let semantics: SymbolVariantSemantics;

  function alive() { if (disposed) throw new Error('Icon is disposed'); }
  function timing(request: IconTransitionOptions, fallback: number) {
    const duration = request.duration ?? fallback;
    if (!Number.isFinite(duration) || duration < 0) throw new RangeError('Icon duration must be finite and nonnegative');
    return request.reducedMotion || root.ownerDocument.defaultView?.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration;
  }
  function stop(channel: string) { active.get(channel)?.release(); }
  function play(channel: string, duration: number, write: (progress: number) => void, done = () => {}) {
    stop(channel);
    if (duration === 0) {
      write(1); done();
      return { state: 'finished' as const, duration: 0, finished: Promise.resolve({ status: 'finished' as const }),
        pause() {}, play() {}, seek() {}, finish() {}, stop() {} };
    }
    const clock = runtime.value(0);
    let released = false;
    let unsubscribe = () => {};
    const release = () => {
      if (released) return;
      released = true; unsubscribe(); clock.dispose();
      if (active.get(channel)?.release === release) active.delete(channel);
    };
    unsubscribe = clock.subscribe(progress => { if (!released && !disposed) write(progress); });
    let playback: SymbolPlayback;
    try { playback = clock.animate(1, { duration, ease: 'linear', reducedMotion: 'user' }); }
    catch (error) { release(); throw error; }
    active.set(channel, { playback, release });
    const finished = playback.finished.then(result => {
      if (!released && !disposed && result.status === 'finished') { write(1); done(); }
      return result;
    }).finally(release);
    // A disposed controller owns the completion even when the caller ignores it.
    void finished.catch(() => {});
    return { get state() { return playback.state; }, duration, finished,
      pause: () => playback.pause(), play: () => playback.play(), seek: (time: number) => playback.seek(time),
      finish: () => playback.finish(), stop: release };
  }
  function writePaint(paint: Paint) {
    paint.element.setAttribute('opacity', String((paint.part.negative ? 1 : paint.alpha) * paint.opacity));
    paint.element.setAttribute('transform', `translate(${paint.x} ${paint.y}) rotate(${paint.rotate} ${paint.part.anchor.join(' ')})`);
    if (paint.guide) {
      // Exactly empty/full endpoints avoid round-cap residue and clipping at any weight.
      paint.element.setAttribute('mask', paint.draw >= 1 ? '' : `url(#${paint.mask!.id})`);
      paint.guide.setAttribute('stroke-dashoffset', String(1 - paint.draw));
      paint.guide.setAttribute('visibility', paint.draw <= 0 ? 'hidden' : 'visible');
    }
  }
  function addPaint(part: SymbolPart, d: string, fillRule: string): Paint {
    const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); path.setAttribute('fill-rule', fillRule);
    path.setAttribute('data-part', part.id);
    const paint: Paint = { element: path, part, alpha: 0, opacity: 1, x: 0, y: 0, rotate: 0, draw: 1 };
    if (part.draw) {
      const mask = document.createElementNS(ns, 'mask'); mask.id = `lab-icon-draw-${++nextMask}`;
      mask.setAttribute('maskUnits', 'userSpaceOnUse'); mask.setAttribute('x', '-24'); mask.setAttribute('y', '-24');
      mask.setAttribute('width', '72'); mask.setAttribute('height', '72');
      const guide = document.createElementNS(ns, 'path');
      guide.setAttribute('d', part.draw.path); guide.setAttribute('fill', 'none'); guide.setAttribute('stroke', 'white');
      guide.setAttribute('stroke-width', String(part.draw.width)); guide.setAttribute('stroke-linecap', 'round');
      guide.setAttribute('stroke-linejoin', 'round'); guide.setAttribute('pathLength', '1'); guide.setAttribute('stroke-dasharray', '1 1');
      mask.append(guide); definitions.append(mask); paint.guide = guide; paint.mask = mask;
    }
    if (part.layer) {
      let layer = layers.get(part.layer);
      if (!layer) {
        const mask = document.createElementNS(ns, 'mask'); mask.id = `lab-icon-subtract-${++nextMask}`;
        mask.setAttribute('maskUnits', 'userSpaceOnUse'); mask.setAttribute('x', '-24'); mask.setAttribute('y', '-24');
        mask.setAttribute('width', '72'); mask.setAttribute('height', '72');
        const white = document.createElementNS(ns, 'rect'); white.setAttribute('x', '-24'); white.setAttribute('y', '-24');
        white.setAttribute('width', '72'); white.setAttribute('height', '72'); white.setAttribute('fill', 'white'); mask.append(white);
        const group = document.createElementNS(ns, 'g'); group.setAttribute('mask', `url(#${mask.id})`);
        definitions.append(mask); element.append(group); layer = { positive: group, negative: mask }; layers.set(part.layer, layer);
      }
      if (part.negative) { path.setAttribute('fill', 'black'); layer.negative.append(path); } else layer.positive.append(path);
    } else element.append(path);
    return paint;
  }
  function resolve(next: RenderIconOptions) {
    const { data, variant, size, position: at, selected } = resolveIconRequest(symbol, next);
    const declaration = selected.semantics;
    const semantic = declaration?.variants[variant] ?? { effects: {}, parts: data.variants[variant].paths.map((_, index) =>
      ({ id: `paint-${index}`, pathIndex: index, key: `${symbol.id}/${variant}/${index}`, anchor: [12, 12] as const })) };
    return { data, variant, size, at, semantic };
  }
  function set(next: RenderIconOptions, transition: IconTransitionOptions = {}) {
    alive();
    const duration = timing(transition, 180), resolved = resolve(next);
    // All dependent motion releases before any next-state DOM mutation.
    for (const channel of [...active.keys()]) stop(channel);
    const generation = ++epoch;
    phases.clear(); stateChannels.clear(); options = { ...next }; semantics = resolved.semantic;
    element.setAttribute('width', String(resolved.size)); element.setAttribute('height', String(resolved.size));
    const desired = new Set<string>(), starts = new Map<Paint, typeof rest & { alpha: number }>();
    const coordinates = new Map<number, Float64Array>();
    for (const part of semantics.parts) {
      const path = resolved.data.variants[resolved.variant].paths[part.pathIndex]!;
      let sampled = coordinates.get(part.pathIndex);
      if (!sampled) { sampled = sampleOpticalPath(path, resolved.at); coordinates.set(part.pathIndex, sampled); }
      const d = opticalPathData(path, sampled, part.contourIndices);
      const key = part.key; desired.add(key);
      let paint = paints.get(key);
      if (!paint) { paint = addPaint(part, d, path.fillRule); paints.set(key, paint); }
      else { paint.part = part; paint.element.setAttribute('d', d); paint.element.setAttribute('data-part', part.id); }
      stateChannels.set(paint, new Set(poseChannels));
    }
    for (const paint of paints.values()) starts.set(paint, { alpha: paint.alpha, opacity: paint.opacity,
      x: paint.x, y: paint.y, rotate: paint.rotate, draw: paint.draw });
    const write = (progress: number) => {
      for (const [paint, start] of starts) {
        paint.alpha = start.alpha + ((desired.has(paint.part.key) ? 1 : 0) - start.alpha) * progress;
        const channels = stateChannels.get(paint);
        if (channels) for (const channel of channels) paint[channel] = start[channel] + (rest[channel] - start[channel]) * progress;
        writePaint(paint);
      }
    };
    const done = () => {
      if (generation !== epoch) return;
      for (const [key, paint] of paints) if (!desired.has(key)) { paint.element.remove(); paint.mask?.remove(); paints.delete(key); }
    };
    return play('state', duration, write, done);
  }
  function effect(name: string, request: IconEffectOptions = {}) {
    alive();
    const gesture: SymbolGesture | undefined = Object.hasOwn(semantics.effects, name) ? semantics.effects[name] : undefined;
    if (!gesture) throw new RangeError(`Symbol ${symbol.id} does not support effect ${name} in this state`);
    const duration = timing(request, gesture.duration), to = request.to ?? 1;
    if (!Number.isFinite(to) || to < 0 || to > 1) throw new RangeError('Icon effect endpoint must be between 0 and 1');
    const current = phases.get(name);
    const replay = request.to === undefined && (current === undefined || current === 1);
    const from = replay ? 0 : current ?? gesture.rest;
    const bindings = gesture.tracks.map(track => {
      const part = semantics.parts.find(part => part.id === track.partId);
      const paint = part && paints.get(part.key);
      if (!paint) throw new Error(`Missing semantic paint: ${track.partId}`);
      // An effect takes over only its own channels; the state may still finish fading.
      stateChannels.get(paint)?.delete(track.property);
      const base = sample(track, from);
      const turn = track.property === 'rotate' && Math.abs(track.stops.at(-1)![1] - track.stops[0]![1]) === 360;
      return { track, paint, start: replay && !turn ? base : paint[track.property], base, turn };
    });
    stop('effect');
    if (replay) {
      for (const { paint, track, start } of bindings) { paint[track.property] = start; writePaint(paint); }
    }
    phases.set(name, from);
    return play('effect', duration, progress => {
      const phase = from + (to - from) * progress;
      phases.set(name, phase);
      for (const { track, paint, start, base, turn } of bindings) {
        // Correct from the last written visible value; the correction vanishes at the endpoint.
        // A full turn retains its accumulated angle while keeping the same normalized phase.
        paint[track.property] = sample(track, phase) + (start - base) * (turn ? 1 : 1 - progress);
        writePaint(paint);
      }
    });
  }
  set(initial, { duration: 0 }); root.append(element);
  return { element, get state() { return options.state; }, set,
    setState: (state, transition) => set({ ...options, state }, transition), effect,
    dispose() { if (disposed) return; disposed = true; epoch++; for (const channel of [...active.keys()]) stop(channel); element.remove(); paints.clear(); stateChannels.clear(); } };
}
