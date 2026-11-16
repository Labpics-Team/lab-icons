import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { authorPathEntries } from '../../src/core/icon-geometry.js';
import { normalizeFigmaSvg } from './figma-import.js';

export const SYMBOL_VARIANTS = Object.freeze(['outline', 'filled']);
const sha256 = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);

/** Offline authority. Consumers receive compiled data, never this document. */
export function loadSymbolSource(root) {
  const source = JSON.parse(readFileSync(join(root, 'symbols/source.json'), 'utf8'));
  if (source.schemaVersion !== 1 || !source.symbols || !source.components || !source.capture?.source) {
    throw new TypeError('SymbolSource: expected versioned source, symbols and components');
  }
  for (const [id, symbol] of Object.entries(source.symbols)) {
    if (!/^[a-z][a-z0-9-]*$/.test(id) || symbol.id !== id ||
        Object.keys(symbol.variants).sort().join(',') !== 'filled,outline') {
      throw new TypeError(`SymbolSource: ${id} must have a stable family identity and both variants`);
    }
    for (const variant of SYMBOL_VARIANTS) if (symbol.compatibilityStatic) {
      const receipt = symbol.compatibilityStatic[variant];
      const expected = variant === 'outline' ? `svg/Outline/${id}.svg` : `svg/Filled/${id}_filled.svg`;
      if (receipt.file !== expected || sha256(readFileSync(join(root, expected))) !== receipt.sha256) {
        throw new Error(`SymbolSource: immutable compatibility snapshot changed: ${id}/${variant}`);
      }
    }
    for (const variant of SYMBOL_VARIANTS) {
      const entry = symbol.variants[variant];
      if (entry.provenance.style !== (variant === 'outline' ? 'Outline' : 'Filled')) {
        throw new TypeError(`SymbolSource: ${id}/${variant} style must come from Figma provenance`);
      }
      if (!entry.anatomy?.parts?.length) throw new TypeError(`SymbolSource: ${id}/${variant} has no paint parts`);
      for (const part of entry.anatomy.parts) {
        if (part.component && !source.components[part.component]) {
          throw new TypeError(`SymbolSource: ${id}/${variant} references missing component ${part.component}`);
        }
      }
    }
  }
  return source;
}

export function projectAuthorBaseline(source) {
  const icons = Object.fromEntries(Object.entries(source.symbols).map(([id, symbol]) => [id,
    Object.fromEntries(SYMBOL_VARIANTS.map(variant => {
      const { style: _style, ...receipt } = symbol.variants[variant].provenance;
      return [variant, receipt];
    })),
  ]));
  return { ...clone(source.capture), counts: { families: Object.keys(icons).length, variants: Object.keys(icons).length * 2 }, icons };
}

export function projectAuthorAnatomy(source) {
  const icons = {};
  for (const [id, symbol] of Object.entries(source.symbols)) {
    const variants = {};
    for (const variant of SYMBOL_VARIANTS) {
      const { classification, ...anatomy } = clone(symbol.variants[variant].anatomy);
      if (classification !== 'declared') continue;
      anatomy.parts = anatomy.parts.map(({ component, ...part }) => {
        // The component supplies semantics, while the master supplies coordinates.
        if (component) part.role = source.components[component].role;
        return part;
      });
      variants[variant] = anatomy;
    }
    if (Object.keys(variants).length) icons[id] = variants;
  }
  return { ...clone(source.compatibility.annotationHeader), icons };
}

export function projectCompatibilityAnatomy(source) {
  return { ...clone(source.compatibility.anatomyHeader), glyphs: Object.fromEntries(
    Object.entries(source.symbols).filter(([, value]) => value.compatibilityModel)
      .map(([id, value]) => [id, clone(value.compatibilityModel)])) };
}

/** Compare author path literals at build time; no geometric guessing in runtime. */
export function verifySymbolComponents(source, root, readMaster = path => readFileSync(path)) {
  const paths = new Map();
  const get = (id, variant) => {
    const key = `${id}/${variant}`;
    if (!paths.has(key)) {
      const receipt = source.symbols[id]?.variants[variant]?.provenance;
      if (!receipt) throw new TypeError(`SymbolSource: unknown component master ${key}`);
      const path = resolve(root, receipt.master);
      if (!path.startsWith(`${resolve(root)}${process.platform === 'win32' ? '\\' : '/'}`)) throw new TypeError('SymbolSource: master escapes repository');
      const bytes = readMaster(path);
      if (bytes.length !== receipt.bytes || sha256(bytes) !== receipt.sha256) throw new Error(`SymbolSource: changed master ${key}`);
      paths.set(key, authorPathEntries(normalizeFigmaSvg(bytes.toString('utf8'), { source: receipt.master })));
    }
    return paths.get(key);
  };
  let references = 0;
  for (const [id, symbol] of Object.entries(source.symbols)) for (const variant of SYMBOL_VARIANTS) {
    for (const part of symbol.variants[variant].anatomy.parts) if (part.component) {
      const component = source.components[part.component];
      const geometry = component.geometry;
      const own = get(id, variant)[part.pathIndex];
      const shared = get(geometry.symbol, geometry.variant)[geometry.pathIndex];
      if (!own || !shared || own.d !== shared.d || own.fillRule !== shared.fillRule) {
        throw new Error(`SymbolSource: ${id}/${variant}/${part.id} no longer matches ${part.component}`);
      }
      references++;
    }
  }
  return { components: Object.keys(source.components).length, references };
}

export function symbolSourceProjections(source) {
  return {
    'semantics/figma-baseline.json': projectAuthorBaseline(source),
    'semantics/author-anatomy.json': projectAuthorAnatomy(source),
    'semantics/anatomy.json': projectCompatibilityAnatomy(source),
    'semantics/author-state-groups.json': clone(source.compatibility.stateGroups),
  };
}

export function writeSymbolSourceProjections(root, { check = false } = {}) {
  const source = loadSymbolSource(root);
  const components = verifySymbolComponents(source, root);
  for (const [path, value] of Object.entries(symbolSourceProjections(source))) {
    const current = existsSync(join(root, path)) ? JSON.parse(readFileSync(join(root, path), 'utf8')) : null;
    // Preserve unchanged projections byte-for-byte, including historic ordering.
    // A metadata-only source edit must not regenerate every downstream artifact.
    if (stable(current) === stable(value)) continue;
    if (check) {
      throw new Error(`SymbolSource: stale projection ${path}; run pnpm generate:source`);
    } else {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), json(value));
    }
  }
  return { families: Object.keys(source.symbols).length, ...components };
}
