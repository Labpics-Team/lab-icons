import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { symbolReleaseProjection } from './lib/symbol-modules.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const contract = symbolReleaseProjection(read('release/contract.json'), Object.keys(read('semantics/catalog.json').icons));
writeFileSync(join(root, 'release/contract.json'), `${JSON.stringify(contract, null, 1)}\n`);
const pkg = read('package.json');
pkg.exports = contract.exports;
pkg.files = contract.files;
writeFileSync(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`generate-symbol-surface: ${Object.keys(read('semantics/catalog.json').icons).length} symbol modules; exact files ${contract.files.length}`);
