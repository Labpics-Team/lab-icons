import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { bundle } from '../../scripts/build-ir.mjs';
import { authoredSymbolPayloads } from '../../scripts/lib/authored-symbol-payload.js';
import { authorVariationIconNames } from '../../scripts/lib/author-variation.js';
import { expandReleaseExports, validateReleaseRuntimeDependencyGraph } from '../../scripts/lib/release-contract.js';
import { renderSymbolModules } from '../../scripts/lib/symbol-modules.js';

/** Малый native dist: production compiler и collector, без сборки каталога. */
export async function collectAnnulusNativeExportSurface(root) {
  const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
  const contract = read('release/contract.json'), anatomy = read('semantics/author-anatomy.json');
  const names = authorVariationIconNames(anatomy).filter(name => anatomy.icons[name].outline.variation.law === 'annulus.counter-scale');
  const expanded = expandReleaseExports(contract);
  const exports = Object.fromEntries(names.map(name => {
    const entry = `./variations/${name}`;
    assert(expanded[entry], `Нет действующего публичного entrypoint ${entry}`);
    return [entry, expanded[entry]];
  }));
  const inputs = await authoredSymbolPayloads(names);
  const fixture = mkdtempSync(join(root, '.annulus-surface-native-'));
  try {
    const pkg = join(fixture, 'node_modules/@labpics/icons'), out = join(pkg, 'dist');
    for (const directory of ['ir/symbol-data', 'variations']) mkdirSync(join(out, directory), { recursive: true });
    mkdirSync(join(pkg, 'release'));
    const compiled = await Promise.allSettled([
      bundle(root, out, 'src/ir/request.ts', 'ir/request.js'),
      bundle(root, out, 'src/ir/author-request-runtime.ts', 'ir/author-request-runtime.js', ['./request.js']),
      bundle(root, out, 'src/ir/symbol-runtime.ts', 'ir/symbol-runtime.js', ['./request.js', './author-request-runtime.js']),
      bundle(root, out, 'src/ir/author-annulus-runtime.ts', 'ir/annulus-runtime.js',
        ['./request.js', './symbol-runtime.js', './author-request-runtime.js', './annulus-geometry-runtime.js']),
      bundle(root, out, 'src/ir/annulus-geometry-runtime.ts', 'ir/annulus-geometry-runtime.js'),
    ]);
    const failure = compiled.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
    for (const name of names) {
      const modules = renderSymbolModules(inputs[name]);
      assert.equal(typeof modules.variation, 'string'); assert.equal(typeof modules.data, 'string');
      writeFileSync(join(out, `variations/${name}.js`), modules.variation);
      writeFileSync(join(out, `ir/symbol-data/${name}.js`), modules.data);
    }
    const runtimeDependencies = ['annulus-geometry-runtime', 'annulus-runtime', 'author-request-runtime', 'request', 'symbol-runtime']
      .map(name => `dist/ir/${name}.js`).concat(names.map(name => `dist/ir/symbol-data/${name}.js`)).sort();
    const subset = { packageName: contract.packageName, exports, runtimeDependencies,
      files: [...Object.values(exports).map(entry => entry.import.slice(2)), ...runtimeDependencies].sort() };
    assert.deepEqual(validateReleaseRuntimeDependencyGraph({ contract: subset, readText: file => readFileSync(join(pkg, file), 'utf8') }), []);
    writeFileSync(join(pkg, 'release/contract.json'), JSON.stringify(subset));
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: contract.packageName, type: 'module', exports }));
    writeFileSync(join(fixture, 'package.json'), JSON.stringify({ private: true, type: 'module' }));
    writeFileSync(join(fixture, 'expectations.json'), JSON.stringify(Object.fromEntries(names.map(name => [name,
      { source: inputs[name].source, staticSvg: inputs[name].staticSvg }]))));
    writeFileSync(join(fixture, 'consumer.mjs'), [
      "import assert from 'node:assert/strict';",
      "import {readFileSync} from 'node:fs';",
      `import {collectExportSurface} from ${JSON.stringify(pathToFileURL(join(root, 'scripts/lib/export-surface.js')).href)};`,
      `const surface=await collectExportSurface(${JSON.stringify(pkg)});const nativeSurface={};`,
      "const expected=JSON.parse(readFileSync(new URL('./expectations.json',import.meta.url),'utf8'));",
      `for(const name of ${JSON.stringify(names)}){const api=await import(${JSON.stringify(contract.packageName + '/variations/')}+name);`,
      "assert.equal(typeof api.glyph,'function');assert.equal(typeof api.glyphCapabilities,'function');",
      "for(const variant of ['outline','filled']){assert.deepEqual(api.glyph({variant}),expected[name].source[variant]);assert.equal(api[variant],expected[name].staticSvg[variant]);}",
      "assert.equal(api.glyph(),api.glyph({variation:{enclosureEmphasis:1}}));",
      "assert.equal(api.glyphCapabilities().variation.law,'annulus.counter-scale');",
      "assert.notEqual(api.glyph({variation:{enclosureEmphasis:1.1}}).d,api.glyph().d);",
      "assert.throws(()=>api.glyph({variant:'filled',variation:{enclosureEmphasis:1.1}}),error=>error.code==='AUTHOR_VARIATION_UNSUPPORTED');",
      "nativeSurface['./variations/'+name]=Object.keys(api).sort();}",
      "assert.deepEqual(nativeSurface,surface);console.log(JSON.stringify({surface,nativeSurface}));",
    ].join('\n'));
    return JSON.parse(execFileSync(process.execPath, ['consumer.mjs'], { cwd: fixture, encoding: 'utf8', stdio: 'pipe', windowsHide: true }));
  } finally {
    const absolute = resolve(fixture), workspace = resolve(root);
    if (!absolute.startsWith(workspace + '\\') && !absolute.startsWith(workspace + '/')) throw new Error('cleanup вне owned worktree');
    rmSync(fixture, { recursive: true, force: true });
  }
}
