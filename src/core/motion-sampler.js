/** Чистая выборка нормализованного жеста, независимая от renderer. */

function finiteProgress(progress) {
  if (!Number.isFinite(progress) || progress < 0 || progress > 1) {
    throw new RangeError(`motion-sampler: progress обязан быть в [0,1], получено ${progress}`);
  }
  return progress;
}

export function validateMotionGesture(gesture) {
  if (!gesture || typeof gesture !== 'object') {
    throw new TypeError('motion-sampler: gesture обязан быть объектом');
  }
  if (typeof gesture.id !== 'string' || gesture.id.length === 0) {
    throw new TypeError('motion-sampler: gesture.id обязан быть непустой строкой');
  }
  if (gesture.progress !== 'normalized-0-to-1') {
    throw new TypeError('motion-sampler: gesture обязан использовать normalized-0-to-1');
  }
  if (gesture.restProgress !== undefined) finiteProgress(gesture.restProgress);
  if (!Array.isArray(gesture.partIds) || gesture.partIds.length === 0) {
    throw new TypeError('motion-sampler: gesture.partIds обязан быть непустым массивом');
  }
  if (!Array.isArray(gesture.tracks) || gesture.tracks.length === 0) {
    throw new TypeError('motion-sampler: gesture.tracks обязан быть непустым массивом');
  }
  const partIds = new Set(gesture.partIds);
  const trackIds = new Set();
  for (const track of gesture.tracks) {
    if (!track || typeof track !== 'object') throw new TypeError('motion-sampler: track обязан быть объектом');
    if (typeof track.partId !== 'string' || track.partId.length === 0) {
      throw new TypeError('motion-sampler: track.partId обязан быть непустой строкой');
    }
    if (trackIds.has(track.partId)) throw new TypeError(`motion-sampler: часть ${track.partId} имеет два track`);
    trackIds.add(track.partId);
    if (!partIds.has(track.partId)) {
      throw new TypeError(`motion-sampler: track ${track.partId} не объявлен в gesture.partIds`);
    }
    if (track.kind === 'rotate') {
      if (track.unit !== 'degrees' || track.interpolation !== 'linear') {
        throw new TypeError(`motion-sampler: неподдержанный track для ${track.partId}`);
      }
      if (!Array.isArray(track.anchor) || track.anchor.length !== 2 || track.anchor.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
        throw new TypeError(`motion-sampler: track ${track.partId} имеет невалидный anchor`);
      }
      if (![track.from, track.to].every(Number.isFinite)) {
        throw new TypeError(`motion-sampler: track ${track.partId} имеет нечисловые границы`);
      }
    } else if (track.kind === 'opacity' || track.kind === 'translate') {
      const translation = track.kind === 'translate';
      const keys = ['partId', 'kind', 'unit', 'interpolation', 'stops', ...(translation ? ['axis'] : [])];
      if (track.unit !== (translation ? 'viewBox' : 'fraction') || track.interpolation !== 'linear' ||
          (translation && !['x', 'y'].includes(track.axis)) ||
          Object.keys(track).some(key => !keys.includes(key)) ||
          !Array.isArray(track.stops) || track.stops.length < 2 ||
          track.stops[0]?.at !== 0 || track.stops.at(-1)?.at !== 1) {
        throw new TypeError(`motion-sampler: невалидная ${track.kind}-шкала для ${track.partId}`);
      }
      let previous = -1;
      for (const stop of track.stops) {
        if (!stop || typeof stop !== 'object' || Object.keys(stop).sort().join(',') !== 'at,value' ||
            !Number.isFinite(stop.at) || stop.at < 0 || stop.at > 1 || stop.at <= previous ||
            !Number.isFinite(stop.value) || (!translation && (stop.value < 0 || stop.value > 1))) {
          throw new TypeError(`motion-sampler: невалидный ${track.kind} stop для ${track.partId}`);
        }
        previous = stop.at;
      }
    } else {
      throw new TypeError(`motion-sampler: неподдержанный track для ${track.partId}`);
    }
  }
  return gesture;
}

export function sampleOpacityTrack(track, progress) {
  const t = finiteProgress(progress);
  const nextIndex = track.stops.findIndex(stop => stop.at >= t);
  if (nextIndex === 0) return track.stops[0].value;
  const next = track.stops[nextIndex], previous = track.stops[nextIndex - 1];
  return previous.value + (next.value - previous.value) * ((t - previous.at) / (next.at - previous.at));
}

export function sampleTranslationTrack(track, progress) {
  const t = finiteProgress(progress);
  const nextIndex = track.stops.findIndex(stop => stop.at >= t);
  if (nextIndex === 0) return track.stops[0].value;
  const next = track.stops[nextIndex], previous = track.stops[nextIndex - 1];
  const fraction = (t - previous.at) / (next.at - previous.at);
  // Convex combination не вычитает противоположные большие координаты.
  return previous.value * (1 - fraction) + next.value * fraction;
}

export function sampleMotionGesture(gesture, progress) {
  validateMotionGesture(gesture);
  const t = finiteProgress(progress);
  return Object.freeze(gesture.tracks.map((track) => Object.freeze(track.kind === 'opacity' ? {
    partId: track.partId,
    kind: track.kind,
    opacity: sampleOpacityTrack(track, t),
  } : track.kind === 'translate' ? {
    partId: track.partId, kind: track.kind, axis: track.axis, unit: track.unit,
    translation: sampleTranslationTrack(track, t),
  } : {
    partId: track.partId,
    kind: track.kind,
    anchor: Object.freeze([...track.anchor]),
    rotation: track.from + (track.to - track.from) * t,
  })));
}

