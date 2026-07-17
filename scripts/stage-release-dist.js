#!/usr/bin/env node
/** Stages the exact dist tree declared by release/contract.json. */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateReleaseContract } from './lib/release-contract.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

export function readReleaseContract(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'release/contract.json'), 'utf8'));
}

export function validateReleaseFiles(root, contract) {
  const errors = validateReleaseContract(contract);
  if (errors.length > 0) return errors;
  for (const file of contract.files ?? []) {
    const absolute = join(root, file);
    if (!existsSync(absolute)) errors.push(`release output отсутствует: ${file}`);
    else if (!statSync(absolute).isFile()) errors.push(`release output не является файлом: ${file}`);
  }
  return errors;
}

export function stageReleaseDist({ root = ROOT, runGit = git } = {}) {
  const contract = readReleaseContract(root);
  const errors = validateReleaseFiles(root, contract);
  if (errors.length > 0) throw new Error(errors.join('\n'));

  const preStaged = runGit(root, ['diff', '--cached', '--name-only']).trim();
  if (preStaged) {
    throw new Error(`release staging требует чистый index; уже staged:\n${preStaged}`);
  }

  // Старый tracked dist не должен пережить новый release из-за того, что его
  // больше нет в manifest. --cached оставляет ignored build tree на диске.
  runGit(root, ['rm', '-r', '--cached', '--ignore-unmatch', '--', 'dist']);
  runGit(root, ['add', '-f', '--', ...contract.files]);

  const tracked = runGit(root, ['ls-files', 'dist']).trim().split(/\r?\n/).filter(Boolean).sort();
  const expected = [...contract.files].sort();
  if (JSON.stringify(tracked) !== JSON.stringify(expected)) {
    throw new Error(
      `staged dist не равен release manifest\nexpected: ${expected.join(', ')}\nactual: ${tracked.join(', ')}`,
    );
  }
  return Object.freeze([...expected]);
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const files = stageReleaseDist();
  console.log(`stage-release-dist: OK — staged ровно ${files.length} файлов release manifest`);
}
