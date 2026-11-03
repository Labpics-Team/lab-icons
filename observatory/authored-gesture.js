const HASH = /^[a-f0-9]{64}$/;
const AUTHOR_FIELDS = ['fileKey', 'version', 'nodeId', 'nodeSha256', 'masterSha256', 'normalizedSha256', 'pathFingerprintSha256'];

function sameMaster(caps, glyph, original) {
  const author = glyph?.provenance?.author;
  return Boolean(caps && author && original && caps.icon === glyph.icon && caps.variant === glyph.variant && caps.author?.kind === 'figma' &&
    AUTHOR_FIELDS.every(field => caps.author[field] === author[field]) &&
    original.fileKey === author.fileKey && original.version === author.version && original.nodeId === author.nodeId &&
    original.masterSha256 === author.masterSha256 && caps.anatomy?.version === 1 &&
    caps.anatomy.masterSha256 === author.masterSha256 && caps.anatomy.pathFingerprintSha256 === author.pathFingerprintSha256 &&
    HASH.test(caps.anatomy.annotationSha256));
}

/** Подготовленный sampler и metadata принадлежат тому же авторскому закону. */
export function admitPreparedWidth(module, glyph, original, variation) {
  if (['prepareBodyWidth', 'motionCapabilities'].some(name => typeof module?.[name] !== 'function')) {
    throw new Error('Подготовленная ширина имеет неполный публичный контракт.');
  }
  const result = module.motionCapabilities(glyph.variant);
  if (result?.ok !== true) {
    if (result?.ok === false && result.reason?.code === 'VARIANT_UNSUPPORTED' && typeof result.reason.message === 'string') return result;
    throw new Error(`${result?.reason?.code ?? 'INVALID_TARGET'}: ${result?.reason?.message ?? 'Возможности ширины недоступны.'}`);
  }
  const caps = result.capabilities, domain = caps?.domain;
  if (!sameMaster(caps, glyph, original) || caps.version !== 1 || caps.law !== 'capsule.width' ||
      !HASH.test(caps.geometrySha256) || variation?.law !== caps.law || variation.geometrySha256 !== caps.geometrySha256 ||
      domain?.kind !== 'bounded-capsule-width' || !Number.isFinite(domain.minimum) ||
      domain.minimum <= 0 || domain.minimum >= 1 || domain.maximum !== 1 ||
      variation.domain?.minimum !== domain.minimum || variation.domain.maximum !== domain.maximum ||
      caps.anatomy.annotationSha256 !== glyph.provenance?.anatomy?.annotationSha256 ||
      !Array.isArray(caps.formats) || !caps.formats.includes('svg') || !caps.formats.includes('prepared-width')) {
    throw new Error('Подготовленная ширина не соответствует выбранному master.');
  }
  const preparation = module.prepareBodyWidth(glyph.variant);
  if (preparation?.ok !== true) throw new Error(`${preparation?.reason?.code ?? 'INVALID_TARGET'}: ${preparation?.reason?.message ?? 'Ширина не подготовлена.'}`);
  const prepared = preparation.prepared, target = prepared?.renderTarget;
  if (!prepared || prepared.version !== 1 || prepared.icon !== caps.icon || prepared.variant !== caps.variant ||
      prepared.law !== caps.law || prepared.domain?.minimum !== caps.domain.minimum || prepared.domain.maximum !== caps.domain.maximum ||
      typeof prepared.svg !== 'string' || prepared.svg !== glyph.svg || typeof prepared.sample !== 'function' ||
      typeof target?.selector !== 'string' || !target.selector.length || target.attribute !== 'd' ||
      typeof target.partId !== 'string' || !target.partId.length || !Array.isArray(target.unchangedPartIds) ||
      target.unchangedPartIds.includes(target.partId) || new Set(target.unchangedPartIds).size !== target.unchangedPartIds.length ||
      target.unchangedPartIds.some(id => typeof id !== 'string' || !id.length)) {
    throw new Error('Подготовленная ширина не соответствует своему публичному metadata.');
  }
  return Object.freeze({ ok: true, capabilities: caps, prepared });
}

/** Пакет владеет анатомией; UI проверяет только идентичность выбранного master. */
export function admitAuthoredGesture(module, glyph, original) {
  if (['renderMotionSvg', 'compileMotionEffect', 'motionCapabilities'].some(name => typeof module?.[name] !== 'function')) {
    throw new Error('Авторский gesture target имеет неполный публичный контракт.');
  }
  const result = module.motionCapabilities(glyph.variant);
  if (result?.ok !== true) {
    if (result?.ok === false && result.reason?.code === 'VARIANT_UNSUPPORTED' && typeof result.reason.message === 'string') return result;
    throw new Error(`${result?.reason?.code ?? 'INVALID_TARGET'}: ${result?.reason?.message ?? 'Возможности авторского жеста недоступны.'}`);
  }
  const caps = result.capabilities;
  if (!sameMaster(caps, glyph, original) ||
      !Array.isArray(caps.gestures) || !caps.gestures.length || caps.gestures.some(gesture => !gesture ||
        typeof gesture.id !== 'string' || !gesture.id.length || !['cycle', 'state'].includes(gesture.kind) ||
        typeof gesture.meaning !== 'string' || !gesture.meaning.length) ||
      new Set(caps.gestures.map(gesture => gesture.id)).size !== caps.gestures.length) {
    throw new Error('Авторский gesture target не соответствует выбранному master.');
  }
  const rendered = module.renderMotionSvg(glyph.variant);
  if (rendered?.ok !== true || typeof rendered.svg !== 'string' || !rendered.svg.length) {
    throw new Error('Авторский gesture target не подготовил SVG выбранного начертания.');
  }
  return Object.freeze({ ok: true, capabilities: caps, svg: rendered.svg });
}

/** Проспективный вид передаётся явно: прежний state ещё может показывать модель. */
export function authoredGestureActive(admission, view, legacy) {
  return Boolean(admission?.ok && view === 'original' && !legacy);
}
