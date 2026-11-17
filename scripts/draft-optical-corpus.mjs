import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadSymbolSource, projectAuthorBaseline } from './lib/symbol-source.js';
import { loadAuthorBaseline } from './lib/author-baseline.js';
import { authorPathEntries } from '../src/core/icon-geometry.js';
import { draftOpticalFields, inspectOpticalPaths } from './lib/optical-drafts.js';
import { opticalVariantMasters } from './lib/optical-corpus.js';
import { compileOpticalGrid } from './lib/optical-grid.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const document = loadSymbolSource(root), baseline = loadAuthorBaseline(root, { manifest: projectAuthorBaseline(document) });
const regenerate = process.argv.includes('--regenerate');
// Small-size detail and counter changes have independent signs. These are
// conservative draft profiles, not substitutes for visual optical correction.
document.opticalProfiles ??= {};
document.opticalProfiles['draft-outline'] ??= {
  weightOffset: [-0.1875, 0, 0.225], opszOffset: [0.06, 0, -0.025],
  counterOpszOffset: [-0.04, 0, 0.015], spanScale: [1.012, 1, 0.995],
};
document.opticalProfiles['draft-filled'] ??= {
  weightOffset: [-0.16, 0, 0.19], opszOffset: [0.045, 0, -0.02],
  counterOpszOffset: [-0.07, 0, 0.02], spanScale: [1.008, 1, 0.996],
};
const outputs = new Map(), summary = { families: 0, variants: 0, attenuated: [], flagged: [], retained: [] };
const started = performance.now();
for (const symbol of Object.values(document.symbols)) {
  const relative = `symbols/optics/${symbol.id}.json`, file = join(root, relative);
  const existing = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : null;
  if (existing && (!regenerate || existing.generator !== 'normal-field-v1' || existing.review !== 'unreviewed')) {
    summary.retained.push(symbol.id); continue;
  }
  const specification = { version: 1, review: 'unreviewed', generator: 'normal-field-v1', variants: {} };
  for (const variant of ['outline', 'filled']) {
    const author = baseline.icons[symbol.id][variant], source = authorPathEntries(author.normalizedSvg);
    const fields = draftOpticalFields(source);
    const recipe = { masterSha256: author.sha256, fieldProfile: `draft-${variant}`, fields };
    let projected, compiled;
    for (const scale of [1, 0.75, 0.5, 0.25, 0.125, 0.0625, 0.03125]) {
      recipe.fieldScale = scale;
      projected = opticalVariantMasters(document, symbol, variant, author, recipe);
      try { compiled = compileOpticalGrid(projected); break; }
      catch (error) {
        if (!String(error.message).includes('winding') || scale === 0.03125) throw new Error(`${symbol.id}/${variant}: ${error.message}`, { cause: error });
      }
    }
    if (recipe.fieldScale === 1) delete recipe.fieldScale;
    else summary.attenuated.push(`${symbol.id}/${variant}`);
    if (!compiled.paths.some(path => path.terms.length)) throw new Error(`${symbol.id}/${variant}: empty optical draft`);
    const original = inspectOpticalPaths(source), risks = [];
    for (const master of projected.masters) {
      if (master.weight === 400 && master.opsz === 24) continue;
      const diagnostics = inspectOpticalPaths(master.paths);
      diagnostics.forEach((path, index) => {
        const base = original[index], support = `${master.weight}/${master.opsz}`;
        if (path.crossings > base.crossings) risks.push({ support, path: index, issue: 'additional-crossings', baseline: base.crossings, observed: path.crossings });
        if (path.bounds.some((value, axis) => axis < 2 ? value < Math.min(0, base.bounds[axis]) - 0.01 : value > Math.max(24, base.bounds[axis]) + 0.01)) {
          risks.push({ support, path: index, issue: 'canvas-overflow', bounds: path.bounds });
        }
        path.areas.forEach((area, contour) => {
          if (Math.abs(area) < Math.abs(base.areas[contour]) * 0.2) risks.push({ support, path: index, contour, issue: 'near-collapse' });
        });
      });
    }
    recipe.diagnostics = { source: original, risks };
    if (risks.length || fields.some(field => field.contours.some(contour => contour.flags?.length))) summary.flagged.push(`${symbol.id}/${variant}`);
    specification.variants[variant] = recipe; summary.variants++;
  }
  symbol.opticalMaster = relative; outputs.set(file, JSON.stringify(specification) + '\n'); summary.families++;
  if (summary.families % 20 === 0) console.log(`Drafted ${summary.families} families in ${((performance.now() - started) / 1000).toFixed(1)}s`);
}
// Commit the new source bindings only after the whole run compiled. Existing
// authored recipes and review decisions are never overwritten by this command.
mkdirSync(join(root, 'symbols/optics'), { recursive: true });
for (const [file, bytes] of outputs) writeFileSync(file, bytes);
writeFileSync(join(root, 'symbols/source.json'), JSON.stringify(document, null, 2) + '\n');
mkdirSync(join(root, 'preview'), { recursive: true });
writeFileSync(join(root, 'preview/optical-draft-report.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ ...summary, retained: summary.retained.length, flagged: summary.flagged.length,
  seconds: (performance.now() - started) / 1000 }, null, 2));
