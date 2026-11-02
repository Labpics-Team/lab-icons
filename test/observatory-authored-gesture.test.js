import { describe, expect, it } from 'vitest';
import { admitAuthoredGesture, authoredGestureActive } from '../observatory/authored-gesture.js';

function fixture() {
  const author = { kind: 'figma', fileKey: 'file', version: 'version', nodeId: '1:2',
    nodeSha256: '1'.repeat(64), masterSha256: '2'.repeat(64), normalizedSha256: '3'.repeat(64),
    pathFingerprintSha256: '4'.repeat(64) };
  const glyph = { icon: 'timer', variant: 'outline', provenance: { author } };
  const original = { fileKey: author.fileKey, version: author.version, nodeId: author.nodeId, masterSha256: author.masterSha256 };
  const capabilities = { icon: 'timer', variant: 'outline', author,
    anatomy: { version: 1, masterSha256: author.masterSha256, pathFingerprintSha256: author.pathFingerprintSha256, annotationSha256: '5'.repeat(64) },
    gestures: [{ id: 'timer.advance', kind: 'cycle', meaning: 'Отдельная стрелка вращается.' }] };
  const calls = [], svg = '<svg viewBox="0 0 24 24"><path data-part="timer-hand" d="M12 12L12 2"/></svg>';
  const module = {
    compileMotionEffect() {},
    motionCapabilities(variant) { calls.push(['capabilities', variant]); return { ok: true, capabilities }; },
    renderMotionSvg(variant) { calls.push(['svg', variant]); return { ok: true, svg }; },
  };
  return { glyph, original, capabilities, module, calls, svg };
}

describe('авторский gesture target в Observatory', () => {
  it('сохраняет source-only glyph и принимает собственный target того же master', () => {
    const value = fixture(), before = structuredClone(value.glyph);
    const admitted = admitAuthoredGesture(value.module, value.glyph, value.original);
    expect(admitted).toEqual({ ok: true, capabilities: value.capabilities, svg: value.svg });
    expect(value.glyph).toEqual(before);
    expect(value.calls).toEqual([['capabilities', 'outline'], ['svg', 'outline']]);
    expect(Object.isFrozen(admitted)).toBe(true);
  });

  it('не подменяет неподдержанное начертание и не вызывает его renderer', () => {
    const value = fixture(); value.glyph.variant = 'filled';
    const refusal = { ok: false, reason: { code: 'VARIANT_UNSUPPORTED', message: 'Filled не имеет отдельной стрелки.' } };
    value.module.motionCapabilities = variant => { value.calls.push(['capabilities', variant]); return refusal; };
    expect(admitAuthoredGesture(value.module, value.glyph, value.original)).toBe(refusal);
    expect(value.calls).toEqual([['capabilities', 'filled']]);
    expect(authoredGestureActive(refusal, 'original', false)).toBe(false);
  });

  it.each([
    ['другое имя', value => { value.capabilities.icon = 'reload'; }],
    ['другое начертание', value => { value.capabilities.variant = 'filled'; }],
    ['чужой author receipt', value => { value.capabilities.author = { ...value.capabilities.author, nodeSha256: '0'.repeat(64) }; }],
    ['иной master в UI', value => { value.original.masterSha256 = '0'.repeat(64); }],
    ['иная версия', value => { value.original.version = 'other'; }],
    ['чужая анатомия', value => { value.capabilities.anatomy.masterSha256 = '0'.repeat(64); }],
    ['потерянная аннотация', value => { value.capabilities.anatomy.annotationSha256 = ''; }],
    ['пустой жест', value => { value.capabilities.gestures = []; }],
    ['неполный жест', value => { value.capabilities.gestures = [null]; }],
    ['двойная identity жеста', value => { value.capabilities.gestures.push({ ...value.capabilities.gestures[0] }); }],
    ['чужой тип движения', value => { value.capabilities.gestures[0].kind = 'generic-spin'; }],
  ])('не принимает %s', (_, mutate) => {
    const value = fixture(); mutate(value);
    expect(() => admitAuthoredGesture(value.module, value.glyph, value.original)).toThrow(/выбранному master/);
  });

  it('отклоняет сломанный module/renderer вместо тихого fallback', () => {
    const value = fixture(); delete value.module.compileMotionEffect;
    expect(() => admitAuthoredGesture(value.module, value.glyph, value.original)).toThrow(/публичный контракт/);
    value.module.compileMotionEffect = () => {};
    value.module.renderMotionSvg = () => ({ ok: false, reason: { code: 'INVALID_TARGET' } });
    expect(() => admitAuthoredGesture(value.module, value.glyph, value.original)).toThrow(/не подготовил SVG/);
  });

  it('выдаёт предметную ошибку для malformed успешных capabilities', () => {
    const value = fixture();
    value.module.motionCapabilities = () => ({ ok: true, capabilities: null });
    expect(() => admitAuthoredGesture(value.module, value.glyph, value.original)).toThrow(/выбранному master/);
    value.module.motionCapabilities = () => ({ reason: { code: 'VARIANT_UNSUPPORTED', message: 'Нет Filled.' } });
    expect(() => admitAuthoredGesture(value.module, value.glyph, value.original)).toThrow(/VARIANT_UNSUPPORTED/);
  });

  it('использует explicit prospective view и не переносит авторский gesture в legacy/comparison', () => {
    const value = fixture(), admitted = admitAuthoredGesture(value.module, value.glyph, value.original);
    expect(authoredGestureActive(admitted, 'original', false)).toBe(true);
    for (const view of ['generated', 'overlay', 'difference']) expect(authoredGestureActive(admitted, view, false)).toBe(false);
    expect(authoredGestureActive(admitted, 'original', true)).toBe(false);
    expect(authoredGestureActive(null, 'original', false)).toBe(false);
  });
});
