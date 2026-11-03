import { describe, expect, it } from 'vitest';
import { admitAuthoredGesture, admitPreparedWidth, admitPreparedClock, authoredGestureActive } from '../observatory/authored-gesture.js';

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

function widthFixture() {
  const value = fixture();
  const domain = { kind: 'bounded-capsule-width', minimum: .8, maximum: 1 };
  const geometrySha256 = '6'.repeat(64);
  const capabilities = { ...value.capabilities, version: 1, law: 'capsule.width', domain, geometrySha256,
    formats: ['svg', 'prepared-width'] };
  delete capabilities.gestures;
  const prepared = { version: 1, icon: capabilities.icon, variant: capabilities.variant, law: capabilities.law,
    svg: value.svg, domain: { minimum: .8, maximum: 1 }, sample: width => ({ ok: true, bodyWidth: width, d: `M${width} 0Z` }),
    renderTarget: { selector: '[data-part="body"]', attribute: 'd', partId: 'body', unchangedPartIds: ['support'] } };
  const variation = { version: 1, law: capabilities.law, geometrySha256, domain };
  const module = { motionCapabilities: () => ({ ok: true, capabilities }), prepareBodyWidth: () => ({ ok: true, prepared }) };
  value.glyph.svg = value.svg;
  value.glyph.provenance.anatomy = { ...capabilities.anatomy };
  return { ...value, module, capabilities, prepared, variation };
}

describe('подготовленная ширина имеет свой контракт и тот же master', () => {
  it('принимает публичный sampler без выдуманных rotation exports', () => {
    const value = widthFixture();
    const result = admitPreparedWidth(value.module, value.glyph, value.original, value.variation);
    expect(result).toEqual({ ok: true, capabilities: value.capabilities, prepared: value.prepared });
    expect(Object.isFrozen(result)).toBe(true);
  });
  it('сохраняет точный отказ начертания до подготовки', () => {
    const value = widthFixture();
    const refusal = { ok: false, reason: { code: 'VARIANT_UNSUPPORTED', message: 'Нет подготовки Filled.' } };
    value.module.motionCapabilities = () => refusal;
    value.module.prepareBodyWidth = () => { throw new Error('Не должна вызываться.'); };
    expect(admitPreparedWidth(value.module, value.glyph, value.original, value.variation)).toBe(refusal);
  });
  it.each([
    ['чужой master', value => { value.original.masterSha256 = '7'.repeat(64); }],
    ['иная геометрия static capability', value => { value.variation.geometrySha256 = '7'.repeat(64); }],
    ['другая оптическая область', value => { value.variation.domain = { ...value.variation.domain, minimum: .7 }; }],
    ['чужая анатомия', value => { value.capabilities.anatomy = { ...value.capabilities.anatomy, pathFingerprintSha256: '7'.repeat(64) }; }],
    ['иная аннотация source', value => { value.glyph.provenance.anatomy.annotationSha256 = '7'.repeat(64); }],
    ['иная SVG preparation', value => { value.prepared.svg = '<svg/>'; }],
    ['чужой prepared icon', value => { value.prepared.icon = 'other'; }],
    ['иной prepared domain', value => { value.prepared.domain.minimum = .7; }],
    ['нефизическая цель', value => { value.prepared.renderTarget.attribute = 'transform'; }],
    ['дублированные неподвижные части', value => { value.prepared.renderTarget.unchangedPartIds = ['support', 'support']; }],
    ['body одновременно неподвижен', value => { value.prepared.renderTarget.unchangedPartIds = ['body']; }],
  ])('отклоняет %s', (_, mutate) => {
    const value = widthFixture(); mutate(value);
    expect(() => admitPreparedWidth(value.module, value.glyph, value.original, value.variation)).toThrow(/не соответствует/);
  });
});

function clockFixture() {
  const value = fixture();
  const capabilities = { icon: value.glyph.icon, variant: value.glyph.variant, author: value.capabilities.author,
    version: 1, law: 'joint.authored-elbow', parameter: 'elapsed-hours', reference: 'authored-pose',
    geometrySha256: '6'.repeat(64), formats: ['svg', 'prepared-clock-hands'],
    gesture: { id: 'clock.advance-hour', kind: 'state', meaning: 'Один час от авторской позы.', from: 0, to: 1, unit: 'elapsed-hours' } };
  const prepared = { version: 1, icon: capabilities.icon, variant: capabilities.variant, law: capabilities.law,
    parameter: capabilities.parameter, reference: capabilities.reference, svg: '<svg><path data-part="clock-hands"/></svg>',
    sample: elapsedHours => ({ ok: true, elapsedHours, d: `M${elapsedHours} 0Z` }),
    renderTarget: { selector: '[data-part="clock-hands"]', attribute: 'd', partIds: ['minute', 'hour'], unchangedPartIds: ['enclosure'] } };
  const module = { motionCapabilities: () => ({ ok: true, capabilities }), prepareClockHands: () => ({ ok: true, prepared }) };
  return { ...value, module, capabilities, prepared };
}

describe('подготовленные стрелки принимаются независимо от rotation-анатомии', () => {
  it('проверяет master, смысл и preparation, сохраняя static glyph без анатомии', () => {
    const f = clockFixture(), before = structuredClone(f.glyph);
    expect(f.capabilities.anatomy).toBeUndefined();
    expect(f.prepared.svg).not.toBe(f.svg);
    const admitted = admitPreparedClock(f.module, f.glyph, f.original);
    expect(admitted).toEqual({ ok: true, capabilities: f.capabilities, prepared: f.prepared });
    expect(Object.isFrozen(admitted)).toBe(true);
    expect(f.glyph).toEqual(before);
  });

  it.each(['VARIANT_UNSUPPORTED', 'COMPOSITION_UNSUPPORTED'])('сохраняет %s без вызова preparation и отказа static glyph', code => {
    const f = clockFixture(), refusal = { ok: false, reason: { code, message: 'Target не подготовлен.' } };
    f.module.motionCapabilities = () => refusal;
    f.module.prepareClockHands = () => { throw new Error('Preparation не должна вызываться.'); };
    expect(admitPreparedClock(f.module, f.glyph, f.original)).toBe(refusal);
  });

  it.each([
    ['другой master', f => { f.original.masterSha256 = '7'.repeat(64); }],
    ['чужой author receipt', f => { f.capabilities.author = { ...f.capabilities.author, nodeSha256: '7'.repeat(64) }; }],
    ['нет geometry identity', f => { f.capabilities.geometrySha256 = ''; }],
    ['чужая единица', f => { f.capabilities.gesture.unit = 'degrees'; }],
    ['чужая начальная поза', f => { f.capabilities.reference = 'absolute-time'; }],
    ['потерянный смысл', f => { f.capabilities.gesture.meaning = ''; }],
    ['другой интервал', f => { f.capabilities.gesture.to = 12; }],
    ['подменённая preparation', f => { f.prepared.icon = 'other'; }],
    ['нет clock-svg формата', f => { f.capabilities.formats = ['svg']; }],
    ['отдельный transform', f => { f.prepared.renderTarget.attribute = 'transform'; }],
    ['повторная стрелка', f => { f.prepared.renderTarget.partIds = ['minute', 'minute']; }],
    ['стрелка одновременно неподвижна', f => { f.prepared.renderTarget.unchangedPartIds = ['hour']; }],
  ])('отклоняет %s', (_, mutate) => {
    const f = clockFixture(); mutate(f);
    expect(() => admitPreparedClock(f.module, f.glyph, f.original)).toThrow(/не соответствуют/);
  });
});
