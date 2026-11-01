import { animate, sequence } from '@labpics/motion';

/** Consumer передаёт значения публичному исполнителю; clock и поза принадлежат ему. */
export function executeSymbolEffect(root, effect, { initialize = false } = {}) {
  const viewport = root instanceof SVGElement ? root : root.querySelector('svg');
  if (!viewport) throw new Error('Композиция не содержит SVG viewport.');
  const byPart = new Map([...root.querySelectorAll('[data-part]')].map((element) => [element.dataset.part, element]));
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
      controls.push(sequence(effect.stages.map(stage => [
        byPart.get(stage.partId), { opacity: stage.to },
        { at: stage.at, duration: stage.duration, ease: effect.options.easing },
      ]), { reducedMotion: effect.options.duration === 0 ? 'always' : 'user' }));
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
