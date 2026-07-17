#!/usr/bin/env node
/**
 * У каждого генератора свой owned output. Root/SVG builder владеет dist/index.*
 * и dist/svg; runtime builder — только dist/animate и dist/ir.
 */
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
for (const directory of ['dist/animate', 'dist/ir']) {
  rmSync(join(root, directory), { recursive: true, force: true });
}
