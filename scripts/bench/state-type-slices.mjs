/** Узкое сравнение declaration emit; runtime, corpus build и browser не запускаются. */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { measureArtifact, PACKAGE_SIZE_MEASUREMENT } from '../check-package-size.js';

const root = fileURLToPath(new URL('../..', import.meta.url));
const baseline = '1d9c408c5491a40a3d2e1a3ae20786c6613a958e';
const temporary = mkdtempSync(join(tmpdir(), 'lab-icons-state-type-slices-'));
const compiler = join(root, 'node_modules/typescript/bin/tsc');
const digest = data => createHash('sha256').update(data).digest('hex');
const measure = data => ({ ...measureArtifact(data), sha256: digest(data) });
const emit = (sourceRoot, out) => execFileSync(process.execPath, [compiler, '--ignoreConfig',
  '--declaration', '--emitDeclarationOnly', '--stripInternal', '--strict', '--noUncheckedIndexedAccess',
  '--isolatedModules', '--resolveJsonModule', '--skipLibCheck', '--lib', 'ES2022,DOM',
  '--target', 'ES2022', '--module', 'ESNext', '--moduleResolution', 'bundler',
  '--rootDir', join(sourceRoot, 'src'), '--outDir', out, join(sourceRoot, 'src/states/types.ts'),
  ...(sourceRoot === root ? [join(root, 'src/states/contour-types.ts')] : [])], { cwd: root, stdio: 'pipe' });

try {
  const oldRoot = join(temporary, 'baseline');
  for (const file of ['src/states/types.ts', 'src/ir/author-provenance.ts']) {
    const data = execFileSync('git', ['show', `${baseline}:${file}`], { cwd: root });
    mkdirSync(dirname(join(oldRoot, file)), { recursive: true });
    writeFileSync(join(oldRoot, file), data);
  }
  const before = join(temporary, 'before'), after = join(temporary, 'after');
  emit(oldRoot, before); emit(root, after);
  const oldBytes = readFileSync(join(before, 'states/types.d.ts'));
  const outputs = {};
  for (const name of ['types', 'common-types', 'contour-types']) {
    // Точно та же смена приватного specifier, которую делает release build.
    const bytes = Buffer.from(readFileSync(join(after, 'states', `${name}.d.ts`), 'utf8')
      .replaceAll('./common-types.js', './state-common-types.js'));
    outputs[name] = { ...measure(bytes), emitted: bytes.toString('utf8') };
  }
  const provenance = readFileSync(join(after, 'ir/author-provenance.d.ts'));
  const report = {
    baseline, capturedAt: new Date().toISOString(), node: process.version,
    typescript: JSON.parse(readFileSync(join(root, 'node_modules/typescript/package.json'))).version,
    packageMeasurement: PACKAGE_SIZE_MEASUREMENT,
    scope: 'two state type entry files and primitive provenance leaf; no runtime/build/pack/timing qualification',
    previous: { ...measure(oldBytes), emitted: oldBytes.toString('utf8') },
    outputs,
    transitiveRawBytes: {
      before: oldBytes.byteLength + provenance.byteLength,
      enclosure: outputs.types.bytes + outputs['common-types'].bytes + provenance.byteLength,
      contour: outputs['contour-types'].bytes + outputs['common-types'].bytes + provenance.byteLength,
      all: Object.values(outputs).reduce((sum, item) => sum + item.bytes, provenance.byteLength),
    },
    sourceDigests: Object.fromEntries(['src/states/types.ts', 'src/states/common-types.ts', 'src/states/contour-types.ts']
      .map(file => [file, digest(readFileSync(join(root, file)))])),
  };
  const output = process.argv[2];
  if (output) writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify({ previous: measure(oldBytes), outputs: Object.fromEntries(Object.entries(outputs)
    .map(([name, { emitted, ...measured }]) => [name, measured])), transitiveRawBytes: report.transitiveRawBytes }));
} finally {
  // mkdtemp создал единственный временный каталог этого probe.
  rmSync(temporary, { recursive: true, force: true });
}
