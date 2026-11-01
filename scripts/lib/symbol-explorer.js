import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { buildSync } from 'esbuild';
import { authorPathEntries } from '../../src/core/icon-geometry.js';
import { loadAuthorBaseline } from './author-baseline.js';
import { authoringTutorialMaterial } from './authoring-tutorial.js';

/** Browser получает имена и членство из semantic spec; shape internals остаются у пакета. */
export function stateExplorerGroups(spec) {
  return Object.entries(spec.groups).map(([group, entry]) => ({
    group,
    members: Object.entries(entry.states).map(([state, member]) => ({
      state, icon: member.icon, variant: member.variant,
    })),
  }));
}

/** Runtime presence задаёт package contract; semantic spec задаёт точное членство. */
export function symbolExplorerBrowserFiles(contract, iconIds, stateGroups) {
  const stateFiles = stateGroups.map(({ group }) => `dist/states/${group}.js`);
  const files = ['dist/ir/request.js', 'dist/ir/symbol-runtime.js', 'dist/ir/render.js', 'dist/motion/index.js', 'dist/ir/lottie-runtime.js', 'dist/authoring/index.js',
    ...iconIds.flatMap(name => [`dist/symbols/${name}.js`, `dist/lottie/${name}.js`]),
    ...contract.files.filter(file => file === 'dist/ir/state-runtime.js'), ...stateFiles];
  for (const file of files) {
    if (!contract.files.includes(file)) throw new Error(`symbol explorer: ${file} не принадлежит package contract`);
  }
  for (const file of contract.files.filter(file => /^dist\/states\/[^/]+\.js$/.test(file))) {
    if (!stateFiles.includes(file)) throw new Error(`symbol explorer: ${file} не имеет semantic group`);
  }
  return files;
}

/** Observatory использует уже проверенные изображения и production package. */
export function writeSymbolExplorer({ repo, outDir, report, visuals, canvas, iconSvg, comparisonVisual, packageDir = join(repo, 'dist') }) {
  mkdirSync(outDir, { recursive: true });
  for (const name of ['index.html', 'explorer.css', 'explorer.js', 'authoring.html', 'authoring.js', 'download.js']) {
    copyFileSync(join(repo, 'observatory', name), join(outDir, name));
  }
  const starter = authoringTutorialMaterial(readFileSync(join(repo, 'docs/authoring.md'), 'utf8'), join(packageDir, 'authoring/index.js'));
  writeFileSync(join(outDir, 'authoring-example.js'), `export const starter = ${JSON.stringify(starter)};\n`);
  const motionPackage = JSON.parse(readFileSync(join(repo, 'node_modules/@labpics/motion/package.json'), 'utf8'));
  const executionIdentity = { package: motionPackage.name, version: motionPackage.version };
  buildSync({
    absWorkingDir: repo,
    entryPoints: ['observatory/motion-execution.js'],
    outfile: join(outDir, 'motion-execution.js'),
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
    define: { __MOTION_IDENTITY__: JSON.stringify(executionIdentity) },
  });
  // Полный записанный IR — отдельный opt-in по выбору прежней модели.
  buildSync({
    absWorkingDir: repo,
    stdin: { contents: "export { glyph, glyphCapabilities } from '@labpics/icons/ir';", resolveDir: repo, sourcefile: 'recorded-model-consumer.js' },
    outfile: join(outDir, 'recorded-model.js'),
    alias: { '@labpics/icons/ir': join(packageDir, 'ir/index.js'), '@labpics/icons': join(packageDir, 'index.js') },
    bundle: true, format: 'esm', platform: 'browser', target: 'es2022', minify: true,
  });
  const contract = JSON.parse(readFileSync(join(repo, 'release', 'contract.json'), 'utf8'));
  const baseline = loadAuthorBaseline(repo);
  const stateGroups = stateExplorerGroups(JSON.parse(readFileSync(join(repo, 'semantics/author-state-groups.json'), 'utf8')));
  const browserFiles = symbolExplorerBrowserFiles(contract, Object.keys(baseline.icons), stateGroups);
  for (const relative of browserFiles) {
    const target = join(outDir, 'package', relative.slice('dist/'.length));
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(packageDir, relative.slice('dist/'.length)), target);
  }
  const recordedRows = new Map(report.rows.map(row => [row.id, row]));
  const rows = Object.entries(baseline.icons).flatMap(([name, variants]) => ['outline', 'filled'].map(variant => {
    const author = variants[variant];
    const id = `${name}/${variant}`;
    const row = recordedRows.get(id);
    const recordedVisual = visuals.get(id);
    const visual = recordedVisual && { ...recordedVisual, originalEntries: authorPathEntries(author.normalizedSvg) };
    const original = `originals/${name}/${variant}.svg`;
    const master = `masters/${name}/${variant}.svg`;
    const generated = visual?.candidateEntries ? `generated/${name}/${variant}.svg` : null;
    const views = { original, master, generated, overlay: null, difference: null };
    const originalPath = join(outDir, original);
    mkdirSync(dirname(originalPath), { recursive: true });
    writeFileSync(originalPath, author.artifactSvg);
    const masterPath = join(outDir, master);
    mkdirSync(dirname(masterPath), { recursive: true });
    writeFileSync(masterPath, author.rawSvg);
    if (generated) {
      const generatedPath = join(outDir, generated);
      mkdirSync(dirname(generatedPath), { recursive: true });
      writeFileSync(generatedPath, iconSvg(visual.candidateEntries, canvas, 'generated', '', `explorer-${name}-${variant}-generated`));
      for (const kind of ['overlay', 'difference']) {
        views[kind] = `comparisons/${name}/${variant}-${kind}.svg`;
        const path = join(outDir, views[kind]);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, comparisonVisual(visual, canvas, id, kind));
      }
    }
    return { id, name, variant, views,
      original: { ...baseline.source, kind: 'FIGMA_AUTHOR', nodeId: author.nodeId, masterSha256: author.sha256 },
      model: row?.model ? { ...row.model, basis: 'RECORDED_REPOSITORY' } : null,
      metrics: null,
    };
  }));
  const data = { version: 2, source: baseline.source, executionIdentity, stateGroups, summary: { glyphs: Object.keys(baseline.icons).length, variants: rows.length }, rows };
  writeFileSync(join(outDir, 'explorer.json'), `${JSON.stringify(data)}\n`);
  return join(outDir, 'index.html');
}
