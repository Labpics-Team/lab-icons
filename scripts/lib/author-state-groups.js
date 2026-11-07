import { createHash } from 'node:crypto';
import { compactDataLiteral, compactGeneratedModule, jsonDataLiteral, literalKey } from './generated-module.js';
import { authorPathEntries, sourcePathEntries } from '../../src/core/icon-geometry.js';
import { exactClosedFillPathKey } from './exact-closed-fill-path.js';
import { normalizeFigmaSvg } from './figma-import.js';
import { compileAuthorContourStateGroup, renderContourStateGroupModule, contourStateGroupDeclaration } from './author-contour-states.js';

const NAME = /^[a-z][a-z0-9-]*$/;
const HASH = /^[a-f0-9]{64}$/;
const STATE_RUNTIME_TARGETS = {
  'enclosure.replace': { entry: 'src/states/runtime.ts', runtime: 'state-runtime.js',
    define: { __LAB_ICONS_REPLACEMENT_KIND__: '"enclosure-replacement"' } },
  'source.replace': { entry: 'src/states/source-runtime.ts', runtime: 'source-state-runtime.js',
    define: { __LAB_ICONS_REPLACEMENT_KIND__: '"source-replacement"' } },
};
const sha256 = value => createHash('sha256').update(value).digest('hex');
const stableJSON = value => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

export class AuthorStateGroupError extends Error {
  constructor(code, message) {
    super(`author-state-groups: ${message}`);
    this.name = 'AuthorStateGroupError';
    this.code = code;
  }
}
const refuse = (code, message) => { throw new AuthorStateGroupError(code, message); };
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) &&
  Object.getPrototypeOf(value) === Object.prototype;
function fields(value, keys, label) {
  if (!record(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) {
    refuse('SPEC_INVALID', `${label}: требуются только поля ${keys.join(', ')}`);
  }
}
function freezeTree(value) {
  if (value && typeof value === 'object') {
    for (const child of Object.values(value)) freezeTree(child);
    Object.freeze(value);
  }
  return value;
}

function sameFillPart(left, right) {
  const { d: a, ...leftContract } = left;
  const { d: b, ...rightContract } = right;
  if (stableJSON(leftContract) !== stableJSON(rightContract)) return false;
  if (a === b) return true;
  const key = exactClosedFillPathKey(a, left.fillRule);
  return key !== null && key === exactClosedFillPathKey(b, right.fillRule);
}
const fillPart = part => ({ d: part.d, fillRule: part.fillRule, paint: part.paint });

// source.replace меняет целый рисунок: адресуемые counter contours сохраняют
// одного evenodd fill owner. Их нельзя принимать за самостоятельные layer paths.
function sourceArtworkParts(glyph, entries, sourceReplacement, author, label) {
  if (glyph.composition.kind === 'layers') return glyph.parts;
  if (!sourceReplacement || glyph.composition.kind !== 'compound' ||
      glyph.composition.fillRule !== 'evenodd' || entries.length !== 1 || entries[0].fillRule !== 'evenodd' ||
      glyph.parts.length < 2 || glyph.parts.map(part => part.d).join('') !== entries[0].d || glyph.d !== entries[0].d ||
      glyph.provenance.anatomy?.masterSha256 !== author.masterSha256 ||
      glyph.provenance.anatomy?.pathFingerprintSha256 !== author.pathFingerprintSha256 ||
      glyph.parts.some((part, index) => part.zIndex !== index || part.fillRule !== null ||
        part.paint.kind !== 'fill' || part.paint.fill !== 'currentColor' ||
        part.role !== (index === 0 ? 'container' : 'counter') ||
        !/^[\t\n\r ]*M/.test(part.d) || part.topologySignature.includes('|') || !part.topologySignature.endsWith('Z') ||
        part.provenance.kind !== 'source' || part.provenance.file !== glyph.provenance.file)) {
    refuse('COMPILER_MISMATCH', `${label}: compound не сохраняет полный ordered source fill`);
  }
  return [{ ...glyph.parts[0], d: glyph.d, fillRule: glyph.composition.fillRule, zIndex: 0,
    topologySignature: glyph.parts.map(part => part.topologySignature).join('|') }];
}

/** Имена release-проекции выводятся из spec, не из параллельного списка. */
export function authorStateGroupNames(document) {
  fields(document, ['schemaVersion', 'source', 'groups'], 'document');
  fields(document.source, ['fileKey', 'version'], 'source');
  if (document.schemaVersion !== 2 || !record(document.groups) ||
      typeof document.source.fileKey !== 'string' || !/^[A-Za-z0-9]+$/.test(document.source.fileKey) ||
      typeof document.source.version !== 'string' || !/^\d+$/.test(document.source.version)) {
    refuse('SPEC_INVALID', 'нужен versioned документ с Figma source');
  }
  const names = Object.keys(document.groups).sort();
  if (names.some(name => !NAME.test(name))) refuse('SPEC_INVALID', 'невалидное имя группы');
  return names;
}

export function authorStateLawNames(document) {
  return [...new Set(authorStateGroupNames(document).map(name => document.groups[name]?.law))].sort();
}

/** Только новый opt-in загружает свой admission, структура перехода остаётся общей. */
export function stateRuntimeTargets(laws) {
  if (!Array.isArray(laws) || laws.some(law => law !== 'dots.orient' && !Object.hasOwn(STATE_RUNTIME_TARGETS, law))) {
    throw new TypeError('author state: law не имеет runtime target');
  }
  return [...new Set(laws)].filter(law => law !== 'dots.orient').sort()
    .map(law => ({ ...STATE_RUNTIME_TARGETS[law], define: { ...STATE_RUNTIME_TARGETS[law].define } }));
}

/** Target compiler фиксирует только kind; runtime admission и execution общие. */
export function stateRuntimeBuildOptions(entry) {
  const target = Object.values(STATE_RUNTIME_TARGETS).find(item => item.entry === entry);
  return target ? { define: { ...target.define } } : {};
}

/**
 * Оболочка сохраняет равный ordered suffix; source.replace меняет полный рисунок.
 * Все контуры проверяются до выдачи данных. Serializer и glyph compiler передаются
 * от production build; runtime не читает SVG и не доказывает correspondence заново.
 */
export function compileAuthorStateGroups(baseline, document, { compiler, grid, assembleGlyphLayers, assembleGlyphFrame }) {
  const names = authorStateGroupNames(document);
  if (baseline?.source?.fileKey !== document.source.fileKey || baseline.source.version !== document.source.version) {
    refuse('SOURCE_MISMATCH', 'группа относится к другому файлу или версии Figma');
  }
  const output = {};
  for (const name of names) {
    const group = document.groups[name];
    if (group?.law === 'dots.orient') {
      output[name] = compileAuthorContourStateGroup(baseline, name, group, { compiler, grid, document });
      continue;
    }
    const sourceReplacement = group?.law === 'source.replace';
    fields(group, sourceReplacement ? ['law', 'defaultState', 'sharedParts', 'states']
      : ['law', 'defaultState', 'enclosurePartId', 'sharedParts', 'states'], name);
    if (!sourceReplacement && group.law !== 'enclosure.replace') refuse('LAW_UNSUPPORTED', `${name}: неизвестный закон`);
    if ((!sourceReplacement && (typeof group.enclosurePartId !== 'string' || !NAME.test(group.enclosurePartId))) ||
        typeof group.defaultState !== 'string' || !NAME.test(group.defaultState) || !record(group.states) ||
        Object.keys(group.states).length < 2 || !Object.hasOwn(group.states, group.defaultState) ||
        !Array.isArray(group.sharedParts) || (sourceReplacement ? group.sharedParts.length !== 0 : group.sharedParts.length === 0)) {
      refuse('SPEC_INVALID', `${name}: нужны именованные состояния и объявленная начальная поза`);
    }
    const stateNames = Object.keys(group.states).sort();
    const partIds = new Set();
    for (const [index, part] of group.sharedParts.entries()) {
      fields(part, ['id', 'role'], `${name}.sharedParts[${index}]`);
      if (typeof part.id !== 'string' || !NAME.test(part.id) || partIds.has(part.id) ||
          part.role !== (index === group.sharedParts.length - 1 ? 'container' : 'content')) {
        refuse('SPEC_INVALID', `${name}: общие part IDs уникальны, последняя часть — container`);
      }
      partIds.add(part.id);
    }
    if (!sourceReplacement && group.sharedParts.at(-1).id !== group.enclosurePartId) {
      refuse('SPEC_INVALID', `${name}: enclosurePartId обязан называть последнюю общую часть`);
    }
    const members = new Set();
    const states = [];
    let reference;
    let referenceShared;
    let referenceEnclosure;
    let sharedSvg;
    let enclosureIdentity;
    let frame;
    let variant;
    const prefixArtwork = new Map();
    const staticSharedByState = new Map();
    for (const state of stateNames) {
      const member = group.states[state];
      fields(member, ['icon', 'variant', 'masterSha256', 'pathFingerprintSha256', 'contentPartIds'], `${name}.${state}`);
      if (!NAME.test(state) || typeof member.icon !== 'string' || !NAME.test(member.icon) ||
          !['outline', 'filled'].includes(member.variant) ||
          typeof member.masterSha256 !== 'string' || !HASH.test(member.masterSha256) ||
          typeof member.pathFingerprintSha256 !== 'string' || !HASH.test(member.pathFingerprintSha256) ||
          members.has(`${member.icon}/${member.variant}`)) {
        refuse('SPEC_INVALID', `${name}.${state}: невалидный или повторённый member`);
      }
      members.add(`${member.icon}/${member.variant}`);
      const source = baseline.icons?.[member.icon]?.[member.variant];
      if (!source || source.author?.fileKey !== document.source.fileKey || source.author.version !== document.source.version ||
          typeof source.rawSvg !== 'string' || typeof source.normalizedSvg !== 'string' || typeof source.artifactSvg !== 'string' ||
          source.author.masterSha256 !== member.masterSha256 ||
          source.author.pathFingerprintSha256 !== member.pathFingerprintSha256 ||
          sha256(source.rawSvg) !== member.masterSha256 || sha256(source.normalizedSvg) !== source.author.normalizedSha256 ||
          source.normalizedSvg.replace(/^<svg\b/, '<svg fill="currentColor"') !== source.artifactSvg) {
        refuse('MASTER_MISMATCH', `${name}.${state}: источник не совпал с закреплённым master`);
      }
      let entries;
      try {
        if (normalizeFigmaSvg(source.rawSvg, { source: source.master }) !== source.normalizedSvg) {
          refuse('MASTER_MISMATCH', `${name}.${state}: normalized geometry не происходит из закреплённого raw master`);
        }
        if (sha256(stableJSON(authorPathEntries(source.normalizedSvg))) !== member.pathFingerprintSha256) {
          refuse('MASTER_MISMATCH', `${name}.${state}: path fingerprint не совпал`);
        }
        entries = sourcePathEntries(source.artifactSvg);
      } catch (error) {
        if (error instanceof AuthorStateGroupError) throw error;
        refuse('SOURCE_UNSUPPORTED', `${name}.${state}: paint/geometry вне поддержанного source-языка`);
      }
      // Prefix и suffix полностью покрывают авторский порядок; индекс не хранится повторно.
      if (!Array.isArray(member.contentPartIds) || member.contentPartIds.length === 0 ||
          member.contentPartIds.length + group.sharedParts.length !== entries.length) {
        refuse('TOPOLOGY_UNSUPPORTED', `${name}.${state}: нужны непустой prefix и полный общий suffix`);
      }
      const groupPartId = `state-${state}`;
      for (const id of [groupPartId, ...member.contentPartIds]) {
        if (typeof id !== 'string' || !NAME.test(id) || partIds.has(id)) refuse('SPEC_INVALID', `${name}.${state}: part IDs обязаны быть уникальны`);
        partIds.add(id);
      }
      const glyph = compiler.glyph({ icon: member.icon, variant: member.variant, modelMode: 'source-only' });
      const artworkParts = sourceArtworkParts(glyph, entries, sourceReplacement, source.author, `${name}.${state}`);
      if (glyph.icon !== member.icon || glyph.variant !== member.variant ||
          glyph.provenance.kind !== 'source' || glyph.provenance.file !== source.master ||
          artworkParts.length !== entries.length ||
          artworkParts.some((part, index) => part.d !== entries[index].d || part.fillRule !== entries[index].fillRule ||
            part.paint.kind !== 'fill' || part.paint.fill !== 'currentColor' || part.zIndex !== index)) {
        refuse('COMPILER_MISMATCH', `${name}.${state}: production glyph изменил ordered geometry/paint`);
      }
      if (glyph.parts.some(part => part.topologySignature.split('|').some(contour => !contour.endsWith('Z')))) {
        refuse('TOPOLOGY_UNSUPPORTED', `${name}.${state}: закон требует явно замкнутые авторские контуры`);
      }
      // Закрытый source-язык уже проверил literal dimensions и viewBox24.
      if (JSON.stringify(glyph.viewBox) !== '[0,0,24,24]') refuse('COMPILER_MISMATCH', `${name}.${state}: viewBox изменился`);
      if (variant !== undefined && member.variant !== variant) refuse(sourceReplacement ? 'VARIANT_MISMATCH' : 'ENCLOSURE_MISMATCH', `${name}: нельзя смешивать начертания`);
      variant = member.variant;
      const enclosure = artworkParts.at(-1);
      const enclosureContract = sourceReplacement ? null : { ...fillPart(enclosure),
        viewBox: glyph.viewBox, dimensions: [24, 24], placement: 'after-content' };
      if (!sourceReplacement && referenceEnclosure !== undefined && !sameFillPart(enclosureContract, referenceEnclosure)) {
        refuse('ENCLOSURE_MISMATCH', `${name}.${state}: оболочка/paint/рамка не равна`);
      }
      const shared = artworkParts.slice(member.contentPartIds.length)
        .map((part, index) => ({ ...part, ...group.sharedParts[index] }));
      const identity = stableJSON({ parts: shared.map(part => ({ id: part.id, role: part.role,
        d: part.d, fillRule: part.fillRule, paint: part.paint })),
      viewBox: glyph.viewBox, dimensions: [24, 24], placement: 'after-content' });
      const sharedContract = shared.map(part => ({ id: part.id, role: part.role, ...fillPart(part) }));
      if (referenceShared !== undefined && sharedContract.some((part, index) => !sameFillPart(part, referenceShared[index]))) {
        refuse('SHARED_PART_MISMATCH', `${name}.${state}: ordered geometry/paint общих частей не равны`);
      }
      if (referenceShared === undefined) {
        referenceShared = sharedContract;
        referenceEnclosure = enclosureContract;
      }
      const staticSharedSvg = assembleGlyphLayers(shared);
      staticSharedByState.set(state, staticSharedSvg);
      if (state === group.defaultState) {
        reference = identity;
        enclosureIdentity = stableJSON(enclosureContract);
        sharedSvg = staticSharedSvg;
        frame = assembleGlyphFrame(glyph.viewBox, [24, 24]);
      }
      const content = artworkParts.slice(0, member.contentPartIds.length)
        .map((part, index) => ({ ...part, id: member.contentPartIds[index], role: 'content' }));
      for (const part of content) {
        const current = fillPart(part);
        const { d, ...paint } = current;
        const key = exactClosedFillPathKey(d, current.fillRule);
        if (key === null) {
          refuse('TOPOLOGY_UNSUPPORTED', `${name}.${state}: prefix ${part.id} вне поддержанного точного closed fill-языка`);
        }
        // Индекс охватывает все позиции и пары states; число проверок не растёт
        // квадратично с числом независимых prefix parts. Допуск решает sameFillPart.
        const identity = stableJSON({ ...paint, geometry: { exact: key } });
        const previous = prefixArtwork.get(identity);
        if (previous && previous.state !== state && sameFillPart(current, previous.part)) {
          refuse('SHARED_PART_UNDECLARED', `${name}.${state}: общий рисунок prefix с ${previous.state} требует объявленной shared anatomy`);
        }
        // Authored multiplicity внутри одной opacity-группы сохраняется.
        if (!previous) prefixArtwork.set(identity, { state, part: current });
      }
      states.push({ id: state, partId: groupPartId, icon: member.icon,
        contentSvg: assembleGlyphLayers(content), contentPartIds: [...member.contentPartIds], author: { ...source.author } });
    }
    for (const state of states) {
      const staticSharedSvg = staticSharedByState.get(state.id);
      if (staticSharedSvg !== sharedSvg) state.staticSharedSvg = staticSharedSvg;
    }
    output[name] = {
      schemaVersion: 2, group: name, variant, defaultState: group.defaultState,
      frame, sharedSvg, sharedPartIds: group.sharedParts.map(part => part.id), enclosurePartId: sourceReplacement ? null : group.enclosurePartId, states,
      proof: { law: group.law, source: { ...document.source }, enclosureSha256: sourceReplacement ? null : sha256(enclosureIdentity),
        sharedPartsSha256: sha256(reference),
        specSha256: sha256(stableJSON({ schemaVersion: document.schemaVersion, source: document.source, name, group })) },
    };
  }
  return freezeTree(output);
}

/** Конечный module хранит общие части один раз и не импортирует geometry/authoring. */
export function renderStateGroupModule(payload) {
  if (payload?.kind === 'contour-interpolation') return renderContourStateGroupModule(payload);
  if (typeof payload?.group !== 'string' || !NAME.test(payload.group)) refuse('SPEC_INVALID', 'невалидный compiled group');
  if (!Array.isArray(payload.states) || !payload.states.length || payload.states.some(state =>
    typeof state?.id !== 'string' || !NAME.test(state.id) ||
    typeof state?.partId !== 'string' || !NAME.test(state.partId) || typeof state?.contentSvg !== 'string' ||
    (state.staticSharedSvg !== undefined && typeof state.staticSharedSvg !== 'string'))) {
    refuse('SPEC_INVALID', 'state projection требует объявленные IDs, SVG и строковый optional override');
  }
  if (typeof payload.defaultState !== 'string' || !payload.states.some(state => state.id === payload.defaultState)) {
    refuse('SPEC_INVALID', 'defaultState обязан принадлежать compiled states');
  }
  const sourceReplacement = payload.proof?.law === 'source.replace';
  if (sourceReplacement && (payload.enclosurePartId !== null || payload.sharedSvg !== '' ||
      !Array.isArray(payload.sharedPartIds) || payload.sharedPartIds.length !== 0 ||
      payload.states.some(state => state.staticSharedSvg !== undefined))) {
    refuse('SPEC_INVALID', 'source.replace не обещает общую геометрию или оболочку');
  }
  const identity = { group: payload.group, variant: payload.variant };
  const runtime = { ...identity, defaultState: payload.defaultState,
    frame: payload.frame, sharedSvg: payload.sharedSvg, sharedPartIds: payload.sharedPartIds,
    states: payload.states.map(({ id, partId, contentSvg, staticSharedSvg }) =>
      staticSharedSvg === undefined ? [id, partId, contentSvg] : [id, partId, contentSvg, staticSharedSvg]) };
  const capabilities = { ...identity, defaultState: payload.defaultState,
    enclosurePartId: payload.enclosurePartId, sharedPartIds: payload.sharedPartIds,
    states: payload.states.map(({ contentSvg: _, staticSharedSvg: _static, ...state }) => state),
    proof: payload.proof };
  const emit = compact => {
    const serialize = compact ? compactDataLiteral : jsonDataLiteral;
    const record = value => `{${Object.entries(value).flatMap(([key, value]) => {
      const encoded = key === 'sharedPartIds' ? 'p' : serialize(value);
      return encoded === undefined ? [] : [`${literalKey(key, compact)}:${encoded}`];
    }).join(',')}}`;
    return [
    `import{createCompiledStateRuntime as r,createCompiledStateCapabilities as c}from'../ir/${sourceReplacement ? 'source-state-runtime' : 'state-runtime'}.js';`,
    `const p=${serialize(payload.sharedPartIds)};`,
    `const g=/* @__PURE__ */r(${record(runtime)});`,
    `export const stateCapabilities=/* @__PURE__ */c(${record(capabilities)});`,
    'export function render(s,o){return g.render(s,o)}',
    'export function renderStateSvg(s,o){return g.renderStateSvg(s,o)}',
    'export function compileStateEffect(s,o){return g.compileStateEffect(s,o)}',
    'export function exportStateTransition(s,o){return g.exportStateTransition(s,o)}',
    '',
  ].join('\n');
  };
  return compactGeneratedModule([emit(false), emit(true)]);
}

export function stateGroupDeclaration(document, name) {
  if (!authorStateGroupNames(document).includes(name)) refuse('SPEC_INVALID', 'неизвестная группа');
  if (document.groups[name].law === 'dots.orient') return contourStateGroupDeclaration(document, name);
  const states = Object.keys(document.groups[name].states).sort();
  const sourceReplacement = document.groups[name].law === 'source.replace';
  const result = sourceReplacement ? 'SourceStateEffectResult' : 'StateEffectResult';
  const capabilities = sourceReplacement ? 'SourceStateGroupCapabilities' : 'StateGroupCapabilities';
  const variant = JSON.stringify(Object.values(document.groups[name].states)[0].variant);
  const request = sourceReplacement ? `SourceStateRenderRequest<${variant}>` : 'StateRenderRequest';
  const effectRequest = sourceReplacement ? `SourceStateEffectRequest<${variant}>` : 'StateEffectRequest';
  const exportRequest = sourceReplacement ? `SourceStateTransitionExportRequest<${variant}>` : 'StateTransitionExportRequest';
  const effectResult = sourceReplacement ? `${result}<${variant}>` : result;
  return [
    `import type { ${sourceReplacement ? 'Source' : ''}StateRenderRequest, ${sourceReplacement ? 'Source' : ''}StateEffectRequest, ${sourceReplacement ? 'Source' : ''}StateTransitionExportRequest, StateSvgResult, ${result}, ${capabilities} } from '../ir/${sourceReplacement ? 'source-state-types' : 'state-types'}.js';`,
    `export type State = ${states.map(state => JSON.stringify(state)).join(' | ')};`,
    `export declare function render(state?: State, options?: ${request}): StateSvgResult;`,
    `export declare function renderStateSvg(state?: State, options?: ${request}): StateSvgResult;`,
    `export declare function compileStateEffect(state: State, request: ${effectRequest}): ${effectResult};`,
    `export declare function exportStateTransition(state: State, request: ${exportRequest}): ${effectResult};`,
    `export declare function stateCapabilities(): ${capabilities}<State${sourceReplacement ? ', ' + variant : ''}>;`,
    '',
  ].join('\n');
}
