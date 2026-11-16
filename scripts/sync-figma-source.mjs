import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncFigmaSource } from './lib/sync-figma-source.js';
const args = process.argv.slice(2), options = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--write') options.write = true;
  else if (args[i] === '--capture') options.captureRoot = resolve(args[++i]);
  else if (args[i] === '--manifest') options.manifest = JSON.parse(readFileSync(resolve(args[++i]), 'utf8'));
  else throw new TypeError('Usage: sync-figma-source --capture <export-root> --manifest <receipt.json> [--write]');
}
if (!options.captureRoot || !options.manifest) throw new TypeError('--capture and --manifest are required');
console.log(JSON.stringify(syncFigmaSource({ root: fileURLToPath(new URL('..', import.meta.url)), ...options }), null, 2));
