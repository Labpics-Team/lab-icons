import { describe, expect, it } from 'vitest';
import { buildMotionCensus } from '../scripts/build-motion-census.mjs';
import catalog from '../semantics/catalog.json';

const byId = (census, id) => census.families.find((family) => family.id === id);

describe('MO-00 motion census', () => {
  it('выводит только семьи с двумя и более совместимыми consumers', () => {
    const census = buildMotionCensus();
    expect(census.families).toHaveLength(10);
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
    expect(byId(census, 'spin')).toMatchObject({ readiness: 'existing-core', accepted: [], candidate: ['arrow-redo', 'arrow-undo', 'refresh', 'reload'] });
  });

  it('не допускает source-only или несовместимого consumer в compatible set', () => {
    const mutated = structuredClone(catalog);
    mutated.icons.refresh.model = null;
    const census = buildMotionCensus({ catalogInput: mutated });
    expect(byId(census, 'spin').candidate).not.toContain('refresh');
    expect(byId(census, 'spin').exclusions).toContainEqual({ icon: 'refresh', code: 'SOURCE_ONLY' });
  });

  it('отклоняет family с менее чем двумя consumers, duplicate id/icon и unknown icon', () => {
    const family = { id: 'fake', meaning: 'fake', icons: ['time', 'time'], requiredPartSets: [['hand-minute']], requiredTrackKinds: ['rotate'], readiness: 'existing-core' };
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [family] } }))
      .toThrow(/невалидные icons/);
    const valid = { id: 'valid', meaning: 'valid', icons: ['plus', 'minus'], requiredPartSets: [['stem'], ['bar']], requiredTrackKinds: ['scale'], readiness: 'needs-core' };
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [valid, valid] } }))
      .toThrow(/duplicate family id/);
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [{ ...valid, icons: ['plus', 'typo-icon'] }] } }))
      .toThrow(/unknown icon typo-icon/);
  });

  it('требует полный альтернативный набор частей и закрытый track kind', () => {
    const family = { id: 'fake', meaning: 'fake', icons: ['plus', 'minus'], requiredPartSets: [['stem', 'missing']], requiredTrackKinds: ['rotate'], readiness: 'existing-core' };
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [family] } }))
      .toThrow(/не менее двух/);
    expect(() => buildMotionCensus({ familySpec: { version: 1, families: [{ ...family, requiredTrackKinds: ['teleport'] }] } }))
      .toThrow(/невалидные/);
  });
});
