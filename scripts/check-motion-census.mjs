#!/usr/bin/env node
/** Проверяет свежесть generated motion census; никогда не обновляет baseline. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildMotionCensus } from './build-motion-census.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const expected = readFileSync(join(ROOT, 'semantics/motion-census.json'), 'utf8');
const actual = `${JSON.stringify(buildMotionCensus(), null, 1)}\n`;
if (actual !== expected) {
  console.error('check-motion-census: HARD — semantics/motion-census.json устарел; запусти node scripts/build-motion-census.mjs');
  process.exit(1);
}
console.log('check-motion-census: PASS — проекция свежая');
