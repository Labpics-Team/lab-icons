import { createHash } from 'node:crypto';
import { compileAuthorAnatomyWithEvidence } from './author-anatomy.js';
import { authorSymbolPayload } from './author-baseline.js';
import { compactDataLiteral, jsonDataLiteral } from './generated-module.js';
import { symbolExportName } from './symbol-modules.js';

const VARIANTS = ['outline', 'filled'], NAME = /^[a-z][a-z0-9-]*$/;
const stableJSON = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const hash = value => createHash('sha256').update(stableJSON(value)).digest('hex');

/** Геометрический участник выбирается только явным семантическим законом. */
export function authorClockMotionSymbolNames(document) {
  return Object.keys(document.icons).filter(icon => Object.values(document.icons[icon])
    .some(declaration => declaration.joint?.law === 'joint.authored-elbow')).sort();
}

/** Один author spec проверяет masters и создаёт source и constructive projections. */
export function compileAuthorClockMotionSymbols(author, document, { grid, catalog, createGlyphCompiler }) {
  const names = authorClockMotionSymbolNames(document);
  if (!names.length) return {};
  const { contracts, jointEvidence } = compileAuthorAnatomyWithEvidence(author, { ...document,
    icons: Object.fromEntries(names.map(icon => [icon, document.icons[icon]])) }, grid, { scope: 'motion' });
  const sources = Object.fromEntries(names.map(icon => [icon, Object.fromEntries(VARIANTS.map(variant =>
    [variant, { ...author.icons[icon][variant],
      sourceContract: contracts[`${icon}/${variant}`] ?? author.icons[icon][variant].sourceContract }]))]));
  const compiler = createGlyphCompiler({ catalog: { canvas: catalog.canvas, axes: catalog.axes,
    icons: Object.fromEntries(names.map(icon => [icon, { model: null,
      source: Object.fromEntries(VARIANTS.map(variant => [variant, sources[icon][variant].sourceContract])) }])) },
    anatomy: { version: 1, glyphs: {} }, grid,
    staticIcons: Object.fromEntries(names.flatMap(icon => VARIANTS.map(variant =>
      [symbolExportName(icon, variant), author.icons[icon][variant].artifactSvg]))) });
  return Object.fromEntries(names.map(icon => {
    const payload = authorSymbolPayload(icon, sources[icon], compiler), variants = {};
    for (const variant of VARIANTS) {
      const joint = jointEvidence[`${icon}/${variant}`];
      if (!joint) continue;
      const glyph = payload.source[variant], declaration = document.icons[icon][variant];
      const physicalPart = glyph.parts[declaration.joint.pathIndex];
      if (!NAME.test(icon) || !physicalPart || joint.source.masterSha256 !== glyph.provenance.author.masterSha256 ||
          joint.source.pathFingerprintSha256 !== glyph.provenance.author.pathFingerprintSha256 ||
          joint.polarity === 'positive' && (glyph.composition.kind !== 'layers' || physicalPart.d !== joint.original.d ||
            physicalPart.fillRule !== 'nonzero' || joint.composition.kind !== 'nonzero-union' || joint.composition.winding !== 1)) {
        throw new TypeError('clock motion: source, авторский receipt и physical target расходятся');
      }
      const motion = { version: 1, law: joint.law, icon, variant, polarity: joint.polarity,
        coordinateSpace: 'viewBox', bearing: joint.bearing, viewBox: glyph.viewBox,
        limbs: joint.limbs.map((limb, index) => ({ ...limb, turnsPerHour: index === 0 ? 1 : 1 / 12 })),
        svg: glyph.svg, originalD: joint.original.d,
        renderTarget: { selector: `[data-part="${physicalPart.id}"]`, attribute: 'd',
          partIds: joint.limbs.map(limb => limb.id), unchangedPartIds: glyph.parts.filter(part => part.id !== physicalPart.id).map(part => part.id) } };
      const capabilities = joint.polarity === 'negative'
        ? { ok: false, reason: { code: 'COMPOSITION_UNSUPPORTED',
          message: 'Отрицательные стрелки требуют вычитания объединения; этот target ещё не подготовлен.' } }
        : { version: 1, law: joint.law, icon, variant, reference: 'authored-pose', parameter: 'elapsed-hours',
          formats: ['svg', 'prepared-clock-hands'], author: glyph.provenance.author,
          gesture: { id: 'clock.advance-hour', kind: 'state',
            meaning: 'Ход времени на один час от авторской позы: минутная стрелка делает оборот, часовая проходит один час.',
            from: 0, to: 1, unit: 'elapsed-hours' },
          geometrySha256: hash({ source: joint.source, bearing: joint.bearing, limbs: joint.limbs, composition: joint.composition }) };
      variants[variant] = { motion: { ...motion, packetSha256: hash(motion) }, capabilities };
    }
    return [icon, { icon, variants }];
  }));
}

export function renderAuthorClockMotionModule(payload) {
  if (!NAME.test(payload?.icon) || !Object.keys(payload.variants ?? {}).length ||
      Object.keys(payload.variants).some(variant => !VARIANTS.includes(variant))) throw new TypeError('clock module: нужен compiler target');
  // Неподдержанный target поставляет причину; его build evidence и operands не нужны runtime.
  const select = field => Object.fromEntries(Object.entries(payload.variants).map(([variant, value]) =>
    [variant, field === 'motion' && value.capabilities.ok === false ? value.capabilities : value[field]]));
  return [
    '/** GENERATED: авторские стрелки и один nonzero-union target; scheduler независим. */',
    "import { createCompiledClockPreparation, createCompiledClockCapabilities } from '../ir/clock-motion-runtime.js';",
    `export const prepareClockHands = /* @__PURE__ */ createCompiledClockPreparation(${compactDataLiteral(select('motion'))});`,
    `export const motionCapabilities = /* @__PURE__ */ createCompiledClockCapabilities(${compactDataLiteral(select('capabilities'))});`,
    '',
  ].join('\n');
}

export function authorClockMotionModuleDeclaration(payload) {
  return [
    "import type { PrepareClockHandsResult, ClockHandsCapabilitiesResult } from '../ir/author-clock-motion-types.js';",
    `export type MotionVariant = ${Object.keys(payload.variants).sort().map(jsonDataLiteral).join(' | ')};`,
    'export declare function prepareClockHands(variant?: MotionVariant): PrepareClockHandsResult;',
    'export declare function motionCapabilities(variant?: MotionVariant): ClockHandsCapabilitiesResult;',
    '',
  ].join('\n');
}
