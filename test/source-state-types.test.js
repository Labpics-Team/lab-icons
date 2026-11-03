import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';
import { stateGroupDeclaration } from '../scripts/lib/author-state-groups.js';
import { stateTypeConsumerSource } from '../scripts/check-package-artifact.js';
import { statePackageExpectations } from '../scripts/lib/state-artifact-consumer.js';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsc = join(root, 'node_modules/typescript/bin/tsc');
const read = file => JSON.parse(readFileSync(join(root, file), 'utf8'));
const document = read('semantics/author-state-groups.json');
const members = [
  { name: 'microphone', variant: 'outline', state: 'muted', states: '"muted" | "unmuted"', foreign: 'hidden' },
  { name: 'microphone-filled', variant: 'filled', state: 'unmuted', states: '"muted" | "unmuted"', foreign: 'visible' },
  { name: 'visibility', variant: 'outline', state: 'hidden', states: '"hidden" | "visible"', foreign: 'muted' },
  { name: 'visibility-filled', variant: 'filled', state: 'visible', states: '"hidden" | "visible"', foreign: 'unmuted' },
];
const groups = [...members.map(member => member.name), 'status-circle'];
const scopedDocument = { ...document, groups: Object.fromEntries(groups.map(name => [name, document.groups[name]])) };
const names = [...new Set(Object.values(scopedDocument.groups).flatMap(group =>
  Object.values(group.states).map(member => member.icon)))];
const manifest = read('semantics/figma-baseline.json');
const baseline = loadAuthorBaseline(root, { manifest: { ...manifest,
  counts: { families: names.length, variants: names.length * 2 },
  icons: Object.fromEntries(names.map(name => [name, manifest.icons[name]])) } });
const generatedExpected = statePackageExpectations(baseline, scopedDocument);

it('чистый NodeNext consumer сохраняет точные source типы и прежний enclosure контракт', () => {
  const temporaryRoot = resolve(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'lab-icons-source-state-types-'));
  try {
    const declarations = join(directory, 'declarations');
    execFileSync(process.execPath, [tsc, '--ignoreConfig', '--declaration', '--emitDeclarationOnly', '--stripInternal',
      '--strict', '--noUncheckedIndexedAccess', '--isolatedModules', '--skipLibCheck', '--lib', 'ES2022,DOM',
      '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
      '--rootDir', join(root, 'src'), '--outDir', declarations, join(root, 'src/states/source-types.ts')],
    { cwd: directory, stdio: 'pipe', windowsHide: true });
    expect(readdirSync(join(declarations, 'ir'))).toEqual(['author-provenance.d.ts']);
    expect(readdirSync(join(declarations, 'states')).sort()).toEqual(['common-types.d.ts', 'source-types.d.ts', 'types.d.ts']);

    const pkg = join(directory, 'node_modules/@labpics/icons'), dist = join(pkg, 'dist');
    mkdirSync(join(dist, 'ir'), { recursive: true });
    mkdirSync(join(dist, 'states'), { recursive: true });
    copyFileSync(join(declarations, 'ir/author-provenance.d.ts'), join(dist, 'ir/author-provenance.d.ts'));
    // Те же relocation/rewrite, что в production scripts/build-ir.mjs.
    writeFileSync(join(dist, 'ir/source-state-types.d.ts'), readFileSync(join(declarations, 'states/source-types.d.ts'), 'utf8')
      .replaceAll('./types.js', './state-types.js'));
    for (const [source, target] of [['types', 'state-types'], ['common-types', 'state-common-types']]) {
      writeFileSync(join(dist, 'ir', `${target}.d.ts`), readFileSync(join(declarations, 'states', `${source}.d.ts`), 'utf8')
        .replaceAll('./common-types.js', './state-common-types.js'));
    }
    for (const name of [...members.map(member => member.name), 'status-circle']) {
      writeFileSync(join(dist, 'states', `${name}.d.ts`), stateGroupDeclaration(document, name));
    }
    const stateExport = read('package.json').exports['./states/*'];
    expect(stateExport).toBeDefined();
    writeFileSync(join(pkg, 'package.json'), JSON.stringify({ name: '@labpics/icons', type: 'module',
      exports: { './states/*': stateExport } }));

    const lines = [
      ...members.map(({ name }, index) => `import * as group${index} from '@labpics/icons/states/${name}';`),
      "import * as status from '@labpics/icons/states/status-circle';",
      'type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;',
      'type Assert<T extends true> = T;',
    ];
    const forbiddenLines = [];
    const forbid = (reason, statement) => {
      lines.push(`// @ts-expect-error: ${reason}`);
      forbiddenLines.push(lines.length + 1);
      lines.push(statement);
    };
    for (const [index, { variant, state, states, foreign }] of members.entries()) {
      const otherVariant = variant === 'outline' ? 'filled' : 'outline';
      lines.push(
        `type States${index} = Assert<Equal<group${index}.State, ${states}>>;`,
        `const caps${index} = group${index}.stateCapabilities();`,
        `type Variant${index} = Assert<Equal<typeof caps${index}.variant, '${variant}'>>;`,
        `type Transition${index} = Assert<Equal<typeof caps${index}.transition, 'source-replacement'>>;`,
        `type Enclosure${index} = Assert<Equal<typeof caps${index}.enclosurePartId, null>>;`,
        `type EnclosureHash${index} = Assert<Equal<typeof caps${index}.proof.enclosureSha256, null>>;`,
        `type Law${index} = Assert<Equal<typeof caps${index}.proof.law, 'source.replace'>>;`,
        `type SpecHash${index} = Assert<Equal<typeof caps${index}.proof.specSha256, string>>;`,
        `type Morph${index} = Assert<Equal<typeof caps${index}.morph, 'unavailable'>>;`,
        `const rendered${index} = group${index}.render('${state}', { variant: '${variant}' });`,
        `group${index}.renderStateSvg('${state}');`,
        `if (rendered${index}.ok) { const svg: string = rendered${index}.svg; void svg; }`,
        `const effect${index} = group${index}.compileStateEffect('${state}', { duration: 200, variant: '${variant}' });`,
        `if (effect${index}.ok) {`,
        `  type Kind${index} = Assert<Equal<typeof effect${index}.effect.kind, 'source-replacement'>>;`,
        `  const effectVariant${index}: '${variant}' = effect${index}.effect.variant;`,
        `  void effectVariant${index};`,
        '}',
        `const exported${index} = group${index}.exportStateTransition('${state}', { duration: 200, format: 'web-effect', variant: '${variant}' });`,
        `if (exported${index}.ok) {`,
        `  type ExportKind${index} = Assert<Equal<typeof exported${index}.effect.kind, 'source-replacement'>>;`,
        `  const exportVariant${index}: '${variant}' = exported${index}.effect.variant;`,
        `  void exportVariant${index};`,
        '}',
      );
      forbid('состояние другого предметного закона.', `group${index}.render('${foreign}');`);
      forbid('другое начертание не входит в этот entrypoint.', `group${index}.render('${state}', { variant: '${otherVariant}' });`);
      forbid('effect сохраняет начертание группы.', `group${index}.compileStateEffect('${state}', { duration: 200, variant: '${otherVariant}' });`);
      forbid('export сохраняет начертание группы.', `group${index}.exportStateTransition('${state}', { duration: 200, format: 'web-effect', variant: '${otherVariant}' });`);
      forbid('самостоятельный source не обещает variation.', `group${index}.renderStateSvg('${state}', { variation: { enclosureEmphasis: 1.1 } });`);
    }
    lines.push(
      'const legacy = status.stateCapabilities();',
      "type LegacyKind = Assert<Equal<typeof legacy.transition, 'enclosure-replacement'>>;",
      'type LegacyEnclosure = Assert<Equal<typeof legacy.enclosurePartId, string>>;',
      'type LegacyHash = Assert<Equal<typeof legacy.proof.enclosureSha256, string>>;',
      "type LegacyLaw = Assert<Equal<typeof legacy.proof.law, 'enclosure.replace'>>;",
      "status.render('confirmation');",
      "const legacyEffect = status.compileStateEffect('confirmation', { duration: 200 });",
      "if (legacyEffect.ok) { type LegacyEffectKind = Assert<Equal<typeof legacyEffect.effect.kind, 'enclosure-replacement'>>; }",
    );
    const positive = lines.join('\n');
    const consumer = join(directory, 'consumer.mts');
    const diagnostics = (source, loadedFiles) => {
      writeFileSync(consumer, source);
      try {
        const output = execFileSync(process.execPath, [tsc, '--ignoreConfig', '--noEmit', '--strict', '--noUncheckedIndexedAccess',
          '--target', 'ES2022', '--module', 'NodeNext', '--moduleResolution', 'NodeNext', '--skipLibCheck', 'false',
          ...(loadedFiles ? ['--listFiles'] : []), consumer],
        { cwd: directory, stdio: 'pipe', windowsHide: true });
        if (loadedFiles) loadedFiles.push(...String(output).trim().split(/\r?\n/).filter(Boolean).map(file => resolve(file)));
        return '';
      } catch (error) {
        if (error.status !== 1 && error.status !== 2) throw error;
        return String(error.stdout) + String(error.stderr);
      }
    };
    expect(diagnostics(positive)).toBe('');
    // Снятие suppression обязано дать ровно предметные отказы, не import failure.
    const negative = diagnostics(positive.replace(/^\/\/ @ts-expect-error:.*$/gm, ''));
    const errors = [...negative.matchAll(/consumer\.mts\((\d+),\d+\): error TS(\d+):/g)]
      .map(([, line, code]) => ({ line: Number(line), code: Number(code) }));
    expect(errors.map(error => error.line), negative).toEqual(forbiddenLines);
    expect(errors.map(error => error.code), negative).toEqual(members.flatMap(() => [2345, 2322, 2322, 2322, 2353]));

    // Полный smoke использует этот же generator; declarations не подменяются.
    expect(Object.keys(generatedExpected).sort()).toEqual(groups.toSorted());
    const generatedChecks = [false, true].map(dynamicImport => {
      const loadedFiles = [];
      const generated = stateTypeConsumerSource(generatedExpected, { dynamicImport });
      return { diagnostics: diagnostics(generated, loadedFiles), loadedFiles };
    });
    expect(generatedChecks.map(result => result.diagnostics)).toEqual(['', '']);
    for (const { loadedFiles } of generatedChecks) expect(loadedFiles.filter(file => dirname(file) === join(dist, 'states')).sort())
      .toEqual(groups.map(name => join(dist, 'states', `${name}.d.ts`)).sort());

    // Deliberate widening различает exact result.variant и правдоподобный union.
    const sourceLeaf = join(dist, 'ir/source-state-types.d.ts');
    const exactSource = readFileSync(sourceLeaf, 'utf8');
    const widenedSource = exactSource.replace('readonly variant: TVariant;', "readonly variant: 'outline' | 'filled';");
    expect(widenedSource).not.toBe(exactSource);
    writeFileSync(sourceLeaf, widenedSource);
    const widened = diagnostics(positive);
    const wideningErrors = [...widened.matchAll(/consumer\.mts\((\d+),\d+\): error TS(\d+):/g)];
    expect(wideningErrors, widened).toHaveLength(members.length * 2);
    expect(wideningErrors.map(([, , code]) => Number(code)), widened).toEqual(members.flatMap(() => [2322, 2322]));
  } finally {
    if (dirname(resolve(directory)) !== temporaryRoot) throw new Error('cleanup вне собственного временного каталога');
    rmSync(directory, { recursive: true, force: true });
  }
});
