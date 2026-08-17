#!/usr/bin/env node
/**
 * scripts/build-path-quality-snapshot.mjs — воспроизводимое переснятие
 * debt-baseline гейтов чистоты:
 *   - semantics/path-quality-by-source.json (per-source ledger, closed world 444)
 *   - semantics/legacy-quality-snapshot.json: секция pathQuality всегда;
 *     секция variantParity — по флагу --variant-parity (пере-фиксация парного
 *     долга легитимна только когда сами файлы пары осознанно изменены)
 *
 * Переснятие baseline — осознанное reviewed-действие: скрипт существует,
 * чтобы re-freeze был детерминируемым и проверяемым, а не ручным JSON-редактом.
 * Обязательный аргумент --reason "<текст>" фиксирует provenance в comment.
 */

import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validatePathQuality } from './check-path-quality.js';
import { validateVariantParity } from './check-variant-parity.js';
import { buildPerSourceSnapshot } from './lib/path-quality-debt.js';
import { findingSetSha256, validateLegacyQualitySnapshot } from './lib/legacy-quality-snapshot.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const reasonIdx = process.argv.indexOf('--reason');
const reason = reasonIdx >= 0 ? process.argv[reasonIdx + 1] : null;
if (!reason || reason.trim().length < 32) {
  console.error('build-path-quality-snapshot: обязателен --reason "<содержательное обоснование ≥32 символов>"');
  process.exit(1);
}

const grid = JSON.parse(readFileSync(join(root, 'semantics', 'grid.json'), 'utf8'));
const files = [];
const allNames = [];
for (const variant of ['Outline', 'Filled']) {
  for (const f of readdirSync(join(root, 'svg', variant))) {
    allNames.push(`${variant}/${f}`);
    files.push({
      name: `${variant}/${f}`,
      content: readFileSync(join(root, 'svg', variant, f), 'utf8'),
    });
  }
}

const findings = validatePathQuality({ grid, files });
const isMajor = (finding) => !/излом [23]\./.test(finding);
const major = findings.filter(isMajor);

const stamp = new Date().toISOString().slice(0, 10);
const perSource = buildPerSourceSnapshot(
  findings,
  allNames,
  `Per-source debt (все находки, minor+major), переснят ${stamp}. ` +
    `Причина: ${reason.trim()} Правило: ни один файл не растёт против своего snapshot.`,
);
writeFileSync(
  join(root, 'semantics', 'path-quality-by-source.json'),
  JSON.stringify(perSource, null, 2) + '\n',
  'utf8',
);

const legacyPath = join(root, 'semantics', 'legacy-quality-snapshot.json');
const legacy = validateLegacyQualitySnapshot(JSON.parse(readFileSync(legacyPath, 'utf8')));
const refreshed = {
  ...legacy,
  comment:
    `Measured full-corpus migration debt frozen on ${stamp}. ` +
    `Причина переснятия: ${reason.trim()} ` +
    'CI rejects count growth and every unreviewed finding-set substitution; ' +
    'lowering debt requires refreshing this proof in the same reviewed change.',
  pathQuality: {
    findingSetSha256: findingSetSha256(findings),
    maximumFindings: findings.length,
    maximumMajorFindings: major.length,
  },
};

let parityNote = 'variantParity не тронут';
if (process.argv.includes('--variant-parity')) {
  const pairs = [];
  for (const f of readdirSync(join(root, 'svg', 'Outline'))) {
    const name = f.replace(/\.svg$/, '');
    pairs.push({
      name,
      outline: readFileSync(join(root, 'svg', 'Outline', f), 'utf8'),
      filled: readFileSync(join(root, 'svg', 'Filled', `${name}_filled.svg`), 'utf8'),
    });
  }
  const parity = validateVariantParity({ grid, pairs });
  if (parity.hard.length > 0) {
    console.error('build-path-quality-snapshot: variantParity HARD не замораживается:');
    for (const e of parity.hard) console.error('  - ' + e);
    process.exit(1);
  }
  refreshed.variantParity = {
    findingSetSha256: findingSetSha256(parity.report),
    maximumFindings: parity.report.length,
  };
  parityNote = `variantParity переснят (${parity.report.length} находок)`;
}

validateLegacyQualitySnapshot(refreshed);
writeFileSync(legacyPath, JSON.stringify(refreshed, null, 2) + '\n', 'utf8');

console.log(
  `build-path-quality-snapshot: ${allNames.length} файлов, ` +
    `${findings.length} находок (${major.length} major); ${parityNote}`,
);
