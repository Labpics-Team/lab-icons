import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { assertAuthoringRender, authoringTutorialExample, tutorialCircleExpectations, verifyAuthoringConsumer } from '../scripts/bench/verify-authoring.mjs';

describe('public authoring consumer', () => {
  const expected = [{ id: 'body', center: { x: 0.5, y: 0.5 }, radius: 0.21,
    paint: { kind: 'stroke', width: 0.055 } }];
  const healthy = { size: 24, width: 24, height: 24, viewBox: '0 0 1 1', staticMatches: true,
    parts: ['body'], paths: [{ d: 'M.71 .5A.21 .21 0 1 0 .29 .5A.21 .21 0 1 0 .71 .5Z',
      length: 2 * Math.PI * 0.21, bounds: { x: 0.29, y: 0.29, width: 0.42, height: 0.42 },
      fill: 'none', stroke: 'rgb(0, 0, 0)', strokeWidth: 0.055, opacity: 1, visibility: 'visible', display: 'inline' }] };

  it('не принимает пустой SVG при сохранённых metadata, dimensions и accessible name', () => {
    expect(() => assertAuthoringRender([healthy], expected)).not.toThrow();
    const empty = { ...healthy, paths: [{ ...healthy.paths[0], d: '', length: 0 }] };
    expect(() => assertAuthoringRender([empty], expected)).toThrow('пустой контур');
  });

  it('обнаруживает неправильную форму и невидимую окраску при сохранённых part IDs', () => {
    const moved = { ...healthy, paths: [{ ...healthy.paths[0], bounds: { ...healthy.paths[0].bounds, x: 0.35 } }] };
    expect(() => assertAuthoringRender([moved], expected)).toThrow('body: x');
    const hidden = { ...healthy, paths: [{ ...healthy.paths[0], opacity: 0 }] };
    expect(() => assertAuthoringRender([hidden], expected)).toThrow();
  });

  it('независимое ожидание строится от authored primitive, а не compiled path', () => {
    expect(tutorialCircleExpectations({ anchors: [{ id: 'center', kind: 'canvas', at: 'center' }],
      parts: [{ id: 'body', geometry: { kind: 'circle', center: 'center', radius: 0.21 }, paint: expected[0].paint }] })).toEqual(expected);
    expect(() => tutorialCircleExpectations({ anchors: [{ id: 'a', kind: 'midpoint' }], parts: [] })).toThrow('неподдержанный якорь');
  });

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
