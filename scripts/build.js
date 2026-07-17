#!/usr/bin/env node
/**
 * Build pipeline for @labpics/icons
 *
 * 1. Load svgo.config.cjs (CommonJS-safe under type:module)
 * 2. Optimise every SVG in svg/Filled + svg/Outline
 * 3. Write optimised copies to dist/svg/Filled + dist/svg/Outline
 * 4. Generate dist/index.js (tree-shakeable named ESM exports)
 * 5. Generate dist/index.d.ts (TypeScript declarations)
 *
 * Naming convention:
 *   svg/Filled/<name>_filled.svg  →  export <camelCase>Filled
 *   svg/Outline/<name>.svg        →  export <camelCase>Outline
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { createRequire } from 'module';
import { optimize } from 'svgo';
import { authorPathEntries, sourcePathEntries } from './lib/icon-geometry.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const ROOT = join(__dirname, '..');

// Load CJS config safely from ESM context
const require = createRequire(import.meta.url);
const svgoConfig = require(join(ROOT, 'svgo.config.cjs'));

const SVG_DIR = join(ROOT, 'svg');
const DIST_DIR = join(ROOT, 'dist');
const DIST_SVG_DIR = join(DIST_DIR, 'svg');

// ── clean stale artifacts ─────────────────────────────────────────────────────

if (existsSync(DIST_SVG_DIR)) {
  rmSync(DIST_SVG_DIR, { recursive: true, force: true });
  console.log('⚙  Cleaned dist/svg (stale artifacts removed)');
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** 'my-icon_filled' → 'myIconFilled' */
function toCamelCase(str) {
  return str
    .replace(/[-_](.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase());
}

/** Inline SVG as a template-literal string safe for JS source */
function escapeSvg(svg) {
  return svg
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$/g, '\\$');
}

// ── source paint contract (M1, аудит 2026-07-03) ─────────────────────────────
//
// Контракт исходников: моно-чернила #101012 (или бесцветные path). Пайплайн
// делает convertColors(#101012→currentColor) + removeAttrs(fill) — на
// КОНТРАКТНОМ входе это без потерь. Но на неконтрактном он МОЛЧА меняет
// рендер: fill="none" (stroke-иконка) стёрся бы и залился currentColor от
// корня; fill="white" (вырез) перекрасился бы в чернила. Честный результат
// (политика ДС): такой вход — ошибка сборки с именем файла, не тихая порча.
const CONTRACT_INK = '#101012';
const PAINT_ATTR_RE = /(fill|stroke|stop-color|color)\s*=\s*"([^"]*)"/gi;

function assertSourceContract(file, src) {
  const violations = [];
  for (const m of src.matchAll(PAINT_ATTR_RE)) {
    const [, attr, value] = m;
    if (value.toLowerCase() !== CONTRACT_INK) {
      violations.push(`${attr}="${value}"`);
    }
  }
  // style="" провозит краску мимо атрибутного контракта — запрещён целиком.
  if (/style\s*=\s*"/i.test(src)) violations.push('style="…"');
  if (violations.length > 0) {
    throw new Error(
      `source contract: ${file} несёт краску вне контракта (${violations.join(', ')}). ` +
      `Разрешены только чернила ${CONTRACT_INK} — пайплайн не имеет права молча перекрашивать.`,
    );
  }
}

// ── optimise all SVGs ─────────────────────────────────────────────────────────

function optimiseDir(variant) {
  const srcDir = join(SVG_DIR, variant);
  const outDir = join(DIST_SVG_DIR, variant);
  mkdirSync(outDir, { recursive: true });

  const files = readdirSync(srcDir).filter(f => f.endsWith('.svg')).sort();
  const results = [];

  for (const file of files) {
    const src = readFileSync(join(srcDir, file), 'utf8');
    assertSourceContract(`${variant}/${file}`, src);
    // Этот вызов — не извлечение ради метрики, а граница языка source SVG:
    // неподдерживаемый clip/mask не должен дожить до root export и разойтись с IR.
    authorPathEntries(src);
    const result = optimize(src, { ...svgoConfig, path: join(srcDir, file) });
    if (result.error) {
      throw new Error(`svgo error on ${file}: ${result.error}`);
    }
    sourcePathEntries(result.data);
    writeFileSync(join(outDir, file), result.data, 'utf8');
    results.push({ file, data: result.data });
  }

  return results;
}

console.log('⚙  Optimising SVGs…');
const filledResults = optimiseDir('Filled');
const outlineResults = optimiseDir('Outline');
console.log(`   Filled: ${filledResults.length}  Outline: ${outlineResults.length}`);

// ── generate ESM index ────────────────────────────────────────────────────────

function makeExportName(filename, variant) {
  // Remove extension
  const base = basename(filename, '.svg');
  // For Filled: 'accessibility_filled' → stem already has '_filled'
  // For Outline: 'accessibility' → append 'Outline'
  if (variant === 'Filled') {
    return toCamelCase(base); // e.g. accessibilityFilled
  } else {
    return toCamelCase(base) + 'Outline'; // e.g. accessibilityOutline
  }
}

let jsLines = [];
let dtsLines = [];

// Header
jsLines.push('// @labpics/icons — auto-generated, do not edit');
jsLines.push('// Tree-shakeable named ESM exports (sideEffects:false)');
jsLines.push('');
dtsLines.push('// @labpics/icons — auto-generated type declarations');
dtsLines.push('');

const exportNames = [];

function processResults(results, variant) {
  for (const { file, data } of results) {
    const exportName = makeExportName(file, variant);
    const escaped = escapeSvg(data);
    jsLines.push(`export const ${exportName} = \`${escaped}\`;`);
    dtsLines.push(`export declare const ${exportName}: string;`);
    exportNames.push(exportName);
  }
}

processResults(filledResults, 'Filled');
processResults(outlineResults, 'Outline');

// ── IconName union (аудит 2026-07-03) ────────────────────────────────────────
// Типобезопасное имя иконки для потребителей (labui <lab-icon name="…">,
// словари, конфиги): union всех экспортов. Type-only — ноль рантайм-веса,
// tree-shaking не затронут.
dtsLines.push('');
dtsLines.push('/** Имя иконки — union всех 444 экспортов (авто-генерация). */');
dtsLines.push('export type IconName =');
for (const name of exportNames) {
  dtsLines.push(`  | '${name}'`);
}
dtsLines.push(';');

mkdirSync(DIST_DIR, { recursive: true });

const jsContent = jsLines.join('\n') + '\n';
const dtsContent = dtsLines.join('\n') + '\n';

writeFileSync(join(DIST_DIR, 'index.js'), jsContent, 'utf8');
writeFileSync(join(DIST_DIR, 'index.d.ts'), dtsContent, 'utf8');

const totalExports = filledResults.length + outlineResults.length;
console.log(`✓  dist/index.js + dist/index.d.ts — ${totalExports} named exports`);

// ── validate export count ─────────────────────────────────────────────────────

const EXPECTED = 444;
if (totalExports !== EXPECTED) {
  console.error(`✗  Export count mismatch: expected ${EXPECTED}, got ${totalExports}`);
  process.exit(1);
}

console.log('✓  Build complete');
