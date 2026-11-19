import type { IconSymbol, IconVariant, RenderIconOptions, SymbolGesture } from '../render/index.js';
import { resolveSymbolPose, symbolGeometryTransition, type PreparedSymbolPart } from '../render/pose.js';
import { sampleSymbolTrack, sampleSymbolEffectValue, sampleSymbolTransition, symbolCoverageAlpha,
  symbolPoseChannels, symbolRest, type SymbolPaintPose } from '../motion/symbol-sampler.js';
import { numericLottieContours } from './numeric-path.js';
import type { LottieAnimation, LottieCapabilities, LottieExportRequest, LottieExportResult, LottieRefusalCode } from './types.js';

const profile = 'lottie-web-svg-5.13' as const;
const renderKeys = ['variant', 'size', 'weight', 'opsz', 'state', 'date', 'timeZone'] as const;
const requestKeys = new Set<string>([...renderKeys, 'gesture', 'duration', 'from', 'to', 'reducedMotion', 'color', 'frameRate', 'transition']);
const fixed = (k: unknown) => ({ a: 0, k });
const identity = () => ({ o: fixed(100), r: fixed(0), p: fixed([0, 0, 0]), a: fixed([0, 0, 0]), s: fixed([100, 100, 100]) });
const scalarFrame = (t: number, values: readonly number[]) => ({ t, s: [...values],
  i: { x: values.map(() => 1), y: values.map(() => 1) }, o: { x: values.map(() => 0), y: values.map(() => 0) } });
const renderOptions = (request: RenderIconOptions): RenderIconOptions => Object.fromEntries(renderKeys
  .filter(key => request[key] !== undefined).map(key => [key, request[key]]));
class ExportRefusal extends Error { constructor(readonly code: LottieRefusalCode, message: string) { super(message); } }
const fail = (code: LottieRefusalCode, message: string): never => { throw new ExportRefusal(code, message); };
const reason = (error: unknown) => ({ code: error instanceof ExportRefusal ? error.code : 'INVALID_REQUEST' as const,
  message: error instanceof Error ? error.message : String(error) });
function contoursOf(prepared: Pick<PreparedSymbolPart, 'commands' | 'coordinates' | 'contours'>) {
  try { return numericLottieContours(prepared.commands, prepared.coordinates, prepared.contours); }
  catch (error) { return fail('PATH_INVALID', error instanceof Error ? error.message : String(error)); }
}
function validateGesture(gesture: SymbolGesture, parts: readonly PreparedSymbolPart[]) {
  if (!gesture || gesture.parameter !== undefined && gesture.parameter !== 'elapsed-hours' || !Array.isArray(gesture.tracks) ||
      !gesture.tracks.length || !Number.isFinite(gesture.duration) || gesture.duration < 0) fail('MOTION_UNSUPPORTED', 'The gesture needs a supported parameter, tracks and duration');
  for (const track of gesture.tracks) {
    const part = parts.find(item => item.part.id === track.partId);
    if (!part || !symbolPoseChannels.includes(track.property) || !Array.isArray(track.stops) || !track.stops.length ||
        track.stops.some((stop, index) => !Array.isArray(stop) || stop.length !== 2 || !stop.every(Number.isFinite) ||
          stop[0] < 0 || stop[0] > 1 || index > 0 && stop[0] <= track.stops[index - 1]![0] ||
          (track.property === 'opacity' || track.property === 'draw') && (stop[1] < 0 || stop[1] > 1)) ||
        track.property === 'draw' && !part.part.draw) fail('MOTION_UNSUPPORTED', 'A gesture track needs a supported channel, part and ordered finite stops');
  }
}
type Binding = { prepared: PreparedSymbolPart; start: PreparedSymbolPart; initial: SymbolPaintPose; present: boolean };
type Timeline = ReturnType<typeof makeTimeline>;

function makeTimeline(symbol: IconSymbol, request: LottieExportRequest) {
  if (!symbol || symbol.data?.version !== 1) fail('SYMBOL_DATA_REQUIRED', 'Lottie requires a compiled IconSymbol');
  const common = renderOptions(request), transition = request.transition;
  if (transition !== undefined && (!transition || typeof transition !== 'object' || Array.isArray(transition))) throw new TypeError('Invalid transition');
  if (transition && (request.gesture !== undefined || request.from !== undefined || request.to !== undefined)) {
    throw new TypeError('A Lottie request selects a gesture or a state transition');
  }
  if (transition && ([transition.from, transition.to].some(endpoint => !endpoint || typeof endpoint !== 'object' || Array.isArray(endpoint)) || Object.keys(transition).some(key => key !== 'from' && key !== 'to'))) {
    throw new TypeError('A transition requires from and to icon options');
  }
  if (transition && [transition.from, transition.to].some(endpoint => Object.keys(endpoint).some(key => !(renderKeys as readonly string[]).includes(key)))) throw new TypeError('Unknown transition icon options');
  const first = resolveSymbolPose(symbol, transition ? { ...common, ...transition.from } : common);
  const last = transition ? resolveSymbolPose(symbol, { ...common, ...transition.to }) : first;
  const gestureName = request.gesture?.startsWith(`${first.selected.id}.`) ? request.gesture.slice(first.selected.id.length + 1) : request.gesture;
  const gesture: SymbolGesture | undefined = gestureName === undefined || !Object.hasOwn(first.semantic.effects, gestureName) ? undefined : first.semantic.effects[gestureName];
  if (gestureName !== undefined && !gesture) fail('MOTION_UNAVAILABLE', `Symbol ${first.selected.id} has no gesture ${gestureName}`);
  if (gesture) validateGesture(gesture, first.paints);
  const linear = gesture?.parameter === 'elapsed-hours';
  const from = request.from === undefined ? 0 : request.from, to = request.to === undefined ? 1 : request.to;
  if (![from, to].every(Number.isFinite) || !linear && (from < 0 || from > 1 || to < 0 || to > 1)) throw new RangeError('Invalid gesture interval');
  if (!gesture && !transition && ['from', 'to', 'duration', 'reducedMotion'].some(key => Object.hasOwn(request, key))) {
    throw new TypeError('Motion options require a gesture or transition');
  }
  const requestedDuration = request.duration === undefined ? gesture?.duration ?? (transition ? 180 : 0) : request.duration;
  if (!Number.isFinite(requestedDuration) || requestedDuration < 0) throw new RangeError('Lottie duration must be finite and nonnegative');
  const duration = request.reducedMotion || gesture && from === to ? 0 : requestedDuration;
  const target = new Map(last.paints.map(paint => [paint.part.key, paint]));
  const bindings: Binding[] = first.paints.map(prepared => ({ prepared: target.get(prepared.part.key) ?? prepared,
    start: prepared, initial: { alpha: 1, ...symbolRest }, present: target.has(prepared.part.key) }));
  const original = new Set(first.paints.map(paint => paint.part.key));
  if (transition) for (const prepared of last.paints) if (!original.has(prepared.part.key)) {
    bindings.push({ prepared, start: prepared, initial: { alpha: 0, ...symbolRest }, present: true });
  }
  const geometry = bindings.map(binding => {
    try { return symbolGeometryTransition(binding.start, binding.prepared); }
    catch (error) { return fail('TOPOLOGY_UNSUPPORTED', error instanceof Error ? error.message : String(error)); }
  });
  const geometryAt = (index: number, progress: number) => geometry[index]?.sample(duration ? progress : 1) ?? bindings[index]!.prepared;
  const stops = new Set([0, 1]);
  if (transition) stops.add(.5);
  if (gesture && !linear && from !== to) for (const track of gesture.tracks) for (const [phase] of track.stops) {
    const progress = (phase - from) / (to - from); if (progress > 0 && progress < 1) stops.add(progress);
  }
  const cache = new Map<number, SymbolPaintPose[]>();
  const sample = (progress: number) => {
    const p = duration ? progress : 1;
    let poses = cache.get(p);
    if (!poses) {
      poses = bindings.map(binding => {
        const pose = { ...binding.initial };
        if (transition) sampleSymbolTransition(pose, binding.initial, binding.present, p, symbolPoseChannels);
        if (gesture) for (const track of gesture.tracks) if (track.partId === binding.prepared.part.id) {
          const base = sampleSymbolTrack(track, from, linear);
          pose[track.property] = sampleSymbolEffectValue(track, from + (to - from) * p, p, base, base, !!linear, false);
          if (!Number.isFinite(pose[track.property])) throw new RangeError('Gesture exceeds finite coordinates');
        }
        return pose;
      });
      cache.set(p, poses);
    }
    return poses;
  };
  return { first, last, bindings, geometry, geometryAt, sample, stops: [...stops].sort((a, b) => a - b), duration, from, to, gestureName, gesture };
}

/** Linear tracks stay exact; normalized crossfade coverage is adaptively baked. */
function property(timeline: Timeline, terminalFrame: number, sample: (progress: number) => readonly number[]) {
  if (!terminalFrame) { const value = sample(1); return fixed(value.length === 1 ? value[0] : [...value]); }
  const values = new Map<number, readonly number[]>();
  const at = (t: number) => { let value = values.get(t); if (!value) { value = sample(t); values.set(t, value); } return value; };
  const refine = (left: number, right: number, depth: number) => {
    const a = at(left), b = at(right), middle = (left + right) / 2, m = sample(middle);
    if (depth < 12 && m.some((value, index) => Math.abs(value - (a[index]! + b[index]!) / 2) > .0001)) {
      values.set(middle, m); refine(left, middle, depth + 1); refine(middle, right, depth + 1);
    }
  };
  for (let index = 1; index < timeline.stops.length; index++) refine(timeline.stops[index - 1]!, timeline.stops[index]!, 0);
  const entries = [...values].sort(([a], [b]) => a - b), initial = entries[0]![1];
  if (entries.every(([, value]) => value.every((component, index) => component === initial[index]))) {
    return fixed(initial.length === 1 ? initial[0] : [...initial]);
  }
  return { a: 1, k: entries.map(([progress, value]) => scalarFrame(progress * terminalFrame, value)) };
}

function canvasBounds(timeline: Timeline) {
  let minX = 0, minY = 0, maxX = 24, maxY = 24;
  for (const [bindingIndex, binding] of timeline.bindings.entries()) for (const prepared of [binding.start, binding.prepared]) {
    const { coordinates, anchor, offsetX, strokeWidth, part } = prepared;
    const tracks = timeline.gesture?.tracks.filter(track => track.partId === part.id) ?? [];
    const rotate = tracks.some(track => track.property === 'rotate');
    const poseValues = timeline.stops.map(progress => timeline.sample(progress)[bindingIndex]!);
    const xs = poseValues.map(pose => pose.x), ys = poseValues.map(pose => pose.y);
    const width = (strokeWidth ?? 0) / 2;
    for (let index = 0; index < coordinates.length; index += 2) {
      const x = coordinates[index]!, y = coordinates[index + 1]!;
      const radius = rotate ? Math.hypot(x - anchor[0], y - anchor[1]) + width : width;
      minX = Math.min(minX, (rotate ? anchor[0] : x) - radius + offsetX + Math.min(...xs));
      maxX = Math.max(maxX, (rotate ? anchor[0] : x) + radius + offsetX + Math.max(...xs));
      minY = Math.min(minY, (rotate ? anchor[1] : y) - radius + Math.min(...ys));
      maxY = Math.max(maxY, (rotate ? anchor[1] : y) + radius + Math.max(...ys));
    }
  }
  const origin = [Math.floor(minX), Math.floor(minY)];
  const width = Math.ceil(maxX) - origin[0]!, height = Math.ceil(maxY) - origin[1]!;
  if (![width, height, ...origin].every(Number.isSafeInteger) || width <= 0 || height <= 0) fail('CANVAS_UNSUPPORTED', 'Lottie canvas is not representable');
  return { width, height, offset: [-origin[0]!, -origin[1]!] };
}

/** Exports the same numeric symbol and semantic pose used by mounted SVG motion. */
export function exportSymbolLottie(symbol: IconSymbol, request: LottieExportRequest = {}): LottieExportResult {
  try {
    if (request && typeof request === 'object' && Object.hasOwn(request, 'variation')) fail('VARIATION_UNSUPPORTED', 'Use the symbol weight and opsz axes; legacy variation operands are not exported');
    if (!request || typeof request !== 'object' || Array.isArray(request) || Object.keys(request).some(key => !requestKeys.has(key))) throw new TypeError('Unknown Lottie request options');
    if (request.reducedMotion !== undefined && typeof request.reducedMotion !== 'boolean') throw new TypeError('reducedMotion must be boolean');
    if (request.gesture !== undefined && typeof request.gesture !== 'string') throw new TypeError('gesture must be a string');
    const color = request.color === undefined ? '#000000' : request.color, rate = request.frameRate === undefined ? 60 : request.frameRate;
    if (typeof color !== 'string' || !/^#[\da-f]{6}([\da-f]{2})?$/i.test(color) || !Number.isSafeInteger(rate) || rate <= 0) throw new TypeError('Lottie needs an RGB/RGBA hex color and positive integer frame rate');
    const timeline = makeTimeline(symbol, request), terminalFrame = timeline.duration * rate / 1000, op = Math.ceil(terminalFrame) + 1;
    if (!Number.isFinite(op) || op >= Number.MAX_SAFE_INTEGER) throw new RangeError('Lottie duration exceeds its frame range');
    const { width, height, offset } = canvasBounds(timeline);
    const rgb = [1, 3, 5].map(index => Number.parseInt(color.slice(index, index + 2), 16) / 255);
    const colorAlpha = color.length === 9 ? Number.parseInt(color.slice(7, 9), 16) / 255 : 1;
    const scopes = new Map<string, number[]>();
    timeline.bindings.forEach(({ prepared }, index) => {
      const key = prepared.part.layer ? `layer:${prepared.part.layer}` : `part:${prepared.part.key}`;
      if (!scopes.has(key)) scopes.set(key, []); scopes.get(key)!.push(index);
    });
    const assets: { id: string; w: number; h: number; layers: Record<string, unknown>[] }[] = [];
    const layers: Record<string, unknown>[] = [];
    let layerId = 0;
    const layer = (name: string, extra: Record<string, unknown> = {}) => ({ ddd: 0, ind: ++layerId, ty: 4, nm: name, sr: 1, ip: 0, op, st: 0, bm: 0, ks: identity(), ...extra });
    const prop = (sample: (progress: number) => readonly number[]) => property(timeline, terminalFrame, sample);
    for (const indices of scopes.values()) {
      const isolated = timeline.bindings[indices[0]!]!.prepared.part.layer !== undefined;
      const groupAlpha = (p: number) => Math.max(...indices.map(index => timeline.sample(p)[index]!.alpha));
      const scopeLayers: Record<string, unknown>[] = [];
      for (const index of indices) {
        const prepared = timeline.bindings[index]!.prepared, { part } = prepared;
        if (part.negative && !isolated) fail('COMPOSITION_UNSUPPORTED', 'Subtraction requires an explicit coverage layer');
        if (!['evenodd', 'nonzero'].includes(prepared.path.fillRule) || prepared.strokeWidth !== undefined && (!Number.isFinite(prepared.strokeWidth) || prepared.strokeWidth <= 0)) fail('PAINT_UNSUPPORTED', 'Lottie needs an explicit fill rule or positive rounded stroke');
        const geometry = (p: number) => timeline.geometryAt(index, p);
        const pose = (p: number) => timeline.sample(p)[index]!;
        const ink = isolated ? part.negative ? [0, 0, 0] : [1, 1, 1] : rgb;
        const ks = { ...identity(), a: prop(p => [...geometry(p).anchor, 0]),
          p: prop(p => { const { anchor, offsetX } = geometry(p); return [anchor[0] + offset[0]! + offsetX + pose(p).x, anchor[1] + offset[1]! + pose(p).y, 0]; }),
          r: prop(p => [pose(p).rotate]),
          o: prop(p => [(isolated ? symbolCoverageAlpha(pose(p).alpha, groupAlpha(p)) : pose(p).alpha) * pose(p).opacity * 100]) };
        const contours = contoursOf(prepared);
        const start = timeline.bindings[index]!.start;
        const startContours = timeline.geometry[index] && terminalFrame ? contoursOf(start) : contours;
        if (contours.length !== startContours.length || contours.some((contour, i) => contour.v.length !== startContours[i]!.v.length)) fail('TOPOLOGY_UNSUPPORTED', 'Lottie transition requires corresponding contour vertices');
        if (prepared.strokeWidth === undefined && contours.some(contour => !contour.c)) fail('OPEN_CONTOUR_UNSUPPORTED', 'An open path requires an explicit stroke');
        const paintOpacity = isolated ? 100 : colorAlpha * 100;
        const paint = prepared.strokeWidth === undefined ? { ty: 'fl', c: fixed(ink), o: fixed(paintOpacity), r: prepared.path.fillRule === 'evenodd' ? 2 : 1 }
          : { ty: 'st', c: fixed(ink), o: fixed(paintOpacity), w: prop(p => [geometry(p).strokeWidth!]), lc: 2, lj: 2 };
        const shape = layer(part.id, { ks, shapes: [...contours.map((contour, i) => ({ ty: 'sh', nm: part.id,
          ks: startContours === contours ? fixed(contour) : { a: 1, k: [
            { t: 0, s: [startContours[i]], e: [structuredClone(contour)], i: { x: 1, y: 1 }, o: { x: 0, y: 0 } }, { t: terminalFrame, s: [contour] }] } })), paint] });
        const drawn = part.draw && timeline.stops.some(p => pose(p).draw < 1);
        if (drawn) {
          const guide = part.draw!, guideContours = contoursOf({ ...guide.path, coordinates: Float64Array.from(guide.path.coordinates), contours: undefined });
          if (!Number.isFinite(guide.width) || guide.width <= 0) fail('PAINT_UNSUPPORTED', 'A draw guide needs a finite positive width');
          const mask = layer(`${part.id}.guide`, { td: 1, ks: { ...ks, o: prop(p => [pose(p).draw <= 0 ? 0 : 100]) }, shapes: [
            ...guideContours.map(contour => ({ ty: 'sh', ks: fixed(contour) })),
            { ty: 'st', c: fixed([1, 1, 1]), o: fixed(100), w: fixed(guide.width), lc: 2, lj: 2 },
            { ty: 'tm', s: fixed(0), e: prop(p => [pose(p).draw * 100]), o: fixed(0), m: 1 }] });
          scopeLayers.push(mask, { ...shape, tt: 1 });
        } else scopeLayers.push(shape);
      }
      // SVG paints later parts on top. Keep each matte immediately above its target.
      const ordered = scopeLayers.reduce<Record<string, unknown>[][]>((groups, item) => {
        if (item.tt === 1) groups[groups.length - 1]!.push(item); else groups.push([item]); return groups;
      }, []).reverse().flat();
      if (isolated) {
        const id = `coverage-${assets.length}`;
        assets.push({ id, w: width, h: height, layers: ordered });
        const matte = layer(id, { ty: 0, td: 1, refId: id, w: width, h: height });
        const tint = layer(`${id}.ink`, { tt: 3, shapes: [
          { ty: 'rc', p: fixed([width / 2, height / 2]), s: fixed([width, height]), r: fixed(0) }, { ty: 'fl', c: fixed(rgb), o: fixed(colorAlpha * 100), r: 1 }] });
        // SVG applies group alpha after its coverage mask. Applying it inside
        // the matte changes 8-bit compositing (e.g. alpha 70 becomes 71 at .75).
        const painted = `${id}.painted`;
        assets.push({ id: painted, w: width, h: height, layers: [matte, tint] });
        layers.unshift(layer(painted, { ty: 0, refId: painted, w: width, h: height,
          ks: { ...identity(), o: prop(p => [groupAlpha(p) * 100]) } }));
      } else layers.unshift(...ordered);
    }
    const animation: LottieAnimation = { v: '5.13.0', fr: rate, ip: 0, op, w: width, h: height,
      nm: `${timeline.last.selected.id}/${timeline.last.variant}`, ddd: 0, assets, layers,
      meta: { labIcons: { profile, icon: timeline.last.selected.id, variant: timeline.last.variant, logicalViewBox: [0, 0, 24, 24], offset,
        durationMs: timeline.duration, terminalFrame, terminalHoldFrames: op - terminalFrame, gesture: timeline.gestureName ?? null,
        from: timeline.gesture ? timeline.from : 0, to: timeline.gesture ? timeline.to : 0 } } };
    return { ok: true, animation };
  } catch (error) {
    return { ok: false, reason: reason(error) };
  }
}

export function symbolLottieCapabilities(symbol: IconSymbol, options: IconVariant | RenderIconOptions = 'outline'): LottieCapabilities {
  try {
    const result = exportSymbolLottie(symbol, typeof options === 'string' ? { variant: options } : options);
    if (!result.ok) return { profile, static: false, gestures: [], reason: result.reason };
    const pose = resolveSymbolPose(symbol, typeof options === 'string' ? { variant: options } : options);
    return { profile, static: true, gestures: Object.entries(pose.semantic.effects).filter(([, gesture]) => {
      try { validateGesture(gesture, pose.paints); return true; } catch { return false; }
    }).map(([name]) => name) };
  } catch (error) {
    return { profile, static: false, gestures: [], reason: reason(error) };
  }
}
