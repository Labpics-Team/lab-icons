import { animate } from '@labpics/motion';

/** Consumer передаёт значения публичному исполнителю; clock и поза принадлежат ему. */
export function executeSymbolEffect(root, effect, { initialize = false } = {}) {
  const viewport = root instanceof SVGElement ? root : root.querySelector('svg');
  if (!viewport) throw new Error('Композиция не содержит SVG viewport.');
  const byPart = new Map([...root.querySelectorAll('[data-part]')].map((element) => [element.dataset.part, element]));
  if (effect.targets.some((target) => !byPart.has(target.partId))) throw new Error('Композиция не содержит цель объявленного жеста.');
  const controls = [];
  try {
    Object.assign(viewport.style, effect.viewport);
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
