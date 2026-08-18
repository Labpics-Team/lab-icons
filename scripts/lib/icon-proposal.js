/**
 * Machine-readable authoring brief for a new or revised Lab Icon.
 *
 * The brief does not attempt to encode taste.  It makes the decisions that a
 * reviewer and an agent must be able to inspect explicit: intended meaning,
 * neighbouring family, keyline, pair relationship, optical-size behaviour,
 * and stable semantic parts.  SVG remains the rendering proposal; this file
 * is the durable constraint proposal that travels with it through intake.
 */

import { readFileSync } from 'node:fs';
import { canonicalIconName } from './figma-import.js';

const EXACT_KEYS = new Set([
  'version',
  'icon',
  'intent',
  'family',
  'keyline',
  'variants',
  'opticalSizing',
  'parts',
  'motion',
]);
const KEYLINES = new Set(['circle', 'square', 'wide', 'tall', 'custom']);
const VARIANT_RELATIONSHIPS = new Set(['independent-masters', 'shared-anatomy']);
const OPTICAL_MODES = new Set(['fixed-master', 'discrete-masters', 'continuous-recipe']);
const MOTION_STATES = new Set(['none', 'semantic-parts', 'anchored-parts', 'gesture-ready']);
const PART_ROLES = new Set([
  'body',
  'content',
  'ink',
  'counter',
  'container',
  'control',
  'detail',
  'decorator',
]);
const STABLE_ID_RE = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/;

function record(value, where) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`icon-proposal: ${where} обязан быть объектом`);
  }
  return value;
}

function exactKeys(value, expected, where) {
  record(value, where);
  const unknown = Object.keys(value).filter((key) => !expected.has(key));
  const missing = [...expected].filter((key) => !Object.hasOwn(value, key));
  if (unknown.length > 0) {
    throw new TypeError(`icon-proposal: ${where} несёт неизвестные поля ${unknown.join(', ')}`);
  }
  if (missing.length > 0) {
    throw new TypeError(`icon-proposal: ${where} не имеет обязательных полей ${missing.join(', ')}`);
  }
}

function text(value, where, minimum = 1) {
  if (typeof value !== 'string' || value.trim().length < minimum) {
    throw new TypeError(`icon-proposal: ${where} обязан быть содержательной строкой`);
  }
  return value.trim();
}

function finitePair(value, where) {
  if (!Array.isArray(value) || value.length !== 2 || value.some((item) => !Number.isFinite(item))) {
    throw new TypeError(`icon-proposal: ${where} обязан быть парой конечных чисел`);
  }
  if (value.some((item) => item < 0 || item > 1)) {
    throw new RangeError(`icon-proposal: ${where} обязан лежать в [0,1]`);
  }
  return value;
}

function stableId(value, where) {
  if (typeof value !== 'string' || !STABLE_ID_RE.test(value)) {
    throw new TypeError(`icon-proposal: ${where} имеет невалидный stable id`);
  }
  return value;
}

function negativeSpaceConstraints(value, where) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`icon-proposal: ${where} обязан быть непустым массивом`);
  }
  const ids = new Set();
  return value.map((constraint, index) => {
    exactKeys(
      constraint,
      new Set(['id', 'kind', 'minimum', 'participants', 'measurement']),
      `${where}[${index}]`,
    );
    const id = stableId(constraint.id, `${where}[${index}].id`);
    if (ids.has(id)) throw new TypeError(`icon-proposal: ${where} повторяет id ${id}`);
    ids.add(id);
    if (typeof constraint.kind !== 'string' || constraint.kind.trim().length < 3) {
      throw new TypeError(`icon-proposal: ${where}[${index}].kind обязан быть содержательным`);
    }
    if (!Number.isFinite(constraint.minimum) || constraint.minimum < 0 || constraint.minimum > 0.5) {
      throw new RangeError(`icon-proposal: ${where}[${index}].minimum вне [0,0.5]`);
    }
    const participants = stringSet(constraint.participants, `${where}[${index}].participants`, {
      parse: (item) => stableId(item, `${where}[${index}].participants[]`),
    });
    const measurement = text(constraint.measurement, `${where}[${index}].measurement`, 8);
    return { id, kind: constraint.kind.trim(), minimum: constraint.minimum, participants, measurement };
  });
}

function stringSet(value, where, { minimum = 1, parse = (item) => text(item, where) } = {}) {
  if (!Array.isArray(value) || value.length < minimum) {
    throw new TypeError(`icon-proposal: ${where} обязан содержать минимум ${minimum} элемент`);
  }
  const parsed = value.map(parse);
  if (new Set(parsed).size !== parsed.length) {
    throw new TypeError(`icon-proposal: ${where} содержит дубликаты`);
  }
  return parsed;
}

export function validateIconProposal(value, { catalogIconIds } = {}) {
  if (!Array.isArray(catalogIconIds) || catalogIconIds.length === 0) {
    throw new TypeError('icon-proposal: catalogIconIds обязателен для проверки family.references');
  }
  exactKeys(value, EXACT_KEYS, 'root');
  if (value.version !== 1) throw new RangeError('icon-proposal: поддерживается version=1');

  const icon = canonicalIconName(value.icon);
  const intent = text(value.intent, 'intent', 12);

  exactKeys(value.family, new Set(['references', 'sharedRules']), 'family');
  const knownIcons = new Set(catalogIconIds);
  const references = stringSet(value.family.references, 'family.references', {
    parse: (item) => canonicalIconName(item),
  });
  const unknownReferences = references.filter((reference) => !knownIcons.has(reference));
  if (unknownReferences.length > 0) {
    throw new TypeError(
      `icon-proposal: неизвестные family.references ${unknownReferences.join(', ')}`,
    );
  }
  const sharedRules = stringSet(value.family.sharedRules, 'family.sharedRules', {
    parse: (item) => text(item, 'family.sharedRules[]', 4),
  });

  exactKeys(value.keyline, new Set(['kind', 'reason']), 'keyline');
  if (!KEYLINES.has(value.keyline.kind)) {
    throw new TypeError(`icon-proposal: неизвестный keyline.kind ${String(value.keyline.kind)}`);
  }
  const keylineReason = text(value.keyline.reason, 'keyline.reason', 12);

  exactKeys(value.variants, new Set(['relationship', 'outline', 'filled']), 'variants');
  if (!VARIANT_RELATIONSHIPS.has(value.variants.relationship)) {
    throw new TypeError(
      `icon-proposal: неизвестный variants.relationship ${String(value.variants.relationship)}`,
    );
  }
  const variantContract = {};
  for (const variant of ['outline', 'filled']) {
    const entry = value.variants[variant];
    exactKeys(entry, new Set(['role', 'negativeSpace']), `variants.${variant}`);
    variantContract[variant] = {
      role: text(entry.role, `variants.${variant}.role`, 8),
      negativeSpace: negativeSpaceConstraints(entry.negativeSpace, `variants.${variant}.negativeSpace`),
    };
  }

  exactKeys(value.opticalSizing, new Set(['mode', 'masters', 'behavior']), 'opticalSizing');
  if (!OPTICAL_MODES.has(value.opticalSizing.mode)) {
    throw new TypeError(
      `icon-proposal: неизвестный opticalSizing.mode ${String(value.opticalSizing.mode)}`,
    );
  }
  if (!Array.isArray(value.opticalSizing.masters)) {
    throw new TypeError('icon-proposal: opticalSizing.masters обязан быть массивом');
  }
  const masters = value.opticalSizing.masters.map((master, index) => {
    exactKeys(master, new Set(['size', 'source']), `opticalSizing.masters[${index}]`);
    if (!Number.isInteger(master.size) || master.size < 8 || master.size > 256) {
      throw new RangeError(`icon-proposal: opticalSizing.masters[${index}].size вне 8..256`);
    }
    return { size: master.size, source: text(master.source, `opticalSizing.masters[${index}].source`) };
  });
  if (new Set(masters.map(({ size }) => size)).size !== masters.length) {
    throw new TypeError('icon-proposal: opticalSizing.masters повторяет size');
  }
  if (value.opticalSizing.mode === 'fixed-master' && masters.length !== 1) {
    throw new TypeError('icon-proposal: fixed-master требует ровно один optical master');
  }
  if (value.opticalSizing.mode !== 'fixed-master' && masters.length < 2) {
    throw new TypeError('icon-proposal: вариативный opsz требует минимум два optical master');
  }
  const opticalBehavior = stringSet(value.opticalSizing.behavior, 'opticalSizing.behavior', {
    parse: (item) => text(item, 'opticalSizing.behavior[]', 8),
  });

  if (!Array.isArray(value.parts) || value.parts.length === 0) {
    throw new TypeError('icon-proposal: parts обязан быть непустым массивом');
  }
  const partIds = new Set();
  const parts = value.parts.map((part, index) => {
    exactKeys(part, new Set(['id', 'role', 'anchor', 'moves']), `parts[${index}]`);
    const id = stableId(part.id, `parts[${index}].id`);
    if (partIds.has(id)) throw new TypeError(`icon-proposal: повторный part.id ${id}`);
    partIds.add(id);
    if (!PART_ROLES.has(part.role)) {
      throw new TypeError(`icon-proposal: parts[${index}].role не поддержан`);
    }
    if (typeof part.moves !== 'boolean') {
      throw new TypeError(`icon-proposal: parts[${index}].moves обязан быть boolean`);
    }
    return {
      id,
      role: part.role,
      anchor: part.anchor === null ? null : finitePair(part.anchor, `parts[${index}].anchor`),
      moves: part.moves,
    };
  });
  for (const variant of ['outline', 'filled']) {
    for (const constraint of variantContract[variant].negativeSpace) {
      const unknownParts = constraint.participants.filter((partId) => !partIds.has(partId));
      if (unknownParts.length > 0) {
        throw new TypeError(
          `icon-proposal: ${variant} negative-space ссылается на неизвестные parts ${unknownParts.join(', ')}`,
        );
      }
    }
  }

  exactKeys(value.motion, new Set(['state', 'gestures']), 'motion');
  if (!MOTION_STATES.has(value.motion.state)) {
    throw new TypeError(`icon-proposal: неизвестный motion.state ${String(value.motion.state)}`);
  }
  if (!Array.isArray(value.motion.gestures)) {
    throw new TypeError('icon-proposal: motion.gestures обязан быть массивом');
  }
  const gestures = value.motion.gestures.map((gesture, index) => {
    exactKeys(gesture, new Set(['id', 'kind', 'partIds', 'meaning']), `motion.gestures[${index}]`);
    const partReferences = stringSet(gesture.partIds, `motion.gestures[${index}].partIds`, {
      parse: (item) => stableId(item, `motion.gestures[${index}].partIds[]`),
    });
    const unknownParts = partReferences.filter((partId) => !partIds.has(partId));
    if (unknownParts.length > 0) {
      throw new TypeError(`icon-proposal: gesture ссылается на неизвестные parts ${unknownParts.join(', ')}`);
    }
    return {
      id: stableId(gesture.id, `motion.gestures[${index}].id`),
      kind: text(gesture.kind, `motion.gestures[${index}].kind`),
      partIds: partReferences,
      meaning: text(gesture.meaning, `motion.gestures[${index}].meaning`, 12),
    };
  });
  if (new Set(gestures.map(({ id }) => id)).size !== gestures.length) {
    throw new TypeError('icon-proposal: motion.gestures повторяет id');
  }
  if (value.motion.state === 'none' && gestures.length > 0) {
    throw new TypeError('icon-proposal: motion.state=none не допускает gestures');
  }
  if (
    (value.motion.state === 'semantic-parts' || value.motion.state === 'anchored-parts') &&
    gestures.length > 0
  ) {
    throw new TypeError(`icon-proposal: motion.state=${value.motion.state} не допускает gestures`);
  }
  if (value.motion.state === 'anchored-parts') {
    const movingParts = parts.filter(({ moves }) => moves);
    if (movingParts.length === 0 || movingParts.some(({ anchor }) => anchor === null)) {
      throw new TypeError(`icon-proposal: ${value.motion.state} требует подвижные parts с anchor`);
    }
  }
  if (value.motion.state === 'gesture-ready') {
    if (gestures.length === 0) {
      throw new TypeError('icon-proposal: gesture-ready требует хотя бы один gesture');
    }
    const partsById = new Map(parts.map((part) => [part.id, part]));
    const invalidPartIds = [...new Set(gestures
      .flatMap(({ partIds: referencedPartIds }) => referencedPartIds)
      .filter((partId) => {
        const part = partsById.get(partId);
        return !part.moves || part.anchor === null;
      }))];
    if (invalidPartIds.length > 0) {
      throw new TypeError(
        'icon-proposal: gesture-ready требует, чтобы все referenced parts были подвижными и имели anchor ' +
        `(${invalidPartIds.join(', ')})`,
      );
    }
  }

  return Object.freeze({
    version: 1,
    icon,
    intent,
    family: Object.freeze({ references: Object.freeze(references), sharedRules: Object.freeze(sharedRules) }),
    keyline: Object.freeze({ kind: value.keyline.kind, reason: keylineReason }),
    variants: Object.freeze({
      relationship: value.variants.relationship,
      outline: Object.freeze(variantContract.outline),
      filled: Object.freeze(variantContract.filled),
    }),
    opticalSizing: Object.freeze({
      mode: value.opticalSizing.mode,
      masters: Object.freeze(masters.map((master) => Object.freeze(master))),
      behavior: Object.freeze(opticalBehavior),
    }),
    parts: Object.freeze(parts.map((part) => Object.freeze(part))),
    motion: Object.freeze({ state: value.motion.state, gestures: Object.freeze(gestures.map((gesture) => Object.freeze(gesture))) }),
  });
}

export function readIconProposal(path, options) {
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (cause) {
    throw new Error(`icon-proposal: ${path} не читается (${cause.message})`);
  }
  return validateIconProposal(parsed, options);
}

export function serializeIconProposal(proposal, options) {
  return `${JSON.stringify(validateIconProposal(proposal, options), null, 2)}\n`;
}
