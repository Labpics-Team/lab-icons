import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomyWithEvidence } from '../scripts/lib/author-anatomy.js';
import { compileAuthorContentVariation, materializeAuthorContentVariation,
  projectAuthorContentVariationRuntime } from '../scripts/lib/author-annulus.js';
import { authoredSymbolPayloads } from '../scripts/lib/authored-symbol-payload.js';
import { createCompiledContentGlyph } from '../src/ir/author-content-runtime.js';
import { createCompiledGlyph } from '../src/ir/symbol-runtime.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = path => JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'));
const document = read('semantics/author-anatomy.json'), captured = read('semantics/figma-baseline.json'), grid = read('semantics/grid.json');
const names = Object.keys(document.icons).filter(name => document.icons[name].outline?.contentVariation);
const baseline = loadAuthorBaseline(root, { manifest: { ...captured, counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map(name => [name, captured.icons[name]])) } });
const spec = { ...document, icons: Object.fromEntries(names.map(name => [name, document.icons[name]])) };
const { contracts, evidence, contentEvidence } = compileAuthorAnatomyWithEvidence(baseline, spec, grid);
const inputs = await authoredSymbolPayloads(names);
const rawPaths = svg => [...svg.matchAll(/<path\b[^>]*\bd="([^"]+)"/g)].map(match => match[1]);

// Независимый raw operand oracle: H/V исполняются из исходного SVG, не из packet.
function rawProgram(d) {
  const tokens = d.match(/[MLHV CQZ]|[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g).filter(token => token !== ' ');
  const commands = [], points = []; let x = 0, y = 0, index = 0;
  while (index < tokens.length) {
    const command = tokens[index++], number = () => Number(tokens[index++]);
    if (command === 'Z') { commands.push('Z'); continue; }
    if (command === 'H') { x = number(); points.push([x, y]); commands.push('L'); }
    else if (command === 'V') { y = number(); points.push([x, y]); commands.push('L'); }
    else {
      const count = command === 'C' ? 3 : command === 'Q' ? 2 : 1;
      for (let point = 0; point < count; point++) { x = number(); y = number(); points.push([x, y]); }
      commands.push(command);
    }
  }
  return { commands: commands.join(''), points };
}

// Независимый fraction oracle не использует арифметику или certificate compiler.
const F = (n, d = 1n) => {
  if (d < 0n) { n = -n; d = -d; }
  let a = n < 0n ? -n : n, b = d; while (b) [a, b] = [b, a % b];
  return [n / a, d / a];
};
const add = (a, b) => F(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
const sub = (a, b) => F(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
const mul = (a, b) => F(a[0] * b[0], a[1] * b[1]);
const cmp = (a, b) => a[0] * b[1] < b[0] * a[1] ? -1 : a[0] * b[1] > b[0] * a[1] ? 1 : 0;
const square = a => mul(a, a), maximum = values => values.reduce((a, b) => cmp(a, b) > 0 ? a : b);
function exact(value) {
  const view = new DataView(new ArrayBuffer(8)); view.setFloat64(0, value);
  const bits = view.getBigUint64(0), exponent = Number(bits >> 52n & 2047n);
  const mantissa = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
  const shift = (exponent ? exponent - 1023 : -1022) - 52, signed = bits >> 63n ? -mantissa : mantissa;
  return shift >= 0 ? F(signed << BigInt(shift)) : F(signed, 1n << BigInt(-shift));
}
const radialSquared = (point, center) => point.map((value, axis) => square(sub(exact(value), exact(center[axis])))).reduce(add);
function actualCurveRadiusSquared(d, center) {
  const { points } = rawProgram(d), choose3 = [1n, 3n, 3n, 1n], choose6 = [1n, 6n, 15n, 20n, 15n, 6n, 1n];
  const local = points.map(point => point.map((value, axis) => sub(exact(value), exact(center[axis]))));
  const values = [];
  for (let quarter = 0; quarter < 4; quarter++) for (let k = 0; k <= 6; k++) {
    let value = F(0n);
    for (let i = 0; i <= 3; i++) {
      const j = k - i; if (j < 0 || j > 3) continue;
      const a = local[quarter * 3 + i], b = local[quarter * 3 + j];
      value = add(value, mul(F(choose3[i] * choose3[j], choose6[k]), add(mul(a[0], b[0]), mul(a[1], b[1]))));
    }
    values.push(value);
  }
  return { minimum: values.reduce((a, b) => cmp(a, b) < 0 ? a : b), maximum: maximum(values) };
}
function hasGap(innerSquared, contentSquared, gap) {
  const g2 = square(gap), residual = sub(sub(innerSquared, contentSquared), g2);
  return residual[0] >= 0n && cmp(square(residual), mul(F(4n), mul(g2, contentSquared))) >= 0;
}

describe('content and annulus share a source-bound affine law and actual binary64 certificate', () => {
  it('the opt-in annotation leaves every legacy anatomy contract and proof byte-identical', async () => {
    const before = execFileSync('git', ['show', '749706af0aa6b4d371cd5842fe616c2d55f7c4e8:scripts/lib/author-anatomy.js'],
      { cwd: root, encoding: 'utf8', windowsHide: true });
    const transported = before.replace(/^import .* from '([^']+)'.*;$/gm, (line, path) =>
      path.startsWith('.') ? line.replace(path, pathToFileURL(resolve(root, 'scripts/lib', path)).href) : line);
    const old = await import(`data:text/javascript;base64,${Buffer.from(transported).toString('base64')}`);
    const legacy = structuredClone(spec);
    for (const name of names) delete legacy.icons[name].outline.contentVariation;
    const expected = old.compileAuthorAnatomyWithEvidence(baseline, legacy, grid);
    const actual = Object.fromEntries(Object.entries(contracts).map(([label, contract]) => {
      const { contentVariation: _content, ...unchanged } = contract; return [label, unchanged];
    }));
    expect(JSON.stringify(actual)).toBe(JSON.stringify(expected.contracts));
    expect(JSON.stringify(evidence)).toBe(JSON.stringify(expected.evidence));
  });

  it.each(names)('%s keeps exact identity and independently moves every authored content operand around C', name => {
    const compiled = contentEvidence[`${name}/outline`], input = inputs[name];
    const glyph = createCompiledContentGlyph(name, input.source, input.contentVariation.outline), source = createCompiledGlyph(name, input.source)();
    expect(materializeAuthorContentVariation(compiled, { contentScale: 1, enclosureEmphasis: 1 })).toBe(compiled.defaults);
    expect(compiled.annulusGeometrySha256).toBe(evidence[`${name}/outline`].geometrySha256);
    expect(compiled.content.center).toEqual(compiled.enclosure.center);
    expect(glyph({ variation: {} })).toBe(source);
    for (const parameters of [{ contentScale: 0.85, enclosureEmphasis: 1.4 }, { contentScale: 1.02, enclosureEmphasis: 0.9 },
      { contentScale: 0.95, enclosureEmphasis: 0.8 }]) {
      const actual = glyph({ variation: parameters }), probe = materializeAuthorContentVariation(compiled, parameters);
      expect(actual.parts.map(part => part.d)).toEqual(probe.parts.map(part => part.d));
      for (let index = 0; index < actual.parts.length - 1; index++) {
        const original = rawProgram(rawPaths(baseline.icons[name].outline.rawSvg)[index]), changed = rawProgram(actual.parts[index].d);
        expect(changed.commands).toBe(original.commands);
        expect(changed.points).toEqual(original.points.map(point => point.map((value, axis) =>
          compiled.enclosure.center[axis] + parameters.contentScale * (value - compiled.enclosure.center[axis]))));
        expect(actual.parts[index].anchor).toEqual(source.parts[index].anchor.map(value => 0.5 + parameters.contentScale * (value - 0.5)));
        expect(actual.parts[index].topologySignature).toBe(source.parts[index].topologySignature);
      }
      expect(actual.parts.at(-1).d.startsWith(compiled.enclosure.outerD)).toBe(true);
      expect(actual.parts.at(-1).anchor).toEqual(source.parts.at(-1).anchor);
      expect(actual.parts.map(({ id, role, zIndex, fillRule }) => ({ id, role, zIndex, fillRule })))
        .toEqual(source.parts.map(({ id, role, zIndex, fillRule }) => ({ id, role, zIndex, fillRule })));
    }
    const contentOnly = glyph({ variation: { contentScale: 0.9 } });
    expect(contentOnly.parts.at(-1)).toBe(source.parts.at(-1));
    const enclosureOnly = glyph({ variation: { enclosureEmphasis: 1.1 } });
    expect(enclosureOnly.parts.slice(0, -1)).toEqual(source.parts.slice(0, -1));
  });

  it.each(names)('%s actual emitted binary64 controls satisfy radial clearance and positive annulus wall', name => {
    const compiled = contentEvidence[`${name}/outline`], center = compiled.enclosure.center;
    const glyph = createCompiledContentGlyph(name, inputs[name].source, inputs[name].contentVariation.outline);
    for (const parameters of [{ contentScale: 0.85, enclosureEmphasis: 1.4 }, { contentScale: 1.02, enclosureEmphasis: 0.9 },
      { contentScale: compiled.domain.contentScale.minimum, enclosureEmphasis: 1 }]) {
      const actual = glyph({ variation: parameters }), ring = actual.parts.at(-1).d;
      const outer = actualCurveRadiusSquared(compiled.enclosure.outerD, center);
      const inner = actualCurveRadiusSquared(ring.slice(compiled.enclosure.outerD.length), center);
      const content = maximum(actual.parts.slice(0, -1).flatMap(part => rawProgram(part.d).points.map(point => radialSquared(point, center))));
      expect(cmp(outer.minimum, inner.maximum), 'actual positive wall').toBe(1);
      const minimumGap = mul(exact(24), exact(grid.ratios.clearanceMin));
      expect(hasGap(inner.minimum, content, minimumGap), 'actual materialized radial gap').toBe(true);
    }
  });

  it('refuses a real joint failure, the question internal-gap counterexample and binary64 collapse', () => {
    const name = 'plus-circle', glyph = createCompiledContentGlyph(name, inputs[name].source, inputs[name].contentVariation.outline);
    expect(glyph({ variation: { contentScale: 1.3 } }).provenance.kind).toBe('authored-variation');
    expect(glyph({ variation: { enclosureEmphasis: 2.2 } }).provenance.kind).toBe('authored-variation');
    expect(() => glyph({ variation: { contentScale: 1.3, enclosureEmphasis: 2.2 } }))
      .toThrow(expect.objectContaining({ code: 'VARIATION_OUTSIDE_DOMAIN' }));
    const question = createCompiledContentGlyph('question-circle', inputs['question-circle'].source, inputs['question-circle'].contentVariation.outline);
    expect(() => question({ variation: { contentScale: 1.25 / 0.681 } }))
      .toThrow(expect.objectContaining({ code: 'VARIATION_OUTSIDE_DOMAIN' }));
    for (const contentScale of [Number.MIN_VALUE, 1e-20]) expect(() => question({ variation: { contentScale } }))
      .toThrow(expect.objectContaining({ code: 'VARIATION_UNREPRESENTABLE' }));
    expect(() => question({ variation: { enclosureEmphasis: 100 } }))
      .toThrow(expect.objectContaining({ code: 'VARIATION_UNREPRESENTABLE' }));
  });

  it('keeps negative parameter, source-only and packet-admission failures precise', () => {
    const glyph = createCompiledContentGlyph('question-circle', inputs['question-circle'].source, inputs['question-circle'].contentVariation.outline);
    for (const variation of [null, [], { contentScale: 0 }, { contentScale: -1 }, { contentScale: NaN },
      { contentScale: Infinity }, { enclosureEmphasis: NaN }, { pivot: [0, 0] }, { opsz: 16 }, { [Symbol('unknown')]: 1 }]) {
      expect(() => glyph({ variation })).toThrow(expect.objectContaining({ code: 'INVALID_VARIATION' }));
    }
    expect(() => glyph({ modelMode: 'source-only', variation: { contentScale: 0.9 } }))
      .toThrow(expect.objectContaining({ code: 'AUTHOR_PARITY_REQUIRED' }));
    const packet = structuredClone(inputs['question-circle'].contentVariation.outline);
    packet.content.parts[0].points[0][0] += 0.2;
    expect(() => createCompiledContentGlyph('question-circle', inputs['question-circle'].source, packet))
      .toThrow(expect.objectContaining({ code: 'VARIATION_SOURCE_MISMATCH' }));
    const source = structuredClone(inputs['question-circle'].source); source.outline.composition = { kind: 'compound', fillRule: 'evenodd' };
    expect(() => createCompiledContentGlyph('question-circle', source, inputs['question-circle'].contentVariation.outline))
      .toThrow(expect.objectContaining({ code: 'VARIATION_SOURCE_MISMATCH' }));
  });

  it('does not admit unknown/non-Outline source semantics or a different pivot', () => {
    const name = 'question-circle', source = baseline.icons[name].outline, parts = contracts[`${name}/outline`].parts;
    const declaration = { ...spec.icons[name].outline.contentVariation, variant: 'outline', source: {
      fileKey: source.author.fileKey, version: source.author.version, masterSha256: source.author.masterSha256,
      pathFingerprintSha256: source.author.pathFingerprintSha256 } };
    expect(() => compileAuthorContentVariation(source, parts, { ...declaration, pivot: [11, 12] }, grid))
      .toThrow(expect.objectContaining({ code: 'LAW_UNSUPPORTED' }));
    expect(() => compileAuthorContentVariation(source, parts, { ...declaration, variant: 'filled' }, grid))
      .toThrow(expect.objectContaining({ code: 'AUTHOR_VARIATION_UNSUPPORTED' }));
    const without = structuredClone(spec); delete without.icons[name].outline.variation;
    expect(() => compileAuthorAnatomyWithEvidence(baseline, without, grid))
      .toThrow(expect.objectContaining({ code: 'LAW_UNSUPPORTED' }));
    expect(projectAuthorContentVariationRuntime(contentEvidence[`${name}/outline`])).toEqual(inputs[name].contentVariation.outline);
  });
});
