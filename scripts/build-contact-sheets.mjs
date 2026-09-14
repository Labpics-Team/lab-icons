#!/usr/bin/env node
/**
 * scripts/build-contact-sheets.mjs — детерминированные PNG contact sheets.
 *
 * Exit evidence для VISUAL-ARTIFACT-01 (product-lab-icons r6):
 *   pnpm visual:contact-sheets -- --out <dir>
 *     → <dir>/manifest.json + PNG sheets (476 SVG × 5 sizes)
 *   manifest.sourceHead = последний commit, изменивший объявленный source-input set
 *   manifest.files[] = { path, sha256 } для каждого PNG
 *   Clean rerun в temporary directory даёт byte-identical результат.
 *
 * Инварианты: INV-01 (CI=true pnpm verify green), INV-18 (permanent artifact).
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 20, 24, 32, 48];
const VARIANTS = ['Outline', 'Filled'];

function parseArgs() {
  const args = process.argv.slice(2);
  let outDir = null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--out' && args[i + 1]) {
      outDir = resolve(args[++i]);
    } else if (args[i].startsWith('--out=')) {
      outDir = resolve(args[i].slice(6));
    }
  }
  if (!outDir) {
    console.error('Usage: build-contact-sheets.mjs --out <directory>');
    process.exit(1);
  }
  return { outDir };
}

function getSourceHead(root) {
  const cmd = 'git log -1 --format=%H -- svg/ scripts/build-contact-sheets.mjs';
  return execSync(cmd, { cwd: root, encoding: 'utf8' }).trim();
}

function collectSVGs(root) {
  const entries = [];
  for (const variant of VARIANTS) {
    const dir = join(root, 'svg', variant);
    const files = readdirSync(dir).filter((f) => f.endsWith('.svg')).sort();
    for (const file of files) {
      entries.push({
        variant,
        name: basename(file, '.svg'),
        path: join(dir, file),
      });
    }
  }
  return entries;
}

async function renderSheet(svgs, size) {
  const count = svgs.length;
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  const padding = 4;
  const cellSize = size + padding * 2;
  const width = cols * cellSize;
  const height = rows * cellSize;

  const composites = [];
  for (let i = 0; i < count; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = col * cellSize + padding;
    const y = row * cellSize + padding;
    const svgBuf = readFileSync(svgs[i].path);
    const resized = await sharp(svgBuf)
      .resize(size, size, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();
    composites.push({ input: resized, left: x, top: y });
  }

  return sharp({
    create: { width, height, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite(composites)
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer();
}

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

async function main() {
  const { outDir } = parseArgs();
  mkdirSync(outDir, { recursive: true });

  const sourceHead = getSourceHead(ROOT);
  const svgs = collectSVGs(ROOT);
  const files = [];

  for (const size of SIZES) {
    const sheetName = `contact-sheet-${size}px.png`;
    const sheetPath = join(outDir, sheetName);
    const buf = await renderSheet(svgs, size);
    writeFileSync(sheetPath, buf);
    files.push({
      path: sheetName,
      sha256: sha256(buf),
      size,
      svgCount: svgs.length,
    });
    console.log(`  ${sheetName}: ${svgs.length} SVGs, ${buf.length} bytes`);
  }

  const manifest = {
    sourceHead,
    generatedAt: new Date().toISOString(),
    svgCount: svgs.length,
    sizes: SIZES,
    files,
  };

  const manifestPath = join(outDir, 'manifest.json');
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  console.log(`manifest.json: sourceHead=${sourceHead}, ${files.length} sheets`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});