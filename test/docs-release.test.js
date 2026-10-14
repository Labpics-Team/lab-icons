import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { marked } from 'marked';
import { describe, expect, test } from 'vitest';

// Исполняется опубликованная инструкция целиком; origin — временный bare repo.
function releaseCommands() {
  const tokens = marked.lexer(readFileSync(new URL('../docs/build-release.md', import.meta.url), 'utf8'));
  const start = tokens.findIndex((token) => token.type === 'heading' && token.text === 'Релиз');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((token, index) => index > start && token.type === 'heading' && token.depth <= 2);
  const blocks = tokens.slice(start + 1, end < 0 ? undefined : end)
    .filter((token) => token.type === 'code' && token.lang === 'sh');
  expect(blocks).toHaveLength(1);
  expect(blocks[0].text.trim()).not.toBe('');
  return blocks[0].text;
}

const it = test.extend({
  release: async ({}, use) => {
    const root = mkdtempSync(join(tmpdir(), 'icons-doc-release-'));
    try {
      const work = join(root, 'work');
      const remote = join(root, 'remote.git');
      mkdirSync(work);
      writeFileSync(join(root, 'gitconfig'), '');
      const env = { ...process.env, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(root, 'gitconfig') };
      const git = (...args) => execFileSync('git', args, {
        cwd: work, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
      }).trim();
      const bash = process.platform === 'win32'
        ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git/bin/bash.exe') : 'bash';
      const execute = (prefix = '') => spawnSync(bash, ['--noprofile', '--norc', '-c', prefix + releaseCommands()], {
        cwd: work, env, encoding: 'utf8', timeout: 10_000,
      });
      git('init', '-q');
      git('config', 'user.name', 'Documentation test');
      git('config', 'user.email', 'docs@example.invalid');
      git('init', '--bare', '-q', remote);
      git('remote', 'add', 'origin', remote);
      writeFileSync(join(work, 'package.json'), '{"version":"1.2.3"}\n');
      git('add', 'package.json');
      git('commit', '-qm', 'release source');
      await use({ work, remote, git, execute, source: git('rev-parse', 'HEAD') });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
});

describe('Инструкция выпуска', () => {
  it('создаёт тег из коммита и сохраняет его при повторе', ({ release: { work, remote, git, execute, source } }) => {
    writeFileSync(join(work, 'package.json'), '{"version":"8.0.0"}\n');
    git('add', 'package.json');
    writeFileSync(join(work, 'package.json'), '{"version":"9.0.0"}\n');
    const result = execute();
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(git('tag', '--list')).toBe('v1.2.3');
    expect(git('--git-dir', remote, 'rev-parse', 'refs/tags/v1.2.3')).toBe(source);
    const again = execute();
    expect(again.error).toBeUndefined();
    expect(again.status).not.toBe(0);
    expect(git('--git-dir', remote, 'rev-parse', 'refs/tags/v1.2.3')).toBe(source);
  });

  it('сохраняет выбранный коммит при перемещении HEAD', ({ release: { remote, git, execute, source } }) => {
    const result = execute('git() {\n  if [ "$1" = show ]; then command git commit --allow-empty -qm concurrent; fi\n  command git "$@"\n}\n');
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(git('rev-parse', 'HEAD')).not.toBe(source);
    expect(git('--git-dir', remote, 'rev-parse', 'refs/tags/v1.2.3')).toBe(source);
  });

  it('останавливается до создания тега при ошибке чтения версии', async ({ release: { work, remote, git, execute } }) => {
    await writeFile(join(work, 'package.json'), '{broken json\n');
    git('add', 'package.json');
    git('commit', '-qm', 'invalid release manifest');
    const result = execute();
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(git('tag', '--list')).toBe('');
    expect(git('--git-dir', remote, 'tag', '--list')).toBe('');
  });
});
