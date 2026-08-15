/**
 * scripts/_find_bad_fills.mjs
 * Find wave2 imports that have non-monochrome fills (contract violation)
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

const NEW_ICONS = [
  'brain', 'branch', 'branches', 'commit', 'commits', 'connect',
  'database', 'fork', 'key', 'mcp', 'merge', 'priority',
  'pull-request', 'revert', 'rocket', 'tag'
];

const VARIANTS = ['Outline', 'Filled'];

// Monochrome contract: fill must be "currentColor", "none", or absent
// Anything else (like hex colors, named colors) is a violation
const BAD_FILL_RE = /fill\s*=\s*["']([^"']+)["']/gi;

for (const variant of VARIANTS) {
  for (const iconName of NEW_ICONS) {
    const fileName = variant === 'Filled' ? `${iconName}_filled.svg` : `${iconName}.svg`;
    const filePath = join(root, 'svg', variant, fileName);
    
    try {
      const content = readFileSync(filePath, 'utf8');
      const fills = new Set();
      let match;
      while ((match = BAD_FILL_RE.exec(content)) !== null) {
        const fill = match[1].toLowerCase();
        if (fill !== 'currentcolor' && fill !== 'none' && fill !== 'transparent') {
          fills.add(fill);
        }
      }
      
      if (fills.size > 0) {
        console.log(`✗ ${variant}/${fileName}: non-monochrome fills: ${[...fills].join(', ')}`);
      } else {
        console.log(`✓ ${variant}/${fileName}: monochrome OK`);
      }
    } catch (e) {
      console.error(`! ${variant}/${fileName}: ${e.message}`);
    }
  }
}