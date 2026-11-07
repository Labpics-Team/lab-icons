import { createHash } from 'node:crypto';
import { sourcePathEntries } from '../../src/core/icon-geometry.js';
import { authorStateGroupNames } from './author-state-groups.js';
import { projectAuthorAnnulusRuntime } from './author-annulus.js';
import { compactDataLiteral, compactGeneratedModule, jsonDataLiteral } from './generated-module.js';

const NAME = /^[a-z][a-z0-9-]*$/;
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const equal = (left, right) => stableJSON(left) === stableJSON(right);

export class AuthorStateVariationError extends Error {
  constructor(code, message) {
    super(`author-state-variations: ${message}`); this.name = 'AuthorStateVariationError'; this.code = code;
  }
}
const refuse = (code, message) => { throw new AuthorStateVariationError(code, message); };
function freezeTree(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freezeTree); Object.freeze(value); }
  return value;
}

/** Release-кандидаты выводятся из двух существующих деклараций, без списка групп. */
export function authorStateVariationGroupNames(states, anatomy) {
  const names = authorStateGroupNames(states);
  if (!anatomy?.icons || !equal(states.source, anatomy.source)) {
    refuse('SOURCE_MISMATCH', 'State и anatomy требуют один файл и saved version.');
  }
  return names.filter(name => {
    const group = states.groups[name];
    return group.law === 'enclosure.replace' && Object.values(group.states).length >= 2 &&
      Object.values(group.states).every(member => {
        const declaration = anatomy.icons[member.icon]?.[member.variant], variation = declaration?.variation;
        return member.variant === 'outline' && variation?.law === 'annulus.counter-scale' &&
          variation.parameter === 'enclosureEmphasis' && typeof variation.enclosurePartId === 'string' &&
          declaration.masterSha256 === member.masterSha256 && declaration.pathFingerprintSha256 === member.pathFingerprintSha256;
      });
  });
}

/**
 * Композиция уже принятых laws. Геометрический admission остаётся у annulus owner;
 * state compiler отвечает за общее обрамление, его ID и полный набор состояний.
 */
export function compileAuthorStateVariations(groups, baseline, states, anatomy, { contracts, evidence }, grid) {
  const names = authorStateVariationGroupNames(states, anatomy);
  if (!equal(baseline?.source && { fileKey: baseline.source.fileKey, version: baseline.source.version }, states.source)) {
    refuse('SOURCE_MISMATCH', 'Baseline не соответствует state source.');
  }
  const gridSha256 = sha256(stableJSON(grid));
  const output = {};
  for (const name of names) {
    const spec = states.groups[name], group = groups[name];
    const stateNames = Object.keys(spec.states).sort();
    const stateSpecSha256 = sha256(stableJSON({ schemaVersion: states.schemaVersion, source: states.source, name, group: spec }));
    if (group?.schemaVersion !== 2 || group.group !== name || group.variant !== 'outline' || group.defaultState !== spec.defaultState ||
        group.enclosurePartId !== spec.enclosurePartId || !equal(group.sharedPartIds, spec.sharedParts.map(part => part.id)) ||
        !equal(group.states?.map(state => state.id), stateNames) || !equal(group.proof?.source, states.source) ||
        group.proof?.law !== 'enclosure.replace' || group.proof.specSha256 !== stateSpecSha256) {
      refuse('GROUP_SOURCE_MISMATCH', `${name}: нужен compiled state contract этой декларации.`);
    }
    let sharedEntries;
    try {
      // Build target добавляет адресацию; source reader проверяет только artwork.
      const artwork = group.sharedSvg.replace(/\sdata-(?:part|role)="[^"]*"/g, '');
      sharedEntries = sourcePathEntries(group.frame[0] + artwork + group.frame[1]);
    } catch (error) { refuse('GROUP_GEOMETRY_MISMATCH', `${name}: shared artwork вне принятого source-языка (${error.message}).`); }
    if (sharedEntries.length !== spec.sharedParts.length) refuse('GROUP_GEOMETRY_MISMATCH', `${name}: shared suffix изменился.`);
    const defaultD = sharedEntries.at(-1).d;
    let referenceGeometry, referencePolicy;
    let minimum = -Infinity, maximum = Infinity;
    const members = [];
    for (const state of stateNames) {
      const member = spec.states[state], source = baseline.icons?.[member.icon]?.outline;
      const label = `${member.icon}/outline`, contract = contracts[label], proof = evidence[label];
      const groupMember = group.states.find(item => item.id === state);
      if (!source || !contract?.variation || !proof || !equal(groupMember?.author, source.author) ||
          groupMember.icon !== member.icon || !equal(groupMember.contentPartIds, member.contentPartIds) ||
          proof.version !== 1 || proof.law !== 'annulus.counter-scale' || proof.variant !== 'outline' ||
          !equal(proof.source, source.author) || proof.source.masterSha256 !== member.masterSha256 ||
          proof.source.pathFingerprintSha256 !== member.pathFingerprintSha256 ||
          proof.defaults.rawSvg !== source.rawSvg || proof.defaults.artifactSvg !== source.artifactSvg ||
          sha256(source.rawSvg) !== member.masterSha256) {
        refuse('ANNULUS_SOURCE_MISMATCH', `${name}.${state}: нужны source и принятый annulus того же master.`);
      }
      const { geometrySha256, ...originalProof } = proof;
      if (geometrySha256 !== sha256(stableJSON(originalProof)) ||
          !equal(contract.variation, projectAuthorAnnulusRuntime(proof))) {
        refuse('ANNULUS_SOURCE_MISMATCH', `${name}.${state}: runtime packet не соответствует full proof.`);
      }
      const { enclosure, domain } = contract.variation;
      const sourcePart = proof.defaults.parts[enclosure.index];
      if (enclosure.index !== contract.parts.length - 1 || !sourcePart || sourcePart.d !== defaultD ||
          sourcePart.id !== enclosure.id || sourcePart.role !== 'container' || sourcePart.fillRule !== sharedEntries.at(-1).fillRule ||
          !equal(contract.parts.map(part => part.id), contract.variation.partIds) ||
          !equal(proof.viewBox, [0, 0, 24, 24]) ||
          groupMember.staticSharedSvg !== undefined && groupMember.staticSharedSvg !== group.sharedSvg) {
        refuse('GROUP_GEOMETRY_MISMATCH', `${name}.${state}: обрамление/paint/placement отличается от общей части.`);
      }
      const geometry = { outerD: enclosure.outerD, innerPoints: enclosure.innerPoints, center: enclosure.center,
        outerRadius: enclosure.outerRadius, referenceInnerRadius: enclosure.referenceInnerRadius, referenceThickness: enclosure.referenceThickness };
      if (referenceGeometry && !equal(referenceGeometry, geometry)) {
        refuse('GROUP_GEOMETRY_MISMATCH', `${name}.${state}: calibrated operands различаются.`);
      }
      referenceGeometry ??= geometry;
      const policy = proof.domain.policy;
      if (!policy || policy.gridSha256 !== gridSha256 || policy.gridVersion !== grid.version ||
          referencePolicy && !equal(referencePolicy, policy)) {
        refuse('POLICY_MISMATCH', `${name}.${state}: members требуют одной текущей grid policy.`);
      }
      referencePolicy ??= policy;
      if (domain.kind !== 'radial-bernstein' || domain.parameter !== 'enclosureEmphasis' ||
          domain.evaluated !== 'actual-binary64-scale' || domain.scale.minimumInclusive !== true || domain.scale.maximumInclusive !== false ||
          !Number.isFinite(domain.scale.minimum) || !Number.isFinite(domain.scale.maximum) ||
          domain.scale.minimum <= 0 || domain.scale.minimum > 1 || domain.scale.maximum <= 1) {
        refuse('DOMAIN_UNSUPPORTED', `${name}.${state}: нет непрерывного допуска с authored default.`);
      }
      minimum = Math.max(minimum, domain.scale.minimum); maximum = Math.min(maximum, domain.scale.maximum);
      members.push({ state, icon: member.icon, sourceEnclosurePartId: enclosure.id, geometrySha256, author: source.author });
    }
    if (!(minimum <= 1 && maximum > 1)) refuse('DOMAIN_UNSUPPORTED', `${name}: intersection не сохраняет default.`);
    const domain = { kind: 'radial-bernstein', parameter: 'enclosureEmphasis', evaluated: 'actual-binary64-scale',
      scale: { minimum, minimumInclusive: true, maximum, maximumInclusive: false } };
    const runtime = { group: name, variant: 'outline', partId: group.enclosurePartId, defaultD,
      enclosure: referenceGeometry, domain };
    const proof = { stateSpecSha256, sharedPartsSha256: group.proof.sharedPartsSha256, gridSha256,
      source: states.source, members };
    const capabilities = { version: 1, group: name, variant: 'outline', law: 'annulus.counter-scale',
      partId: group.enclosurePartId, defaults: { enclosureEmphasis: 1 }, domain,
      targets: { svg: 'supported', webEffect: 'existing-state-transitions', lottie: 'not-exported', sfSymbols: 'not-exported' },
      proof: { geometrySha256: sha256(stableJSON({ runtime, proof })), ...proof } };
    output[name] = { runtime, capabilities };
  }
  return freezeTree(output);
}

/** Source state функции reexport сохраняют прежнюю identity и данные без копии. */
export function renderStateVariationModule(payload) {
  const name = payload?.runtime?.group;
  if (typeof name !== 'string' || !NAME.test(name) || payload.capabilities?.group !== name) {
    refuse('GROUP_SOURCE_MISMATCH', 'Нужна compiled state variation.');
  }
  const emit = compact => {
    const serialize = compact ? compactDataLiteral : jsonDataLiteral;
    return [
      `export{render,renderStateSvg,compileStateEffect,exportStateTransition,stateCapabilities}from'../states/${name}.js';`,
      "import{createCompiledEnclosureVariation as r,createCompiledEnclosureVariationCapabilities as c}from'../ir/state-annulus-runtime.js';",
      `export const renderEnclosurePatch=/* @__PURE__ */r(${serialize(payload.runtime)});`,
      `export const enclosureVariationCapabilities=/* @__PURE__ */c(${serialize(payload.capabilities)});`,
      '',
    ].join('\n');
  };
  return compactGeneratedModule([emit(false), emit(true)]);
}

export function stateVariationDeclaration(states, name) {
  if (!authorStateGroupNames(states).includes(name)) refuse('GROUP_SOURCE_MISMATCH', 'Неизвестная state group.');
  return [
    `export{render,renderStateSvg,compileStateEffect,exportStateTransition,stateCapabilities}from'../states/${name}.js';`,
    `import type{State}from'../states/${name}.js';`,
    `export type{State}from'../states/${name}.js';`,
    "import type{EnclosureVariationRequest,EnclosureVariationResult,EnclosureVariationCapabilities}from'../ir/state-annulus-types.js';",
    'export declare function renderEnclosurePatch(request?:EnclosureVariationRequest):EnclosureVariationResult;',
    'export declare function enclosureVariationCapabilities():EnclosureVariationCapabilities<State>;',
    '',
  ].join('\n');
}
