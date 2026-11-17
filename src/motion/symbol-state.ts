import type { IconSymbol, RenderIconOptions, SymbolGesture, SymbolPart, SymbolTrack, SymbolVariantSemantics } from '../render/index.js';
import { resolveSymbolPose, symbolGeometryTransition, type PreparedSymbolPart } from '../render/pose.js';
import { opticalPathData } from '../render/optical-grid.js';
import type { SymbolMotionRuntime, SymbolPlayback } from './execution.js';
import { sampleSymbolTrack as sample, sampleSymbolTransition, sampleSymbolEffectValue,
  symbolCoverageAlpha, symbolRest as rest, symbolPoseChannels as poseChannels } from './symbol-sampler.js';

export interface IconTransitionOptions {
  readonly duration?: number;
  readonly reducedMotion?: boolean;
}
export interface IconEffectOptions extends IconTransitionOptions {
  /** Explicit endpoints continue; omission replays a gesture or advances elapsed time by one hour. */
  readonly to?: number;
}
export interface MountedIcon {
  readonly element: SVGSVGElement;
  readonly state: string | undefined;
  set(options: RenderIconOptions, transition?: IconTransitionOptions): SymbolPlayback;
  setState(state: string, transition?: IconTransitionOptions): SymbolPlayback;
  setDate(date: Date, timeZone: string, transition?: IconTransitionOptions): SymbolPlayback;
  effect(name: string, options?: IconEffectOptions): SymbolPlayback;
  /** Stops all controls and removes the mounted SVG. Idempotent. */
  dispose(): void;
}
type Paint = { element: SVGPathElement; geometry: PreparedSymbolPart; part: SymbolPart; anchor: readonly [number, number]; offsetX: number; alpha: number; opacity: number; x: number; y: number; rotate: number; draw: number; guide?: SVGPathElement; mask?: SVGMaskElement };
const ns = 'http://www.w3.org/2000/svg';
let nextMask = 0;

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
  const layers = new Map<string, { paint: SVGRectElement; mask: SVGMaskElement; parts: Set<Paint>; alpha: number }>();
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
    // A value already at 0 does not have to emit on subscribe or seek(0).
    // Establish new parts' opacity/transforms before the first clock update.
    write(0);
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
    const layer = paint.part.layer ? layers.get(paint.part.layer)! : undefined;
    const coverage = layer ? symbolCoverageAlpha(paint.alpha, layer.alpha) : paint.alpha;
    paint.element.setAttribute('opacity', String(coverage * paint.opacity));
    paint.element.setAttribute('transform', `translate(${paint.x + paint.offsetX} ${paint.y}) rotate(${paint.rotate} ${paint.anchor.join(' ')})`);
    if (paint.guide) {
      // Exactly empty/full endpoints avoid round-cap residue and clipping at any weight.
      paint.element.setAttribute('mask', paint.draw >= 1 ? '' : `url(#${paint.mask!.id})`);
      paint.guide.setAttribute('stroke-dashoffset', String(1 - paint.draw));
      paint.guide.setAttribute('visibility', paint.draw <= 0 ? 'hidden' : 'visible');
    }
  }
  function addPaint(geometry: PreparedSymbolPart, d: string, fillRule: string): Paint {
    const part = geometry.part;
    const path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); path.setAttribute('fill-rule', fillRule);
    path.setAttribute('data-part', part.id);
    const paint: Paint = { element: path, geometry, part, anchor: part.anchor, offsetX: 0, alpha: 0, opacity: 1, x: 0, y: 0, rotate: 0, draw: 1 };
    if (part.draw) {
      const mask = document.createElementNS(ns, 'mask'); mask.id = `lab-icon-draw-${++nextMask}`;
      mask.setAttribute('maskUnits', 'userSpaceOnUse'); mask.setAttribute('x', '-24'); mask.setAttribute('y', '-24');
      mask.setAttribute('width', '72'); mask.setAttribute('height', '72');
      const guide = document.createElementNS(ns, 'path');
      guide.setAttribute('d', opticalPathData(part.draw.path, part.draw.path.coordinates)); guide.setAttribute('fill', 'none'); guide.setAttribute('stroke', 'white');
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
        const fill = document.createElementNS(ns, 'rect'); fill.setAttribute('x', '-24'); fill.setAttribute('y', '-24');
        fill.setAttribute('width', '72'); fill.setAttribute('height', '72'); fill.setAttribute('mask', `url(#${mask.id})`);
        definitions.append(mask); element.append(fill); layer = { paint: fill, mask, parts: new Set(), alpha: 0 }; layers.set(part.layer, layer);
      }
      path.setAttribute('fill', part.negative ? 'black' : 'white'); layer.mask.append(path); layer.parts.add(paint);
    } else element.append(path);
    return paint;
  }
  function set(next: RenderIconOptions, transition: IconTransitionOptions = {}) {
    alive();
    const duration = timing(transition, 180), resolved = resolveSymbolPose(symbol, next);
    // All dependent motion releases before any next-state DOM mutation.
    for (const channel of [...active.keys()]) stop(channel);
    const generation = ++epoch;
    phases.clear(); stateChannels.clear();
    options = { ...next, ...(next.date !== undefined && { date: new Date(Date.prototype.getTime.call(next.date)) }) };
    semantics = resolved.semantic;
    element.setAttribute('width', String(resolved.size)); element.setAttribute('height', String(resolved.size));
    const desired = new Set<string>(), starts = new Map<Paint, typeof rest & { alpha: number }>();
    const geometryTransitions = new Map<Paint, NonNullable<ReturnType<typeof symbolGeometryTransition>>>();
    for (const prepared of resolved.paints) {
      const { part, path, commands, coordinates, contours, strokeWidth } = prepared;
      const d = opticalPathData({ commands, coordinates }, coordinates, contours);
      const key = part.key; desired.add(key);
      let paint = paints.get(key);
      if (!paint) { paint = addPaint(prepared, d, path.fillRule); paints.set(key, paint); }
      else {
        const geometry = symbolGeometryTransition(paint.geometry, prepared);
        if (geometry) geometryTransitions.set(paint, geometry);
        paint.part = part; paint.geometry = prepared; paint.element.setAttribute('data-part', part.id);
      }
      paint.anchor = prepared.anchor;
      paint.offsetX = prepared.offsetX;
      if (strokeWidth !== undefined) {
        paint.element.setAttribute('fill', 'none');
        paint.element.setAttribute('stroke', part.layer ? part.negative ? 'black' : 'white' : 'currentColor');
        paint.element.setAttribute('stroke-width', String(strokeWidth));
        paint.element.setAttribute('stroke-linecap', 'round'); paint.element.setAttribute('stroke-linejoin', 'round');
      }
      stateChannels.set(paint, new Set(poseChannels));
    }
    for (const paint of paints.values()) starts.set(paint, { alpha: paint.alpha, opacity: paint.opacity,
      x: paint.x, y: paint.y, rotate: paint.rotate, draw: paint.draw });
    const write = (progress: number) => {
      for (const [paint, start] of starts) {
        sampleSymbolTransition(paint, start, desired.has(paint.part.key), progress, stateChannels.get(paint));
      }
      for (const [paint, geometry] of geometryTransitions) {
        const value = geometry.sample(progress); paint.geometry = value;
        paint.element.setAttribute('d', opticalPathData(value, value.coordinates, value.contours));
        paint.anchor = value.anchor; paint.offsetX = value.offsetX;
        if (value.strokeWidth !== undefined) paint.element.setAttribute('stroke-width', String(value.strokeWidth));
      }
      // A shared shell stays opaque while old/new contents fade within its coverage.
      // When every part fades together, the full layer (including holes) fades once.
      for (const layer of layers.values()) {
        layer.alpha = 0;
        for (const paint of layer.parts) layer.alpha = Math.max(layer.alpha, paint.alpha);
        layer.paint.setAttribute('opacity', String(layer.alpha));
      }
      for (const paint of starts.keys()) writePaint(paint);
    };
    const done = () => {
      if (generation !== epoch) return;
      for (const [key, paint] of paints) if (!desired.has(key)) {
        paint.element.remove(); paint.mask?.remove(); paints.delete(key);
        if (paint.part.layer) layers.get(paint.part.layer)!.parts.delete(paint);
      }
      for (const [key, layer] of layers) if (!layer.parts.size) { layer.mask.remove(); layer.paint.remove(); layers.delete(key); }
    };
    return play('state', duration, write, done);
  }
  function effect(name: string, request: IconEffectOptions = {}) {
    alive();
    const gesture: SymbolGesture | undefined = Object.hasOwn(semantics.effects, name) ? semantics.effects[name] : undefined;
    if (!gesture) throw new RangeError(`Symbol ${symbol.id} does not support effect ${name} in this state`);
    const linear = gesture.parameter === 'elapsed-hours';
    // A linear parameter has an unambiguous visible phase, including during a state reset.
    const reference = linear ? gesture.tracks.find(track => track.stops[0]![1] !== track.stops.at(-1)![1]) : undefined;
    const referencePart = reference && semantics.parts.find(part => part.id === reference.partId);
    const referencePaint = referencePart && paints.get(referencePart.key);
    const current = reference && referencePaint
      ? (referencePaint[reference.property] - reference.stops[0]![1]) / (reference.stops.at(-1)![1] - reference.stops[0]![1])
      : phases.get(name);
    const duration = timing(request, gesture.duration), to = request.to ?? (linear ? (current ?? gesture.rest) + 1 : 1);
    if (!Number.isFinite(to) || !linear && (to < 0 || to > 1)) throw new RangeError(linear ? 'Elapsed hours must be finite' : 'Icon effect endpoint must be between 0 and 1');
    const replay = !linear && request.to === undefined && (current === undefined || current === 1);
    const from = replay ? 0 : current ?? gesture.rest;
    const bindings = gesture.tracks.map(track => {
      const part = semantics.parts.find(part => part.id === track.partId);
      const paint = part && paints.get(part.key);
      if (!paint) throw new Error(`Missing semantic paint: ${track.partId}`);
      // An effect takes over only its own channels; the state may still finish fading.
      stateChannels.get(paint)?.delete(track.property);
      const base = sample(track, from, linear);
      if (!Number.isFinite(sample(track, to, linear))) throw new RangeError('Icon effect endpoint exceeds its finite coordinates');
      const turn = !linear && track.property === 'rotate' && Math.abs(track.stops.at(-1)![1] - track.stops[0]![1]) === 360;
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
        paint[track.property] = sampleSymbolEffectValue(track, phase, progress, start, base, linear, turn);
        writePaint(paint);
      }
    });
  }
  set(initial, { duration: 0 }); root.append(element);
  return { element, get state() { return options.state; }, set,
    setState: (state, transition) => set({ ...options, state }, transition), effect,
    setDate: (date, timeZone, transition) => set({ ...options, date, timeZone }, transition),
    dispose() { if (disposed) return; disposed = true; epoch++; for (const channel of [...active.keys()]) stop(channel); element.remove(); paints.clear(); stateChannels.clear(); } };
}
