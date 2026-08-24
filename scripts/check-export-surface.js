#!/usr/bin/env node
// Гейт: фактическая runtime-поверхность dist === release/export-surface.json.
// Никогда не автообновляет снапшот — расхождение всегда красное.
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectExportSurface, serializeExportSurface } from './lib/export-surface.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(ROOT, 'release', 'export-surface.json');

const actual = serializeExportSurface(await collectExportSurface(ROOT));
let snapshot;
try {
  snapshot = readFileSync(file, 'utf8');
} catch {
  console.error('check-export-surface: release/export-surface.json отсутствует; запустить pnpm generate:export-surface');
  process.exit(1);
}

if (actual !== snapshot) {
  const actualSurface = JSON.parse(actual);
  const snapshotSurface = JSON.parse(snapshot);
  for (const subpath of new Set([...Object.keys(actualSurface), ...Object.keys(snapshotSurface)])) {
    const a = new Set(actualSurface[subpath] ?? []);
    const s = new Set(snapshotSurface[subpath] ?? []);
    const added = [...a].filter((n) => !s.has(n));
    const removed = [...s].filter((n) => !a.has(n));
    if (added.length) console.error(`check-export-surface: «${subpath}» новые runtime-экспорты: ${added.join(', ')}`);
    if (removed.length) console.error(`check-export-surface: «${subpath}» исчезли runtime-экспорты: ${removed.join(', ')}`);
  }
  console.error('check-export-surface: runtime-поверхность дрейфует от release/export-surface.json; осознанное изменение — pnpm generate:export-surface + ревью диффа');
  process.exit(1);
}

console.log('check-export-surface: runtime-поверхность совпадает со снапшотом');
