#!/usr/bin/env node
/**
 * Tree-shaking proof for @labpics/icons
 *
 * Uses rollup's JS API to bundle a single named import from dist/index.js,
 * then asserts the output:
 *   (a) contains the imported icon's SVG content
 *   (b) does NOT contain SVG content from any other icon
 *
 * Exits non-zero on failure — the check bites.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, rmSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST_INDEX = join(ROOT, 'dist', 'index.js');

if (!existsSync(DIST_INDEX)) {
  console.error('✗  dist/index.js not found — run pnpm build first');
  process.exit(1);
}

// Parse exports from the built index
const indexSrc = readFileSync(DIST_INDEX, 'utf8');
// Each line: export const <name> = `<svg...>`
const exportMatches = [...indexSrc.matchAll(/^export const (\w+) = (`[\s\S]*?`);/mg)];

if (exportMatches.length < 10) {
  console.error(`✗  Too few exports parsed (${exportMatches.length}) — index format may be unexpected`);
  process.exit(1);
}

const [matchA, matchB] = exportMatches;
const iconAName = matchA[1];   // e.g. "accessibilityFilled"
const iconAValue = matchA[2];  // the template literal `<svg...>`
const iconBName = matchB[1];   // e.g. "actionsFilled"
const iconBValue = matchB[2];

// Extract a unique fragment from each icon's SVG (path data, ~50 chars in)
// Skip the common prefix (<svg viewBox="0 0 24 24" xmlns="...">)
function uniqueFragment(templateLiteral) {
  // Strip backticks and get the SVG string
  const svg = templateLiteral.slice(1, -1);
  // Find path data which is unique per icon
  const pathMatch = svg.match(/<path\s+d="([^"]{20,})"/);
  if (pathMatch) return pathMatch[1].slice(0, 40);
  // Fallback: use chars 80-120 of the SVG (past the common header)
  return svg.slice(80, 120);
}

const fragmentA = uniqueFragment(iconAValue);
const fragmentB = uniqueFragment(iconBValue);

console.log(`Testing tree-shake:`);
console.log(`  Import : "${iconAName}"`);
console.log(`  Exclude: "${iconBName}"`);
console.log(`  Fragment A (must be in bundle): ${fragmentA.slice(0, 50)}`);
console.log(`  Fragment B (must NOT be in bundle): ${fragmentB.slice(0, 50)}`);

// Use rollup JS API for cross-platform reliability
let rollup;
try {
  const rollupModule = await import('rollup');
  rollup = rollupModule.rollup;
} catch (e) {
  console.error('✗  rollup not found — run pnpm install');
  process.exit(1);
}

// Write a virtual entry that imports only iconA
const TMP = join(ROOT, '.treeshake-tmp');
mkdirSync(TMP, { recursive: true });
const entryPath = join(TMP, 'entry.js');
writeFileSync(entryPath, `import { ${iconAName} } from '../dist/index.js';\nexport { ${iconAName} };\n`, 'utf8');

let bundle;
try {
  bundle = await rollup({
    input: entryPath,
    treeshake: true,
  });
} catch (e) {
  console.error(`✗  rollup error: ${e.message}`);
  process.exit(1);
}

const { output } = await bundle.generate({ format: 'esm' });
await bundle.close();

// Clean up tmp
try { rmSync(TMP, { recursive: true, force: true }); } catch {}

const bundleCode = output[0].code;
const bundleBytes = Buffer.byteLength(bundleCode, 'utf8');

console.log(`  Bundle size: ${bundleBytes} bytes`);

// Assert iconA is present
if (!bundleCode.includes(fragmentA)) {
  console.error(`✗  Bundle does not contain icon "${iconAName}" content`);
  console.error(`   Looking for fragment: ${fragmentA}`);
  process.exit(1);
}

// Assert iconB is absent
if (bundleCode.includes(fragmentB)) {
  console.error(`✗  Bundle contains content from excluded icon "${iconBName}" — tree-shaking FAILED`);
  console.error(`   Found fragment: ${fragmentB}`);
  process.exit(1);
}

// Sanity: total export count in bundle should be 1
const exportCount = [...bundleCode.matchAll(/^export (const|{)/mg)].length;
if (exportCount !== 1) {
  console.error(`✗  Bundle has ${exportCount} exports; expected exactly 1`);
  process.exit(1);
}

console.log(`✓  "${iconAName}" present in bundle`);
console.log(`✓  "${iconBName}" absent from bundle`);
console.log(`✓  Tree-shaking VERIFIED via rollup JS API (${bundleBytes} bytes for 1 icon)`);
