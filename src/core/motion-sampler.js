/** Pure, target-neutral sampling of a normalized semantic gesture. */

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
    const validKinds = ['rotate', 'translate', 'opacity', 'scale', 'reveal'];
    if (!validKinds.includes(track.kind)) {
      throw new TypeError(`motion-sampler: неподдержанный track.kind '${track.kind}' для ${track.partId}; допустимы [${validKinds.join(', ')}]`);
    }
    if (track.kind === 'rotate') {
      if (track.unit !== 'degrees' || track.interpolation !== 'linear') {
        throw new TypeError(`motion-sampler: rotate track обязан использовать unit=degrees, interpolation=linear`);
      }
      if (!Array.isArray(track.anchor) || track.anchor.length !== 2 || track.anchor.some((value) => !Number.isFinite(value) || value < 0 || value > 1)) {
        throw new TypeError(`motion-sampler: track ${track.partId} имеет невалидный anchor`);
      }
    }
    if (track.kind === 'opacity' || track.kind === 'reveal') {
      if (track.unit !== 'normalized') {
        throw new TypeError(`motion-sampler: ${track.kind} track обязан использовать unit=normalized`);
      }
      if (track.from < 0 || track.from > 1 || track.to < 0 || track.to > 1) {
        throw new RangeError(`motion-sampler: ${track.kind} track.from/to обязаны быть в [0,1]`);
      }
    }
    if (![track.from, track.to].every(Number.isFinite)) {
      throw new TypeError(`motion-sampler: track ${track.partId} имеет нечисловые границы`);
    }
  }
  return gesture;
}

export function sampleMotionGesture(gesture, progress) {
  validateMotionGesture(gesture);
  const t = finiteProgress(progress);
  return Object.freeze(gesture.tracks.map((track) => {
    const value = track.from + (track.to - track.from) * t;
    const sample = { partId: track.partId, kind: track.kind };
    if (track.kind === 'rotate') {
      sample.anchor = Object.freeze([...track.anchor]);
      sample.rotation = value;
    } else if (track.kind === 'opacity' || track.kind === 'reveal') {
      sample.opacity = value;
    } else if (track.kind === 'translate') {
      sample.translation = value;
    } else if (track.kind === 'scale') {
      sample.scale = value;
    }
    return Object.freeze(sample);
  }));
}

