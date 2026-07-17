#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildIconCatalog, serializeIconCatalog } from './lib/icon-catalog.js';
import { renderIrTypeProjection } from './lib/ir-type-projection.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const anatomy = JSON.parse(readFileSync(join(ROOT, 'semantics', 'anatomy.json'), 'utf8'));
const grid = JSON.parse(readFileSync(join(ROOT, 'semantics', 'grid.json'), 'utf8'));
const modelQuality = JSON.parse(readFileSync(join(ROOT, 'semantics', 'model-quality.json'), 'utf8'));
const axisQuality = JSON.parse(readFileSync(join(ROOT, 'semantics', 'axis-quality.json'), 'utf8'));
const catalog = buildIconCatalog(ROOT, anatomy, grid, modelQuality, axisQuality);
const output = serializeIconCatalog(catalog);
writeFileSync(join(ROOT, 'semantics', 'catalog.json'), output, 'utf8');
writeFileSync(
  join(ROOT, 'src', 'ir', 'catalog.generated.ts'),
  renderIrTypeProjection(catalog),
  'utf8',
);
console.log(`build-catalog: ${Object.keys(JSON.parse(output).icons).length} icons / 444 source variants`);
