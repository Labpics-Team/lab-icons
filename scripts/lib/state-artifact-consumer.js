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
    return [name, {
      group: name, defaultState: group.defaultState, enclosurePartId: group.enclosurePartId,
      source: document.source,
      specSha256: sha256(stableJSON({ schemaVersion: 1, source: document.source, name, group })),
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
    capabilities.enclosurePartId === expected.enclosurePartId && capabilities.morph === 'unavailable', 'capability identity');
  require(equal(capabilities.proof.source, expected.source) && capabilities.proof.specSha256 === expected.specSha256,
    'spec/source provenance');
  require(equal(capabilities.states.map(state => state.id), expected.states.map(state => state.id)), 'state census');
  const initial = group.renderStateSvg(expected.defaultState);
  require(initial.ok, 'mount SVG refusal');
  require(!/\b(?:transform|clip-path|mask|style|on[a-z]+)=/.test(initial.svg) &&
    !/<(?!\/?(?:svg|g|path)\b)/.test(initial.svg), 'mount paint/node language');
  const mounted = [...initial.svg.matchAll(/<g\b[^>]*data-state="([^"]+)"[^>]*opacity="([01])">([\s\S]*?)<\/g>/g)];
  require(mounted.length === expected.states.length, 'mounted groups census');
  require(initial.svg.split(`data-part="${expected.enclosurePartId}"`).length === 2, 'single enclosure');
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
      equal(paths(body[3]), state.paths.slice(0, -1)) && !/\bopacity=/.test(body[3]), `${state.id}: group opacity/geometry`);
    const effect = group.compileStateEffect(state.id, { duration: 360 });
    require(effect.ok && effect.effect.contract === 'labpics.symbol-state-effect/1' &&
      effect.effect.targetState === state.id && equal(effect.effect.unchangedPartIds, [expected.enclosurePartId]), 'effect contract');
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
