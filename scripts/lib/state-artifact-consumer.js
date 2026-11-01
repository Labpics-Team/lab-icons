import { createHash } from 'node:crypto';
import { authorStateGroupNames } from './author-state-groups.js';

const stableJSON = value => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Expected читает raw masters/spec; compiled payload и installed module не участвуют. */
export function statePackageExpectations(baseline, document) {
  return Object.fromEntries(authorStateGroupNames(document).map(name => {
    const group = document.groups[name];
    const member = Object.values(group.states)[0];
    const shared = [...baseline.icons[member.icon][member.variant].rawSvg.matchAll(/<path\b[^>]*>/g)]
      .slice(-group.sharedParts.length).map(([tag], index) => ({ ...group.sharedParts[index],
        d: /\bd="([^"]+)"/.exec(tag)[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
        paint: { kind: 'fill', fill: 'currentColor' } }));
    return [name, {
      group: name, defaultState: group.defaultState, enclosurePartId: group.enclosurePartId,
      sharedPartIds: group.sharedParts.map(part => part.id),
      source: document.source,
      specSha256: sha256(stableJSON({ schemaVersion: document.schemaVersion, source: document.source, name, group })),
      sharedPartsSha256: sha256(stableJSON({ parts: shared, viewBox: [0, 0, 24, 24], dimensions: [24, 24], placement: 'after-content' })),
      states: Object.entries(group.states).sort(([a], [b]) => a.localeCompare(b)).map(([id, member]) => {
        const source = baseline.icons[member.icon][member.variant];
        return { id, icon: member.icon, variant: member.variant, partId: `state-${id}`,
          contentPartIds: member.contentPartIds, author: source.author,
          paths: [...source.rawSvg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
            d: /\bd="([^"]+)"/.exec(tag)[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
          })),
        };
      }),
    }];
  }));
}

/** Вставляется целиком в настоящий installed consumer, без producer helper imports. */
export function verifyInstalledStateGroup(group, expected) {
  const require = (condition, message) => { if (!condition) throw new Error(`state artifact: ${message}`); };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const paths = svg => [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
    d: /\bd="([^"]+)"/.exec(tag)?.[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
  }));
  const capabilities = group.stateCapabilities();
  require(capabilities.group === expected.group && capabilities.defaultState === expected.defaultState &&
    capabilities.enclosurePartId === expected.enclosurePartId && equal(capabilities.sharedPartIds, expected.sharedPartIds) &&
    capabilities.morph === 'unavailable', 'capability identity');
  require(equal(capabilities.proof.source, expected.source) && capabilities.proof.specSha256 === expected.specSha256 &&
    capabilities.proof.sharedPartsSha256 === expected.sharedPartsSha256,
    'spec/source provenance');
  require(equal(capabilities.states.map(state => state.id), expected.states.map(state => state.id)), 'state census');
  const initial = group.renderStateSvg(expected.defaultState);
  require(initial.ok, 'mount SVG refusal');
  require(!/\b(?:transform|clip-path|mask|style|on[a-z]+)=/.test(initial.svg) &&
    !/<(?!\/?(?:svg|g|path)\b)/.test(initial.svg), 'mount paint/node language');
  const mounted = [...initial.svg.matchAll(/<g\b[^>]*data-state="([^"]+)"[^>]*opacity="([01])">([\s\S]*?)<\/g>/g)];
  require(mounted.length === expected.states.length, 'mounted groups census');
  require((initial.svg.match(/<g\b/g) ?? []).length === mounted.length &&
    initial.svg.includes('viewBox="0 0 24 24"') && initial.svg.includes('width="24" height="24"') &&
    !/\bopacity=/.test(initial.svg.match(/<svg\b[^>]*>/)?.[0] ?? ''), 'mount frame/groups');
  require([...initial.svg.matchAll(/<path\b[^>]*>/g)].every(([tag]) =>
    /\bfill="currentColor"/.test(tag) && !/\b(?:stroke(?:-[a-z]+)?|opacity)=/.test(tag)), 'mount path paint');
  require(initial.svg.split(`data-part="${expected.enclosurePartId}"`).length === 2, 'single enclosure');
  const shared = paths(initial.svg).slice(-expected.sharedPartIds.length);
  require(equal(shared, expected.states[0].paths.slice(-expected.sharedPartIds.length)), 'raw ordered shared suffix');
  require(equal(paths(initial.svg), [...expected.states.flatMap(state => state.paths.slice(0, state.contentPartIds.length)), ...shared]),
    'full mounted ordered geometry');
  const sharedTags = [...initial.svg.matchAll(/<path\b[^>]*>/g)].slice(-expected.sharedPartIds.length);
  require(sharedTags.every(([tag], index) => tag.includes(`data-part="${expected.sharedPartIds[index]}"`) &&
    tag.includes(`data-role="${expected.sharedPartIds[index] === expected.enclosurePartId ? 'container' : 'content'}"`)),
  'shared anatomy IDs/roles');
  for (const id of expected.sharedPartIds) {
    require(initial.svg.split(`data-part="${id}"`).length === 2, 'single shared part');
    require(mounted.every(match => !match[3].includes(`data-part="${id}"`)), 'shared part outside opacity groups');
  }
  for (const state of expected.states) {
    const metadata = capabilities.states.find(member => member.id === state.id);
    require(equal(metadata.author, state.author) && equal(metadata.contentPartIds, state.contentPartIds), 'author/part metadata');
    const rendered = group.render(state.id);
    require(rendered.ok && equal(paths(rendered.svg), state.paths), `${state.id}: raw ordered geometry`);
    require(rendered.svg.includes('viewBox="0 0 24 24"') && rendered.svg.includes('width="24" height="24"') &&
      !/\b(?:transform|clip-path|mask|opacity|style|on[a-z]+)=/.test(rendered.svg) &&
      !/<(?!\/?(?:svg|path)\b)/.test(rendered.svg) &&
      [...rendered.svg.matchAll(/<path\b[^>]*>/g)].every(([tag]) => /\bfill="currentColor"/.test(tag) && !/\bstroke(?:-[a-z]+)?=/.test(tag)),
    `${state.id}: frame/paint`);
    const body = mounted.find(match => match[1] === state.id);
    require(body && body[2] === (state.id === expected.defaultState ? '1' : '0') &&
      equal(paths(body[3]), state.paths.slice(0, state.contentPartIds.length)) && !/\bopacity=/.test(body[3]), `${state.id}: group opacity/geometry`);
    require(body[0].slice(0, body[0].indexOf('>')).includes(`data-part="${state.partId}"`) &&
      body[0].slice(0, body[0].indexOf('>')).includes('data-role="state"') &&
      equal([...body[3].matchAll(/data-part="([^"]+)"/g)].map(match => match[1]), state.contentPartIds),
    `${state.id}: mounted anatomy IDs`);
    const effect = group.compileStateEffect(state.id, { duration: 360 });
    require(effect.ok && effect.effect.contract === 'labpics.symbol-state-effect/1' &&
      effect.effect.targetState === state.id && equal(effect.effect.unchangedPartIds, expected.sharedPartIds), 'effect contract');
    const stages = expected.states.map(member => ({ partId: member.partId, property: 'opacity',
      to: member.id === state.id ? 1 : 0, at: 0, duration: 360 }));
    require(equal(effect.effect.stages, stages), `${state.id}: takeover stages`);
    const reduced = group.compileStateEffect(state.id, { duration: 360, reducedMotion: true });
    require(reduced.ok && reduced.effect.options.duration === 0 &&
      equal(reduced.effect.stages, stages.map(stage => ({ ...stage, duration: 0 }))), 'reduced endpoint');
    require(equal(group.exportStateTransition(state.id, { format: 'web-effect', duration: 360 }), effect), 'shared export semantics');
  }
  for (const format of ['lottie', 'dotlottie', 'sf-symbols']) {
    const result = group.exportStateTransition(expected.defaultState, { format, duration: 360 });
    require(!result.ok && result.reason.code === 'FORMAT_UNSUPPORTED', 'format refusal');
  }
  const filled = group.render(expected.defaultState, { variant: 'filled' });
  require(!filled.ok && filled.reason.code === 'VARIANT_UNSUPPORTED', 'unsupported variant');
  const unknown = group.compileStateEffect('not-declared', { duration: 360 });
  require(!unknown.ok && unknown.reason.code === 'STATE_UNSUPPORTED', 'unknown state');
}

export function stateArtifactConsumerSource() {
  return `const verifyInstalledStateGroup = ${verifyInstalledStateGroup.toString()};\n` +
    `const expectedStates = JSON.parse(readFileSync(new URL('./state-expected.json', import.meta.url), 'utf8'));\n` +
    `for (const [name, expected] of Object.entries(expectedStates)) {\n` +
    `  verifyInstalledStateGroup(await import('@labpics/icons/states/' + name), expected);\n` +
    `}\n`;
}
