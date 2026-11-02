import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { symbolReleaseProjection } from './lib/symbol-modules.js';
import { authorIconNames, renderAuthorTypeProjection } from './lib/author-baseline.js';
import { authorStateGroupNames } from './lib/author-state-groups.js';
import { authorVariationIconNames, authorVariationLawNames } from './lib/author-variation.js';
import { authorStateVariationGroupNames } from './lib/author-state-variations.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const author = read('semantics/figma-baseline.json');
const names = authorIconNames(author);
const stateSpec = read('semantics/author-state-groups.json');
const groups = authorStateGroupNames(stateSpec);
const authorSpec = read('semantics/author-anatomy.json');
const variationNames = authorVariationIconNames(authorSpec);
const contract = symbolReleaseProjection(read('release/contract.json'), names, groups, variationNames, authorVariationLawNames(authorSpec),
  [], authorStateVariationGroupNames(stateSpec, authorSpec));
writeFileSync(join(root, 'src/ir/author-catalog.generated.ts'), renderAuthorTypeProjection(author));
writeFileSync(join(root, 'release/contract.json'), `${JSON.stringify(contract, null, 1)}\n`);
const pkg = read('package.json');
pkg.exports = contract.exports;
pkg.files = contract.files;
writeFileSync(join(root, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`generate-symbol-surface: ${names.length} author symbol modules, ${groups.length} state groups; exact files ${contract.files.length}`);
