/**
 * Fix existing wave2 imports: remove fill="none" from root <svg> tag.
 * The monochrome contract only allows currentColor or #101012 on the root.
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
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

let fixed = 0;

for (const variant of VARIANTS) {
  for (const iconName of NEW_ICONS) {
    const fileName = variant === 'Filled' ? iconName + '_filled.svg' : iconName + '.svg';
    const filePath = join(root, 'svg', variant, fileName);
    
    if (!existsSync(filePath)) continue;
    
    let content = readFileSync(filePath, 'utf8');
    const original = content;
    
    // Remove fill="none" from root <svg> tag
    content = content.replace(/(<svg\b[^>]*?)\s*fill\s*=\s*["']none["']([^>]*>)/i, '\\');
    
    if (content !== original) {
      writeFileSync(filePath, content, 'utf8');
      console.log('Fixed: ' + variant + '/' + fileName);
      fixed++;
    }
  }
}

console.log('\nFixed ' + fixed + ' files');
