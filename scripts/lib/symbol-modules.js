import { compactDataLiteral, compactGeneratedModule, jsonDataLiteral, literalKey } from './generated-module.js';
import { authorVariationCapability } from './author-variation.js';
import { authorContentVariationCapability } from './author-annulus.js';
import { cyclePacketExpression, sourcePacketEligible, sourcePacketExpression, sourcePacketRuntimeTargets, translationCyclePacket } from './source-packet.js';
import { stateRuntimeTargets } from './author-state-groups.js';

const SYMBOL_NAME = /^[a-z][a-z0-9-]*$/;
const VARIATION_RUNTIME_TARGETS = {
  'dots.affine': { entry: 'src/ir/authored-variation.ts', runtime: 'variation-runtime.js', factory: 'createCompiledVariationGlyph' },
  'annulus.counter-scale': { entry: 'src/ir/author-annulus-runtime.ts', runtime: 'annulus-runtime.js', factory: 'createCompiledAnnulusGlyph' },
  'capsule.width': { entry: 'src/ir/author-capsule-runtime.ts', runtime: 'capsule-runtime.js', factory: 'createCompiledCapsuleGlyph' },
};

/** Отдельный opt-in оставляет content operands за границей старых потребителей. */
export function authorContentVariationIconNames(anatomy) {
  return Object.entries(anatomy.icons ?? {}).filter(([, variants]) => variants.outline?.contentVariation)
    .map(([icon]) => icon).sort();
}

export function contentVariationRuntimeTargets(names) {
  if (!Array.isArray(names) || names.some(name => !SYMBOL_NAME.test(name))) {
    throw new TypeError('content variation: невалидные имена');
  }
  return names.length ? [
    { entry: 'src/ir/author-content-runtime.ts', runtime: 'content-runtime.js' },
    { entry: 'src/ir/content-geometry-runtime.ts', runtime: 'content-geometry-runtime.js' },
  ] : [];
}

/** Размещение law runtime принадлежит target compiler, не каталогу или caller. */
export function variationRuntimeTargets(laws) {
  if (!Array.isArray(laws) || laws.some(law => !Object.hasOwn(VARIATION_RUNTIME_TARGETS, law))) {
    throw new TypeError('symbol variation: law не имеет runtime target');
  }
  return [...new Set(laws)].sort().map(law => ({ ...VARIATION_RUNTIME_TARGETS[law] }));
}

/** Единственная release-проекция каталога; wildcard раскрывается в точные файлы. */
export function symbolReleaseProjection(base, iconIds, stateGroupIds = [], variationIconIds = [], variationLaws = ['dots.affine'],
  compiledSymbolModules = [], stateVariationGroupIds = [], contentVariationIconIds = [], stateLaws = ['enclosure.replace'], motionIconIds = [], capsuleMotionIconIds = []) {
  const ids = [...iconIds].sort();
  const groups = [...stateGroupIds].sort();
  const stateVariations = [...stateVariationGroupIds].sort();
  const contentVariations = [...contentVariationIconIds].sort();
  const motions = [...motionIconIds].sort();
  const capsuleMotions = [...capsuleMotionIconIds].sort();
  if (new Set(motions).size !== motions.length || motions.some(id => !ids.includes(id))) {
    throw new TypeError('motion projection: символ должен принадлежать авторскому каталогу');
  }
  if (new Set(capsuleMotions).size !== capsuleMotions.length || capsuleMotions.some(id => !motions.includes(id))) {
    throw new TypeError('capsule motion projection: width target должен принадлежать gesture каталогу');
  }
  if (new Set(contentVariations).size !== contentVariations.length || contentVariations.some(id => !variationIconIds.includes(id))) {
    throw new TypeError('content variation projection: символ должен иметь авторский variation допуск');
  }
  if (new Set(stateVariations).size !== stateVariations.length || stateVariations.some(id => !groups.includes(id))) {
    throw new TypeError('state variation projection: группа должна принадлежать state каталогу');
  }
  if (new Set(variationIconIds).size !== variationIconIds.length || variationIconIds.some(id => !ids.includes(id))) {
    throw new TypeError('symbol module projection: variation должна принадлежать авторскому каталогу');
  }
  if (new Set(ids).size !== ids.length || ids.some(id => !SYMBOL_NAME.test(id)) ||
      new Set(groups).size !== groups.length || groups.some(id => !SYMBOL_NAME.test(id))) {
    throw new TypeError('symbol module projection: невалидные или повторные имена');
  }
  const exports = {
    '.': base.exports['.'],
    './ir': base.exports['./ir'],
    './ir/recipes': base.exports['./ir/recipes'],
    './ir/candidates': base.exports['./ir/candidates'],
    './ir/render': { types: './dist/ir/render.d.ts', import: './dist/ir/render.js' },
    './authoring': { types: './dist/authoring/index.d.ts', import: './dist/authoring/index.js' },
    './motion': { types: './dist/motion/index.d.ts', import: './dist/motion/index.js' },
    './symbols/*': { types: './dist/symbols/*.d.ts', import: './dist/symbols/*.js' },
    './lottie/*': { types: './dist/lottie/*.d.ts', import: './dist/lottie/*.js' },
    ...(groups.length ? { './states/*': { types: './dist/states/*.d.ts', import: './dist/states/*.js' } } : {}),
    ...(variationIconIds.length ? { './variations/*': { types: './dist/variations/*.d.ts', import: './dist/variations/*.js' } } : {}),
    ...(stateVariations.length ? { './state-variations/*': { types: './dist/state-variations/*.d.ts', import: './dist/state-variations/*.js' } } : {}),
    ...(contentVariations.length ? { './content-variations/*': { types: './dist/content-variations/*.d.ts', import: './dist/content-variations/*.js' } } : {}),
    ...(motions.length ? { './gestures/*': { types: './dist/gestures/*.d.ts', import: './dist/gestures/*.js' } } : {}),
  };
  const publicFiles = Object.entries(exports).flatMap(([key, conditions]) =>
    key.includes('*')
      ? (key === './states/*' ? groups : key === './state-variations/*' ? stateVariations : key === './content-variations/*' ? contentVariations : key === './gestures/*' ? motions : key === './variations/*' ? [...variationIconIds].sort() : ids).flatMap(id => Object.values(conditions).map(target => target.replace('*', id).slice(2)))
      : Object.values(conditions).map(target => target.slice(2)));
  const typeDependencies = ['dist/authoring/design-spec.d.ts', 'dist/ir/author-annulus-types.d.ts', 'dist/ir/author-content-types.d.ts', 'dist/ir/author-capsule-types.d.ts', 'dist/ir/author-catalog.generated.d.ts', 'dist/ir/author-provenance.d.ts', 'dist/ir/author-source.d.ts', 'dist/ir/authored-variation.d.ts', 'dist/ir/catalog.generated.d.ts', 'dist/ir/compiler.d.ts', 'dist/ir/glyph-types.d.ts', 'dist/ir/paint-types.d.ts', 'dist/ir/request.d.ts', 'dist/ir/lottie-types.d.ts', 'dist/ir/state-types.d.ts', 'dist/ir/state-common-types.d.ts', 'dist/ir/contour-state-types.d.ts'].sort();
  const runtimeDependencies = ['dist/ir/author-request-runtime.js', 'dist/ir/compiler.js', 'dist/ir/contour-runtime.js', 'dist/ir/request.js', 'dist/ir/symbol-runtime.js', 'dist/ir/lottie-runtime.js'].sort();
  if (motions.some(id => !capsuleMotions.includes(id))) {
    typeDependencies.push('dist/ir/gesture-types.d.ts'); typeDependencies.sort();
    runtimeDependencies.push('dist/ir/gesture-runtime.js');
  }
  if (capsuleMotions.length) {
    typeDependencies.push('dist/ir/author-capsule-motion-types.d.ts'); typeDependencies.sort();
    runtimeDependencies.push('dist/ir/capsule-motion-runtime.js');
  }
  if (groups.length && stateLaws.includes('source.replace')) {
    typeDependencies.push('dist/ir/source-state-types.d.ts'); typeDependencies.sort();
  }
  runtimeDependencies.push(...sourcePacketRuntimeTargets(compiledSymbolModules).map(target => `dist/ir/${target.runtime}`));
  if (variationIconIds.length) runtimeDependencies.push(...variationRuntimeTargets(variationLaws).map(target => `dist/ir/${target.runtime}`),
    ...variationIconIds.map(id => `dist/ir/symbol-data/${id}.js`));
  if (groups.length) {
    runtimeDependencies.push(...stateRuntimeTargets(stateLaws).map(target => `dist/ir/${target.runtime}`));
  }
  if (stateVariations.length) {
    runtimeDependencies.push('dist/ir/state-annulus-runtime.js');
    typeDependencies.push('dist/ir/state-annulus-types.d.ts'); typeDependencies.sort();
  }
  if (contentVariations.length) {
    runtimeDependencies.push(...contentVariationRuntimeTargets(contentVariations).map(target => `dist/ir/${target.runtime}`));
  }
  if (variationIconIds.length && variationLaws.includes('annulus.counter-scale') || stateVariations.length || contentVariations.length) {
    runtimeDependencies.push('dist/ir/annulus-geometry-runtime.js');
  }
  runtimeDependencies.sort();
  return {
    version: 7,
    packageName: base.packageName,
    primary: base.primary,
    fallback: base.fallback,
    files: [...new Set([...publicFiles, ...typeDependencies, ...runtimeDependencies])].sort(),
    typeDependencies,
    runtimeDependencies,
    exports,
  };
}

export function symbolExportName(icon, variant) {
  return `${icon.replace(/-([a-z0-9])/g, (_, char) => char.toUpperCase())}${variant === 'outline' ? 'Outline' : 'Filled'}`;
}

/** Build-only ссылки заменяют только названные поля проверенной JSON-проекции. */
function renderJSONRecord(value, references, compact = false) {
  const serialize = compact ? compactDataLiteral : jsonDataLiteral;
  if (!references.size) return serialize(value);
  return `{${Object.entries(value).flatMap(([key, item]) => {
    const encoded = references.get(key) ?? serialize(item);
    return encoded === undefined ? [] : [`${literalKey(key, compact)}:${encoded}`];
  }).join(',')}}`;
}

function sourceCapabilities(input) {
  const result = { ...input };
  for (const variant of ['outline', 'filled']) {
    const capability = input[variant];
    if (capability && typeof capability === 'object' && Object.hasOwn(capability, 'variation')) {
      const { variation: _variation, ...base } = capability;
      result[variant] = base;
    }
  }
  return result;
}

/** Сборка разбивает только exact строки; consumer не разбирает path или SVG. */
function pathStringExpression(value, references) {
  let fragments = [{ value }];
  for (const [path, reference] of references) {
    fragments = fragments.flatMap(fragment => fragment.reference ? [fragment]
      : fragment.value.split(path).flatMap((value, index) => index ? [{ reference }, { value }] : [{ value }]));
  }
  return fragments.filter(fragment => fragment.reference || fragment.value)
    .map(fragment => fragment.reference ?? jsonDataLiteral(fragment.value)).join('+') || '""';
}

/** Общий build-only источник записей и ссылок: размещение не меняет authored данные. */
function sourceRecords({ source, capabilities, staticSvg }, compact, sharePaths = false, packet = false) {
  const json = jsonDataLiteral;
  const serialize = compact ? compactDataLiteral : json;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const shared = [], paths = [], references = {};
  for (const variant of ['outline', 'filled']) {
    const provenance = source[variant]?.provenance, capability = capabilities[variant];
    references[variant] = new Map();
    for (const field of ['author', 'anatomy']) {
      const left = provenance?.[field], right = capability?.[field];
      // Независимые авторские варианты не объединяются даже при равных receipts.
      // Расходящиеся или отсутствующие записи остаются исходными JSON-литералами.
      if (!record(left) || !record(right)) continue;
      const encoded = json(left);
      if (encoded !== json(right)) continue;
      const name = `${variant}${field === 'author' ? 'Author' : 'Anatomy'}`;
      shared.push(`const ${name} = ${serialize(left)};`);
      references[variant].set(field, name);
    }
  }
  const sources = {}, capabilityRecords = {}, capabilityReferences = new Map();
  for (const variant of ['outline', 'filled']) {
    const metadata = references[variant], sourceReferences = new Map();
    if (metadata.size) sourceReferences.set('provenance', renderJSONRecord(source[variant].provenance, metadata, compact));
    if (source[variant].svg === staticSvg[variant]) sourceReferences.set('svg', variant);
    const shape = source[variant];
    const geometry = sharePaths && typeof shape.d === 'string' && typeof shape.svg === 'string' &&
      Array.isArray(shape.parts) && shape.parts.length && shape.parts.every(part => record(part) && typeof part.d === 'string' && part.d.length)
      ? shape.parts.map((part, index) => [part.d, `${variant}Path${index}`]) : [];
    if (geometry.length) {
      paths.push(...geometry.map(([path, name]) => `const ${name} = ${json(path)};`));
      sourceReferences.set('parts', `[${shape.parts.map((part, index) => renderJSONRecord(part,
        new Map([['d', `${variant}Path${index}`]]), compact)).join(',')}]`);
      sourceReferences.set('d', pathStringExpression(shape.d, geometry));
      sourceReferences.set('svg', pathStringExpression(shape.svg, geometry));
    }
    const rendered = renderJSONRecord(shape, sourceReferences, compact);
    // PURE закрывает string expressions целиком: caps/static не удерживают
    // geometry из-за потенциального coercion в неиспользуемом source record.
    sources[variant] = packet ? sourcePacketExpression(shape, geometry, metadata, pathStringExpression)
      : geometry.length ? `/* @__PURE__ */ (() => (${rendered}))()` : rendered;
    const capabilityMetadata = new Map(metadata);
    if (packet) capabilityMetadata.set('motion', cyclePacketExpression(translationCyclePacket(capabilities[variant].motion)));
    capabilityRecords[variant] = renderJSONRecord(capabilities[variant], capabilityMetadata, compact);
    if (capabilityMetadata.size) capabilityReferences.set(variant, capabilityRecords[variant]);
  }
  return { shared, paths, sources, capabilityRecords, capabilities: renderJSONRecord(capabilities, capabilityReferences, compact),
    static: ['outline', 'filled'].map(variant => `export const ${variant} = ${json(staticSvg[variant])};`) };
}

/** Компактный символ собирается тем же compiler, которым проверяется общий IR. */
export function renderSymbolModule(input) {
  if (!SYMBOL_NAME.test(input.icon)) throw new TypeError('symbol module: невалидное имя');
  input = { ...input, capabilities: sourceCapabilities(input.capabilities) };
  const emit = (compact, sharePaths = false, packet = false) => {
    const records = sourceRecords(input, compact, sharePaths, packet);
    return [
    packet ? '/** GENERATED */' : '/** GENERATED: проверенные текущие авторские masters одного символа. */',
    "import { createCompiledGlyph, createCompiledCapabilities } from '../ir/symbol-runtime.js';",
    ...(packet ? ["import { materializeSourceV1, materializeTranslationCycleV1 } from '../ir/source-packet-runtime.js';"] : []),
    ...records.paths, ...records.static, ...records.shared,
    `const outlineSource = ${records.sources.outline};`,
    `const filledSource = ${records.sources.filled};`,
    `export const glyph = /* @__PURE__ */ createCompiledGlyph(${jsonDataLiteral(input.icon)}, { outline: outlineSource, filled: filledSource });`,
    `export const glyphCapabilities = /* @__PURE__ */ createCompiledCapabilities(${records.capabilities});`,
    '',
    ].join('\n');
  };
  const packet = ['outline', 'filled'].every(variant => sourcePacketEligible(input.source[variant], input.icon, variant) &&
    translationCyclePacket(input.capabilities[variant]?.motion));
  return compactGeneratedModule([emit(false), emit(true), emit(false, true), emit(true, true), ...(packet ? [emit(true, true, true)] : [])]);
}

export function symbolModuleDeclaration(icon) {
  if (!SYMBOL_NAME.test(icon)) throw new TypeError('symbol declaration: невалидное имя');
  return [
    "import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';",
    'export declare const outline: string;',
    'export declare const filled: string;',
    `export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'${icon}'>;`,
    `export declare function glyphCapabilities(variant?: AuthorSourceCapabilities['variant']): AuthorSourceCapabilities<'${icon}'>;`,
    '',
  ].join('\n');
}

/** Только доказанный opt-in использует общие source объекты; каталог не переносится. */
export function renderSymbolModules(input) {
  const { icon, source, staticSvg, variation } = input;
  const capabilities = sourceCapabilities(input.capabilities);
  if (input.contentVariation && !variation) throw new TypeError('content variation: отсутствует авторский annulus variation допуск');
  if (!variation) return { symbol: renderSymbolModule({ icon, source, staticSvg, capabilities }) };
  const law = variation.outline?.law;
  const target = variationRuntimeTargets([law])[0];
  if (!SYMBOL_NAME.test(icon) || Object.keys(variation).some(variant => !['outline', 'filled'].includes(variant)) ||
      law === 'dots.affine' && !variation.filled || law === 'annulus.counter-scale' && variation.filled) {
    throw new TypeError('symbol variation: law не соответствует допущенным независимым авторским формам');
  }
  for (const variant of ['outline', 'filled']) {
    const compiled = variation[variant], capability = input.capabilities[variant]?.variation;
    if (!compiled && !capability) continue;
    if (!compiled || compiled.law !== law || !capability ||
        jsonDataLiteral(authorVariationCapability(compiled)) !== jsonDataLiteral(capability)) {
      throw new TypeError(`symbol variation: ${icon}/${variant}: compiled domain и capability не совпадают`);
    }
  }
  const caps = input.capabilities;
  const emitData = (compact, sharePaths = false) => {
    const records = sourceRecords({ source, staticSvg, capabilities }, compact, sharePaths);
    const lines = [...records.paths, ...records.static, ...records.shared];
    for (const variant of ['outline', 'filled']) {
      lines.push(`export const ${variant}Source = ${records.sources[variant]};`);
      lines.push(`export const ${variant}Capabilities = ${records.capabilityRecords[variant]};`);
    }
    return lines.join('\n');
  };
  const dataPath = `../ir/symbol-data/${icon}.js`;
  const imports = `import { outline, filled, outlineSource, filledSource, outlineCapabilities, filledCapabilities } from '${dataPath}';`;
  const exports = 'export { outline, filled };';
  const base = [imports, "import { createCompiledGlyph, createCompiledCapabilities } from '../ir/symbol-runtime.js';", exports,
    `export const glyph = /* @__PURE__ */ createCompiledGlyph(${jsonDataLiteral(icon)}, { outline: outlineSource, filled: filledSource });`,
    'export const glyphCapabilities = /* @__PURE__ */ createCompiledCapabilities({ outline: outlineCapabilities, filled: filledCapabilities });', ''].join('\n');
  const variable = compact => [imports,
    `import { ${target.factory} } from '../ir/${target.runtime}';`,
    "import { createCompiledCapabilities } from '../ir/symbol-runtime.js';", exports,
    `export const glyph = /* @__PURE__ */ ${target.factory}(${jsonDataLiteral(icon)}, { outline: outlineSource, filled: filledSource }, ${(compact ? compactDataLiteral : jsonDataLiteral)(law === 'annulus.counter-scale' ? variation.outline : variation)});`,
    // PURE закрывает весь materializer: неиспользуемый capability export не
    // оставляет чтения/spread данных в аргументе удалённой внешней фабрики.
    `export const glyphCapabilities = /* @__PURE__ */ createCompiledCapabilities(/* @__PURE__ */ (() => ({${['outline', 'filled'].map(variant =>
      `${variant}: ${caps[variant].variation ? `{ ...${variant}Capabilities, variation: ${(compact ? compactDataLiteral : jsonDataLiteral)(caps[variant].variation)} }` : `${variant}Capabilities`}`).join(',')}}))());`, ''].join('\n');
  const modules = { symbol: base, data: compactGeneratedModule([emitData(false), emitData(true), emitData(false, true), emitData(true, true)]),
    variation: compactGeneratedModule([variable(false), variable(true)]) };
  if (input.contentVariation) {
    modules.contentVariation = renderContentVariationModule(input);
  }
  return modules;
}

/** Использует прежние exact source records; новую геометрию несёт только этот модуль. */
function renderContentVariationModule(input) {
  const { icon, contentVariation, variation } = input, compiled = contentVariation.outline;
  if (Object.keys(contentVariation).some(variant => variant !== 'outline') || !compiled ||
      compiled.law !== 'annulus.content-counter-scale' || variation?.outline?.law !== 'annulus.counter-scale' ||
      compiled.source.masterSha256 !== variation.outline.source.masterSha256 ||
      compiled.source.pathFingerprintSha256 !== variation.outline.source.pathFingerprintSha256) {
    throw new TypeError('content variation: нужен доказанный Outline content/annulus packet того же master');
  }
  const capability = authorContentVariationCapability(compiled);
  const emit = compact => {
    const literal = compact ? compactDataLiteral : jsonDataLiteral;
    return [
      `import { outline, filled, outlineSource, filledSource, outlineCapabilities, filledCapabilities } from '../ir/symbol-data/${icon}.js';`,
      "import { createCompiledContentGlyph } from '../ir/content-runtime.js';",
      "import { createCompiledCapabilities } from '../ir/symbol-runtime.js';",
      'export { outline, filled };',
      `export const glyph = /* @__PURE__ */ createCompiledContentGlyph(${jsonDataLiteral(icon)}, { outline: outlineSource, filled: filledSource }, ${literal(compiled)});`,
      `export const glyphCapabilities = /* @__PURE__ */ createCompiledCapabilities(/* @__PURE__ */ (() => ({ outline: { ...outlineCapabilities, variation: ${literal(capability)} }, filled: filledCapabilities }))());`,
      '',
    ].join('\n');
  };
  return compactGeneratedModule([emit(false), emit(true)]);
}

export function contentVariationModuleDeclaration(icon) {
  if (!SYMBOL_NAME.test(icon)) throw new TypeError('content variation declaration: невалидное имя');
  const supported = `AuthorContentVariationCapabilities<'${icon}'>`;
  const source = `AuthorSourceCapabilities<'${icon}'> & Readonly<{ variant: 'filled' }>`;
  return [
    "import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';",
    "import type { AuthorContentVariationGlyph, AuthorContentVariationCapabilities, AuthorContentVariationGlyphRequest } from '../ir/author-content-types.js';",
    'export declare const outline: string;', 'export declare const filled: string;',
    `export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'${icon}'>;`,
    `export declare function glyph(request: AuthorContentVariationGlyphRequest): AuthorContentVariationGlyph<'${icon}'>;`,
    `export declare function glyphCapabilities(variant?: 'outline'): ${supported};`,
    `export declare function glyphCapabilities(variant: 'filled'): ${source};`,
    `export declare function glyphCapabilities(variant: 'outline' | 'filled'): ${supported} | (${source});`, '',
  ].join('\n');
}

export function variationModuleDeclaration(icon, law = 'dots.affine', variants) {
  if (!SYMBOL_NAME.test(icon)) throw new TypeError('variation declaration: невалидное имя');
  variationRuntimeTargets([law]);
  if (law === 'capsule.width') {
    if (!Array.isArray(variants) || !variants.includes('outline') || new Set(variants).size !== variants.length ||
        variants.some(variant => !['outline', 'filled'].includes(variant))) {
      throw new TypeError('capsule declaration: невалидные admitted variants');
    }
    const admitted = variants.map(variant => `'${variant}'`).join(' | ');
    return [
      "import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';",
      "import type { AuthorCapsuleVariationGlyph, AuthorCapsuleVariationCapabilities, AuthorCapsuleVariationGlyphRequest } from '../ir/author-capsule-types.js';",
      'export declare const outline: string;', 'export declare const filled: string;',
      `export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'${icon}'>;`,
      `export declare function glyph(request: AuthorCapsuleVariationGlyphRequest<'outline'>): AuthorCapsuleVariationGlyph<'${icon}', 'outline'>;`,
      `export declare function glyph<TVariant extends ${admitted}>(request: AuthorCapsuleVariationGlyphRequest<TVariant> & Readonly<{variant:TVariant}>): AuthorCapsuleVariationGlyph<'${icon}', TVariant>;`,
      `export declare function glyph(request: AuthorCapsuleVariationGlyphRequest<${admitted}>): AuthorCapsuleVariationGlyph<'${icon}', ${admitted}>;`,
      `export declare function glyphCapabilities(variant?: 'outline'): AuthorCapsuleVariationCapabilities<'${icon}', 'outline'>;`,
      `export declare function glyphCapabilities(variant: 'filled'): ${variants.includes('filled') ? `AuthorCapsuleVariationCapabilities<'${icon}', 'filled'>` : `AuthorSourceCapabilities<'${icon}'> & Readonly<{variant:'filled'}>`};`,
      `export declare function glyphCapabilities(variant: 'outline' | 'filled'): AuthorCapsuleVariationCapabilities<'${icon}', 'outline'> | ${variants.includes('filled') ? `AuthorCapsuleVariationCapabilities<'${icon}', 'filled'>` : `AuthorSourceCapabilities<'${icon}'> & Readonly<{variant:'filled'}>`};`, '',
    ].join('\n');
  }
  if (law === 'annulus.counter-scale') {
    const supported = `AuthorAnnulusVariationCapabilities<'${icon}'>`;
    const source = `AuthorSourceCapabilities<'${icon}'> & Readonly<{ variant: 'filled' }>`;
    return [
      "import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';",
      "import type { AuthorAnnulusVariationGlyph, AuthorAnnulusVariationCapabilities, AuthorAnnulusVariationGlyphRequest } from '../ir/author-annulus-types.js';",
      'export declare const outline: string;', 'export declare const filled: string;',
      `export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'${icon}'>;`,
      `export declare function glyph(request: AuthorAnnulusVariationGlyphRequest): AuthorAnnulusVariationGlyph<'${icon}'>;`,
      `export declare function glyphCapabilities(variant?: 'outline'): ${supported};`,
      `export declare function glyphCapabilities(variant: 'filled'): ${source};`,
      `export declare function glyphCapabilities(variant: 'outline' | 'filled'): ${supported} | (${source});`, '',
    ].join('\n');
  }
  return [
    "import type { AuthorSourceGlyph, AuthorSymbolGlyphRequest } from '../ir/author-source.js';",
    "import type { AuthorVariationGlyph, AuthorVariationCapabilities, AuthorVariationGlyphRequest } from '../ir/authored-variation.js';",
    'export declare const outline: string;',
    'export declare const filled: string;',
    `export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'${icon}'>;`,
    `export declare function glyph(request: AuthorVariationGlyphRequest): AuthorVariationGlyph<'${icon}'>;`,
    `export declare function glyphCapabilities(variant?: AuthorVariationCapabilities['variant']): AuthorVariationCapabilities<'${icon}'>;`, '',
  ].join('\n');
}
