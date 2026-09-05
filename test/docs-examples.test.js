import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));

// README использует обычные fenced blocks. Разбор охватывает только этот
// формат и не выдаётся за произвольный Markdown-парсер или запуск shell-релиза.
function javascriptExamples(markdown) {
  const result = [];
  let fence = null;
  let body = [];
  for (const line of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const marker = line.match(/^(`{3,}|~{3,})([^`]*)$/);
    if (fence === null) {
      if (marker) {
        fence = { marker: marker[1], javascript: ['js', 'javascript'].includes(marker[2].trim()) };
        body = [];
      }
    } else if (line.trim() === fence.marker) {
      if (fence.javascript) {
        if (!body.join('\n').trim()) throw new Error('пустой JavaScript-пример');
        result.push(body.join('\n'));
      }
      fence = null;
    } else body.push(line);
  }
  if (fence !== null) throw new Error('незакрытый блок кода в README');
  if (result.length === 0) throw new Error('в README нет исполняемого JavaScript-примера');
  return result;
}

function runExample(source) {
  return spawnSync(process.execPath, ['--input-type=module', '--eval', source], {
    cwd: root, encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
  });
}

describe('первый сценарий из README', () => {
  it('исполняет каждый опубликованный JS-блок через публичный пакет после сборки', () => {
    const examples = javascriptExamples(readFileSync(new URL('../README.md', import.meta.url), 'utf8'));
    for (const example of examples) {
      const result = runExample(example);
      expect(result.error, result.stderr).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout.trim().length).toBeGreaterThan(0);
    }
  });

  it('отвергает отсутствующий экспорт, а не только проверяет синтаксис примера', () => {
    const good = runExample("import { accessibilityOutline } from '@labpics/icons'; console.log(accessibilityOutline);");
    expect(good.error).toBeUndefined();
    expect(good.status, good.stderr).toBe(0);
    const bad = runExample("import { __missingDocumentationExport__ } from '@labpics/icons'; console.log(__missingDocumentationExport__);");
    expect(bad.error).toBeUndefined();
    expect(bad.status).not.toBe(0);
    expect(bad.stderr).toContain('__missingDocumentationExport__');
  });

  it('не даёт успеха при удалённом или сломанном блоке и не исполняет shell', () => {
    for (const source of ['', '```js\n', '```js\n```', '```sh\necho hello\n```']) {
      expect(() => javascriptExamples(source)).toThrow();
    }
    expect(javascriptExamples('```sh\nexit 1\n```\n```js\nconsole.log(1);\n```')).toEqual(['console.log(1);']);
    expect(javascriptExamples('~~~javascript\r\nconsole.log(1);\r\n~~~')).toEqual(['console.log(1);']);
  });
});
