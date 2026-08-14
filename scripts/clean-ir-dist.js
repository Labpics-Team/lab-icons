#!/usr/bin/env node
/** IR builder владеет только dist/ir; root/SVG builder владеет dist/index.* и dist/svg. */
import { rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(join(root, 'dist', 'ir'), { recursive: true, force: true });
