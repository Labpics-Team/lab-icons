/**
 * scripts/import-wave2.mjs — импорт 16 новых иконок из свежего экспорта руки
 *
 * Владелец обновил экспорт (476 файлов, центры колец cy=12 починены).
 * 16 новых иконок: brain, branch, branches, commit, commits, connect, database,
 * fork, key, mcp, merge, priority, pull request, revert, rocket, tag.
 *
 * Нормализация:
 * - identity clipPath (path-вариант И rect-вариант) удаляется
 * - fill="#101012" → fill="currentColor"
 * - "pull request" → "pull-request" (kebab-case)
 * - Filled: name.svg → name_filled.svg (repo convention)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const HAND_ROOT = 'C:/Users/Daniel/Desktop/Lab Icons';

const NEW_ICONS = [
  'brain', 'branch', 'branches', 'commit', 'commits', 'connect',
  'database', 'fork', 'key', 'mcp', 'merge', 'priority',
  'pull request', 'revert', 'rocket', 'tag'
];

const VARIANTS = ['Outline', 'Filled'];

/**
 * Удаляет identity clipPath — два варианта:
 * 1. Старый: <g clip-path="url(#...)">...paths...</g> + <defs><clipPath id="..."><path d="M0 0h24v24H0z"/></clipPath></defs>
 * 2. Новый (wave2): <g clip-path="url(#...)">...paths...</g> + <defs><clipPath id="..."><rect width="24" height="24" fill="white"/></clipPath></defs>
 *
 * Оба — viewport-identity клипы, безопасно удаляются.
 */
function stripIdentityClipPath(svg) {
  const hasClipPath = /<clipPath\b/i.test(svg);
  const hasClipRef = /\sclip-path\s*=/i.test(svg);
  
  if (!hasClipPath || !hasClipRef) return svg;
  
  // Pattern 1: clipPath with <path d="...">
  const pathPattern = /^\s*<svg([^>]*)>\s*<g\b([^>]*)>\s*clip-path\s*=\s*["']url\(#([^)]+)\)["']([^>]*)>([\s\S]*?)<\/g>\s*<defs[^>]*>\s*<clipPath\b[^>]*id\s*=\s*["']\3["'][^>]*>\s*<path\b[^>]*\/>\s*<\/clipPath>\s*<\/defs>\s*<\/svg>\s*$/i;
  
  // Pattern 2: clipPath with <rect width="24" height="24".../>
  const rectPattern = /^\s*<svg([^>]*)>\s*<g\b([^>]*)\s*clip-path\s*=\s*["']url\(#([^)]+)\)["']([^>]*)>([\s\S]*?)<\/g>\s*<defs[^>]*>\s*<clipPath\b[^>]*id\s*=\s*["']\3["'][^>]*>\s*<rect\b[^>]*\/>\s*<\/clipPath>\s*<\/defs>\s*<\/svg>\s*$/i;
  
  // Try path pattern first
  let match = svg.match(pathPattern);
  if (match) {
    const [, svgAttrs, , , groupAttrs, body] = match;
    return `<svg${svgAttrs}>${body}</svg>`;
  }
  
  // Try rect pattern
  match = svg.match(rectPattern);
  if (match) {
    const [, svgAttrs, , , groupAttrs, body] = match;
    return `<svg${svgAttrs}>${body}</svg>`;
  }
  
  // Fallback: simple regex strip (less safe but covers edge cases)
  // Remove <g clip-path="..."> wrapper, keeping inner content
  let result = svg.replace(
    /<g\b[^>]*\sclip-path\s*=\s*["']url\([^)]+\)["'][^>]*>([\s\S]*?)<\/g>/i,
    '$1'
  );
  // Remove <defs>...</defs> containing clipPath
  result = result.replace(/\s*<defs[^>]*>\s*<clipPath\b[^>]*>[\s\S]*?<\/clipPath>\s*<\/defs>/i, '');
  
  return result;
}

/**
 * Нормализует fill:
 * - fill="#101012" → fill="currentColor"
 * - fill="none" на корневом <svg> удаляется (Figma экспортирует outline с fill="none" на корне,
 *   но монохромный контракт разрешает только currentColor и #101012)
 */
function normalizeFill(svg) {
  let result = svg.replace(/fill\s*=\s*["']#101012["']/gi, 'fill="currentColor"');
  // Удаляем fill="none" с корневого тега <svg>
  result = result.replace(/(<svg\b[^>]*?)\s*fill\s*=\s*["']none["']([^>]*>)/i, '$1$2');
  return result;
}

/**
 * Нормализует имя файла для repo:
 * - kebab-case (lowercase, hyphens)
 * - "pull request" → "pull-request"
 */
function normalizeName(handName) {
  return handName.toLowerCase().replace(/\s+/g, '-');
}

/**
 * Repo convention: Filled files have _filled suffix
 */
function repoFileName(handName, variant) {
  const base = normalizeName(handName);
  return variant === 'Filled' ? `${base}_filled.svg` : `${base}.svg`;
}

let imported = 0;
let errors = [];

for (const variant of VARIANTS) {
  for (const iconName of NEW_ICONS) {
    const handPath = join(HAND_ROOT, variant, `${iconName}.svg`);
    const repoPath = join(root, 'svg', variant, repoFileName(iconName, variant));
    
    try {
      let content = readFileSync(handPath, 'utf8');
      
      // Normalize
      content = stripIdentityClipPath(content);
      content = normalizeFill(content);
      
      // Ensure directory exists
      const dir = dirname(repoPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      
      writeFileSync(repoPath, content, 'utf8');
      imported++;
      console.log(`✓ ${variant}/${repoFileName(iconName, variant)}`);
    } catch (e) {
      errors.push(`${variant}/${iconName}: ${e.message}`);
      console.error(`✗ ${variant}/${iconName}: ${e.message}`);
    }
  }
}

console.log(`\nИмпортировано: ${imported}/${NEW_ICONS.length * 2}`);
if (errors.length > 0) {
  console.error(`\nОшибки (${errors.length}):`);
  for (const e of errors) console.error(`  ${e}`);
  process.exit(1);
}