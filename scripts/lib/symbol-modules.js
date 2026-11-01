import { isDeepStrictEqual } from 'node:util';

const SYMBOL_NAME = /^[a-z][a-z0-9-]*$/;

/** Единственная release-проекция каталога; wildcard раскрывается в точные файлы. */
export function symbolReleaseProjection(base, iconIds) {
  const ids = [...iconIds].sort();
  if (new Set(ids).size !== ids.length || ids.some(id => !SYMBOL_NAME.test(id))) {
    throw new TypeError('symbol module projection: невалидные или повторные имена');
  }
  const exports = {
    '.': base.exports['.'],
    './ir': base.exports['./ir'],
    './ir/recipes': base.exports['./ir/recipes'],
    './ir/candidates': base.exports['./ir/candidates'],
    './ir/render': { types: './dist/ir/render.d.ts', import: './dist/ir/render.js' },
    './motion': { types: './dist/motion/index.d.ts', import: './dist/motion/index.js' },
    './symbols/*': { types: './dist/symbols/*.d.ts', import: './dist/symbols/*.js' },
  };
  const publicFiles = Object.entries(exports).flatMap(([key, conditions]) =>
    key.includes('*')
      ? ids.flatMap(id => Object.values(conditions).map(target => target.replace('*', id).slice(2)))
      : Object.values(conditions).map(target => target.slice(2)));
  const typeDependencies = ['dist/ir/catalog.generated.d.ts', 'dist/ir/compiler.d.ts', 'dist/ir/request.d.ts'];
  const runtimeDependencies = ['dist/ir/compiler.js', 'dist/ir/request.js', 'dist/ir/symbol-runtime.js'];
  return {
    version: 5,
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

/** Замкнутая anatomy-проекция: mirror получает только действительный источник. */
export function anatomyForSymbol(icon, catalog, anatomy) {
  const glyphs = {};
  const visiting = new Set();
  function include(name) {
    if (Object.hasOwn(glyphs, name)) return;
    if (visiting.has(name)) throw new Error(`symbol module: цикл anatomy ${name}`);
    const declaration = anatomy.glyphs[name];
    if (!declaration) throw new Error(`symbol module: anatomy ${name} отсутствует`);
    visiting.add(name);
    if (declaration.archetype === 'mirror') include(declaration.of);
    visiting.delete(name);
    glyphs[name] = declaration;
  }
  const model = catalog.icons[icon]?.model;
  if (model) include(model.declaration);
  return { version: anatomy.version, glyphs };
}

/** Компактный символ собирается тем же compiler, которым проверяется общий IR. */
export function renderSymbolModule({ icon, source, defaults, capabilities, axes, staticSvg, compilerInput }) {
  if (!SYMBOL_NAME.test(icon)) throw new TypeError('symbol module: невалидное имя');
  const json = value => JSON.stringify(value);
  const modelDefaults = variant => isDeepStrictEqual(defaults[variant], source[variant])
    ? `${variant}Source` : json(defaults[variant]);
  const lines = [
    '/** GENERATED: авторские masters и доказанные модели одного символа. */',
    "import { createCompiledSymbol } from '../ir/symbol-runtime.js';",
    ...(compilerInput ? ["import { createGlyphCompiler } from '../ir/compiler.js';"] : []),
    `export const outline = ${json(staticSvg.outline)};`,
    `export const filled = ${json(staticSvg.filled)};`,
    `const outlineSource = ${json(source.outline)};`,
    `const filledSource = ${json(source.filled)};`,
    ...(compilerInput ? [
      'let axesCompiler;',
      'function compileAxes(request) {',
      `  axesCompiler ??= createGlyphCompiler(${json(compilerInput)});`,
      '  return axesCompiler.glyph(request);',
      '}',
    ] : []),
    'const symbol = /* @__PURE__ */ createCompiledSymbol({',
    `  icon: ${json(icon)},`,
    `  axes: ${json(axes)},`,
    '  source: { outline: outlineSource, filled: filledSource },',
    `  defaults: { outline: ${modelDefaults('outline')}, filled: ${modelDefaults('filled')} },`,
    `  capabilities: ${json(capabilities)},`,
    `}${compilerInput ? ', compileAxes' : ''});`,
    'export const glyph = symbol.glyph;',
    'export const glyphCapabilities = symbol.glyphCapabilities;',
    '',
  ];
  return lines.join('\n');
}

export function symbolModuleDeclaration() {
  return [
    "import type { GlyphIR, GlyphCapabilities, GlyphRequest, IconVariant } from '../ir/compiler.js';",
    'export declare const outline: string;',
    'export declare const filled: string;',
    'export declare function glyph(request?: Omit<GlyphRequest, \'icon\'>): GlyphIR;',
    'export declare function glyphCapabilities(variant?: IconVariant): GlyphCapabilities;',
    '',
  ].join('\n');
}
