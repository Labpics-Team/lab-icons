import { authorMotionSymbolNames } from './author-motion.js';
import { authorCapsuleMotionSymbolNames } from './author-capsule-motion.js';
import { authorClockMotionSymbolNames } from './author-clock-motion.js';

/** Build и release получают один census настоящих law-specific gesture targets. */
export function authorMotionTargets(document) {
  const rotations = authorMotionSymbolNames(document), capsules = authorCapsuleMotionSymbolNames(document), clocks = authorClockMotionSymbolNames(document);
  const names = [...rotations, ...capsules, ...clocks].sort();
  if (new Set(names).size !== names.length) throw new TypeError('motion targets: symbol имеет два несовместимых target контракта');
  return { rotations, capsules, clocks, names };
}
