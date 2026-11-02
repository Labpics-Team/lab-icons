import { compactDataLiteral, compactGeneratedModule, jsonDataLiteral, literalKey } from './generated-module.js';

const SYMBOL_NAME = /^[a-z][a-z0-9-]*$/;

/** Единственная release-проекция каталога; wildcard раскрывается в точные файлы. */
export function symbolReleaseProjection(base, iconIds, stateGroupIds = [], variationIconIds = []) {
  const ids = [...iconIds].sort();
  const groups = [...stateGroupIds].sort();
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
  };
  const publicFiles = Object.entries(exports).flatMap(([key, conditions]) =>
    key.includes('*')
      ? (key === './states/*' ? groups : ids).flatMap(id => Object.values(conditions).map(target => target.replace('*', id).slice(2)))
      : Object.values(conditions).map(target => target.slice(2)));
  const typeDependencies = ['dist/authoring/design-spec.d.ts', 'dist/ir/author-catalog.generated.d.ts', 'dist/ir/author-provenance.d.ts', 'dist/ir/author-source.d.ts', 'dist/ir/author-symbol.d.ts', 'dist/ir/authored-variation.d.ts', 'dist/ir/catalog.generated.d.ts', 'dist/ir/compiler.d.ts', 'dist/ir/request.d.ts', 'dist/ir/lottie-types.d.ts', 'dist/ir/state-types.d.ts'].sort();
  const runtimeDependencies = ['dist/ir/compiler.js', 'dist/ir/contour-runtime.js', 'dist/ir/request.js', 'dist/ir/symbol-runtime.js', 'dist/ir/lottie-runtime.js'].sort();
  if (variationIconIds.length) runtimeDependencies.push('dist/ir/variation-runtime.js');
  if (groups.length) {
    runtimeDependencies.push('dist/ir/state-runtime.js');
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

/** Компактный символ собирается тем же compiler, которым проверяется общий IR. */
export function renderSymbolModule({ icon, source, capabilities, staticSvg, variation }) {
  if (!SYMBOL_NAME.test(icon)) throw new TypeError('symbol module: невалидное имя');
  const json = jsonDataLiteral;
  const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
  const shared = [], references = {};
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
      shared.push({ name, value: left });
      references[variant].set(field, name);
    }
  }
  const emit = compact => {
    const serialize = compact ? compactDataLiteral : json;
    const sources = {}, capabilityReferences = new Map();
    for (const variant of ['outline', 'filled']) {
      const metadata = references[variant];
      sources[variant] = renderJSONRecord(source[variant], metadata.size
        ? new Map([['provenance', renderJSONRecord(source[variant].provenance, metadata, compact)]]) : new Map(), compact);
      if (metadata.size) capabilityReferences.set(variant, renderJSONRecord(capabilities[variant], metadata, compact));
    }
    return [
    '/** GENERATED: проверенные текущие авторские masters одного символа. */',
    variation ? "import { createCompiledCapabilities } from '../ir/symbol-runtime.js';" :
      "import { createCompiledGlyph, createCompiledCapabilities } from '../ir/symbol-runtime.js';",
    ...(variation ? ["import { createCompiledVariationGlyph } from '../ir/variation-runtime.js';"] : []),
    `export const outline = ${json(staticSvg.outline)};`,
    `export const filled = ${json(staticSvg.filled)};`,
    ...shared.map(({ name, value }) => `const ${name} = ${serialize(value)};`),
    `const outlineSource = ${sources.outline};`,
    `const filledSource = ${sources.filled};`,
    `export const glyph = /* @__PURE__ */ ${variation ? 'createCompiledVariationGlyph' : 'createCompiledGlyph'}(${json(icon)}, { outline: outlineSource, filled: filledSource }${variation ? `, ${json(variation)}` : ''});`,
    `export const glyphCapabilities = /* @__PURE__ */ createCompiledCapabilities(${renderJSONRecord(capabilities, capabilityReferences, compact)});`,
    '',
    ].join('\n');
  };
  return compactGeneratedModule([emit(false), emit(true)]);
}

export function symbolModuleDeclaration(icon, variation = false) {
  if (!SYMBOL_NAME.test(icon)) throw new TypeError('symbol declaration: невалидное имя');
  const api = variation ? 'AuthorVariationSymbolApi' : 'AuthorSymbolApi';
  return [
    `import type { ${api} } from '../ir/${variation ? 'authored-variation' : 'author-symbol'}.js';`,
    `type Api = ${api}<'${icon}'>;`,
    'export declare const outline: string;',
    'export declare const filled: string;',
    "export declare const glyph: Api['glyph'];",
    "export declare const glyphCapabilities: Api['glyphCapabilities'];",
    '',
  ].join('\n');
}
