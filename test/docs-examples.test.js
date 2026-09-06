import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocumentation } from '../scripts/lib/docs-markdown.js';
import { validateIconProposal } from '../scripts/lib/icon-proposal.js';

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

it('пример предложения проходит настоящий parser, но не подменяет визуальную приёмку', () => {
  const { jsonExamples } = parseDocumentation(readFileSync(new URL('../docs/agent-workflow.md', import.meta.url), 'utf8'));
  expect(jsonExamples.length).toBeGreaterThan(0);
  const catalog = JSON.parse(readFileSync(new URL('../semantics/catalog.json', import.meta.url), 'utf8'));
  const catalogIconIds = Object.keys(catalog.icons);
  for (const source of jsonExamples) {
    const proposal = JSON.parse(source);
    expect(() => validateIconProposal(proposal, { catalogIconIds })).not.toThrow();
    expect(() => validateIconProposal({ ...proposal, unsupported: true }, { catalogIconIds })).toThrow(/unsupported/);
    expect(() => validateIconProposal({ ...proposal, family: { ...proposal.family, references: ['not-a-real-icon'] } }, { catalogIconIds })).toThrow(/not-a-real-icon/);
  }
});
