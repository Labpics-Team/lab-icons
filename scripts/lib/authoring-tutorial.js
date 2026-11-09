import { buildSync } from 'esbuild';
import { dirname } from 'node:path';
import { runInNewContext } from 'node:vm';

/** Исполняется первый самостоятельный пример из публичного tutorial. */
export function authoringTutorialExample(document) {
  const code = document.match(/```ts\r?\n([\s\S]*?)\r?\n```/)?.[1];
  if (!code || !code.includes("from '@labpics/icons/authoring'") ||
      !/\bconst\s+glyph\s*=\s*compileDesignSpec\(/.test(code)) {
    throw new Error('authoring consumer: tutorial не содержит самостоятельного public compile примера');
  }
  return code;
}

/** Доверенный tutorial исполняется при сборке; браузеру передаются только данные. */
export function authoringTutorialMaterial(document, authoringEntry) {
  const bundle = buildSync({
    stdin: { contents: `${authoringTutorialExample(document)}\nexport { beacon as spec, glyph };`,
      resolveDir: dirname(authoringEntry), loader: 'ts', sourcefile: 'authoring-tutorial.ts' },
    alias: { '@labpics/icons/authoring': authoringEntry },
    bundle: true, format: 'iife', globalName: 'tutorial', platform: 'browser',
    target: 'es2022', write: false, logLevel: 'silent',
  });
  const context = { TextEncoder };
  runInNewContext(bundle.outputFiles[0].text, context);
  return JSON.parse(JSON.stringify(context.tutorial));
}
