import { authorMotionSymbolNames } from './author-motion.js';
import { authorCapsuleMotionSymbolNames } from './author-capsule-motion.js';

/** Build и release получают один census настоящих law-specific gesture targets. */
export function authorMotionTargets(document) {
  const rotations = authorMotionSymbolNames(document), capsules = authorCapsuleMotionSymbolNames(document);
  if (rotations.some(icon => capsules.includes(icon))) throw new TypeError('motion targets: symbol имеет два несовместимых target контракта');
  return { rotations, capsules, names: [...rotations, ...capsules].sort() };
}
