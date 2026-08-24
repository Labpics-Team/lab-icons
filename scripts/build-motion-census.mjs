#!/usr/bin/env node
/** MO-00: строит проверяемую проекцию семантических motion-семейств. */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => JSON.parse(readFileSync(join(ROOT, path), 'utf8'));
const catalog = read('semantics/catalog.json');
const anatomy = read('semantics/anatomy.json');
const spec = read('semantics/motion-families.json');

const FAMILY_KEYS = ['id', 'meaning', 'icons', 'requiredPartSets', 'requiredTrackKinds', 'readiness', 'compatibleExclusions'];
const READINESS = new Set(['existing-core', 'needs-core', 'needs-morph']);
const TRACK_KINDS = new Set(['rotate', 'translate', 'reveal', 'morph', 'scale', 'opacity']);
const FAMILY_ID = /^[a-z][a-z0-9-]*$/;

function exactKeys(value, keys, where) {
  const actual = Object.keys(value).sort();
  const expected = [...keys].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new TypeError(`${where}: поля должны быть ${expected.join(', ')}`);
  }
}

function variantParts(model) {
  return Object.values(model.variants ?? {}).flatMap((variant) => variant.parts ?? []);
}

export function buildMotionCensus({
  catalogInput = catalog,
  anatomyInput = anatomy,
  familySpec = spec,
} = {}) {
  exactKeys(familySpec, ['version', 'families'], 'motion family spec');
  if (familySpec.version !== 1) throw new TypeError('motion family spec.version обязан быть 1');
  const declaredGestures = [];
  const morphGroups = new Map();
  for (const [icon, glyph] of Object.entries(anatomyInput.glyphs)) {
    for (const gesture of glyph.motion?.gestures ?? []) {
      declaredGestures.push({ icon, id: gesture.id, kind: gesture.kind });
    }
  }
  for (const [icon, contract] of Object.entries(catalogInput.icons)) {
    for (const part of variantParts(contract.model ?? {})) {
      if (!part.morphGroup) continue;
      const names = morphGroups.get(part.morphGroup) ?? new Set();
      names.add(icon);
      morphGroups.set(part.morphGroup, names);
    }
  }

  const familyIds = new Set();
  for (const family of familySpec.families) {
    exactKeys(family, FAMILY_KEYS, `motion family ${family.id ?? '<unknown>'}`);
    if (typeof family.id !== 'string' || !FAMILY_ID.test(family.id) ||
        typeof family.meaning !== 'string' || family.meaning.length === 0) {
      throw new TypeError('motion family id/meaning невалидны');
    }
    if (familyIds.has(family.id)) throw new TypeError(`${family.id}: duplicate family id`);
    familyIds.add(family.id);
  }
  const families = familySpec.families.map((family) => {
    if (!READINESS.has(family.readiness)) {
      throw new TypeError(`${family.id}: неизвестная readiness ${family.readiness}`);
    }
    if (!Array.isArray(family.icons) || family.icons.length < 2 ||
        !family.icons.every((icon) => typeof icon === 'string') ||
        new Set(family.icons).size !== family.icons.length ||
        !Array.isArray(family.requiredPartSets) || family.requiredPartSets.length === 0 ||
        !family.requiredPartSets.every((set) => Array.isArray(set) && set.length > 0 &&
          set.every((id) => typeof id === 'string' && !/^c\d+$/.test(id)) && new Set(set).size === set.length) ||
        !Array.isArray(family.requiredTrackKinds) || family.requiredTrackKinds.length === 0 ||
        !family.requiredTrackKinds.every((kind) => TRACK_KINDS.has(kind)) ||
        !Array.isArray(family.compatibleExclusions) ||
        !family.compatibleExclusions.every((item) => item && typeof item.icon === 'string' &&
          item.code === 'SEMANTIC_MEANING_MISMATCH')) {
      throw new TypeError(`${family.id}: невалидные icons/requiredPartSets/requiredTrackKinds`);
    }
    for (const icon of family.icons) {
      if (!Object.hasOwn(catalogInput.icons, icon)) {
        throw new Error(`${family.id}: unknown icon ${icon}`);
      }
    }
    const declaredPartSets = family.icons
      .filter((icon) => catalogInput.icons[icon].model)
      .map((icon) => new Set(variantParts(catalogInput.icons[icon].model).map((part) => part.id)));
    for (const required of family.requiredPartSets) {
      if (!declaredPartSets.some((ids) => required.every((id) => ids.has(id)))) {
        throw new Error(`${family.id}: requiredPartSet не встречается ни у одного declared icon (${required.join(',')})`);
      }
    }
    const explicitExclusions = new Map(family.compatibleExclusions.map((item) => [item.icon, item.code]));
    if (explicitExclusions.size !== family.compatibleExclusions.length) {
      throw new TypeError(`${family.id}: duplicate compatible exclusion`);
    }
    for (const icon of explicitExclusions.keys()) {
      if (!Object.hasOwn(catalogInput.icons, icon)) {
        throw new Error(`${family.id}: unknown compatible exclusion ${icon}`);
      }
      if (family.icons.includes(icon)) {
        throw new Error(`${family.id}: icon ${icon} одновременно consumer и exclusion`);
      }
    }
    const compatibleUniverse = Object.entries(catalogInput.icons)
      .filter(([, icon]) => icon.model)
      .filter(([, icon]) => Object.values(icon.model.variants ?? {}).every((variant) => {
        const ids = new Set((variant.parts ?? []).map((part) => part.id));
        return family.requiredPartSets.some((required) => required.every((id) => ids.has(id)));
      }))
      .map(([icon]) => icon)
      .sort();
    const omitted = compatibleUniverse.filter(
      (icon) => !family.icons.includes(icon) && !explicitExclusions.has(icon),
    );
    if (omitted.length > 0) {
      throw new Error(`${family.id}: compatible consumers не классифицированы: ${omitted.join(', ')}`);
    }
    const accepted = [];
    const candidate = [];
    const exclusions = [];
    for (const icon of family.icons) {
      if (!Object.hasOwn(catalogInput.icons, icon)) {
        throw new Error(`${family.id}: unknown icon ${icon}`);
      }
      const model = catalogInput.icons[icon].model;
      if (!model) {
        exclusions.push({ icon, code: 'SOURCE_ONLY' });
        continue;
      }
      const variantsMatch = Object.values(model.variants ?? {}).every((variant) => {
        const ids = new Set((variant.parts ?? []).map((part) => part.id));
        return family.requiredPartSets.some((required) => required.every((id) => ids.has(id)));
      });
      if (!variantsMatch) {
        exclusions.push({ icon, code: 'REQUIRED_PART_SET_MISSING' });
        continue;
      }
      const states = Object.values(model.variants).map((variant) => variant.state);
      (states.every((state) => state === 'accepted') ? accepted : candidate).push(icon);
    }
    if (accepted.length + candidate.length < 2) {
      throw new Error(`${family.id}: family требует не менее двух compatible consumers`);
    }
    return {
      id: family.id,
      meaning: family.meaning,
      requiredPartSets: family.requiredPartSets
        .map((set) => [...set].sort())
        .sort((a, b) => a.join('/').localeCompare(b.join('/'))),
      requiredTrackKinds: [...family.requiredTrackKinds].sort(),
      readiness: family.readiness,
      accepted: accepted.sort(),
      candidate: candidate.sort(),
      exclusions: exclusions.sort((a, b) => a.icon.localeCompare(b.icon)),
    };
  }).sort((a, b) => a.id.localeCompare(b.id));

  return {
    version: 1,
    generatedBy: 'scripts/build-motion-census.mjs',
    declaredGestures: declaredGestures.sort((a, b) => `${a.icon}/${a.id}`.localeCompare(`${b.icon}/${b.id}`)),
    morphReadyPairs: [...morphGroups.entries()]
      .filter(([, icons]) => icons.size >= 2)
      .map(([morphGroup, icons]) => ({ morphGroup, icons: [...icons].sort() }))
      .sort((a, b) => a.morphGroup.localeCompare(b.morphGroup)),
    families,
  };
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const census = buildMotionCensus();
  writeFileSync(join(ROOT, 'semantics/motion-census.json'), `${JSON.stringify(census, null, 1)}\n`);
  console.log(`motion-census: ${census.declaredGestures.length} declared; ${census.families.length} candidate families; ${census.morphReadyPairs.length} morph groups`);
}
