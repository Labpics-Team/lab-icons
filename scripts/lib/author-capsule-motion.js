import { createHash } from 'node:crypto';
import { authorPathEntries } from '../../src/core/icon-geometry.js';
import { compactDataLiteral, jsonDataLiteral } from './generated-module.js';

const VARIANTS = ['outline', 'filled'];
const NAME = /^[a-z][a-z0-9-]*$/;
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => createHash('sha256').update(value).digest('hex');

/** Допуск берётся из того же author spec, который строит static capsule. */
export function authorCapsuleMotionSymbolNames(document) {
  return Object.keys(document.icons).filter(icon => Object.values(document.icons[icon])
    .some(declaration => declaration.variation?.law === 'capsule.width')).sort();
}

/** Физическая связь выводится до удаления полного IR из consumer target. */
export function projectAuthorCapsuleMotion(payload) {
  if (!NAME.test(payload?.icon) || !payload.variation) throw new TypeError('capsule motion: нужен допущенный symbol payload');
  const variants = {};
  for (const variant of VARIANTS) {
    const geometry = payload.variation[variant];
    if (!geometry) continue;
    const source = payload.source[variant], capability = payload.capabilities[variant];
    const compound = source.composition.kind === 'compound';
    const body = source.parts[geometry.body.index];
    const { packetSha256, ...packet } = geometry, { geometrySha256, ...program } = packet;
    const ids = source.parts.map(part => part.id), roles = source.parts.map(part => part.role);
    const parentEntries = compound
      ? [{ index: 0, d: source.parts.map(part => part.d).join(''), fillRule: source.composition.fillRule }]
      : source.parts.map((part, index) => ({ index, d: part.d, fillRule: part.fillRule }));
    const attributes = compound ? ['parts', 'roles'] : ['part', 'role'];
    const labels = attributes.map(attribute => [...source.svg.matchAll(new RegExp(` data-${attribute}="([^"]+)"`, 'g'))].map(match => match[1]));
    const expectedLabels = compound ? [[ids.join(' ')], [roles.join(' ')]] : [ids, roles];
    const unaddressed = source.svg.replace(/ data-(?:parts?|roles?)="[a-z][a-z0-9-]*(?: [a-z][a-z0-9-]*)*"/g, '');
    if (geometry.version !== 1 || geometry.law !== 'capsule.width' || packetSha256 !== hash(stableJSON(packet)) ||
        geometrySha256 !== hash(stableJSON(program)) || source.icon !== payload.icon || source.variant !== variant ||
        source.provenance.kind !== 'source' || !source.provenance.anatomy ||
        !['layers', 'compound'].includes(source.composition.kind) || ids.some(id => !NAME.test(id)) ||
        stableJSON(ids) !== stableJSON(geometry.partIds) ||
        source.parts.some((part, index) => part.zIndex !== index || part.provenance.kind !== 'source' || part.provenance.identity !== 'declared') ||
        !body || body.id !== geometry.body.id || body.role !== (compound ? 'counter' : 'content') ||
        compound && (source.composition.fillRule !== 'evenodd' || geometry.body.index === 0 ||
          roles[0] !== 'container' || roles.slice(1).some(role => role !== 'counter') || source.parts.some(part => part.fillRule !== null)) ||
        geometry.body.sourceLiteralSha256 !== hash(`${body.fillRule}\0${body.d}`) ||
        geometry.source.masterSha256 !== source.provenance.author.masterSha256 ||
        geometry.source.pathFingerprintSha256 !== source.provenance.author.pathFingerprintSha256 ||
        geometry.source.pathFingerprintSha256 !== hash(stableJSON(parentEntries)) ||
        stableJSON(authorPathEntries(unaddressed)) !== stableJSON(parentEntries) || stableJSON(labels) !== stableJSON(expectedLabels) ||
        capability.variation?.law !== geometry.law || capability.variation.geometrySha256 !== geometry.geometrySha256 ||
        stableJSON(capability.variation.domain) !== stableJSON(geometry.domain)) {
      throw new TypeError('capsule motion: geometry, author receipt и физический SVG target расходятся');
    }
    const selector = compound ? `[data-parts="${ids.join(' ')}"]` : `[data-part="${body.id}"]`;
    const motion = { version: 1, law: geometry.law, icon: payload.icon, variant,
      domain: { minimum: geometry.domain.minimum, maximum: geometry.domain.maximum },
      contours: geometry.body.contours.map(({ commands, points, rates }) => ({ commands, points, rates })),
      svg: source.svg,
      originalD: compound ? parentEntries[0].d : body.d,
      prefix: compound ? source.parts.slice(0, geometry.body.index).map(part => part.d).join('') : '',
      suffix: compound ? source.parts.slice(geometry.body.index + 1).map(part => part.d).join('') : '',
      renderTarget: { selector, attribute: 'd', partId: body.id, unchangedPartIds: ids.filter(id => id !== body.id) },
    };
    variants[variant] = { motion: { ...motion, packetSha256: hash(stableJSON(motion)) }, capabilities: {
      version: 1, icon: payload.icon, variant, law: geometry.law, domain: geometry.domain,
      geometrySha256: geometry.geometrySha256, formats: ['svg', 'prepared-width'],
      author: source.provenance.author, anatomy: source.provenance.anatomy,
    } };
  }
  if (!Object.keys(variants).length) throw new TypeError('capsule motion: нет самостоятельного width target');
  return { icon: payload.icon, variants };
}

export function renderAuthorCapsuleMotionModule(payload) {
  if (!NAME.test(payload?.icon) || !payload.variants || !Object.keys(payload.variants).length ||
      Object.keys(payload.variants).some(variant => !VARIANTS.includes(variant))) {
    throw new TypeError('capsule motion module: нужен допущенный target');
  }
  const select = field => Object.fromEntries(Object.entries(payload.variants).map(([variant, value]) => [variant, value[field]]));
  return [
    '/** GENERATED: оптическая ширина из авторского capsule закона; executor независим. */',
    "import { createCompiledBodyWidthPreparation, createCompiledBodyWidthCapabilities } from '../ir/capsule-motion-runtime.js';",
    `export const prepareBodyWidth = /* @__PURE__ */ createCompiledBodyWidthPreparation(${compactDataLiteral(select('motion'))});`,
    `export const motionCapabilities = /* @__PURE__ */ createCompiledBodyWidthCapabilities(${compactDataLiteral(select('capabilities'))});`,
    '',
  ].join('\n');
}

export function authorCapsuleMotionModuleDeclaration(payload) {
  const variants = Object.keys(payload.variants).sort();
  return [
    "import type { PrepareBodyWidthResult, BodyWidthMotionCapabilitiesResult } from '../ir/author-capsule-motion-types.js';",
    `export type MotionVariant = ${variants.map(jsonDataLiteral).join(' | ')};`,
    'export declare function prepareBodyWidth(variant?: MotionVariant): PrepareBodyWidthResult;',
    'export declare function motionCapabilities(variant?: MotionVariant): BodyWidthMotionCapabilitiesResult;',
    '',
  ].join('\n');
}
