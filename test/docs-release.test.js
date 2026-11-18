import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { marked } from 'marked';
import { describe, expect, test } from 'vitest';

function releaseCommands() {
  const tokens = marked.lexer(readFileSync(new URL('../docs/build-release.md', import.meta.url), 'utf8'));
  const start = tokens.findIndex(token => token.type === 'heading' && token.text === 'Релиз');
  expect(start).toBeGreaterThanOrEqual(0);
  const end = tokens.findIndex((token, index) => index > start && token.type === 'heading' && token.depth <= 2);
  const blocks = tokens.slice(start + 1, end < 0 ? undefined : end)
    .filter(token => token.type === 'code' && token.lang === 'sh');
  expect(blocks).toHaveLength(1);
  return blocks[0].text;
}

function execute(runId, gh = 'printf "%s\\n" "$@"') {
  const bash = process.platform === 'win32'
    ? join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Git/bin/bash.exe') : 'bash';
  // Execute the published command; the gh function records the requested operation.
  return spawnSync(bash, ['--noprofile', '--norc', '-c', `gh() { ${gh}; }\n${releaseCommands()}`], {
    cwd: tmpdir(), env: { ...process.env, CI_RUN_ID: runId ?? '' }, encoding: 'utf8', timeout: 10_000,
  });
}

describe('Инструкция выпуска', () => {
  test('передаёт выбранный CI run штатному workflow на main', () => {
    const result = execute('12345');
    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split(/\r?\n/)).toEqual([
      'workflow', 'run', 'release-packages.yml', '--ref', 'main', '-f', 'ci_run_id=12345',
    ]);
  });
  test('при отсутствующем run ID не запускает выпуск', () => {
    const result = execute();
    expect(result.status).not.toBe(0);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('CI_RUN_ID');
  });
  test('возвращает ошибку запуска Actions', () => {
    const result = execute('12345', 'return 17');
    expect(result.status).toBe(17);
  });
});
