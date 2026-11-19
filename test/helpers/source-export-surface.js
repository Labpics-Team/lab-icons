import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { build } from 'esbuild';
import { loadAuthorBaseline } from '../../scripts/lib/author-baseline.js';
import { renderSymbolModule } from '../../scripts/lib/symbol-modules.js';

export async function importSourceBundle(contents) {
  return import(`data:text/javascript;base64,${Buffer.from(contents).toString('base64')}`);
}

/** Ограниченное наблюдение source/template exports; не заменяет проверку packed dist. */
export async function reflectAddedSourceSurface(root, names) {
  const manifest = JSON.parse(readFileSync(join(root, 'semantics/figma-baseline.json'), 'utf8'));
  const selected = { ...manifest, counts: { families: names.length, variants: names.length * 2 },
    icons: Object.fromEntries(names.map(name => [name, manifest.icons[name]])) };
  const author = loadAuthorBaseline(root, { manifest: selected });
  const surface = {}, bundles = {}, modules = {};
  for (const [entry, source] of [['./ir/render', 'src/ir/render.ts'], ['./motion', 'src/motion/index.ts']]) {
    const result = await build({ entryPoints: [join(root, source)], bundle: true, write: false,
      format: 'esm', platform: 'browser', logLevel: 'silent' });
    bundles[entry] = result.outputFiles[0].text;
    modules[entry] = await importSourceBundle(bundles[entry]);
    surface[entry] = Object.keys(modules[entry]).sort();
  }
  for (const name of names) {
    // Экспортная грамматика template не зависит от формы IR. Masters здесь
    // служат настоящими static payload controls, не oracle семантической геометрии.
    const source = Object.fromEntries(['outline', 'filled'].map(variant => [variant,
      { icon: name, variant, svg: author.icons[name][variant].artifactSvg } ]));
    const staticSvg = Object.fromEntries(['outline', 'filled'].map(variant => [variant, source[variant].svg]));
    const capabilities = Object.fromEntries(['outline', 'filled'].map(variant => [variant, { icon: name, variant }]));
    const contents = renderSymbolModule({ icon: name, source, staticSvg, capabilities });
    const result = await build({ stdin: { contents, loader: 'js', resolveDir: root },
      bundle: true, write: false, format: 'esm', platform: 'browser', logLevel: 'silent',
      plugins: [{ name: 'actual-symbol-runtime', setup(plugin) {
        plugin.onResolve({ filter: /^\.\.\/ir\/symbol-runtime\.js$/ }, () => ({
          path: join(root, 'src/ir/symbol-runtime.ts'),
        }));
      } }],
    });
    const entry = `./symbols/${name}`;
    bundles[entry] = result.outputFiles[0].text;
    modules[entry] = await importSourceBundle(bundles[entry]);
    surface[entry] = Object.keys(modules[entry]).sort();
    if (modules[entry].outline !== staticSvg.outline || modules[entry].filled !== staticSvg.filled) {
      throw new Error(`source export reflection: ${entry} потерял static master`);
    }
  }
  return { surface, bundles, modules };
}
