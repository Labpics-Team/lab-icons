const HASH = /^[a-f0-9]{64}$/;
const AUTHOR_FIELDS = ['fileKey', 'version', 'nodeId', 'nodeSha256', 'masterSha256', 'normalizedSha256', 'pathFingerprintSha256'];

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
  const caps = result.capabilities, author = glyph?.provenance?.author;
  if (!caps || !author || !original || caps.icon !== glyph.icon || caps.variant !== glyph.variant || caps.author?.kind !== 'figma' ||
      AUTHOR_FIELDS.some(field => caps.author[field] !== author[field]) ||
      original.fileKey !== author.fileKey || original.version !== author.version ||
      original.nodeId !== author.nodeId || original.masterSha256 !== author.masterSha256 ||
      caps.anatomy?.version !== 1 || caps.anatomy.masterSha256 !== author.masterSha256 ||
      caps.anatomy.pathFingerprintSha256 !== author.pathFingerprintSha256 || !HASH.test(caps.anatomy.annotationSha256) ||
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
