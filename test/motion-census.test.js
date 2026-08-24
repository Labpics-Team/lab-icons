import { describe, expect, it } from 'vitest';
import { buildMotionCensus } from '../scripts/build-motion-census.mjs';
import catalog from '../semantics/catalog.json';

const byId = (census, id) => census.families.find((family) => family.id === id);

describe('MO-00 motion census', () => {
  it('выводит только семьи с двумя и более совместимыми consumers', () => {
    const census = buildMotionCensus();
    expect(census.families).toHaveLength(8);
    for (const family of census.families) {
      expect(family.accepted.length + family.candidate.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('отделяет declared capability от candidate families и morph readiness', () => {
    const census = buildMotionCensus();
    expect(census.declaredGestures).toEqual([
      { icon: 'time', id: 'time.advance', kind: 'clock-advance' },
    ]);
    expect(census.morphReadyPairs).toEqual([]);
    expect(census.families.map((family) => family.id)).not.toContain('spin');
    expect(census.families.map((family) => family.id)).not.toContain('play-state-toggle');
  });

  it('не допускает source-only или несовместимого consumer в compatible set', () => {
    const mutated = structuredClone(catalog);
    mutated.icons['cloud-off'].model = null;
    const census = buildMotionCensus({ catalogInput: mutated });
    expect(byId(census, 'off-slash-draw').candidate).not.toContain('cloud-off');
    expect(byId(census, 'off-slash-draw').exclusions).toContainEqual({ icon: 'cloud-off', code: 'SOURCE_ONLY' });
  });

  it('отклоняет family с менее чем двумя consumers, duplicate id/icon и unknown icon', () => {
    const family = { id: 'fake', meaning: 'fake', icons: ['time', 'time'], requiredPartSets: [['hand-minute']], requiredTrackKinds: ['rotate'], readiness: 'existing-core', compatibleExclusions: [] };
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [family] } }))
      .toThrow(/невалидные icons/);
    const valid = { id: 'valid', meaning: 'valid', icons: ['cloud-off', 'heart-off'], requiredPartSets: [['slash']], requiredTrackKinds: ['reveal'], readiness: 'needs-core', compatibleExclusions: [{ icon: 'mic-off', code: 'SEMANTIC_MEANING_MISMATCH' }, { icon: 'video-camera-off', code: 'SEMANTIC_MEANING_MISMATCH' }] };
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [valid, valid] } }))
      .toThrow(/duplicate family id/);
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [{ ...valid, icons: ['cloud-off', 'typo-icon'] }] } }))
      .toThrow(/unknown icon typo-icon/);
  });

  it('отклоняет границу ровно одного compatible consumer', () => {
    const mutated = structuredClone(catalog);
    for (const icon of ['heart-off', 'mic-off', 'video-camera-off']) mutated.icons[icon].model = null;
    const family = { id: 'single', meaning: 'single', icons: ['cloud-off', 'heart-off', 'mic-off', 'video-camera-off'], requiredPartSets: [['slash']], requiredTrackKinds: ['reveal'], readiness: 'needs-core', compatibleExclusions: [] };
    expect(() => buildMotionCensus({ catalogInput: mutated, familySpec: { version: 1, families: [family] } }))
      .toThrow(/не менее двух/);
  });

  it('требует полный набор частей, а не частичное совпадение, и закрытый track kind', () => {
    const mutated = structuredClone(catalog);
    for (const variant of Object.values(mutated.icons['swap-vertical'].model.variants)) {
      variant.parts = variant.parts.filter((part) => part.id !== 'shaft-b');
    }
    // swap-horizontal содержит весь set, swap-vertical — только его часть: `some()` ошибочно дал бы 2 consumers.
    const family = { id: 'partial', meaning: 'partial', icons: ['swap-horizontal', 'swap-vertical'], requiredPartSets: [['head-a', 'shaft-a', 'head-b', 'shaft-b']], requiredTrackKinds: ['translate'], readiness: 'needs-core', compatibleExclusions: [] };
    expect(() => buildMotionCensus({ catalogInput: mutated, familySpec: { version: 1, families: [family] } }))
      .toThrow(/не менее двух/);
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [{ ...family, requiredTrackKinds: ['teleport'] }] } }))
      .toThrow(/невалидные/);
  });

  it('запрещает contour-index как semantic evidence и требует closed-world exclusions', () => {
    const contour = { id: 'whirl', meaning: 'whirl', icons: ['heart', 'refresh'], requiredPartSets: [['c0']], requiredTrackKinds: ['rotate'], readiness: 'existing-core', compatibleExclusions: [] };
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [contour] } }))
      .toThrow(/невалидные/);
    const omitted = { id: 'mark-family', meaning: 'mark', icons: ['checkmark', 'checkmark-circle'], requiredPartSets: [['mark']], requiredTrackKinds: ['reveal'], readiness: 'needs-core', compatibleExclusions: [] };
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [omitted] } }))
      .toThrow(/не классифицированы/);
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [{
      ...omitted,
      compatibleExclusions: [
        { icon: 'chevron-back', code: 'SEMANTIC_MEANING_MISMATCH' },
        { icon: 'chevron-back', code: 'SEMANTIC_MEANING_MISMATCH' },
      ],
    }] } })).toThrow(/duplicate compatible exclusion/);
  });

  it('не принимает part-set только в одном варианте и мёртвый альтернативный set', () => {
    const mutated = structuredClone(catalog);
    for (const variant of Object.values(mutated.icons['heart-off'].model.variants).slice(0, 1)) {
      variant.parts = variant.parts.filter((part) => part.id !== 'slash');
    }
    const partialVariant = { id: 'slash-family', meaning: 'slash', icons: ['heart-off', 'cloud-off'], requiredPartSets: [['slash']], requiredTrackKinds: ['reveal'], readiness: 'needs-core', compatibleExclusions: [{ icon: 'mic-off', code: 'SEMANTIC_MEANING_MISMATCH' }, { icon: 'video-camera-off', code: 'SEMANTIC_MEANING_MISMATCH' }] };
    expect(() => buildMotionCensus({ catalogInput: mutated, familySpec: { version: 1, families: [partialVariant] } }))
      .toThrow(/не менее двух/);

    const deadSet = { ...partialVariant, requiredPartSets: [['slash'], ['slash', 'ghost-part']] };
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [deadSet] } }))
      .toThrow(/requiredPartSet не встречается/);
  });
});
