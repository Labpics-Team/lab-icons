import * as nodeFs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { importFigma } from '../scripts/import-figma.mjs';

const root = join(import.meta.dirname, '..');
const script = join(root, 'scripts', 'import-figma.mjs');
const temporary = [];

const run = (...args) => spawnSync(process.execPath, [script, ...args], {
  cwd: root,
  encoding: 'utf8',
});

afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function svg(d = 'M2 2h20v20H2z') {
  return `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="${d}" fill="#101012"/></svg>\n`;
}

function fixtureRepo({ names = ['alpha', 'beta'], catalogNames = names } = {}) {
  const repo = mkdtempSync(join(tmpdir(), 'lab-icons-import-repo-'));
  temporary.push(repo);
  mkdirSync(join(repo, 'svg', 'Outline'), { recursive: true });
  mkdirSync(join(repo, 'svg', 'Filled'), { recursive: true });
  mkdirSync(join(repo, 'semantics'), { recursive: true });
  for (const name of names) {
    writeFileSync(join(repo, 'svg', 'Outline', `${name}.svg`), svg());
    writeFileSync(join(repo, 'svg', 'Filled', `${name}_filled.svg`), svg());
  }
  writeFileSync(
    join(repo, 'semantics', 'catalog.json'),
    JSON.stringify({ icons: Object.fromEntries(catalogNames.map((name) => [name, {}])) }),
  );
  return repo;
}

function fixtureExport({ names = ['alpha'], proposal = undefined, d = undefined } = {}) {
  const source = mkdtempSync(join(tmpdir(), 'lab-icons-import-source-'));
  temporary.push(source);
  mkdirSync(join(source, 'Outline'));
  mkdirSync(join(source, 'Filled'));
  for (const name of names) {
    writeFileSync(join(source, 'Outline', `${name}.svg`), svg(d));
    writeFileSync(join(source, 'Filled', `${name}.svg`), svg(d));
  }
  if (proposal !== undefined) writeFileSync(join(source, 'proposal.json'), JSON.stringify(proposal));
  return source;
}

function corpusSnapshot(repo, names) {
  return names.flatMap((name) => [
    readFileSync(join(repo, 'svg', 'Outline', `${name}.svg`), 'utf8'),
    readFileSync(join(repo, 'svg', 'Filled', `${name}_filled.svg`), 'utf8'),
  ]);
}

function noTransactionResidue(repo) {
  return readdirSync(repo).filter((name) =>
    name.startsWith('.figma-import-') || name === '.svg-figma-import-backup');
}

function acceptedProposal(icon = 'alpha') {
  return { status: 'PASS', selected: 1, variants: 2, proposal: { icon } };
}

function iconProposal(icon) {
  return {
    version: 1,
    icon,
    intent: 'Represent a compact sample while preserving the Lab Icons visual language.',
    family: {
      references: ['square'],
      sharedRules: ['centered on the square keyline'],
    },
    keyline: { kind: 'square', reason: 'The sample is a compact square-shaped mass.' },
    variants: {
      relationship: 'independent-masters',
      outline: {
        role: 'regular contour master',
        negativeSpace: [{
          id: 'body.interior',
          kind: 'counter',
          minimum: 0.033333,
          participants: ['body'],
          measurement: 'minimum counter width inside the outline body',
        }],
      },
      filled: {
        role: 'solid companion master',
        negativeSpace: [{
          id: 'body.exterior',
          kind: 'exterior-margin',
          minimum: 0.041667,
          participants: ['body'],
          measurement: 'minimum ink-bounds distance to the canvas edge',
        }],
      },
    },
    opticalSizing: {
      mode: 'fixed-master',
      masters: [{ size: 24, source: 'paired Figma export' }],
      behavior: ['no optical-size capability is claimed'],
    },
    parts: [{ id: 'body', role: 'body', anchor: null, moves: false }],
    motion: { state: 'none', gestures: [] },
  };
}

describe('import:figma CLI boundary', () => {
  it.each(['--source', '--icons', '--proposal'])('does not consume the next flag as %s value', (flag) => {
    const result = run(flag, '--write');

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(`${flag} отсутствует значение`);
    expect(result.stderr).not.toContain('node:internal');
  });

  it('keeps dry-run independent from repository and proposal state', () => {
    const source = fixtureExport({ names: ['alpha', 'beta'] });

    expect(importFigma({ argv: ['--source', source] })).toMatchObject({
      names: 2,
      variants: 4,
      mode: 'check',
    });
  });

  it('write rejects a missing proposal before touching the repository', () => {
    const repo = fixtureRepo({ names: ['alpha'] });
    const source = fixtureExport({ names: ['alpha'] });
    const before = corpusSnapshot(repo, ['alpha']);

    expect(() => importFigma({
      argv: ['--source', source, '--icons', 'alpha', '--write'],
      repoRoot: repo,
      expectedIconNames: 1,
    })).toThrow(/proposal/i);

    expect(corpusSnapshot(repo, ['alpha'])).toEqual(before);
    expect(noTransactionResidue(repo)).toEqual([]);
  });

  it('write rejects a corpus/catalog name mismatch before the proposal gate', () => {
    const repo = fixtureRepo({ names: ['alpha'], catalogNames: ['beta'] });
    const source = fixtureExport({ names: ['alpha'] });
    let proposalGateCalled = false;

    expect(() => importFigma({
      argv: ['--source', source, '--icons', 'alpha', '--write'],
      repoRoot: repo,
      expectedIconNames: 1,
      validateProposal() {
        proposalGateCalled = true;
      },
    })).toThrow(/corpus|catalog|name|имя/i);

    expect(proposalGateCalled).toBe(false);
    expect(noTransactionResidue(repo)).toEqual([]);
  });

  it('write rolls back a partial staged write and cleans temporary state', () => {
    const repo = fixtureRepo();
    const source = fixtureExport({ names: ['alpha'] });
    const before = corpusSnapshot(repo, ['alpha', 'beta']);
    let writes = 0;
    const fs = {
      ...nodeFs,
      writeFileSync(...args) {
        writes += 1;
        if (writes === 2) throw new Error('injected partial write failure');
        return nodeFs.writeFileSync(...args);
      },
    };

    expect(() => importFigma({
      argv: ['--source', source, '--icons', 'alpha', '--write'],
      repoRoot: repo,
      expectedIconNames: 2,
      validateProposal: () => acceptedProposal(),
      fs,
    })).toThrow(/partial write/i);

    expect(corpusSnapshot(repo, ['alpha', 'beta'])).toEqual(before);
    expect(noTransactionResidue(repo)).toEqual([]);
  });

  it('write rolls back a readback mismatch without publishing a partial pair', () => {
    const repo = fixtureRepo();
    const source = fixtureExport({ names: ['alpha'] });
    const before = corpusSnapshot(repo, ['alpha', 'beta']);
    const fs = {
      ...nodeFs,
      readFileSync(...args) {
        const value = nodeFs.readFileSync(...args);
        if (String(args[0]).includes('.figma-import-')) return `${value}corrupted-readback`;
        return value;
      },
    };

    expect(() => importFigma({
      argv: ['--source', source, '--icons', 'alpha', '--write'],
      repoRoot: repo,
      expectedIconNames: 2,
      validateProposal: () => acceptedProposal(),
      fs,
    })).toThrow(/readback/i);

    expect(corpusSnapshot(repo, ['alpha', 'beta'])).toEqual(before);
    expect(noTransactionResidue(repo)).toEqual([]);
  });

  it('write publishes a pair only after the real proposal gate passes', () => {
    const repo = fixtureRepo({ names: ['square'] });
    const source = fixtureExport({
      names: ['square'],
      proposal: iconProposal('square'),
      d: 'M10 10h4v4h-4z',
    });
    const before = readFileSync(join(repo, 'svg', 'Outline', 'square.svg'), 'utf8');

    const result = importFigma({
      argv: ['--source', source, '--icons', 'square', '--write'],
      repoRoot: repo,
      expectedIconNames: 1,
    });

    expect(result).toMatchObject({ names: 1, variants: 2, mode: 'write' });
    expect(readFileSync(join(repo, 'svg', 'Outline', 'square.svg'), 'utf8')).not.toBe(before);
    expect(noTransactionResidue(repo)).toEqual([]);
  });
});
