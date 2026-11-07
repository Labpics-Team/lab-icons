const HASH = /^[a-f0-9]{64}$/;
const AUTHOR_FIELDS = ['fileKey', 'version', 'nodeId', 'nodeSha256', 'masterSha256', 'normalizedSha256', 'pathFingerprintSha256'];

function sameAuthor(caps, glyph, original) {
  const author = glyph?.provenance?.author;
  return Boolean(caps && author && original && caps.icon === glyph.icon && caps.variant === glyph.variant && caps.author?.kind === 'figma' &&
    AUTHOR_FIELDS.every(field => caps.author[field] === author[field]) &&
    original.fileKey === author.fileKey && original.version === author.version && original.nodeId === author.nodeId &&
    original.masterSha256 === author.masterSha256);
}

function sameMaster(caps, glyph, original) {
  const author = glyph?.provenance?.author;
  return sameAuthor(caps, glyph, original) && caps.anatomy?.version === 1 &&
    caps.anatomy.masterSha256 === author.masterSha256 && caps.anatomy.pathFingerprintSha256 === author.pathFingerprintSha256 &&
    HASH.test(caps.anatomy.annotationSha256);
}

/** Геометрия стрелок принадлежит compiler; UI принимает identity и публичную семантику. */
export function admitPreparedClock(module, glyph, original) {
  if (['prepareClockHands', 'motionCapabilities'].some(name => typeof module?.[name] !== 'function')) {
    throw new Error('Подготовленные стрелки имеют неполный публичный контракт.');
  }
  const result = module.motionCapabilities(glyph.variant);
  if (result?.ok !== true) {
    if (result?.ok === false && ['VARIANT_UNSUPPORTED', 'COMPOSITION_UNSUPPORTED'].includes(result.reason?.code) &&
        typeof result.reason.message === 'string') return result;
    throw new Error(`${result?.reason?.code ?? 'INVALID_TARGET'}: ${result?.reason?.message ?? 'Возможности стрелок недоступны.'}`);
  }
  const caps = result.capabilities, gesture = caps?.gesture;
  if (!sameAuthor(caps, glyph, original) || caps.version !== 1 || caps.law !== 'joint.authored-elbow' ||
      caps.parameter !== 'elapsed-hours' || caps.reference !== 'authored-pose' || !HASH.test(caps.geometrySha256) ||
      gesture?.id !== 'clock.advance-hour' || gesture.kind !== 'state' || gesture.unit !== caps.parameter ||
      gesture.from !== 0 || gesture.to !== 1 || typeof gesture.meaning !== 'string' || !gesture.meaning.length ||
      !Array.isArray(caps.formats) || !caps.formats.includes('svg') || !caps.formats.includes('prepared-clock-hands')) {
    throw new Error('Подготовленные стрелки не соответствуют выбранному master.');
  }
  const preparation = module.prepareClockHands(glyph.variant);
  if (preparation?.ok !== true) {
    throw new Error(`${preparation?.reason?.code ?? 'INVALID_TARGET'}: ${preparation?.reason?.message ?? 'Стрелки не подготовлены.'}`);
  }
  const prepared = preparation.prepared, target = prepared?.renderTarget;
  if (!prepared || prepared.version !== 1 || prepared.icon !== caps.icon || prepared.variant !== caps.variant ||
      prepared.law !== caps.law || prepared.parameter !== caps.parameter || prepared.reference !== caps.reference ||
      typeof prepared.svg !== 'string' || !prepared.svg.length || typeof prepared.sample !== 'function' ||
      typeof target?.selector !== 'string' || !target.selector.length || target.attribute !== 'd' ||
      !Array.isArray(target.partIds) || !target.partIds.length || !Array.isArray(target.unchangedPartIds) ||
      [...target.partIds, ...target.unchangedPartIds].some(id => typeof id !== 'string' || !id.length) ||
      new Set([...target.partIds, ...target.unchangedPartIds]).size !== target.partIds.length + target.unchangedPartIds.length) {
    throw new Error('Подготовленные стрелки не соответствуют своему публичному metadata.');
  }
  return Object.freeze({ ok: true, capabilities: caps, prepared });
}

function preparedPose(prepared, scalar) {
  const field = prepared?.law === 'capsule.width' ? 'bodyWidth' : prepared?.law === 'joint.authored-elbow' ? 'elapsedHours' : null;
  if (!field || typeof prepared.sample !== 'function' || prepared.renderTarget?.attribute !== 'd') {
    throw new Error('Нет публичной подготовленной геометрии.');
  }
  const pose = prepared.sample(scalar);
  if (pose?.ok !== true) throw new Error(`${pose?.reason?.code ?? 'INVALID_SAMPLE'}: ${pose?.reason?.message ?? 'Поза не подготовлена.'}`);
  if (pose[field] !== scalar || typeof pose.d !== 'string' || !pose.d.length) throw new Error('Sampler не подготовил объявленную позу.');
  return pose;
}

/** Повторная presentation использует последний записанный scalar во всех размерах. */
export function preparedPoseSvg(prepared, scalar) {
  const pose = preparedPose(prepared, scalar), container = document.createElement('div');
  container.innerHTML = prepared.svg;
  const svg = container.querySelector('svg'), targets = svg?.querySelectorAll(prepared.renderTarget.selector);
  if (!svg || targets.length !== 1 || targets[0].tagName.toLowerCase() !== 'path') {
    throw new Error('RENDER_CORRESPONDENCE_MISMATCH: preparation не имеет единственного физического контура.');
  }
  targets[0].setAttribute('d', pose.d);
  return svg.outerHTML;
}

/** Export читает видимую позу, не останавливая её исполнение. */
export function visiblePreparedSvg(root, prepared, scalar, color) {
  const pose = preparedPose(prepared, scalar), svg = root.querySelector('svg');
  const targets = svg?.querySelectorAll(prepared.renderTarget.selector);
  if (!svg || targets.length !== 1 || targets[0].tagName.toLowerCase() !== 'path' || targets[0].getAttribute('d') !== pose.d) {
    throw new Error('RENDER_CORRESPONDENCE_MISMATCH: SVG не соответствует видимой подготовленной позе.');
  }
  const image = svg.cloneNode(true);
  image.style.removeProperty('width'); image.style.removeProperty('height');
  image.setAttribute('color', color);
  return image.outerHTML;
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
