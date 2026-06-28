#!/usr/bin/env node
/**
 * currentColor guard for @labpics/icons
 *
 * Scans OPTIMISED SVGs in dist/svg/ (the build output) for hardcoded colours.
 * If any optimised SVG contains a hardcoded hex colour (#101012 or any other
 * six-digit / three-digit hex), the check fails with a non-zero exit.
 *
 * This guard bites: inject a '#101012' into one optimised file → exit 1.
 * Clean tree → exit 0.
 */

import { readdirSync, readFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const DIST_SVG_DIR = join(ROOT, 'dist', 'svg');

// Regex: any 3-digit or 6-digit hex colour attribute or value
// Matches: fill="#101012", stroke="#fff", color="#abc123", etc.
// Does NOT match "currentColor" or "none" or "inherit".
const HEX_COLOR_RE = /#([0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g;

let errors = 0;
let scanned = 0;

function scanDir(variant) {
  const dir = join(DIST_SVG_DIR, variant);
  if (!existsSync(dir)) {
    console.error(`✗  ${dir} not found — run 'pnpm build' first`);
    errors++;
    return;
  }

  const files = readdirSync(dir).filter(f => f.endsWith('.svg')).sort();
  for (const file of files) {
    const content = readFileSync(join(dir, file), 'utf8');
    const matches = [...content.matchAll(HEX_COLOR_RE)];
    if (matches.length > 0) {
      const found = [...new Set(matches.map(m => m[0]))].join(', ');
      console.error(`✗  Hardcoded colour in ${variant}/${file}: ${found}`);
      errors++;
    }
    scanned++;
  }
}

scanDir('Filled');
scanDir('Outline');

if (errors > 0) {
  console.error(`\nColour check FAILED — ${errors} file(s) with hardcoded colours (${scanned} scanned)`);
  process.exit(1);
} else {
  console.log(`✓  Colour check PASSED — ${scanned} SVGs clean (no hardcoded hex colours)`);
}
