#!/usr/bin/env node

/**
 * Validate an agent/designer proposal without touching the repository.
 *
 * The command is intentionally narrower than full verification: it proves the
 * source intake contract and pair geometry for a selected Figma export. It is
 * the fail-closed gate before `import:figma --write`; promotion still requires
 * the repository-wide `pnpm verify`.
 */

import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { canonicalIconName, normalizeFigmaSvg } from './lib/figma-import.js';
import { readIconProposal } from './lib/icon-proposal.js';
import { EXPECTED_ICON_NAMES } from './lib/corpus-contract.js';
import { validateVariantParity } from './check-variant-parity.js';
import { findBlobBugs } from './check-fill-rule.js';
import { findTopologyDefects } from './check-topology.js';
import { validateStaticGrid } from './check-static-grid.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function usage() {
  return [
    'Usage: pnpm validate:proposal -- --source <export-dir> [--proposal proposal.json] [--icons id,id ...] [--json]',
    '',
    'The export must contain paired Outline/Filled SVGs. The command never writes files.',
  ].join('\n');
}

function parseArgs(argv) {
  const result = { source: null, proposal: null, icons: null, json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--source') result.source = argv[++index] ?? null;
    else if (value === '--proposal') result.proposal = argv[++index] ?? null;
    else if (value === '--icons' || value === '--icon') {
      const values = [];
      while (index + 1 < argv.length && !argv[index + 1].startsWith('--')) {
        values.push(...argv[++index].split(/[\s,]+/).filter(Boolean));
      }
      result.icons = values.map((item) => canonicalIconName(item));
    } else if (value === '--json') result.json = true;
    else if (value === '--help' || value === '-h') {
      console.log(usage());
      process.exit(0);
    } else {
      throw new Error(`validate:proposal: unknown argument ${value}\n${usage()}`);
    }
  }
  if (!result.source) throw new Error(`validate:proposal: --source is required\n${usage()}`);
  if (result.icons && new Set(result.icons).size !== result.icons.length) {
    throw new Error('validate:proposal: --icons contains a duplicate canonical id');
  }
  return result;
}

function variantCatalog(sourceRoot, variant) {
  const directory = join(sourceRoot, variant);
  const catalog = new Map();
  for (const file of readdirSync(directory).filter((name) => name.toLowerCase().endsWith('.svg')).sort()) {
    const id = canonicalIconName(basename(file, '.svg'));
    if (catalog.has(id)) {
      throw new Error(`validate:proposal: ${variant} collision for ${id}: ${catalog.get(id)} and ${file}`);
    }
    catalog.set(id, file);
  }
  return catalog;
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const sourceRoot = resolve(options.source);
  const outline = variantCatalog(sourceRoot, 'Outline');
  const filled = variantCatalog(sourceRoot, 'Filled');
  const outlineIds = [...outline.keys()].sort();
  const filledIds = [...filled.keys()].sort();
  if (JSON.stringify(outlineIds) !== JSON.stringify(filledIds)) {
    throw new Error('validate:proposal: Outline/Filled name parity is broken');
  }

  const selected = options.icons ?? outlineIds;
  const unknown = selected.filter((id) => !outline.has(id));
  if (unknown.length > 0) throw new Error(`validate:proposal: missing ids: ${unknown.join(', ')}`);

  const pairs = [];
  const files = [];
  for (const name of selected) {
    const outlineContent = normalizeFigmaSvg(
      readFileSync(join(sourceRoot, 'Outline', outline.get(name)), 'utf8'),
      { source: `Outline/${outline.get(name)}` },
    );
    const filledContent = normalizeFigmaSvg(
      readFileSync(join(sourceRoot, 'Filled', filled.get(name)), 'utf8'),
      { source: `Filled/${filled.get(name)}` },
    );
    pairs.push({ name, outline: outlineContent, filled: filledContent });
    files.push(
      { name: `Outline/${name}.svg`, content: outlineContent },
      { name: `Filled/${name}_filled.svg`, content: filledContent },
    );
  }

  const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
  const catalog = JSON.parse(readFileSync(join(root, 'semantics', 'catalog.json'), 'utf8'));
  if (Object.keys(catalog.icons).length !== EXPECTED_ICON_NAMES) {
    throw new Error('validate:proposal: catalog icon count drifted before proposal validation');
  }
  const proposalPath = resolve(options.proposal ?? join(sourceRoot, 'proposal.json'));
  const proposal = readIconProposal(proposalPath, { catalogIconIds: Object.keys(catalog.icons) });
  if (selected.length !== 1 || proposal.icon !== selected[0]) {
    throw new Error(
      `validate:proposal: proposal.icon=${proposal.icon} обязан совпадать с единственной выбранной парой`,
    );
  }

  const parity = validateVariantParity({ grid, pairs });
  const staticGrid = validateStaticGrid({ grid, files });
  const fillRule = findBlobBugs(files);
  const topology = findTopologyDefects(files);
  const hard = [
    ...parity.hard,
    ...staticGrid.hard,
    ...fillRule.outlineFails.map(({ name, pct }) => `${name}: fill-rule blob ${pct.toFixed(1)}%`),
    ...topology.outlineFails.map(({ name, detail }) => `${name}: ${detail}`),
  ];
  const report = [
    ...parity.report,
    ...staticGrid.report,
    ...fillRule.filledWarns.map(({ name, pct }) => `${name}: filled fill-rule drift ${pct.toFixed(1)}%`),
    ...topology.filledWarns.map(({ name, detail }) => `${name}: ${detail}`),
  ];
  const payload = {
    status: hard.length === 0 && report.length === 0 ? 'PASS' : 'FAIL',
    proposal: {
      icon: proposal.icon,
      opticalSizing: proposal.opticalSizing.mode,
      motion: proposal.motion.state,
      semanticParts: proposal.parts.length,
    },
    selected: selected.length,
    variants: pairs.length * 2,
    hard,
    report,
    stats: parity.stats,
  };

  if (options.json) console.log(JSON.stringify(payload, null, 2));
  else if (payload.status === 'PASS') console.log(`validate:proposal: PASS — ${selected.length} names / ${pairs.length * 2} variants`);
  else {
    console.error(`validate:proposal: FAIL — ${hard.length} hard, ${report.length} report findings`);
    for (const finding of [...hard, ...report]) console.error(`  - ${finding}`);
  }
  if (payload.status === 'FAIL') process.exit(1);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
