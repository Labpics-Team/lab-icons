const SYMBOL_NAME = /^[a-z][a-z0-9-]*$/;

/** Единственная release-проекция каталога; wildcard раскрывается в точные файлы. */
export function symbolReleaseProjection(base, iconIds, stateGroupIds = []) {
  const ids = [...iconIds].sort();
  const groups = [...stateGroupIds].sort();
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
  const typeDependencies = ['dist/authoring/design-spec.d.ts', 'dist/ir/author-catalog.generated.d.ts', 'dist/ir/author-provenance.d.ts', 'dist/ir/author-source.d.ts', 'dist/ir/catalog.generated.d.ts', 'dist/ir/compiler.d.ts', 'dist/ir/request.d.ts', 'dist/ir/lottie-types.d.ts'].sort();
  const runtimeDependencies = ['dist/ir/compiler.js', 'dist/ir/request.js', 'dist/ir/symbol-runtime.js', 'dist/ir/lottie-runtime.js'].sort();
  if (groups.length) {
    typeDependencies.push('dist/ir/state-types.d.ts');
    runtimeDependencies.push('dist/ir/state-runtime.js');
    typeDependencies.sort();
    runtimeDependencies.sort();
  }
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

/** Компактный символ собирается тем же compiler, которым проверяется общий IR. */
export function renderSymbolModule({ icon, source, capabilities, staticSvg }) {
  if (!SYMBOL_NAME.test(icon)) throw new TypeError('symbol module: невалидное имя');
  const json = value => JSON.stringify(value);
  const lines = [
    '/** GENERATED: проверенные текущие авторские masters одного символа. */',
    "import { createCompiledGlyph, createCompiledCapabilities } from '../ir/symbol-runtime.js';",
    `export const outline = ${json(staticSvg.outline)};`,
    `export const filled = ${json(staticSvg.filled)};`,
    `const outlineSource = ${json(source.outline)};`,
    `const filledSource = ${json(source.filled)};`,
    `export const glyph = /* @__PURE__ */ createCompiledGlyph(${json(icon)}, { outline: outlineSource, filled: filledSource });`,
    `export const glyphCapabilities = /* @__PURE__ */ createCompiledCapabilities(${json(capabilities)});`,
    '',
  ];
  return lines.join('\n');
}

export function symbolModuleDeclaration(icon) {
  if (!SYMBOL_NAME.test(icon)) throw new TypeError('symbol declaration: невалидное имя');
  return [
    "import type { AuthorSourceGlyph, AuthorSourceCapabilities, AuthorSymbolGlyphRequest } from '../ir/author-source.js';",
    "import type { IconVariant } from '../ir/compiler.js';",
    'export declare const outline: string;',
    'export declare const filled: string;',
    `export declare function glyph(request?: AuthorSymbolGlyphRequest): AuthorSourceGlyph<'${icon}'>;`,
    `export declare function glyphCapabilities(variant?: IconVariant): AuthorSourceCapabilities<'${icon}'>;`,
    '',
  ].join('\n');
}
