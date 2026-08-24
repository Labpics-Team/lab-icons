#!/usr/bin/env node
// Генерирует release/export-surface.json — SSOT runtime-поверхности экспортов.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectExportSurface, serializeExportSurface } from './lib/export-surface.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(ROOT, 'release', 'export-surface.json');
writeFileSync(file, serializeExportSurface(await collectExportSurface(ROOT)));
console.log('generate-export-surface: release/export-surface.json обновлён');
