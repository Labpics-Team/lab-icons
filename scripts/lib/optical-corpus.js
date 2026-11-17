import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadSymbolSource, projectAuthorBaseline, verifySymbolComponents } from './symbol-source.js';
import { loadAuthorBaseline } from './author-baseline.js';
import { authorPathEntries } from '../../src/core/icon-geometry.js';
import { opticalRecipeMasters } from './optical-recipes.js';
import { compileOpticalGrid } from './optical-grid.js';

/** One projection serves renderer, exporters and atlas; shipping requires the full reviewed corpus. */
export function compileOpticalCorpus(root, { preview = false } = {}) {
  const document = loadSymbolSource(root);
  const baseline = loadAuthorBaseline(root, { manifest: projectAuthorBaseline(document) });
  verifySymbolComponents(document, root);
  const axes = document.axisDesign, symbols = {}, profiles = document.opticalProfiles ?? {};
  const withProfile = recipe => {
    if (recipe.profile !== undefined && !Object.hasOwn(profiles, recipe.profile)) {
      throw new TypeError(`optical master has an unknown profile: ${recipe.profile}`);
    }
    return { ...profiles[recipe.profile], ...recipe };
  };
  for (const symbol of Object.values(document.symbols)) {
    if (!symbol.opticalMaster) {
      if (preview) continue;
      throw new Error(`optical corpus has no authored masters for ${symbol.id}`);
    }
    if (symbol.opticalMaster !== `symbols/optics/${symbol.id}.json`) throw new TypeError('optical master must belong to its symbol');
    const specification = JSON.parse(readFileSync(join(root, symbol.opticalMaster), 'utf8'));
    if (specification.version !== 1 || !specification.variants ||
        Object.keys(specification.variants).sort().join(',') !== 'filled,outline') throw new TypeError('optical master requires both variants');
    if (!preview && specification.review !== 'accepted') throw new Error(`optical masters still need visual review: ${symbol.id}`);
    const variants = {};
    for (const variant of ['outline', 'filled']) {
      const author = baseline.icons[symbol.id][variant], recipe = specification.variants[variant];
      if (recipe.masterSha256 !== author.sha256) throw new Error(`optical master source changed: ${symbol.id}/${variant}`);
      const source = authorPathEntries(author.normalizedSvg);
      const recipes = recipe.paths.map(withProfile);
      const components = symbol.variants[variant].anatomy.parts.flatMap(part => {
        const component = document.components[part.component];
        return component?.opticalRecipe ? [{ ...withProfile(component.opticalRecipe), pathIndex: part.pathIndex,
          center: component.anchors.center.map(value => value * 24) }] : [];
      });
      const compiled = compileOpticalGrid({ axes, source,
        masters: opticalRecipeMasters({ axes, source, recipes: [...recipes, ...components] }) });
      variants[variant] = { paths: compiled.paths };
    }
    symbols[symbol.id] = { id: symbol.id, outline: baseline.icons[symbol.id].outline.artifactSvg,
      filled: baseline.icons[symbol.id].filled.artifactSvg, data: { version: 1, axes, variants } };
  }
  return { axes, symbols };
}
