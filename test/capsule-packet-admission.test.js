import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { authoredSymbolPayloads } from '../scripts/lib/authored-symbol-payload.js';
import { projectAuthorCapsuleMotion } from '../scripts/lib/author-capsule-motion.js';
import { createCompiledCapsuleGlyph } from '../src/ir/author-capsule-runtime.ts';
import { createCompiledBodyWidthPreparation } from '../src/ir/author-capsule-motion-runtime.ts';

const inputs = await authoredSymbolPayloads(['mic', 'mic-circle']);
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => createHash('sha256').update(stableJSON(value)).digest('hex');
const rehash = packet => {
  const { packetSha256, ...program } = packet;
  packet.packetSha256 = hash(program);
};
const mutations = [
  ['unsupported grammar', contour => { contour.commands = contour.commands.replace('C', 'A'); }],
  ['missing command', contour => { contour.commands = contour.commands.replace('C', ''); }],
  ['missing point', contour => { contour.points.pop(); contour.rates.pop(); }],
  ['extra point', contour => { contour.points.push(contour.points[0]); contour.rates.push(contour.rates[0]); }],
  ['missing rate', contour => { contour.rates.pop(); }],
  ['nonfinite rate', contour => { contour.rates[0] = Infinity; }],
  ['nonfinite coordinate', contour => { contour.points[0][0] = NaN; }],
  ['incomplete point', contour => { contour.points[0].pop(); }],
];

describe('capsule packet admission owns shape validation before materialization', () => {
  it.each(mutations)('static and prepared factories reject rehashed %s before exposing a glyph/sampler', (_, mutate) => {
    const input = structuredClone(inputs.mic), geometry = input.variation.outline;
    mutate(geometry.body.contours[0]);
    const { geometrySha256, packetSha256, ...program } = geometry;
    geometry.geometrySha256 = hash(program);
    rehash(geometry);
    expect(() => createCompiledCapsuleGlyph('mic', input.source, input.variation))
      .toThrowError(expect.objectContaining({ name: 'AuthoredCapsuleVariationError', code: 'VARIATION_SOURCE_MISMATCH' }));

    const motion = structuredClone(projectAuthorCapsuleMotion(inputs.mic).variants.outline.motion);
    mutate(motion.contours[0]);
    rehash(motion);
    expect(() => createCompiledBodyWidthPreparation({ outline: motion })).toThrow(TypeError);
  });

  it.each(['mic', 'mic-circle'])('%s keeps finite optical neighbors and physical path identity', icon => {
    const input = structuredClone(inputs[icon]);
    Object.freeze(input.source);
    const glyph = createCompiledCapsuleGlyph(icon, input.source, input.variation);
    const packets = projectAuthorCapsuleMotion(inputs[icon]);
    const prepare = createCompiledBodyWidthPreparation(Object.fromEntries(Object.entries(packets.variants).map(([variant, value]) => [variant, value.motion])));
    for (const variant of ['outline', 'filled']) {
      const source = glyph({ variant }), prepared = prepare(variant).prepared;
      expect(Object.isFrozen(source)).toBe(true);
      expect(Object.isFrozen(source.parts[0].paint)).toBe(true);
      for (const bodyWidth of [.8, .8000000000000002, .9, .9999999999999999, 1]) {
        const value = glyph({ variant, variation: { bodyWidth } });
        const d = value.composition.kind === 'compound' ? value.d : value.parts[input.variation[variant].body.index].d;
        expect(prepared.sample(bodyWidth)).toEqual({ ok: true, bodyWidth, d });
        if (bodyWidth === 1) expect(value).toBe(source);
      }
    }
    const invalidArray = [];
    invalidArray.variation = {};
    expect(() => glyph(invalidArray)).toThrowError(expect.objectContaining({ name: 'GlyphModelError', code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
    for (const request of [null, [], false, 1, 'outline']) expect(() => glyph(request)).toThrow(TypeError);
  });
});
