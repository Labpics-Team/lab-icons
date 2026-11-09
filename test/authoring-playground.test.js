import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { compileDesignSpec } from '../src/authoring/index.js';
import { authoringTutorialMaterial } from '../scripts/lib/authoring-tutorial.js';
import { downloadFile } from '../observatory/download.js';

describe('starter из публичного tutorial', () => {
  const document = readFileSync(new URL('../docs/authoring.md', import.meta.url), 'utf8');
  const entry = fileURLToPath(new URL('../src/authoring/index.ts', import.meta.url));

  it('передаёт plain data и тот же public GlyphIR, без tutorial кода в browser payload', () => {
    const material = authoringTutorialMaterial(document, entry);
    expect(material.glyph).toEqual(compileDesignSpec(material.spec, { icon: material.glyph.icon, size: 24 }));
    expect(material.glyph.provenance.state).toBe('candidate');
    expect(material.glyph.svg).toMatch(/width="24" height="24"/);
    expect(JSON.parse(JSON.stringify(material))).toEqual(material);
  });

  it('изменение tutorial проходит в JSON и отрисовку без второго editable примера', () => {
    const original = authoringTutorialMaterial(document, entry);
    const changed = authoringTutorialMaterial(document.replace('radius: 0.21', 'radius: 0.22'), entry);
    expect(changed.spec.parts[0].geometry.radius).toBe(0.22);
    expect(changed.glyph.svg).not.toBe(original.glyph.svg);
    expect(changed.glyph.provenance.specSha256).not.toBe(original.glyph.provenance.specSha256);
  });

  it('build отказывает ошибочному tutorial до публикации starter', () => {
    expect(() => authoringTutorialMaterial(document.replace('radius: 0.21', 'radius: -0.21'), entry)).toThrow('radius');
  });
});

describe('общий download transport', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  function fixture(failure) {
    vi.useFakeTimers();
    const click = vi.fn(() => { if (failure) throw failure; });
    const link = { click };
    vi.stubGlobal('document', { createElement: vi.fn(() => link) });
    const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    return { click, link, create, revoke };
  }

  it('скачивает точные текущие bytes и MIME, освобождая Blob после activation', async () => {
    const { click, link, create, revoke } = fixture();
    const svg = '<svg width="16" height="16"/>';
    downloadFile(svg, 'image/svg+xml', 'candidate-16.svg');
    expect(link).toMatchObject({ href: 'blob:download', download: 'candidate-16.svg' });
    expect(click).toHaveBeenCalledOnce();
    expect(create.mock.calls[0][0].type).toBe('image/svg+xml');
    expect(await create.mock.calls[0][0].text()).toBe(svg);
    expect(revoke).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:download');
  });

  it('освобождает Blob и при отказе активации', () => {
    const failure = new Error('activation failure');
    const { revoke } = fixture(failure);
    expect(() => downloadFile('{}', 'application/json', 'effect.json')).toThrow(failure);
    vi.runAllTimers();
    expect(revoke).toHaveBeenCalledWith('blob:download');
  });
});
