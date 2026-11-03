import { animate, sequence, value } from '@labpics/motion';

/** Публичный scalar clock исполняет подготовленную геометрию; последняя запись — начало successor. */
export function executePreparedWidth(roots, prepared, request, { onProgress } = {}) {
  if (!prepared || prepared.version !== 1 || prepared.law !== 'capsule.width' || typeof prepared.sample !== 'function' ||
      prepared.renderTarget?.attribute !== 'd' || !Number.isFinite(request?.duration) || request.duration < 0 ||
      typeof request.reducedMotion !== 'boolean') throw new Error('Нужны подготовленная ширина и конечный запрос исполнения.');
  const poseAt = width => {
    const pose = prepared.sample(width);
    if (!pose.ok) throw new Error(`${pose.reason.code}: ${pose.reason.message}`);
    if (pose.bodyWidth !== width || typeof pose.d !== 'string' || !pose.d.length) throw new Error('Sampler не подготовил объявленную ширину.');
    return pose;
  };
  const initial = poseAt(request.from), endpoint = poseAt(request.to);
  const viewports = (Array.isArray(roots) ? roots : [roots]).flatMap(root =>
    root instanceof SVGElement ? [root] : [...root.querySelectorAll('svg')]);
  if (!viewports.length || new Set(viewports).size !== viewports.length) throw new Error('Ширина требует независимые SVG viewport.');
  const bindings = viewports.map(svg => {
    const targets = svg.querySelectorAll(prepared.renderTarget.selector);
    if (targets.length !== 1 || targets[0].tagName?.toLowerCase() !== 'path' || targets[0].getAttribute('d') !== initial.d) {
      throw new Error('RENDER_CORRESPONDENCE_MISMATCH: видимая ширина не соответствует preparation.');
    }
    return targets[0];
  });
  const clock = value(request.from);
  let playback, disposed = false, lastD = initial.d, failure;
  let unsubscribe = () => {};
  const release = () => {
    if (disposed) return;
    disposed = true; unsubscribe(); clock.dispose();
  };
  const write = pose => {
    if (disposed) return;
    if (bindings.some(element => element.getAttribute('d') !== lastD)) {
      throw new Error('RENDER_CORRESPONDENCE_MISMATCH: другой writer изменил подготовленную форму.');
    }
    if (pose.d !== lastD) for (const element of bindings) element.setAttribute('d', pose.d);
    lastD = pose.d;
    onProgress?.(pose.bodyWidth);
  };
  unsubscribe = clock.subscribe(width => {
    if (disposed) return;
    try { write(poseAt(width)); }
    catch (error) { failure = error; playback?.stop(); release(); }
  });
  try {
    write(initial);
    if (request.reducedMotion || request.duration === 0) write(endpoint);
    playback = clock.animate(request.to, { duration: request.reducedMotion ? 0 : request.duration,
      ease: 'linear', reducedMotion: request.reducedMotion ? 'always' : 'user' });
    if (failure) { playback.stop(); throw failure; }
  } catch (error) { release(); throw error; }
  const finished = playback.finished.then(result => {
    if (failure) throw failure;
    if (result.status === 'finished' && !disposed) write(endpoint);
    return result;
  }).finally(release);
  return [{ finished, get state() { return playback.state; }, get duration() { return playback.duration; },
    pause: () => playback.pause(), play: () => playback.play(), seek: time => playback.seek(time),
    finish: () => playback.finish(), stop() { playback.stop(); release(); } }];
}

function contourEffect(effect, byPart, prepared, onProgress) {
  if (!prepared?.ok || typeof prepared.sample !== 'function' || !effect.targets.length ||
    new Set(effect.targets.map(target => target.partId)).size !== effect.targets.length ||
    effect.targets.some(target => target.property !== 'd' || !byPart.has(target.partId) ||
      byPart.get(target.partId).tagName?.toLowerCase() !== 'path' || effect.unchangedPartIds.includes(target.partId)) ||
    effect.unchangedPartIds.some(id => !byPart.has(id))) {
    throw new Error('Переход требует подготовленных контуров и объявленных частей.');
  }
  const bindings = effect.targets.map(target => ({ id: target.partId, element: byPart.get(target.partId) }));
  const poseAt = progress => {
    const pose = prepared.sample(progress);
    if (!pose.ok) throw new Error(`${pose.reason.code}: ${pose.reason.message}`);
    if (pose.parts.length !== bindings.length || pose.parts.some((part, index) =>
      part.partId !== bindings[index].id || typeof part.d !== 'string' || !part.d.length)) {
      throw new Error('Поза не соответствует объявленному набору частей.');
    }
    return pose;
  };
  const initialPose = poseAt(effect.from);
  const clock = value(effect.from);
  let playback, disposed = false;
  const writePose = (pose, progress) => {
    for (let index = 0; index < bindings.length; index++) bindings[index].element.setAttribute('d', pose.parts[index].d);
    // Подхват использует последний записанный кадр, а не другой расчёт времени.
    onProgress?.(progress);
  };
  const unsubscribe = clock.subscribe(progress => writePose(poseAt(progress), progress));
  const release = () => {
    if (disposed) return;
    disposed = true;
    unsubscribe(); clock.dispose();
  };
  try {
    writePose(initialPose, clock.get());
    playback = clock.animate(effect.to, { duration: effect.options.duration, ease: effect.options.easing,
      reducedMotion: effect.options.duration === 0 ? 'always' : 'user' });
  } catch (error) { release(); throw error; }
  const finished = playback.finished.then(result => { release(); return result; }, error => { release(); throw error; });
  return { finished, get state() { return playback.state; }, get duration() { return playback.duration; },
    pause: () => playback.pause(), play: () => playback.play(), seek: time => playback.seek(time),
    finish: () => playback.finish(), stop() { playback.stop(); release(); } };
}

function opacityStages(stages, byPart, easing) {
  // Читаем все видимые начала до admission любого канала. В fallback модель
  // исполнителя может уже обогнать последний отрисованный кадр.
  const visible = new Map();
  for (const { partId } of stages) {
    if (visible.has(partId)) continue;
    const value = getComputedStyle(byPart.get(partId)).opacity;
    const opacity = Number(value);
    if (!value || !Number.isFinite(opacity)) throw new Error(`Не определена видимая opacity ${partId}.`);
    visible.set(partId, opacity);
  }
  const first = new Set();
  return stages.map(stage => {
    const value = first.has(stage.partId) ? stage.to : [visible.get(stage.partId), stage.to];
    first.add(stage.partId);
    return [byPart.get(stage.partId), { opacity: value },
      { at: stage.at, duration: stage.duration, ease: easing }];
  });
}

/** Consumer сохраняет видимое начало; clock принадлежит публичному исполнителю. */
export function executeSymbolEffect(root, effect, { initialize = false, preparedContour, onProgress } = {}) {
  const viewport = root instanceof SVGElement ? root : root.querySelector('svg');
  if (!viewport) throw new Error('Композиция не содержит SVG viewport.');
  const byPart = new Map([...root.querySelectorAll('[data-part]')].map((element) => [element.dataset.part, element]));
  if (effect.contract === 'labpics.symbol-state-effect/1') {
    if (effect.version === 1 && effect.kind === 'contour-interpolation') {
      return [contourEffect(effect, byPart, preparedContour, onProgress)];
    }
    if (effect.version !== 1 || !['enclosure-replacement', 'source-replacement'].includes(effect.kind) ||
        (effect.kind === 'source-replacement' && effect.unchangedPartIds.length !== 0) ||
        !effect.stages.length || effect.stages.some(stage => stage.property !== 'opacity' ||
          !byPart.has(stage.partId) || byPart.get(stage.partId).tagName?.toLowerCase() !== 'g') ||
        effect.unchangedPartIds.some(id => !byPart.has(id)) ||
        effect.stages.some(stage => effect.unchangedPartIds.includes(stage.partId))) {
      throw new Error('Замена требует отдельных групп и доказанной общей геометрии.');
    }
    return [sequence(opacityStages(effect.stages, byPart, effect.options.easing),
      { reducedMotion: effect.options.duration === 0 ? 'always' : 'user' })];
  }
  if (effect.targets.some((target) => !byPart.has(target.partId))) throw new Error('Композиция не содержит цель объявленного жеста.');
  if (effect.version === 3 && (effect.targets.some(target => !['x', 'y'].includes(target.property) || target.unit !== 'viewBox') ||
      effect.stages.some(stage => !['x', 'y'].includes(stage.property) || stage.unit !== 'viewBox' ||
        !effect.targets.some(target => target.partId === stage.partId && target.property === stage.property)))) {
    throw new Error('Сдвиг требует объявленной x/y цели в единицах viewBox.');
  }
  const controls = [];
  try {
    Object.assign(viewport.style, effect.viewport);
    if (effect.version === 2) {
      controls.push(sequence(opacityStages(effect.stages, byPart, effect.options.easing),
        { reducedMotion: effect.options.duration === 0 ? 'always' : 'user' }));
      return controls;
    }
    if (effect.version === 3) {
      const first = new Set();
      controls.push(sequence(effect.stages.map(stage => {
        const key = `${stage.partId}:${stage.property}`;
        const target = effect.targets.find(target => target.partId === stage.partId && target.property === stage.property);
        const value = initialize && !first.has(key) ? [target.from, stage.to] : stage.to;
        first.add(key);
        return [byPart.get(stage.partId), { [stage.property]: value },
          { at: stage.at, duration: stage.duration, ease: effect.options.easing }];
      }), { reducedMotion: effect.options.duration === 0 ? 'always' : 'user' }));
      return controls;
    }
    if (effect.version !== 1) throw new Error('Версия эффекта не поддержана исполнителем.');
    for (const target of effect.targets) {
      const element = byPart.get(target.partId);
      Object.assign(element.style, target.style);
      controls.push(animate(element, { rotate: initialize ? [target.rotation.from, target.rotation.to] : target.rotation.to }, {
        duration: effect.options.duration,
        ease: effect.options.easing,
        reducedMotion: effect.options.duration === 0 ? 'always' : 'user',
      }));
    }
  } catch (error) {
    for (const control of controls) control.stop();
    throw error;
  }
  return controls;
}

export const executionIdentity = Object.freeze(__MOTION_IDENTITY__);
