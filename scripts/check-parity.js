#!/usr/bin/env node
/**
 * Parity guard for @labpics/icons
 *
 * Verifies:
 *   1. Exactly 222 unique icon names exist in both Filled and Outline.
 *   2. Every Filled name has a matching Outline name (triple comm -3 style check).
 *   3. Exactly 444 total SVG files across both variants.
 *   4. The built dist/index.js exports exactly 444 named symbols.
 *
 * Exits non-zero on ANY discrepancy — the check bites.
 */

import { readdirSync, existsSync, readFileSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const FILLED_DIR = join(ROOT, 'svg', 'Filled');
const OUTLINE_DIR = join(ROOT, 'svg', 'Outline');
const DIST_INDEX = join(ROOT, 'dist', 'index.js');

let errors = 0;

function fail(msg) {
  console.error(`✗  ${msg}`);
  errors++;
}

function ok(msg) {
  console.log(`✓  ${msg}`);
}

// ── read file lists ───────────────────────────────────────────────────────────

if (!existsSync(FILLED_DIR)) fail(`svg/Filled not found`);
if (!existsSync(OUTLINE_DIR)) fail(`svg/Outline not found`);

if (errors > 0) {
  console.error(`\nParity check FAILED with ${errors} error(s)`);
  process.exit(1);
}

const filledFiles = readdirSync(FILLED_DIR).filter(f => f.endsWith('.svg')).sort();
const outlineFiles = readdirSync(OUTLINE_DIR).filter(f => f.endsWith('.svg')).sort();

// ── normalise names for comparison ───────────────────────────────────────────
// Filled: 'accessibility_filled.svg' → 'accessibility'
// Outline: 'accessibility.svg'       → 'accessibility'

function normFilled(f) {
  return basename(f, '.svg').replace(/_filled$/, '');
}

function normOutline(f) {
  return basename(f, '.svg');
}

const filledNames = filledFiles.map(normFilled).sort();
const outlineNames = outlineFiles.map(normOutline).sort();

// ── check counts ──────────────────────────────────────────────────────────────

if (filledFiles.length !== 222) {
  fail(`Filled count: expected 222, got ${filledFiles.length}`);
} else {
  ok(`Filled count: 222`);
}

if (outlineFiles.length !== 222) {
  fail(`Outline count: expected 222, got ${outlineFiles.length}`);
} else {
  ok(`Outline count: 222`);
}

// ── triple comm -3: pairwise symmetric diff ───────────────────────────────────
// Check 1: in Filled but not in Outline
const filledSet = new Set(filledNames);
const outlineSet = new Set(outlineNames);

const onlyFilled = filledNames.filter(n => !outlineSet.has(n));
const onlyOutline = outlineNames.filter(n => !filledSet.has(n));

if (onlyFilled.length > 0) {
  fail(`Icons in Filled but NOT in Outline (${onlyFilled.length}): ${onlyFilled.slice(0, 10).join(', ')}${onlyFilled.length > 10 ? '…' : ''}`);
} else {
  ok(`All Filled names have matching Outline`);
}

if (onlyOutline.length > 0) {
  fail(`Icons in Outline but NOT in Filled (${onlyOutline.length}): ${onlyOutline.slice(0, 10).join(', ')}${onlyOutline.length > 10 ? '…' : ''}`);
} else {
  ok(`All Outline names have matching Filled`);
}

// Check 2: unique names count
const uniqueNames = new Set([...filledNames, ...outlineNames]);
if (uniqueNames.size !== 222) {
  fail(`Unique icon names: expected 222, got ${uniqueNames.size}`);
} else {
  ok(`Unique icon names: 222`);
}

// ── check dist/index.js export count ─────────────────────────────────────────

if (!existsSync(DIST_INDEX)) {
  fail(`dist/index.js not found — run 'pnpm build' first`);
} else {
  const src = readFileSync(DIST_INDEX, 'utf8');
  // Count "export const <name> = " lines
  const matches = src.match(/^export const \w+ = /mg);
  const exportCount = matches ? matches.length : 0;
  if (exportCount !== 444) {
    fail(`dist/index.js export count: expected 444, got ${exportCount}`);
  } else {
    ok(`dist/index.js exports: 444`);
  }

  // Verify each Filled name appears as export
  for (const name of filledNames.slice(0, 5)) { // sample check
    const camel = name.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (_, c) => c.toLowerCase());
    const exportName = `${camel}Filled`;
    if (!src.includes(`export const ${exportName}`)) {
      fail(`Missing export: ${exportName} (from Filled/${name}_filled.svg)`);
    }
  }

  // Verify each Outline name appears as export
  for (const name of outlineNames.slice(0, 5)) { // sample check
    const camel = name.replace(/[-_](.)/g, (_, c) => c.toUpperCase()).replace(/^(.)/, (_, c) => c.toLowerCase());
    const exportName = `${camel}Outline`;
    if (!src.includes(`export const ${exportName}`)) {
      fail(`Missing export: ${exportName} (from Outline/${name}.svg)`);
    }
  }

  if (errors === 0) ok(`Sampled export names verified in dist/index.js`);
}

// ── result ────────────────────────────────────────────────────────────────────

if (errors > 0) {
  console.error(`\nParity check FAILED with ${errors} error(s)`);
  process.exit(1);
} else {
  console.log(`\nParity check PASSED — 222 × 2 = 444`);
}
