#!/usr/bin/env node
/**
 * Fail-closed provenance для пары v<version> / v<version>-dist.
 *
 * Source tag обязан дословно следовать package.json#version и указывать на
 * checkout HEAD. Dist tag — отдельный одно-родительский commit: его parent
 * равен source tag, единственный diff равен release manifest, а blob каждого
 * output байт-в-байт совпадает с только что проверенной clean-сборкой.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { STRICT_SEMVER, validateReleaseContract } from './lib/release-contract.js';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

function git(root, args) {
  return execFileSync('git', args, {
    cwd: root,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function output(runGit, root, args, label, errors) {
  try {
    const value = runGit(root, args).trim();
    if (!value) errors.push(`${label}: git вернул пустой ответ`);
    return value;
  } catch (error) {
    errors.push(`${label}: ${error.message}`);
    return '';
  }
}

export function validateReleaseTag(tag, packageVersion) {
  const errors = [];
  if (typeof packageVersion !== 'string' || !STRICT_SEMVER.test(packageVersion)) {
    errors.push(`package.json#version не является строгим SemVer: ${String(packageVersion)}`);
    return errors;
  }
  const expected = `v${packageVersion}`;
  if (tag !== expected) {
    errors.push(`release ref обязан быть ровно ${expected}; найдено ${String(tag)}`);
  }
  return errors;
}

export function validateSourceReleaseRef({
  root = ROOT,
  tag,
  packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  runGit = git,
} = {}) {
  const errors = validateReleaseTag(tag, packageVersion);
  if (errors.length > 0) return errors;
  const sourceCommit = output(
    runGit,
    root,
    ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`],
    `source tag ${tag}`,
    errors,
  );
  const headCommit = output(runGit, root, ['rev-parse', 'HEAD'], 'checkout HEAD', errors);
  if (sourceCommit && headCommit && sourceCommit !== headCommit) {
    errors.push(`checkout HEAD ${headCommit} != source tag ${tag} ${sourceCommit}`);
  }
  return errors;
}

export function validateDistProvenance({
  root = ROOT,
  tag,
  packageVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version,
  contract = JSON.parse(readFileSync(join(root, 'release/contract.json'), 'utf8')),
  runGit = git,
} = {}) {
  const errors = [
    ...validateReleaseTag(tag, packageVersion),
    ...validateReleaseContract(contract),
  ];
  if (errors.length > 0) return errors;

  const distTag = `${tag}-dist`;
  const sourceCommit = output(
    runGit,
    root,
    ['rev-parse', '--verify', `refs/tags/${tag}^{commit}`],
    `source tag ${tag}`,
    errors,
  );
  const distCommit = output(
    runGit,
    root,
    ['rev-parse', '--verify', `refs/tags/${distTag}^{commit}`],
    `dist tag ${distTag}`,
    errors,
  );
  if (!sourceCommit || !distCommit) return errors;

  const ancestry = output(
    runGit,
    root,
    ['rev-list', '--parents', '-n', '1', distCommit],
    `ancestry ${distTag}`,
    errors,
  ).split(/\s+/).filter(Boolean);
  if (ancestry.length !== 2 || ancestry[0] !== distCommit || ancestry[1] !== sourceCommit) {
    errors.push(
      `${distTag}: ожидается один parent ${sourceCommit}; найдено ${ancestry.slice(1).join(', ') || '<none>'}`,
    );
  }

  const expected = [...contract.files].sort();
  const changed = output(
    runGit,
    root,
    ['diff-tree', '--no-commit-id', '--name-only', '-r', distCommit],
    `diff ${distTag}`,
    errors,
  ).split(/\r?\n/).filter(Boolean).sort();
  if (JSON.stringify(changed) !== JSON.stringify(expected)) {
    errors.push(
      `${distTag}: commit diff не равен release manifest; ` +
        `expected [${expected.join(', ')}], actual [${changed.join(', ')}]`,
    );
  }

  const trackedDist = output(
    runGit,
    root,
    ['ls-tree', '-r', '--name-only', distCommit, '--', 'dist'],
    `tree ${distTag}`,
    errors,
  ).split(/\r?\n/).filter(Boolean).sort();
  if (JSON.stringify(trackedDist) !== JSON.stringify(expected)) {
    errors.push(
      `${distTag}: dist tree не равен release manifest; ` +
        `expected [${expected.join(', ')}], actual [${trackedDist.join(', ')}]`,
    );
  }

  for (const file of expected) {
    const absolute = join(root, file);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) {
      errors.push(`${file}: clean build output отсутствует перед provenance check`);
      continue;
    }
    const builtBlob = output(runGit, root, ['hash-object', '--', file], `${file} built blob`, errors);
    const taggedBlob = output(
      runGit,
      root,
      ['rev-parse', `${distCommit}:${file}`],
      `${file} tagged blob`,
      errors,
    );
    if (builtBlob && taggedBlob && builtBlob !== taggedBlob) {
      errors.push(`${distTag}: ${file} не совпадает с проверенной clean-сборкой`);
    }
  }
  return errors;
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const [mode, tag] = process.argv.slice(2);
  const errors = mode === 'source'
    ? validateSourceReleaseRef({ tag })
    : mode === 'dist'
      ? validateDistProvenance({ tag })
      : ['usage: node scripts/check-release-ref.js <source|dist> <vX.Y.Z>'];
  if (errors.length > 0) {
    console.error(`check-release-ref: HARD — ${errors.length} нарушений:`);
    for (const error of errors) console.error(`  - ${error}`);
    process.exit(1);
  }
  console.log(`check-release-ref: OK — ${mode} ${tag} имеет доказанный SemVer/provenance`);
}
