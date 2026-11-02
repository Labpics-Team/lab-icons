import { createHash } from 'node:crypto';
import { authorStateGroupNames } from './author-state-groups.js';

const stableJSON = value => JSON.stringify(value, (_, item) =>
  item && typeof item === 'object' && !Array.isArray(item)
    ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const sha256 = value => createHash('sha256').update(value).digest('hex');

/** Expected читает raw masters/spec; compiled payload и installed module не участвуют. */
export function statePackageExpectations(baseline, document, grid) {
  return Object.fromEntries(authorStateGroupNames(document).map(name => {
    const group = document.groups[name];
    if (group.law === 'dots.orient') {
      if (!grid) throw new TypeError('state artifact: dots.orient требует политику сетки');
      const states = Object.entries(group.states).sort(([a], [b]) => a.localeCompare(b)).map(([id, member]) => ({
        id, icon: member.icon, variant: member.variant, author: baseline.icons[member.icon][member.variant].author,
        paths: [...baseline.icons[member.icon][member.variant].rawSvg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
          d: /\bd="([^"]+)"/.exec(tag)[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
        })),
      }));
      // Числа читаются из исходных d, без скомпилированных данных и проверки runtime.
      const operands = d => [...d.matchAll(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g)].map(match => Number(match[0]));
      const targets = group.partIds.map((partId, index) => ({ partId, property: 'd', commands: ['M', 'C', 'C', 'C', 'C', 'Z'],
        vectors: states.map(state => operands(state.paths[index].d)), endpoints: states.map(state => state.paths[index].d) }));
      return [name, { law: 'dots.orient', group: name, variant: states[0].variant, defaultState: group.defaultState,
        partIds: group.partIds, source: document.source, states, targets,
        specSha256: sha256(stableJSON({ schemaVersion: document.schemaVersion, source: document.source, name, group })),
        geometrySha256: sha256(JSON.stringify(targets)), gridVersion: grid.version, gridSha256: sha256(JSON.stringify(grid)),
      }];
    }
    const member = group.states[group.defaultState];
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
export function verifyInstalledStateGroup(group, expected, prepareContourStateEffect) {
  if (expected.law === 'dots.orient') return verifyInstalledContourStateGroup(group, expected, prepareContourStateEffect);
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
  require(equal(shared, expected.states.find(state => state.id === expected.defaultState).paths.slice(-expected.sharedPartIds.length)), 'raw ordered shared suffix');
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

/** Самостоятельная проверка публичной группы контуров по исходным SVG. */
export function verifyInstalledContourStateGroup(group, expected, prepareContourStateEffect) {
  const require = (condition, message) => { if (!condition) throw new Error(`state artifact: contour ${message}`); };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const refused = (result, code) => !result.ok && result.reason?.code === code;
  const paths = svg => [...svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => ({
    d: /\bd="([^"]+)"/.exec(tag)?.[1], fillRule: /\bfill-rule="([^"]+)"/.exec(tag)?.[1] ?? 'nonzero',
  }));
  const operands = d => [...d.matchAll(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g)].map(match => Number(match[0]));
  const capabilities = group.stateCapabilities();
  require(capabilities.group === expected.group && capabilities.variant === expected.variant &&
    capabilities.defaultState === expected.defaultState && capabilities.transition === 'contour-interpolation' &&
    capabilities.morph === 'topology-proven' && capabilities.variation === 'exact-default-only' && equal(capabilities.partIds, expected.partIds) &&
    equal(capabilities.formats, { static: ['svg'], transition: ['web-effect'] }), 'capability identity');
  require(equal(capabilities.states, expected.states.map(({ id, icon, author }) => ({ id, icon, author }))), 'author/state census');
  const proof = capabilities.proof;
  require(proof.law === expected.law && equal(proof.source, expected.source) && proof.specSha256 === expected.specSha256 &&
    proof.geometrySha256 === expected.geometrySha256 && proof.gridVersion === expected.gridVersion && proof.gridSha256 === expected.gridSha256 &&
    proof.topology === 'ordered-monotone-cardinal-quarters' && proof.interval === 'control-hull-disks', 'spec/source/geometry/policy provenance');
  const fraction = value => value && /^(?:0|[1-9]\d*)$/.test(value.numerator) && /^[1-9]\d*$/.test(value.denominator);
  require(fraction(proof.roundingUpper) && fraction(proof.roundingNormUpper) && BigInt(proof.roundingUpper.numerator) > 0n, 'rounding certificate');
  const axis = proof.roundingUpper, norm = proof.roundingNormUpper;
  require(BigInt(norm.numerator) ** 2n * BigInt(axis.denominator) ** 2n >=
    2n * BigInt(axis.numerator) ** 2n * BigInt(norm.denominator) ** 2n, 'Euclidean rounding certificate');
  const pairs = [[0, 1], [1, 2], [0, 2]].map(pair => pair.map(index => expected.partIds[index]));
  require(Array.isArray(proof.separation) && equal(proof.separation.map(item => item.pair), pairs) && proof.separation.every(item =>
    fraction(item.minimumCenterDistanceSquared) && fraction(item.requiredDistanceSquared) && BigInt(item.requiredDistanceSquared.numerator) > 0n &&
    BigInt(item.minimumCenterDistanceSquared.numerator) * BigInt(item.requiredDistanceSquared.denominator) >=
      BigInt(item.requiredDistanceSquared.numerator) * BigInt(item.minimumCenterDistanceSquared.denominator)), 'whole-interval certificate');
  const moving = expected.targets.filter(target => target.endpoints[0] !== target.endpoints[1]);
  const unchanged = expected.targets.filter(target => target.endpoints[0] === target.endpoints[1]).map(target => target.partId);
  require(typeof prepareContourStateEffect === 'function', 'public sampler missing');
  for (const state of expected.states) {
    const rendered = group.render(state.id), mounted = group.renderStateSvg(state.id);
    require(rendered.ok && equal(rendered, mounted) && equal(paths(rendered.svg), state.paths), `${state.id}: exact raw ordered geometry`);
    require(rendered.svg.includes('viewBox="0 0 24 24"') && rendered.svg.includes('width="24" height="24"') &&
      !/\b(?:transform|clip-path|mask|opacity|style|on[a-z]+)=/.test(rendered.svg) && !/<(?!\/?(?:svg|path)\b)/.test(rendered.svg), `${state.id}: frame/node language`);
    const tags = [...rendered.svg.matchAll(/<path\b[^>]*>/g)].map(([tag]) => tag);
    require(equal(tags.map(tag => /\bdata-part="([^"]+)"/.exec(tag)?.[1]), expected.partIds) &&
      tags.every(tag => /\bdata-role="content"/.test(tag) && /\bfill="currentColor"/.test(tag) && !/\bstroke(?:-[a-z]+)?=/.test(tag)), `${state.id}: paint/part identity`);
    const result = group.compileStateEffect(state.id, { duration: 360, from: 0.37 });
    require(result.ok, `${state.id}: effect refusal`);
    const effect = result.effect;
    require(effect.contract === 'labpics.symbol-state-effect/1' && effect.version === 1 && effect.kind === 'contour-interpolation' &&
      effect.group === expected.group && effect.variant === expected.variant && effect.targetState === state.id && effect.from === 0.37 &&
      effect.to === (state.id === 'horizontal' ? 0 : 1) && equal(effect.targets, moving) && equal(effect.unchangedPartIds, unchanged) &&
      equal(effect.options, { duration: 360, easing: 'linear', fill: 'both' }), `${state.id}: numeric effect correspondence`);
    require(equal(group.exportStateTransition(state.id, { format: 'web-effect', duration: 360, from: 0.37 }), result), `${state.id}: shared export semantics`);
    const reduced = group.compileStateEffect(state.id, { duration: 360, reducedMotion: true, from: 0.37 });
    require(reduced.ok && equal(reduced.effect, { ...effect, options: { ...effect.options, duration: 0 } }), `${state.id}: reduced endpoint`);
    const transported = JSON.parse(JSON.stringify(effect)), prepared = prepareContourStateEffect(transported);
    require(prepared.ok, `${state.id}: JSON sampler refusal`);
    for (const p of [0, 0.37, 0.5, 1]) {
      const pose = prepared.sample(p);
      require(pose.ok && equal(pose.parts.map(part => part.partId), moving.map(target => target.partId)), `${state.id}: sampled part identity`);
      pose.parts.forEach((part, index) => {
        const target = moving[index];
        if (p === 0 || p === 1) require(part.d === target.endpoints[p], `${state.id}: exact sampled endpoint`);
        else {
          const [a, b] = target.vectors;
          require(equal(operands(part.d), a.map((value, operand) => value === b[operand] ? value : (1 - p) * value + p * b[operand])) &&
            part.d.replace(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g, '').replace(/[\s,]/g, '') === target.commands.join(''),
          `${state.id}: forward/reverse numeric family pose`);
        }
      });
    }
    const snapshot = prepared.sample(0.37);
    transported.targets[0].vectors[0][0] = -100; transported.targets[0].endpoints[0] = 'corrupt';
    require(equal(prepared.sample(0.37), snapshot), `${state.id}: transport snapshot`);
    require(refused(prepared.sample(-0.1), 'INVALID_REQUEST'), `${state.id}: progress refusal`);
    const corrupt = JSON.parse(JSON.stringify(effect)); corrupt.targets[0].vectors[0][2] = Infinity;
    require(refused(prepareContourStateEffect(corrupt), 'EFFECT_UNSUPPORTED'), `${state.id}: malformed packet refusal`);
    for (const variation of [{}, { dotScale: 1, spacingScale: 1 }]) require(group.compileStateEffect(state.id, { duration: 360, variation }).ok, `${state.id}: default accepted`);
    for (const operation of [options => group.render(state.id, options), options => group.compileStateEffect(state.id, { duration: 360, ...options }),
      options => group.exportStateTransition(state.id, { duration: 360, format: 'web-effect', ...options })]) {
      require(refused(operation({ variation: { dotScale: 1.1, spacingScale: 0.9 } }), 'VARIATION_UNSUPPORTED'), `${state.id}: nondefault refusal`);
      require(refused(operation({ variation: { dotScale: null } }), 'INVALID_REQUEST'), `${state.id}: malformed variation refusal`);
      require(refused(operation({ variant: expected.variant === 'outline' ? 'filled' : 'outline' }), 'VARIANT_UNSUPPORTED'), `${state.id}: independent variant refusal`);
    }
  }
  require(equal(group.renderStateSvg(), group.render(expected.defaultState)), 'default mount');
  for (const format of ['lottie', 'dotlottie', 'sf-symbols']) require(refused(group.exportStateTransition(expected.defaultState, { format, duration: 360 }), 'FORMAT_UNSUPPORTED'), 'format refusal');
  require(refused(group.compileStateEffect('not-declared', { duration: 360 }), 'STATE_UNSUPPORTED'), 'unknown state refusal');
  for (const options of [{ duration: -1 }, { duration: 360, from: null }, { duration: 360, from: 2 }, { duration: 360, unknown: true }]) {
    require(refused(group.compileStateEffect(expected.defaultState, options), 'INVALID_REQUEST'), 'malformed request refusal');
  }
}

export function stateArtifactConsumerSource() {
  return `const { prepareContourStateEffect } = await import('@labpics/icons/motion');\n` +
    `const verifyInstalledContourStateGroup = ${verifyInstalledContourStateGroup.toString()};\n` +
    `const verifyInstalledStateGroup = ${verifyInstalledStateGroup.toString()};\n` +
    `const expectedStates = JSON.parse(readFileSync(new URL('./state-expected.json', import.meta.url), 'utf8'));\n` +
    `for (const [name, expected] of Object.entries(expectedStates)) {\n` +
    `  verifyInstalledStateGroup(await import('@labpics/icons/states/' + name), expected, prepareContourStateEffect);\n` +
    `}\n`;
}
