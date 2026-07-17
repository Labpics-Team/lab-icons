#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  buildIconCatalog,
  serializeIconCatalog,
  validateCatalogRatchet,
  validateIconCatalog,
} from './lib/icon-catalog.js';
import { renderIrTypeProjection } from './lib/ir-type-projection.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(ROOT, 'semantics', 'catalog.json');
const actual = readFileSync(file, 'utf8');
const parsed = validateIconCatalog(JSON.parse(actual));
const anatomy = JSON.parse(readFileSync(join(ROOT, 'semantics', 'anatomy.json'), 'utf8'));
const grid = JSON.parse(readFileSync(join(ROOT, 'semantics', 'grid.json'), 'utf8'));
const modelQuality = JSON.parse(readFileSync(join(ROOT, 'semantics', 'model-quality.json'), 'utf8'));
const axisQuality = JSON.parse(readFileSync(join(ROOT, 'semantics', 'axis-quality.json'), 'utf8'));
const expected = serializeIconCatalog(buildIconCatalog(ROOT, anatomy, grid, modelQuality, axisQuality));

if (actual !== expected) {
  console.error('check-catalog: semantics/catalog.json дрейфует; запустить pnpm build:catalog');
  process.exit(1);
}
const typeProjectionFile = join(ROOT, 'src', 'ir', 'catalog.generated.ts');
const expectedTypeProjection = renderIrTypeProjection(parsed);
if (readFileSync(typeProjectionFile, 'utf8') !== expectedTypeProjection) {
  console.error('check-catalog: src/ir/catalog.generated.ts дрейфует; запустить pnpm build:catalog');
  process.exit(1);
}

const ratchet = validateCatalogRatchet(
  JSON.parse(readFileSync(join(ROOT, 'semantics', 'catalog-ratchet.json'), 'utf8')),
);
const icons = Object.values(parsed.icons);
const modeledNames = icons.filter((icon) => icon.model !== null).length;
const modeledVariants = icons.flatMap((icon) => Object.values(icon.model?.variants ?? {}));
const acceptedVariants = modeledVariants.filter((variant) => variant.state === 'accepted').length;
const generatedVariants = Object.values(anatomy.glyphs)
  .flatMap((entry) => Object.values(entry.status ?? {}))
  .filter((status) => status === 'generated').length;
const quarantinedGeneratedVariants = Object.keys(modelQuality.quarantined).length;
const sourceOnlyVariants = 444 - modeledVariants.length;
const unclassifiedModelParts = modeledVariants
  .flatMap((variant) => variant.parts)
  .filter((part) => part.role === 'unclassified').length;
const provenAxisCapabilities = modeledVariants
  .flatMap((variant) => variant.supportedAxes)
  .length;
const disabledAxisCapabilities = Object.keys(axisQuality.disabled).length;
const failures = [];
if (modeledNames < ratchet.minimumModeledNames) failures.push(`modeled names ${modeledNames} < ${ratchet.minimumModeledNames}`);
if (modeledVariants.length < ratchet.minimumModeledVariants) failures.push(`modeled variants ${modeledVariants.length} < ${ratchet.minimumModeledVariants}`);
if (generatedVariants < ratchet.minimumGeneratedVariants) failures.push(`generated variants ${generatedVariants} < ${ratchet.minimumGeneratedVariants}`);
if (acceptedVariants < ratchet.minimumAcceptedVariants) failures.push(`accepted variants ${acceptedVariants} < ${ratchet.minimumAcceptedVariants}`);
if (quarantinedGeneratedVariants > ratchet.maximumQuarantinedGeneratedVariants) {
  failures.push(`quarantined generated variants ${quarantinedGeneratedVariants} > ${ratchet.maximumQuarantinedGeneratedVariants}`);
}
if (sourceOnlyVariants > ratchet.maximumSourceOnlyVariants) failures.push(`source-only variants ${sourceOnlyVariants} > ${ratchet.maximumSourceOnlyVariants}`);
if (unclassifiedModelParts > ratchet.maximumUnclassifiedModelParts) {
  failures.push(`unclassified model parts ${unclassifiedModelParts} > ${ratchet.maximumUnclassifiedModelParts}`);
}
if (failures.length > 0) {
  console.error(`check-catalog: quality ratchet нарушен\n- ${failures.join('\n- ')}`);
  process.exit(1);
}
console.log(
  `check-catalog: 222 icons / 444 source; model ${modeledNames} names / ` +
  `${modeledVariants.length} variants (${generatedVariants} generated; ${acceptedVariants} accepted; ` +
  `${quarantinedGeneratedVariants} quarantined); ` +
  `source-only ${sourceOnlyVariants}; axes ${provenAxisCapabilities} proven / ` +
  `${disabledAxisCapabilities} disabled; unclassified parts ${unclassifiedModelParts}; drift=0`,
);
