import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorStateGroups } from '../scripts/lib/author-state-groups.js';
import { normalizeFigmaSvg } from '../scripts/lib/figma-import.js';
import { buildSourceVariantContractFromSvg } from '../scripts/lib/icon-catalog.js';
import { symbolExportName } from '../scripts/lib/symbol-modules.js';
import { createGlyphCompiler } from '../src/ir/compiler.js';
import { assembleGlyphLayers, assembleGlyphFrame } from '../src/ir/svg-assembly.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = file => JSON.parse(readFileSync(new URL(file, new URL('..', import.meta.url)), 'utf8'));
const captured = read('semantics/author-state-groups.json');
const document = { ...captured, groups: Object.fromEntries(Object.entries(captured.groups)
  .filter(([, group]) => group.law === 'source.replace')) };
const groupNames = ['microphone', 'microphone-filled', 'microphone-presentation', 'microphone-presentation-filled',
  'plus-presentation', 'plus-presentation-filled', 'visibility', 'visibility-filled'];
const names = [...new Set(Object.values(document.groups).flatMap(group => Object.values(group.states).map(state => state.icon)))];
const manifest = read('semantics/figma-baseline.json');
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest,
  counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map(name => [name, manifest.icons[name]])),
} });
const sha256 = value => createHash('sha256').update(value).digest('hex');

// Oracle читает исходные теги, не production reader, compiler или serializer.
const rawPathTags = svg => [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => tag);
const rawPaths = svg => rawPathTags(svg).map(tag => ({
  d: /\bd="([^"]+)"/.exec(tag)[1],
  fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
}));
const rawFingerprint = svg => sha256(JSON.stringify(rawPaths(svg)
  .map(({ d, fillRule }, index) => ({ d, fillRule, index }))));
const attribute = (svg, name) => new RegExp(`\\b${name}="([^"]+)"`).exec(svg)?.[1];
const rawFrame = svg => ['viewBox', 'width', 'height'].map(name => attribute(svg, name));

function compilerFor(source) {
  return createGlyphCompiler({
    catalog: { canvas: { viewBox: [0, 0, 24, 24] }, axes: read('semantics/catalog.json').axes,
      icons: Object.fromEntries(Object.entries(source.icons).map(([icon, variants]) => [icon, {
        model: null,
        source: Object.fromEntries(Object.entries(variants).map(([variant, item]) => [variant, item.sourceContract])),
      }])),
    },
    anatomy: { version: 1, glyphs: {} }, grid: read('semantics/grid.json'),
    staticIcons: Object.fromEntries(Object.entries(source.icons).flatMap(([icon, variants]) =>
      Object.entries(variants).map(([variant, item]) => [symbolExportName(icon, variant), item.artifactSvg]))),
  });
}
const compiler = compilerFor(baseline);
const compile = (source = baseline, input = document, owner = source === baseline ? compiler : compilerFor(source)) =>
  compileAuthorStateGroups(source, input, { compiler: owner, assembleGlyphLayers, assembleGlyphFrame });
const oneGroup = name => ({ ...structuredClone(document), groups: { [name]: structuredClone(document.groups[name]) } });
const memberSource = (source, input, name, state) => {
  const member = input.groups[name].states[state];
  return source.icons[member.icon][member.variant];
};
function replaceRawPath(svg, index, mutate) {
  let position = 0;
  const result = svg.replace(/<path\b[^>]*>/g, tag => position++ === index ? mutate(tag) : tag);
  expect(position).toBeGreaterThan(index);
  expect(result).not.toBe(svg);
  return result;
}
function repin(source, input, name, state, mutate) {
  const member = input.groups[name].states[state];
  const item = memberSource(source, input, name, state);
  item.rawSvg = mutate(item.rawSvg);
  item.normalizedSvg = normalizeFigmaSvg(item.rawSvg);
  item.artifactSvg = item.normalizedSvg.replace(/^<svg\b/, '<svg fill="currentColor"');
  item.author.masterSha256 = member.masterSha256 = sha256(item.rawSvg);
  item.author.normalizedSha256 = sha256(item.normalizedSvg);
  item.author.pathFingerprintSha256 = member.pathFingerprintSha256 = rawFingerprint(item.rawSvg);
  item.sourceContract = buildSourceVariantContractFromSvg({ file: item.master,
    sourceSvg: item.normalizedSvg, artifactSvg: item.artifactSvg });
}
function assertRawProjection(payload, input, source, name) {
  const spec = input.groups[name];
  expect(payload).toMatchObject({ group: name, variant: Object.values(spec.states)[0].variant,
    defaultState: spec.defaultState, enclosurePartId: null, sharedPartIds: [], sharedSvg: '',
    proof: { law: 'source.replace', source: input.source },
  });
  expect(payload.states.map(state => state.id)).toEqual(Object.keys(spec.states).sort());
  for (const state of payload.states) {
    const item = memberSource(source, input, name, state.id);
    const expected = rawPaths(item.rawSvg);
    expect(rawPaths(state.contentSvg)).toEqual(expected);
    expect(state.contentPartIds).toEqual(spec.states[state.id].contentPartIds);
    expect(rawPathTags(state.contentSvg).map(tag => attribute(tag, 'data-part'))).toEqual(state.contentPartIds);
    expect(rawPathTags(state.contentSvg).map(tag => attribute(tag, 'fill'))).toEqual(expected.map(() => 'currentColor'));
    expect(rawFrame(payload.frame[0])).toEqual(rawFrame(item.rawSvg));
    expect(state.author.masterSha256).toBe(sha256(item.rawSvg));
    expect(state.author.pathFingerprintSha256).toBe(rawFingerprint(item.rawSvg));
    expect(state.staticSharedSvg).toBeUndefined();
  }
}

describe('source.replace: точный допуск авторских состояний', () => {
  it('предметный набор полный и не включает другие законы', () => {
    expect(Object.keys(document.groups).sort()).toEqual([...groupNames].sort());
    expect([...new Set(Object.values(document.groups).flatMap(group =>
      Object.values(group.states).map(state => state.icon)))].sort()).toEqual([...names].sort());
  });

  it.each(groupNames)('%s: реальные сохранённые masters проходят без выдуманной оболочки', name => {
    const input = oneGroup(name);
    for (const [state, member] of Object.entries(input.groups[name].states)) {
      const item = memberSource(baseline, input, name, state);
      const bytes = readFileSync(new URL(item.master, new URL('..', import.meta.url)));
      expect(sha256(bytes)).toBe(member.masterSha256);
      expect(rawFingerprint(bytes.toString('utf8'))).toBe(member.pathFingerprintSha256);
      expect(member.contentPartIds).toHaveLength(rawPaths(bytes.toString('utf8')).length);
    }
    assertRawProjection(compile(baseline, input)[name], input, baseline, name);
  });

  it('Filled eye с одним compound path сохраняет отверстие и полный исходный path', () => {
    const input = oneGroup('visibility-filled');
    const member = baseline.icons.eye.filled;
    expect(rawPaths(member.rawSvg)).toHaveLength(1);
    expect(rawPaths(member.rawSvg)[0].fillRule).toBe('evenodd');
    expect(rawPaths(member.rawSvg)[0].d.match(/M/g)).toHaveLength(2);
    assertRawProjection(compile(baseline, input)['visibility-filled'], input, baseline, 'visibility-filled');
  });

  it('смена defaultState не меняет source artwork или вводит общую часть', () => {
    const input = oneGroup('microphone');
    input.groups.microphone.defaultState = 'muted';
    assertRawProjection(compile(baseline, input).microphone, input, baseline, 'microphone');
  });

  it.each([
    ['оболочка', group => { group.enclosurePartId = 'invented-enclosure'; }],
    ['общая часть', group => { group.sharedParts = [{ id: 'invented-shared', role: 'content' }]; }],
    ['неизвестное поле группы', group => { group.axes = {}; }],
    ['пустые состояния', group => { group.states = {}; }],
    ['единственное состояние', group => { delete group.states.muted; }],
    ['отсутствующий defaultState', group => { group.defaultState = 'absent'; }],
    ['старый индекс пути', group => { group.states.unmuted.contentPathIndices = [0, 1]; }],
    ['неизвестное поле состояния', group => { group.states.unmuted.sharedPartIds = []; }],
    ['повтор member', group => { group.states.muted = { ...group.states.unmuted,
      contentPartIds: ['muted-a', 'muted-b'] }; }],
    ['повтор ID внутри state', group => { group.states.unmuted.contentPartIds[1] = 'unmuted-support'; }],
    ['повтор ID между states', group => { group.states.muted.contentPartIds[0] = 'unmuted-support'; }],
    ['ID группы state как content', group => { group.states.unmuted.contentPartIds[0] = 'state-muted'; }],
    ['нестроковый ID', group => { group.states.unmuted.contentPartIds[0] = null; }],
  ])('%s отвергается строгим source profile', (_, mutate) => {
    const input = oneGroup('microphone');
    mutate(input.groups.microphone);
    expect(() => compile(baseline, input)).toThrow(expect.objectContaining({ code: 'SPEC_INVALID' }));
  });

  it.each([
    ['потерянный путь', group => { group.states.unmuted.contentPartIds.pop(); }],
    ['лишний путь', group => { group.states.unmuted.contentPartIds.push('invented-path'); }],
    ['пустое покрытие', group => { group.states.unmuted.contentPartIds = []; }],
  ])('%s не проходит полное ordered покрытие', (_, mutate) => {
    const input = oneGroup('microphone');
    mutate(input.groups.microphone);
    expect(() => compile(baseline, input)).toThrow(expect.objectContaining({ code: 'TOPOLOGY_UNSUPPORTED' }));
  });

  it('Outline и Filled не смешиваются даже с настоящими receipts обоих masters', () => {
    const input = oneGroup('microphone');
    input.groups.microphone.states.unmuted = structuredClone(document.groups['microphone-filled'].states.unmuted);
    expect(() => compile(baseline, input)).toThrow(expect.objectContaining({ code: 'VARIANT_MISMATCH' }));
  });

  it.each([
    ['чужая версия', input => { input.source.version = '1'; }, 'SOURCE_MISMATCH'],
    ['подменённый master receipt', input => { input.groups.microphone.states.unmuted.masterSha256 = '0'.repeat(64); }, 'MASTER_MISMATCH'],
    ['подменённый fingerprint', input => { input.groups.microphone.states.unmuted.pathFingerprintSha256 = '0'.repeat(64); }, 'MASTER_MISMATCH'],
  ])('%s не подтверждается самим объявлением', (_, mutate, code) => {
    const input = oneGroup('microphone');
    mutate(input);
    expect(() => compile(baseline, input)).toThrow(expect.objectContaining({ code }));
  });

  it('изменённые raw bytes обнаруживаются при сохранённых верных receipts', () => {
    const source = structuredClone(baseline), input = oneGroup('microphone');
    const item = source.icons.mic.outline;
    item.rawSvg = item.rawSvg.replace('M19.1299', 'M19.1298');
    expect(sha256(item.rawSvg)).not.toBe(input.groups.microphone.states.unmuted.masterSha256);
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'MASTER_MISMATCH' }));
  });

  it('новый normalized fingerprint не связывает чужую геометрию с неизменённым raw master', () => {
    const source = structuredClone(baseline), input = oneGroup('microphone');
    const item = source.icons.mic.outline;
    item.normalizedSvg = item.normalizedSvg.replace('M19.1299', 'M19.1298');
    item.artifactSvg = item.normalizedSvg.replace(/^<svg\b/, '<svg fill="currentColor"');
    item.author.normalizedSha256 = sha256(item.normalizedSvg);
    item.author.pathFingerprintSha256 = input.groups.microphone.states.unmuted.pathFingerprintSha256 = rawFingerprint(item.normalizedSvg);
    item.sourceContract = buildSourceVariantContractFromSvg({ file: item.master,
      sourceSvg: item.normalizedSvg, artifactSvg: item.artifactSvg });
    expect(sha256(item.rawSvg)).toBe(input.groups.microphone.states.unmuted.masterSha256);
    expect(rawPaths(item.artifactSvg)).not.toEqual(rawPaths(item.rawSvg));
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'MASTER_MISMATCH' }));
  });

  it.each(['width', 'height'])('raw %s вне 24 px отвергается до source projection', dimension => {
    const source = structuredClone(baseline), input = oneGroup('microphone');
    const item = source.icons.mic.outline;
    item.rawSvg = item.rawSvg.replace(`${dimension}="24"`, `${dimension}="25"`);
    item.author.masterSha256 = input.groups.microphone.states.unmuted.masterSha256 = sha256(item.rawSvg);
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'SOURCE_UNSUPPORTED' }));
  });

  it.each(groupNames)('%s: implicit fill closure не считается явной авторской топологией', name => {
    const source = structuredClone(baseline), input = oneGroup(name);
    const state = input.groups[name].defaultState;
    repin(source, input, name, state, svg => replaceRawPath(svg, 0,
      tag => tag.replace(/\bd="([^"]+)"/, (_, d) => `d="${d.replaceAll('Z', '')}"`)));
    expect(rawPaths(memberSource(source, input, name, state).rawSvg)[0].d).not.toContain('Z');
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'TOPOLOGY_UNSUPPORTED' }));
  });

  it.each([
    ['геометрия', glyph => { glyph.parts[0].d += 'M0 0Z'; }],
    ['fill-rule', glyph => { glyph.parts[0].fillRule = glyph.parts[0].fillRule === 'evenodd' ? 'nonzero' : 'evenodd'; }],
    ['stroke paint', glyph => { glyph.parts[0].paint = { kind: 'stroke', strokeWidth: 1, linecap: 'round', linejoin: 'round' }; }],
    ['literal fill paint', glyph => { glyph.parts[0].paint.fill = '#ff00ff'; }],
    ['порядок geometry с новыми zIndex', glyph => { glyph.parts.reverse(); glyph.parts.forEach((part, index) => { part.zIndex = index; }); }],
    ['потерянная часть', glyph => { glyph.parts.pop(); }],
    ['zIndex', glyph => { glyph.parts[0].zIndex = 1; }],
    ['viewBox', glyph => { glyph.viewBox[2] = 25; }],
    ['composition', glyph => { glyph.composition = { kind: 'compound', fillRule: 'nonzero' }; }],
    ['source provenance', glyph => { glyph.provenance.kind = 'model'; }],
    ['master path', glyph => { glyph.provenance.file = 'foreign.svg'; }],
    ['icon identity', glyph => { glyph.icon = 'eye'; }],
    ['variant identity', glyph => { glyph.variant = 'filled'; }],
  ])('подмена compiler: %s получает точный отказ', (_, mutate) => {
    const input = oneGroup('microphone');
    const owner = { glyph(request) {
      const output = structuredClone(compiler.glyph(request));
      if (request.icon === 'mic') mutate(output);
      return output;
    } };
    expect(() => compile(baseline, input, owner)).toThrow(expect.objectContaining({ code: 'COMPILER_MISMATCH' }));
  });

  it.each(groupNames)('%s: общая whole path в разных позициях требует shared anatomy', name => {
    const source = structuredClone(baseline), input = oneGroup(name);
    const [firstState, secondState] = Object.keys(input.groups[name].states);
    const first = memberSource(source, input, name, firstState);
    const second = memberSource(source, input, name, secondState);
    const copied = rawPathTags(first.rawSvg)[0];
    const lastIndex = rawPaths(second.rawSvg).length - 1;
    repin(source, input, name, secondState, svg => replaceRawPath(svg, lastIndex, () => copied));
    expect(rawPaths(memberSource(source, input, name, secondState).rawSvg)[lastIndex]).toEqual(rawPaths(first.rawSvg)[0]);
    expect(() => compile(source, input)).toThrow(expect.objectContaining({ code: 'SHARED_PART_UNDECLARED' }));
  });

  it('та же compound geometry с другим fill-rule остаётся допустимым различным artwork', () => {
    const source = structuredClone(baseline), input = oneGroup('microphone');
    const original = rawPathTags(source.icons.mic.outline.rawSvg)[1];
    expect(rawPaths(source.icons.mic.outline.rawSvg)[1].fillRule).toBe('evenodd');
    expect(rawPaths(source.icons.mic.outline.rawSvg)[1].d.match(/M/g)).toHaveLength(2);
    const differentPaint = original.replaceAll('rule="evenodd"', 'rule="nonzero"');
    repin(source, input, 'microphone', 'muted', svg => replaceRawPath(svg, 4, () => differentPaint));
    const left = rawPaths(source.icons.mic.outline.rawSvg)[1];
    const right = rawPaths(source.icons['mic-off'].outline.rawSvg)[4];
    expect(right.d).toBe(left.d);
    expect(right.fillRule).not.toBe(left.fillRule);
    assertRawProjection(compile(source, input).microphone, input, source, 'microphone');
  });

  it('авторский повтор внутри одного state сохраняется с различными part IDs', () => {
    const source = structuredClone(baseline), input = oneGroup('microphone');
    const copied = rawPathTags(source.icons.mic.outline.rawSvg)[0];
    repin(source, input, 'microphone', 'unmuted', svg => replaceRawPath(svg, 1, () => copied));
    const paths = rawPaths(source.icons.mic.outline.rawSvg);
    expect(paths[0]).toEqual(paths[1]);
    assertRawProjection(compile(source, input).microphone, input, source, 'microphone');
  });
});
