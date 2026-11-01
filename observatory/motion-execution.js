import { animate, sequence } from '@labpics/motion';

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
export function executeSymbolEffect(root, effect, { initialize = false } = {}) {
  const viewport = root instanceof SVGElement ? root : root.querySelector('svg');
  if (!viewport) throw new Error('Композиция не содержит SVG viewport.');
  const byPart = new Map([...root.querySelectorAll('[data-part]')].map((element) => [element.dataset.part, element]));
  if (effect.contract === 'labpics.symbol-state-effect/1') {
    if (effect.version !== 1 || effect.kind !== 'enclosure-replacement' ||
        !effect.stages.length || effect.stages.some(stage => stage.property !== 'opacity' ||
          !byPart.has(stage.partId) || byPart.get(stage.partId).tagName?.toLowerCase() !== 'g') ||
        effect.unchangedPartIds.some(id => !byPart.has(id)) ||
        effect.stages.some(stage => effect.unchangedPartIds.includes(stage.partId))) {
      throw new Error('Замена требует отдельных групп и неподвижной оболочки.');
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
