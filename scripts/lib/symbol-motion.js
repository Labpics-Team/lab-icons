import { createHash } from 'node:crypto';
import { loadSymbolSource, projectAuthorAnatomy, projectAuthorBaseline } from './symbol-source.js';
import { loadAuthorBaseline } from './author-baseline.js';
import { compileAuthorAnatomyWithEvidence } from './author-anatomy.js';
import { compactDataLiteral } from './generated-module.js';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 24);
const variants = ['outline', 'filled'];

/** Select whole source contours, retaining every sparse coefficient and winding. */
function selectContours(path, selected) {
  let contour = -1, cursor = 0, commands = ''; const indices = [];
  for (const command of path.commands) {
    if (command === 'M') contour++;
    const count = command === 'C' ? 6 : command === 'Z' ? 0 : 2;
    if (selected.includes(contour)) { commands += command; for (let i = 0; i < count; i++) indices.push(cursor + i); }
    cursor += count;
  }
  if (!commands || selected.some(index => index > contour || index < 0)) throw new TypeError('Motion anatomy references a missing contour');
  const remap = new Map(indices.map((index, output) => [index, output]));
  return { commands, coordinates: indices.map(index => path.coordinates[index]), fillRule: 'nonzero',
    terms: path.terms.flatMap(([term, delta]) => {
      const result = [];
      for (let i = 0; i < delta.length; i += 2) if (remap.has(delta[i])) result.push(remap.get(delta[i]), delta[i + 1]);
      return result.length ? [[term, result]] : [];
    }) };
}

/** Standalone exporters use the same validated author tracks as the web build. */
export function compileSemanticCorpus(root, corpus) {
  const document = loadSymbolSource(root);
  const author = loadAuthorBaseline(root, { manifest: projectAuthorBaseline(document) });
  const { contracts } = compileAuthorAnatomyWithEvidence(author, projectAuthorAnatomy(document), undefined, { scope: 'source' });
  const semantics = Object.fromEntries(Object.keys(corpus.symbols).map(id => [id,
    compileSymbolMotion(id, corpus.symbols[id].data, Object.fromEntries(variants.map(variant => [variant,
      { motion: { gestures: contracts[`${id}/${variant}`]?.gestures ?? [] } }])), document.symbols[id])]));
  return { semantics, families: compileSymbolFamilies(semantics, document, corpus) };
}

/** Semantic lowering consumes validated author gesture tracks, never infers intent from names. */
export function compileSymbolMotion(symbol, data, capabilities, declaration) {
  return { variants: Object.fromEntries(variants.map(variant => {
    const anatomy = declaration.variants[variant].anatomy;
    const sourcePaths = data.variants[variant].paths;
    const subtract = anatomy.parts.some(part => part.role === 'counter' && declaration.draw?.[variant]?.[part.id]);
    const layer = subtract ? hash(sourcePaths) : undefined;
    const projected = subtract ? anatomy.parts.map(part => ({ part,
      path: part.contourIndices ? selectContours(sourcePaths[part.pathIndex], part.contourIndices) : sourcePaths[part.pathIndex] })) : null;
    if (projected) for (const [pathIndex, path] of sourcePaths.entries()) {
      const parts = anatomy.parts.filter(part => part.pathIndex === pathIndex);
      const contours = parts.flatMap(part => part.contourIndices ?? Array.from({ length: [...path.commands].filter(command => command === 'M').length }, (_, i) => i));
      if (new Set(contours).size !== contours.length || contours.length !== [...path.commands].filter(command => command === 'M').length) {
        throw new TypeError(`Subtractive motion must preserve every contour exactly once: ${symbol}/${variant}`);
      }
    }
    const paths = projected?.map(entry => entry.path) ?? sourcePaths;
    const parts = paths.map((path, pathIndex) => {
      const declarations = anatomy.parts.filter(part => part.pathIndex === pathIndex);
      const own = projected?.[pathIndex]?.part ?? (declarations.length === 1 && !declarations[0].contourIndices ? declarations[0] : undefined);
      const id = own?.id ?? `paint-${pathIndex}`;
      const draw = declaration.draw?.[variant]?.[id];
      if (draw && (!/^M[\d .,LC-]+$/.test(draw.path) || !Number.isFinite(draw.width) || draw.width <= 0)) {
        throw new TypeError(`Invalid authored draw guide: ${symbol}/${variant}/${id}`);
      }
      return { id, key: hash(layer ? { layer, path } : path), pathIndex, anchor: own?.anchor?.map(value => value * 24) ?? [12, 12],
        ...(draw && { draw }), ...(layer && { layer, ...(own.role === 'counter' && { negative: true }) }) };
    });
    const effects = {};
    for (const gesture of capabilities?.[variant]?.motion?.gestures ?? []) {
      const id = gesture.id.slice(gesture.id.indexOf('.') + 1);
      const tracks = gesture.tracks.map(track => ({ partId: track.partId,
        property: track.kind === 'translate' ? track.axis : track.kind,
        stops: track.kind === 'rotate' ? [[0, track.from], [1, track.to]] : track.stops.map(stop => [stop.at, stop.value]) }));
      if (tracks.some(track => !parts.some(part => part.id === track.partId))) continue;
      effects[id] = { duration: id === 'cycle' || id === 'activity' ? 900 : id === 'ring' ? 500 : 260,
        rest: gesture.restProgress ?? 0, tracks };
    }
    const drawn = parts.filter(part => part.draw);
    if (drawn.length) effects.draw = { duration: 360, rest: 1,
      tracks: drawn.map(part => ({ partId: part.id, property: 'draw', stops: [[0, 0], [1, 1]] })) };
    return [variant, { parts, effects, ...(projected && { paths }) }];
  })) };
}

/** One explicit source family list; resolved state data have no cyclic module imports. */
export function compileSymbolFamilies(semantics, document, corpus) {
  return Object.fromEntries(Object.entries(document.stateFamilies ?? {}).map(([family, group]) => {
    const id = Object.values(group)[0];
    if (!id || !corpus.symbols[id]) throw new TypeError(`Empty semantic state family: ${family}`);
    const states = {};
      for (const [name, target] of Object.entries(group)) {
        if (!/^[a-z][a-z0-9-]*$/.test(name) || !corpus.symbols[target]) throw new TypeError(`Unknown semantic state: ${id}/${name}/${target}`);
        if (Object.hasOwn(states, name) && states[name].id !== target) throw new TypeError(`Ambiguous semantic state: ${id}/${name}`);
        states[name] = target === id ? { id } : { id: target, data: corpus.symbols[target].data,
          semantics: { variants: semantics[target].variants } };
      }
    return [family, { ...corpus.symbols[id], semantics: { ...semantics[id], states } }];
  }));
}

export const renderSymbolFamilyModule = family => `\nexport const family = /* @__PURE__ */ Object.freeze(${compactDataLiteral(family)});\nexport default family;\n`;
export const symbolFamilyDeclaration = () => "\nimport type { IconSymbol } from '../render/index.js';\nexport declare const family: IconSymbol;\nexport default family;\n";
