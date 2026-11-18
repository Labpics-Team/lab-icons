import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { buildSync } from 'esbuild';
import { parseDocumentation } from '../scripts/lib/docs-markdown.js';

const root = fileURLToPath(new URL('../', import.meta.url));

// Примеры извлекаются тем же Markdown-парсером, что текст и ссылки справки.
function javascriptExamples(markdown) {
  const { examples } = parseDocumentation(markdown);
  if (examples.length === 0 || examples.some((source) => !source.trim())) {
    throw new Error('в README отсутствует содержательный JavaScript-пример');
  }
  return examples;
}

function runExample(source) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
  });
}

describe('Примеры README', () => {
  it('собирает каждый браузерный JS-блок через публичный пакет после сборки', () => {
    const examples = javascriptExamples(readFileSync(new URL('../README.md', import.meta.url), 'utf8'));
    for (const example of examples) {
      const result = buildSync({ stdin: { contents: example, resolveDir: root },
        bundle: true, platform: 'browser', format: 'esm', write: false });
      expect(result.outputFiles[0].text.length).toBeGreaterThan(0);
    }
    // Исполнение этих же блоков в настоящем DOM входит в catalog:check.
  });

  it('сообщает об отсутствующем экспорте при исполнении примера', () => {
    const good = runExample("import { accessibilityOutline } from '@labpics/icons'; console.log(accessibilityOutline);");
    expect(good.error).toBeUndefined();
    expect(good.status, good.stderr).toBe(0);
    const bad = runExample("import { __missingDocumentationExport__ } from '@labpics/icons'; console.log(__missingDocumentationExport__);");
    expect(bad.error).toBeUndefined();
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('__missingDocumentationExport__');
  });

  it('отклоняет пустые JS-примеры и пропускает shell-блоки', () => {
    for (const source of ['', '```js\n', '```js\n```', '```sh\necho hello\n```']) {
      expect(() => javascriptExamples(source)).toThrow();
    }
    expect(javascriptExamples('```sh\nexit 1\n```\n```js\nconsole.log(1);\n```')).toEqual(['console.log(1);']);
    expect(javascriptExamples('~~~javascript\r\nconsole.log(1);\r\n~~~')).toEqual(['console.log(1);']);
  });
});
