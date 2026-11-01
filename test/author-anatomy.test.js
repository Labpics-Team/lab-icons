import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { loadAuthorBaseline } from '../scripts/lib/author-baseline.js';
import { compileAuthorAnatomy } from '../scripts/lib/author-anatomy.js';
import { authorPathEntries } from '../src/core/icon-geometry.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = relative => JSON.parse(readFileSync(new URL(relative, new URL('../', import.meta.url)), 'utf8'));
const captured = read('semantics/figma-baseline.json');
const allAnnotations = read('semantics/author-anatomy.json');
const document = { ...allAnnotations, icons: { reload: allAnnotations.icons.reload, refresh: allAnnotations.icons.refresh } };
const manifest = { ...captured, counts: { families: 3, variants: 6 },
  icons: Object.fromEntries(['reload', 'refresh', 'time'].map(icon => [icon, captured.icons[icon]])) };
const baseline = loadAuthorBaseline(root, { manifest });

describe('явная анатомия неизменённых авторских masters', () => {
  it('даёт один закон двум настоящим семействам и сохраняет обе независимые формы', () => {
    const contracts = compileAuthorAnatomy(baseline, document);
    expect(Object.keys(contracts).sort()).toEqual(['refresh/filled', 'refresh/outline', 'reload/filled', 'reload/outline']);
    for (const [id, contract] of Object.entries(contracts)) {
      const [icon, variant] = id.split('/');
      const master = baseline.icons[icon][variant];
      expect(contract.file).toBe(master.master);
      expect(contract.parts.map(({ id, identity, role, anchor, anchorSource, ...geometry }) => geometry))
        .toEqual(master.sourceContract.parts.map(({ id, identity, role, ...geometry }) => geometry));
      expect(authorPathEntries(master.artifactSvg)).toEqual(authorPathEntries(master.normalizedSvg));
      expect(contract.parts).toHaveLength(1);
      expect(contract.parts[0]).toMatchObject({ id: 'cycle-body', identity: 'declared',
        role: 'control', anchor: [0.5, 0.5], anchorSource: 'declared' });
      expect(contract.anatomy).toMatchObject({ version: 1,
        masterSha256: master.author.masterSha256,
        pathFingerprintSha256: master.author.pathFingerprintSha256 });
      expect(contract.anatomy.annotationSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(contract.gestures[0]).toMatchObject({ id: `${icon}.cycle`,
        tracks: [{ partId: 'cycle-body', from: 0, to: 360, anchor: [0.5, 0.5] }] });
      expect(Object.isFrozen(contract.parts[0].anchor)).toBe(true);
      expect(Object.isFrozen(contract.gestures[0].tracks[0])).toBe(true);
    }
    expect(contracts['reload/outline'].parts[0].sourceFingerprint)
      .not.toBe(contracts['reload/filled'].parts[0].sourceFingerprint);
    expect(contracts['time/outline']).toBeUndefined();
    expect(Object.isFrozen(contracts)).toBe(true);
  });

  it('digest детерминирован при перестановке ключей, но связывает смысл и конкретный вариант', () => {
    const original = compileAuthorAnatomy(baseline, document);
    const reordered = { icons: document.icons, source: document.source, schemaVersion: document.schemaVersion };
    expect(compileAuthorAnatomy(baseline, reordered)).toEqual(original);
    expect(original['reload/outline'].anatomy.annotationSha256)
      .not.toBe(original['reload/filled'].anatomy.annotationSha256);
    const changed = structuredClone(document);
    changed.icons.reload.outline.parts[0].id = 'refresh-arrow';
    changed.icons.reload.outline.gesture.partId = 'refresh-arrow';
    expect(compileAuthorAnatomy(baseline, changed)['reload/outline'].anatomy.annotationSha256)
      .not.toBe(original['reload/outline'].anatomy.annotationSha256);
  });

  it.each([
    ['другая версия', value => { value.source.version = '1'; }, 'SOURCE_MISMATCH'],
    ['другой файл', value => { value.source.fileKey = 'anotherFile'; }, 'SOURCE_MISMATCH'],
    ['raw master drift', value => { value.icons.reload.outline.masterSha256 = 'a'.repeat(64); }, 'MASTER_MISMATCH'],
    ['path drift', value => { value.icons.refresh.filled.pathFingerprintSha256 = 'b'.repeat(64); }, 'MASTER_MISMATCH'],
    ['другая геометрия', value => { value.icons.reload.outline.parts[0].d = 'M0 0Z'; }, 'ANNOTATION_INVALID'],
    ['координаты shape', value => { value.icons.reload.outline.coordinates = [12, 12]; }, 'ANNOTATION_INVALID'],
    ['неизвестный закон', value => { value.icons.reload.outline.gesture.law = 'spin.everything'; }, 'LAW_UNSUPPORTED'],
    ['чужая часть', value => { value.icons.reload.outline.gesture.partId = 'missing'; }, 'LAW_TOPOLOGY_UNSUPPORTED'],
    ['нет пути', value => { value.icons.reload.outline.parts = []; }, 'PARTS_INVALID'],
    ['нечисловой index', value => { value.icons.reload.outline.parts[0].pathIndex = NaN; }, 'PARTS_INVALID'],
    ['несуществующий index', value => { value.icons.reload.outline.parts[0].pathIndex = 1; }, 'PARTS_INVALID'],
    ['нечисловой anchor', value => { value.icons.reload.outline.parts[0].anchor[0] = Infinity; }, 'PARTS_INVALID'],
    ['anchor вне viewBox', value => { value.icons.reload.outline.parts[0].anchor[0] = -0.1; }, 'PARTS_INVALID'],
    ['подмена canvas-center', value => { value.icons.reload.outline.parts[0].anchor[0] = 0.6; }, 'PARTS_INVALID'],
    ['другое значение якоря', value => { value.icons.reload.outline.parts[0].anchorMeaning = 'circle-center'; }, 'PARTS_INVALID'],
  ])('точно отказывает: %s', (_, mutate, code) => {
    const invalid = structuredClone(document);
    mutate(invalid);
    expect(() => compileAuthorAnatomy(baseline, invalid)).toThrow(expect.objectContaining({ code }));
  });

  it('дубликаты адресов и semantic IDs отклоняются до выдачи partial admission', () => {
    const source = baseline.icons.time.outline;
    const timeDeclaration = { masterSha256: source.author.masterSha256,
      pathFingerprintSha256: source.author.pathFingerprintSha256,
      parts: [0, 1].map(pathIndex => ({ pathIndex, id: `time-part-${pathIndex}`, role: 'control',
        anchor: [0.5, 0.5], anchorMeaning: 'canvas-center' })),
      gesture: { law: 'cycle.clockwise', partId: 'time-part-0' } };
    for (const key of ['pathIndex', 'id']) {
      const invalid = structuredClone(document);
      invalid.icons.time = { outline: structuredClone(timeDeclaration) };
      invalid.icons.time.outline.parts[1][key] = invalid.icons.time.outline.parts[0][key];
      expect(() => compileAuthorAnatomy(baseline, invalid)).toThrow(expect.objectContaining({ code: 'PARTS_INVALID' }));
    }
  });

  it.each(['outline', 'filled'])('контрпример time/%s: единый цикл не заменяет две независимые стрелки', variant => {
    const source = baseline.icons.time[variant];
    const invalid = structuredClone(document);
    invalid.icons.time = { [variant]: {
      masterSha256: source.author.masterSha256,
      pathFingerprintSha256: source.author.pathFingerprintSha256,
      parts: source.sourceContract.parts.map((_, pathIndex) => ({ pathIndex, id: `time-part-${pathIndex}`,
        role: 'control', anchor: [0.5, 0.5], anchorMeaning: 'canvas-center' })),
      gesture: { law: 'cycle.clockwise', partId: 'time-part-0' },
    } };
    expect(() => compileAuthorAnatomy(baseline, invalid)).toThrow(
      expect.objectContaining({ code: 'LAW_TOPOLOGY_UNSUPPORTED' }));
  });
});
