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

/** Вариативность открывает только производный публичный entrypoint пакета. */
export function symbolExplorerVariationIds(contract, iconIds) {
  const files = contract.files.filter(file => /^dist\/variations\/[^/]+\.js$/.test(file));
  const entry = contract.exports?.['./variations/*'];
  if (files.length && (entry?.import !== './dist/variations/*.js' || entry?.types !== './dist/variations/*.d.ts')) {
    throw new Error('symbol explorer: variation output не имеет публичного package entry');
  }
  const ids = files.map(file => file.slice('dist/variations/'.length, -'.js'.length)).sort();
  if (new Set(ids).size !== ids.length || ids.some(id => !/^[a-z][a-z0-9-]*$/.test(id) || !iconIds.includes(id))) {
    throw new Error('symbol explorer: variation output не принадлежит авторскому каталогу');
  }
  for (const id of ids) {
    if (!contract.files.includes(`dist/variations/${id}.d.ts`)) {
      throw new Error(`symbol explorer: variation ${id} не имеет declaration в package contract`);
    }
  }
  return ids;
}

/** Opt-in оболочки выводятся из опубликованных entries и semantic membership. */
export function symbolExplorerStateVariationIds(contract, stateGroups) {
  const files = contract.files.filter(file => /^dist\/state-variations\/[^/]+\.js$/.test(file));
  const entry = contract.exports?.['./state-variations/*'];
  if (files.length && (entry?.import !== './dist/state-variations/*.js' ||
      entry?.types !== './dist/state-variations/*.d.ts')) {
    throw new Error('symbol explorer: state variation output не имеет публичного package entry');
  }
  const ids = files.map(file => file.slice('dist/state-variations/'.length, -'.js'.length)).sort();
  const groups = new Set(stateGroups.map(group => group.group));
  if (new Set(ids).size !== ids.length || ids.some(id => !/^[a-z][a-z0-9-]*$/.test(id) || !groups.has(id))) {
    throw new Error('symbol explorer: state variation output не имеет semantic group');
  }
  for (const id of ids) {
    if (!contract.files.includes(`dist/state-variations/${id}.d.ts`)) {
      throw new Error(`symbol explorer: state variation ${id} не имеет declaration в package contract`);
    }
  }
  return ids;
}

/** Членство жестов выводится из реальных публичных exports, без списка имён UI. */
export function symbolExplorerGestureProjection(contract, iconIds, surface = {}) {
  const files = contract.files.filter(file => /^dist\/gestures\/[^/]+\.js$/.test(file));
  const entry = contract.exports?.['./gestures/*'];
  if (files.length && (entry?.import !== './dist/gestures/*.js' || entry?.types !== './dist/gestures/*.d.ts')) {
    throw new Error('symbol explorer: gesture output не имеет публичного package entry');
  }
  const ids = files.map(file => file.slice('dist/gestures/'.length, -'.js'.length)).sort();
  if (new Set(ids).size !== ids.length || ids.some(id => !/^[a-z][a-z0-9-]*$/.test(id) || !iconIds.includes(id))) {
    throw new Error('symbol explorer: gesture output не принадлежит авторскому каталогу');
  }
  const rotationIconIds = [], preparedWidthIconIds = [], preparedClockIconIds = [];
  for (const id of ids) {
    if (!contract.files.includes(`dist/gestures/${id}.d.ts`)) {
      throw new Error(`symbol explorer: gesture ${id} не имеет declaration в package contract`);
    }
    const names = surface[`./gestures/${id}`];
    if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length || names.some(name => typeof name !== 'string')) {
      throw new Error(`symbol explorer: gesture ${id} не имеет точной публичной export surface`);
    }
    const required = ['renderMotionSvg', 'compileMotionEffect', 'motionCapabilities'];
    if (names.includes('renderMotionSvg') || names.includes('compileMotionEffect')) {
      if (!required.every(name => names.includes(name))) {
        throw new Error(`symbol explorer: gesture ${id} имеет неполный rotation contract`);
      }
      rotationIconIds.push(id);
    }
    if (names.includes('prepareBodyWidth')) {
      if (!names.includes('motionCapabilities')) throw new Error(`symbol explorer: gesture ${id} имеет неполный prepared width contract`);
      preparedWidthIconIds.push(id);
    }
    if (names.includes('prepareClockHands')) {
      if (!names.includes('motionCapabilities')) throw new Error(`symbol explorer: gesture ${id} имеет неполный prepared clock contract`);
      preparedClockIconIds.push(id);
    }
  }
  const declared = Object.keys(surface).filter(key => /^\.\/gestures\/[^/]+$/.test(key));
  if (declared.some(key => !ids.includes(key.slice('./gestures/'.length)))) {
    throw new Error('symbol explorer: gesture export surface не имеет package target');
  }
  return { iconIds: ids, rotationIconIds, preparedWidthIconIds, preparedClockIconIds };
}

/** Runtime presence задаёт package contract; semantic spec задаёт точное членство. */
export function symbolExplorerBrowserFiles(contract, iconIds, stateGroups, surface = {}) {
  const stateFiles = stateGroups.map(({ group }) => `dist/states/${group}.js`);
  const variationFiles = symbolExplorerVariationIds(contract, iconIds).map(id => `dist/variations/${id}.js`);
  const stateVariationFiles = symbolExplorerStateVariationIds(contract, stateGroups)
    .map(id => `dist/state-variations/${id}.js`);
  const gestureFiles = symbolExplorerGestureProjection(contract, iconIds, surface).iconIds
    .map(id => `dist/gestures/${id}.js`);
  const files = [...new Set([...contract.runtimeDependencies, 'dist/ir/render.js', 'dist/motion/index.js', 'dist/authoring/index.js',
    ...iconIds.flatMap(name => [`dist/symbols/${name}.js`, `dist/lottie/${name}.js`]),
    ...stateFiles, ...variationFiles, ...stateVariationFiles, ...gestureFiles])];
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
  for (const name of ['index.html', 'explorer.css', 'explorer.js', 'variation-preview.js', 'geometry-patch.js', 'authored-gesture.js', 'authoring.html', 'authoring.js', 'download.js']) {
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
  const surface = JSON.parse(readFileSync(join(repo, 'release', 'export-surface.json'), 'utf8'));
  const baseline = loadAuthorBaseline(repo);
  const stateGroups = stateExplorerGroups(JSON.parse(readFileSync(join(repo, 'semantics/author-state-groups.json'), 'utf8')));
  const iconIds = Object.keys(baseline.icons);
  const variationIconIds = symbolExplorerVariationIds(contract, iconIds);
  const stateVariationGroupIds = symbolExplorerStateVariationIds(contract, stateGroups);
  const gestureProjection = symbolExplorerGestureProjection(contract, iconIds, surface);
  const rotationGestureIconIds = gestureProjection.rotationIconIds;
  const preparedWidthIconIds = gestureProjection.preparedWidthIconIds;
  const preparedClockIconIds = gestureProjection.preparedClockIconIds;
  const browserFiles = symbolExplorerBrowserFiles(contract, iconIds, stateGroups, surface);
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
  const data = { version: 2, source: baseline.source, executionIdentity, stateGroups, variationIconIds, stateVariationGroupIds,
    rotationGestureIconIds, preparedWidthIconIds, preparedClockIconIds, summary: { glyphs: iconIds.length, variants: rows.length }, rows };
  writeFileSync(join(outDir, 'explorer.json'), `${JSON.stringify(data)}\n`);
  return join(outDir, 'index.html');
}
