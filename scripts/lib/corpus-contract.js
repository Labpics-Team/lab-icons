/** Product ratchet for the complete Lab Icons family. */
export const EXPECTED_ICON_NAMES = 238;
export const EXPECTED_VARIANTS_PER_ICON = 2;
export const EXPECTED_SOURCE_VARIANTS = EXPECTED_ICON_NAMES * EXPECTED_VARIANTS_PER_ICON;

/** Замкнутый набор семантических входов, образующих baseline evidence. */
export const BASELINE_INPUT_PATHS = Object.freeze([
  'semantics/catalog.json',
  'semantics/anatomy.json',
  'semantics/anatomy.runtime.json',
  'semantics/anatomy.candidates.json',
  'semantics/candidate-variants.json',
  'semantics/model-quality.json',
  'semantics/axis-quality.json',
  'semantics/grid.json',
]);
