import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { authoringTutorialExample, verifyAuthoringConsumer } from '../scripts/bench/verify-authoring.mjs';

describe('public authoring consumer', () => {
  it('извлекает реальный самостоятельный tutorial, включая CRLF', () => {
    const document = readFileSync(new URL('../docs/authoring.md', import.meta.url), 'utf8');
    const example = authoringTutorialExample(document);
    expect(example).toContain('satisfies DesignSpec');
    expect(example).toContain("icon: 'focus-beacon'");
    expect(authoringTutorialExample(document.replace(/\r?\n/g, '\r\n'))).toBe(example.replace(/\r?\n/g, '\r\n'));
  });

  it.each([
    '```ts\nconst glyph = compileDesignSpec({});\n```',
    "```ts\nimport { compileDesignSpec } from '@labpics/icons/authoring';\n```",
    'Нет самостоятельного примера',
  ])('отказывает неполному tutorial, вместо исполнения тестовой подмены', document => {
    expect(() => authoringTutorialExample(document)).toThrow('самостоятельного public compile');
  });

  it('не запускает installed consumer на локальной рабочей станции', async () => {
    vi.stubEnv('GITHUB_ACTIONS', 'false');
    try {
      await expect(verifyAuthoringConsumer({})).rejects.toThrow('штатном удалённом GitHub runner');
    } finally { vi.unstubAllEnvs(); }
  });
});
