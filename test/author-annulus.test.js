import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnnulus, materializeAuthorAnnulus } from '../scripts/lib/author-annulus.js';
import { normalizeFigmaSvg } from '../scripts/lib/figma-import.js';
import { authorPathEntries } from '../src/core/icon-geometry.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => JSON.parse(readFileSync(new URL(path, new URL('..', import.meta.url)), 'utf8'));
const manifest = read('semantics/figma-baseline.json'), grid = read('semantics/grid.json');
const names = ['plus-circle', 'minus-circle'];
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest, counts: { families: 2, variants: 4 },
  icons: Object.fromEntries(names.map(name => [name, manifest.icons[name]])) } });
const states = read('semantics/author-state-groups.json').groups['status-circle'];
const hash = value => createHash('sha256').update(value).digest('hex');
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const rawPaths = svg => [...svg.matchAll(/\bd="([^"]+)"/g)].map(match => match[1]);
const tokens = d => [...d.matchAll(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g)].map(match => Number(match[0]));
function input(icon = 'plus-circle', variant = 'outline') {
  const source = structuredClone(baseline.icons[icon][variant]);
  const member = states.states[icon === 'plus-circle' ? 'increase' : 'decrease'];
  // Части привязаны к действующему semantic owner status-circle, не shape guess.
  const parts = source.sourceContract.parts.map((part, index) => ({ ...part, identity: 'declared',
    id: index === 0 ? member.contentPartIds[0] : states.enclosurePartId, role: index === 0 ? 'content' : 'container' }));
  const declaration = { law: 'annulus.counter-scale', parameter: 'enclosureEmphasis', variant,
    enclosurePartId: states.enclosurePartId, source: Object.fromEntries(['fileKey', 'version', 'masterSha256', 'pathFingerprintSha256'].map(key => [key, source.author[key]])) };
  return { source, parts, declaration };
}
const compile = value => compileAuthorAnnulus(value.source, value.parts, value.declaration, grid);
const packets = Object.fromEntries(names.map(name => [name, compile(input(name))]));
function rebound(icon, change) {
  const value = input(icon), paths = rawPaths(value.source.rawSvg).map((d, index) => change(d, index));
  let index = 0;
  value.source.rawSvg = value.source.rawSvg.replace(/\bd="[^"]+"/g, () => `d="${paths[index++]}"`);
  value.source.normalizedSvg = normalizeFigmaSvg(value.source.rawSvg);
  value.source.artifactSvg = value.source.normalizedSvg.replace(/^<svg\b/, '<svg fill="currentColor"');
  value.source.author.masterSha256 = hash(value.source.rawSvg);
  value.source.author.pathFingerprintSha256 = hash(stableJSON(authorPathEntries(value.source.artifactSvg)));
  value.declaration.source.masterSha256 = value.source.author.masterSha256;
  value.declaration.source.pathFingerprintSha256 = value.source.author.pathFingerprintSha256;
  return value;
}
function mapOperands(d, transform) {
  let i = 0;
  return d.replace(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g, token => String(transform(Number(token), i++)));
}
const numericFraction = value => Number(value.numerator) / Number(value.denominator);
// Независимый oracle: прямое вычисление cubic в фиксированной области из raw tokens.
function cubicRadiusSamples(d, center) {
  const values = tokens(d), points = Array.from({ length: values.length / 2 }, (_, i) => values.slice(i * 2, i * 2 + 2));
  const result = [];
  for (let quarter = 0; quarter < 4; quarter++) for (const t of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
    const a = 1 - t, local = points.slice(quarter * 3, quarter * 3 + 4);
    const point = [0, 1].map(axis => a ** 3 * local[0][axis] + 3 * a ** 2 * t * local[1][axis] + 3 * a * t ** 2 * local[2][axis] + t ** 3 * local[3][axis]);
    result.push((point[0] - center[0]) ** 2 + (point[1] - center[1]) ** 2);
  }
  return result;
}
describe('authored annulus build compiler: exact master and certified countershape', () => {
  it.each(names)('%s preserves exact default Figma identity and shared ring', icon => {
    const packet = packets[icon], source = baseline.icons[icon].outline;
    expect(materializeAuthorAnnulus(packet)).toBe(packet.defaults);
    expect(materializeAuthorAnnulus(packet, { enclosureEmphasis: 1 })).toBe(packet.defaults);
    expect(packet.defaults.rawSvg).toBe(source.rawSvg);
    expect(packet.defaults.artifactSvg).toBe(source.artifactSvg);
    expect(packet.defaults.parts.map(part => part.d)).toEqual(rawPaths(source.rawSvg));
    expect(hash(packet.enclosure.outerD + packet.enclosure.innerD)).toBe('e968e80eacbedc69a95420ccbfb386db9a4a6b5c77f728e206eb1e970308c5c9');
    expect(packet.source).toMatchObject({ fileKey: 'LuaiBd4anRi4DMZayKAnY2', version: '2416636003859748575' });
    expect(packet.enclosure).toMatchObject({ center: [12, 12], outerRadius: 10.5, referenceInnerRadius: 8.7002 });
    expect(packet.enclosure.referenceThickness).not.toBe(24 * grid.ratios.strokeWidth.enclosureRing);
    expect(Object.isFrozen(packet.defaults.parts[0])).toBe(true);
  });
  it.each(names)('%s genuinely varies only the inner authored contour', icon => {
    const packet = packets[icon];
    for (const emphasis of [0.6, 0.9, 1.1, 1.29167, 2]) {
      const result = materializeAuthorAnnulus(packet, { enclosureEmphasis: emphasis });
      expect(result.parts[0]).toBe(packet.defaults.parts[0]);
      expect(result.parts[1].d.startsWith(packet.enclosure.outerD)).toBe(true);
      expect(result.parts[1].d).not.toBe(packet.defaults.parts[1].d);
      expect(result.parts.map(({ id, role, fillRule, zIndex }) => ({ id, role, fillRule, zIndex })))
        .toEqual(packet.defaults.parts.map(({ id, role, fillRule, zIndex }) => ({ id, role, fillRule, zIndex })));
      const scale = result.provenance.variation.scale, original = tokens(packet.enclosure.innerD);
      const actual = tokens(result.parts[1].d.slice(packet.enclosure.outerD.length));
      expect(actual).toEqual(original.map((value, i) => packet.enclosure.center[i % 2] + scale * (value - packet.enclosure.center[i % 2])));
      expect(result.artifactSvg.replace(result.parts[1].d, packet.defaults.parts[1].d)).toBe(packet.defaults.artifactSvg);
      expect(result.rawSvg.replace(result.parts[1].d, packet.defaults.parts[1].d)).toBe(packet.defaults.rawSvg);
      expect(result.provenance).toMatchObject({ kind: 'authored-variation', author: packet.source,
        variation: { law: 'annulus.counter-scale', geometrySha256: packet.geometrySha256, parameters: { enclosureEmphasis: emphasis } } });
    }
  });
  it.each(names)('%s has curve bounds that enclose independent samples, rather than control-hull disk radius', icon => {
    const packet = packets[icon], proof = packet.domain.proof;
    for (const [d, lower, upper] of [[packet.enclosure.outerD, proof.outerLowerSquared, proof.outerUpperSquared],
      [packet.enclosure.innerD, proof.innerLowerSquared, proof.innerUpperSquared]]) {
      for (const sample of cubicRadiusSamples(d, packet.enclosure.center)) {
        expect(sample).toBeGreaterThanOrEqual(numericFraction(lower));
        expect(sample).toBeLessThanOrEqual(numericFraction(upper));
      }
    }
    expect(Math.sqrt(numericFraction(proof.outerLowerSquared))).toBeCloseTo(10.468683893785313, 12);
    expect(Math.sqrt(numericFraction(proof.innerUpperSquared))).toBeCloseTo(8.717044776528338, 12);
    expect(numericFraction(proof.euclideanErrorUpper)).toBeGreaterThan(0);
    expect(numericFraction(proof.euclideanErrorUpper)).toBeLessThan(1e-13);
    expect(packet.domain.scale.minimum).toBeLessThan(1);
    expect(packet.domain.scale.maximum).toBeGreaterThan(1);
  });
  it('has actual on-curve clearance failures before refusal: rejects unsafe and collapsed emphasis', () => {
    // Точки принадлежат raw endpoint/content и cardinal/inner contour; не hull-only oracle.
    const gap = 24 * grid.ratios.clearanceMin;
    expect(Math.sqrt(42329557 / 100000000)).toBeLessThan(gap);
    expect(Math.sqrt(1132583401 / 2500000000)).toBeLessThan(gap);
    for (const [icon, point, cardinal, squared] of [
      ['plus-circle', [11.9961, 6.83008], [12, 3.2998], 42329557 / 100000000],
      ['minus-circle', [17.1475, 11.9912], [20.7002, 12], 1132583401 / 2500000000],
    ]) {
      const packet = packets[icon], { center, outerRadius: R, referenceInnerRadius: r, referenceThickness: T } = packet.enclosure;
      // После H/V raw tokens не являются парами x/y; свидетель закреплён
      // как явный endpoint непосредственно перед следующим C в raw master.
      expect(packet.defaults.parts[0].d).toContain(`${point.join(' ')}C`);
      expect(packet.enclosure.innerD).toContain(`${cardinal.join(' ')}C`);
      const s = (R - 2.6 * T) / r, transformed = cardinal.map((value, axis) => center[axis] + s * (value - center[axis]));
      const actualSquared = transformed.reduce((sum, value, axis) => sum + (value - point[axis]) ** 2, 0);
      expect(actualSquared).toBeCloseTo(squared, 12); expect(actualSquared).toBeLessThan(gap ** 2);
    }
    for (const packet of Object.values(packets)) {
      expect(() => materializeAuthorAnnulus(packet, { enclosureEmphasis: 2.6 })).toThrow(expect.objectContaining({ code: 'VARIATION_OUTSIDE_DOMAIN' }));
      expect(() => materializeAuthorAnnulus(packet, { enclosureEmphasis: 0.001 })).toThrow(expect.objectContaining({ code: 'VARIATION_OUTSIDE_DOMAIN' }));
      expect(() => materializeAuthorAnnulus(packet, { enclosureEmphasis: 6 })).toThrow(expect.objectContaining({ code: 'VARIATION_UNREPRESENTABLE' }));
    }
  });
  it('does not inherit the law for Filled or arbitrary weight/optical requests', () => {
    expect(() => compile(input('plus-circle', 'filled'))).toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
    for (const variation of [null, [], { weight: 1.1 }, { opsz: 16 }, { enclosureEmphasis: null }, { enclosureEmphasis: 0 }, { enclosureEmphasis: Infinity }]) {
      expect(() => materializeAuthorAnnulus(packets['plus-circle'], variation)).toThrow(expect.objectContaining({ code: 'INVALID_VARIATION' }));
    }
  });
  it('rejects source/version/fingerprint mismatches and anonymous shape guessing', () => {
    for (const key of ['fileKey', 'version', 'masterSha256', 'pathFingerprintSha256']) {
      const value = input(); value.declaration.source[key] += 'x';
      expect(() => compile(value)).toThrow(expect.objectContaining({ code: 'SOURCE_MISMATCH' }));
    }
    const value = input(); value.parts[1].role = 'content';
    expect(() => compile(value)).toThrow(expect.objectContaining({ code: 'DECLARED_PARTS_REQUIRED' }));
    const anonymous = input(); anonymous.parts[1].identity = 'geometry-derived';
    expect(() => compile(anonymous)).toThrow(expect.objectContaining({ code: 'DECLARED_PARTS_REQUIRED' }));
  });
  it('refuses null, missing and sparse declared parts before reading identity fields', () => {
    for (const malformed of [null, undefined, 1, 'content', [], Object.create(null)]) {
      const value = input(); value.parts[0] = malformed;
      expect(() => compile(value)).toThrow(expect.objectContaining({ code: 'DECLARED_PARTS_REQUIRED' }));
    }
    for (const index of [0, 1]) {
      const value = input(); delete value.parts[index];
      expect(() => compile(value)).toThrow(expect.objectContaining({ code: 'DECLARED_PARTS_REQUIRED' }));
    }
    const invalidId = input(); invalidId.parts[0].id = Symbol('content');
    expect(() => compile(invalidId)).toThrow(expect.objectContaining({ code: 'DECLARED_PARTS_REQUIRED' }));
    expect(compile(input('plus-circle')).geometrySha256).toBe(packets['plus-circle'].geometrySha256);
    expect(compile(input('minus-circle')).geometrySha256).toBe(packets['minus-circle'].geometrySha256);
  });
  it('rebound controls reach geometric failures, rather than being hidden by old hash mismatch', () => {
    const badQuarter = rebound('plus-circle', (d, index) => index === 1 ? d.replace('17.7988 1.50013', '25 1.50013') : d);
    expect(() => compile(badQuarter)).toThrow(expect.objectContaining({ code: 'CORRESPONDENCE_UNSUPPORTED' }));
    const badCenter = rebound('plus-circle', (d, index) => index === 1 ? d.replace('ZM12 3.2998', 'ZM12.1 3.2998') : d);
    expect(() => compile(badCenter)).toThrow(expect.objectContaining({ code: 'TOPOLOGY_UNSUPPORTED' }));
    const movedInner = rebound('plus-circle', (d, index) => {
      if (index !== 1) return d;
      const split = d.indexOf('Z') + 1;
      return d.slice(0, split) + mapOperands(d.slice(split), (value, operand) => value + (operand % 2 === 0 ? 0.1 : 0));
    });
    expect(() => compile(movedInner)).toThrow(expect.objectContaining({ code: 'CORRESPONDENCE_UNSUPPORTED' }));
    const sameWinding = rebound('plus-circle', (d, index) => {
      if (index !== 1) return d;
      const split = d.indexOf('Z') + 1;
      return d.slice(0, split) + mapOperands(d.slice(split), (value, operand) => operand % 2 === 0 ? 24 - value : value);
    });
    expect(() => compile(sameWinding)).toThrow(expect.objectContaining({ code: 'CORRESPONDENCE_UNSUPPORTED' }));
    const contentCollision = rebound('plus-circle', (d, index) => index === 0 ? mapOperands(d, value => 12 + 2 * (value - 12)) : d);
    expect(() => compile(contentCollision)).toThrow(expect.objectContaining({ code: 'DEFAULT_OUTSIDE_DOMAIN' }));
    const reversedNesting = rebound('plus-circle', (d, index) => {
      if (index !== 1) return d;
      const split = d.indexOf('Z') + 1;
      return mapOperands(d.slice(0, split), value => 12 + 0.5 * (value - 12)) + d.slice(split);
    });
    expect(() => compile(reversedNesting)).toThrow(expect.objectContaining({ code: 'CORRESPONDENCE_UNSUPPORTED' }));
    const nonzero = input(); nonzero.source.rawSvg = nonzero.source.rawSvg.replaceAll('="evenodd"', '="nonzero"');
    nonzero.source.artifactSvg = normalizeFigmaSvg(nonzero.source.rawSvg).replace(/^<svg\b/, '<svg fill="currentColor"');
    nonzero.source.author.masterSha256 = nonzero.declaration.source.masterSha256 = hash(nonzero.source.rawSvg);
    nonzero.source.author.pathFingerprintSha256 = nonzero.declaration.source.pathFingerprintSha256 = hash(stableJSON(authorPathEntries(nonzero.source.artifactSvg)));
    nonzero.parts[1].fillRule = 'nonzero';
    expect(() => compile(nonzero)).toThrow(expect.objectContaining({ code: 'TOPOLOGY_UNSUPPORTED' }));
    const paint = input(); paint.source.artifactSvg = paint.source.artifactSvg.replace('<path', '<path stroke="red"');
    expect(() => compile(paint)).toThrow(expect.objectContaining({ code: 'SOURCE_UNSUPPORTED' }));
  });
  it('bounds are serialized inward and survive JSON without permission from object identity', () => {
    const packet = packets['plus-circle'], portable = JSON.parse(JSON.stringify(packet));
    expect(materializeAuthorAnnulus(portable, { enclosureEmphasis: 1.1 })).toEqual(materializeAuthorAnnulus(packet, { enclosureEmphasis: 1.1 }));
    expect(compile(input('plus-circle'))).toEqual(packet);
    const lower = packet.domain.proof.minimumScale, upper = packet.domain.proof.maximumScale;
    const binary = value => {
      const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, value);
      const bits = bytes.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n), significand = (bits & ((1n << 52n) - 1n)) + (1n << 52n);
      const shift = exponent - 1023 - 52;
      return shift >= 0 ? [significand << BigInt(shift), 1n] : [significand, 1n << BigInt(-shift)];
    };
    const compare = (value, fraction) => {
      const [n, d] = binary(value); return n * BigInt(fraction.denominator) - BigInt(fraction.numerator) * d;
    };
    expect(compare(packet.domain.scale.minimum, lower)).toBeGreaterThanOrEqual(0n);
    expect(compare(packet.domain.scale.maximum, upper)).toBeLessThanOrEqual(0n);
  });
  it.each(names)('%s uses actual binary scale at both domain boundaries and adjacent weights', icon => {
    const packet = packets[icon], { outerRadius: R, referenceInnerRadius: r, referenceThickness: T } = packet.enclosure;
    const next = (value, direction) => {
      const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, value);
      bytes.setBigUint64(0, bytes.getBigUint64(0) + BigInt(direction)); return bytes.getFloat64(0);
    };
    let accepted = 0, refused = 0;
    for (const bound of [packet.domain.scale.minimum, packet.domain.scale.maximum]) {
      const middle = (R - r * bound) / T;
      for (const emphasis of [next(next(middle, -1), -1), next(middle, -1), middle, next(middle, 1), next(next(middle, 1), 1)]) {
        const actualScale = (R - emphasis * T) / r;
        if (actualScale >= packet.domain.scale.minimum && actualScale < packet.domain.scale.maximum) {
          expect(materializeAuthorAnnulus(packet, { enclosureEmphasis: emphasis }).provenance.variation.scale).toBe(actualScale); accepted++;
        } else {
          expect(() => materializeAuthorAnnulus(packet, { enclosureEmphasis: emphasis })).toThrow(expect.objectContaining({ code: 'VARIATION_OUTSIDE_DOMAIN' })); refused++;
        }
      }
    }
    expect(accepted).toBeGreaterThan(0); expect(refused).toBeGreaterThan(0);
  });
  it.each(names)('%s accepts a positive subnormal grid clearance without Infinity/Infinity refusal', icon => {
    const value = input(icon), policy = { ...grid, ratios: { ...grid.ratios, clearanceMin: Number.MIN_VALUE } };
    const packet = compileAuthorAnnulus(value.source, value.parts, value.declaration, policy);
    expect(packet.domain.scale.minimum).toBeCloseTo(icon === 'plus-circle' ? 0.59980729450811 : 0.5985886483532691, 12);
    expect(packet.domain.scale.maximum).toBeGreaterThan(1);
    expect(materializeAuthorAnnulus(packet)).toBe(packet.defaults);
    expect(materializeAuthorAnnulus(packet, { enclosureEmphasis: 2.6 }).parts[0]).toBe(packet.defaults.parts[0]);
    expect(packet.domain.policy.minimumGapRatio).toBe(Number.MIN_VALUE);
  });
});
