import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join, resolve, sep } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { gzipSync, strToU8 } from 'fflate';
import { brotliCompressSync, constants } from 'node:zlib';
import { symbolModuleDeclaration } from '../lib/symbol-modules.js';

const baseline = '700f863f7cef3d7d17b3eadf29df699cdf144d4c';
const previous = execFileSync('git', ['--no-replace-objects', 'show', `${baseline}:scripts/lib/symbol-modules.js`], { encoding: 'utf8' });
const old = await import(`data:text/javascript;base64,${Buffer.from("const SYMBOL_NAME=/^[a-z][a-z0-9-]*$/;\n" + previous.slice(previous.indexOf('export function symbolModuleDeclaration('))).toString('base64')}`);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const names = Object.keys(read('semantics/figma-baseline.json').icons).sort();
const eligible = new Set(Object.entries(read('semantics/author-anatomy.json').icons)
  .filter(([, variants]) => Object.values(variants).some(part => part.variation)).map(([icon]) => icon));
const measure = text => {
  const data = strToU8(text);
  return { bytes: data.length, gzipBytes: gzipSync(data, { level: 9, mtime: 0 }).length,
    brotliBytes: brotliCompressSync(data, { params: { [constants.BROTLI_PARAM_QUALITY]: 11 } }).length,
    sha256: createHash('sha256').update(data).digest('hex') };
};
const rows = names.map(icon => ({ icon, variation: eligible.has(icon),
  baseline: measure(old.symbolModuleDeclaration(icon, eligible.has(icon))),
  actual: measure(symbolModuleDeclaration(icon, eligible.has(icon))) }));
const output = mkdtempSync(join(tmpdir(), 'lab-icons-declaration-size-'));
let dependencies;
try {
  execFileSync(process.execPath, ['node_modules/typescript/bin/tsc', '--ignoreConfig', '--declaration', '--emitDeclarationOnly',
    '--strict', '--skipLibCheck', '--stripInternal', '--target', 'es2022', '--module', 'esnext', '--moduleResolution', 'bundler',
    '--resolveJsonModule', '--rootDir', 'src', '--outDir', output, 'src/ir/author-symbol.ts', 'src/ir/authored-variation.ts'], { stdio: 'pipe' });
  dependencies = ['author-symbol', 'authored-variation'].map(name => ({ name,
    actual: measure(readFileSync(join(output, 'ir', `${name}.d.ts`), 'utf8')) }));
} finally {
  if (!resolve(output).startsWith(resolve(tmpdir()) + sep) || !basename(output).startsWith('lab-icons-declaration-size-')) {
    throw new Error('owned temporary output boundary');
  }
  rmSync(output, { recursive: true, force: true });
}
const report = { baseline, node: process.version, typescript: read('node_modules/typescript/package.json').version, fflate: '0.8.3', brotli: process.versions.brotli,
  scope: 'bounded generated declarations only; no runtime, full build, pack or timing qualification',
  totals: { baselineBytes: rows.reduce((sum, row) => sum + row.baseline.bytes, 0), actualBytes: rows.reduce((sum, row) => sum + row.actual.bytes, 0) },
  dependencies, rows };
writeFileSync('docs/research/declaration-sharing-20261102.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ totals: report.totals, dependencies, samples: rows.filter(row => eligible.has(row.icon) || row.icon === 'time') }));
