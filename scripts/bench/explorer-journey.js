/** Независимый reader исходного SVG: сохраняет controls, subpaths и явный Z. */
function rawCapsuleContours(d) {
  if (typeof d !== 'string' || !d.length) throw new TypeError('Нужен authored path.');
  const tokens = [], expression = /[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  let end = 0;
  for (const match of d.matchAll(expression)) {
    if (!/^[\s,]*$/.test(d.slice(end, match.index))) throw new TypeError('Некорректный path token.');
    tokens.push(match[0]); end = match.index + match[0].length;
  }
  if (!/^[\s,]*$/.test(d.slice(end))) throw new TypeError('Некорректное окончание path.');
  const counts = { M: 2, L: 2, C: 6, Q: 4, H: 1, V: 1 }, contours = [];
  let cursor = 0, command, point = [0, 0], start;
  while (cursor < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[cursor])) command = tokens[cursor++];
    const kind = command?.toUpperCase(), relative = command !== kind;
    if (kind === 'Z') {
      if (!start || contours.at(-1)?.at(-1)?.cmd === 'Z') throw new TypeError('Лишний Z.');
      contours.at(-1).push({ cmd: 'Z', values: [] }); point = [...start]; start = null; command = null;
      continue;
    }
    const count = counts[kind];
    if (!count || cursor + count > tokens.length) throw new TypeError('Неподдержанная либо неполная команда.');
    const values = tokens.slice(cursor, cursor + count).map(Number); cursor += count;
    if (!values.every(Number.isFinite)) throw new TypeError('Нужны конечные operands.');
    if (kind === 'H' || kind === 'V') {
      const axis = kind === 'H' ? 0 : 1, target = [...point]; target[axis] = values[0] + (relative ? point[axis] : 0);
      values.splice(0, values.length, ...target);
    } else if (relative) {
      for (let i = 0; i < values.length; i++) values[i] += point[i % 2];
    }
    if (kind === 'M') {
      if (start) throw new TypeError('Контур обязан иметь явный Z.');
      contours.push([]); start = values.slice(-2); command = relative ? 'l' : 'L';
    } else if (!start) throw new TypeError('Контур начинается с M.');
    contours.at(-1).push({ cmd: kind === 'H' || kind === 'V' ? 'L' : kind, values }); point = values.slice(-2);
  }
  if (start || !contours.length || contours.some(contour => contour.at(-1).cmd !== 'Z')) throw new TypeError('Незамкнутый контур.');
  return contours;
}

/** Width law сверяется с raw authored operands, без coefficient packet/compiler parser. */
export function matchesAuthoredCapsulePath(before, after, width) {
  try {
    if (!Number.isFinite(width) || width <= 0 || width > 1) return false;
    const source = rawCapsuleContours(before), changed = rawCapsuleContours(after);
    if (source.length < 1 || source.length > 2 || changed.length !== source.length) return false;
    const spans = source.map(contour => {
      const xs = contour.flatMap(segment => segment.values.filter((_, index) => index % 2 === 0));
      const low = Math.min(...xs), high = Math.max(...xs);
      return { width: high - low, center: (low + high) / 2 };
    });
    return source.every((contour, index) => {
      const original = spans[index], targetWidth = index === 0 ? original.width * width
        : original.width - spans[0].width * (1 - width);
      const factor = targetWidth / original.width;
      return original.width > 0 && targetWidth > 0 && contour.length === changed[index].length && contour.every((segment, part) => {
        const actual = changed[index][part];
        return segment.cmd === actual.cmd && segment.values.length === actual.values.length && segment.values.every((value, coordinate) => {
          const expected = coordinate % 2 ? value : original.center + (value - original.center) * factor;
          return Math.abs(actual.values[coordinate] - expected) < 1e-10;
        });
      });
    });
  } catch { return false; }
}

function capsuleFrameGeometryMatches(observed, viewBox) {
  const same = (left, right) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.0001;
  return observed?.viewBox?.length === 4 && viewBox.length === 4 && observed.viewBox.every((value, index) => same(value, viewBox[index])) &&
    observed.preserveAspectRatio === 'xMidYMid meet' && observed.untransformed === true &&
    same(observed.intrinsicWidth, viewBox[2]) && same(observed.intrinsicHeight, viewBox[3]);
}

/** Авторский master сохраняет нейтральные Figma-группы с metadata. */
export function capsuleContentShapeMatches(svg, authored = false) {
  const elements = [...svg.querySelectorAll('*')];
  return elements.some(element => element.localName === 'path') && elements.every(element =>
    element.namespaceURI === 'http://www.w3.org/2000/svg' && (element.localName === 'path'
      ? element.children.length === 0 && (authored || element.parentElement === svg)
      : authored && element.localName === 'g' && [...element.attributes].every(attribute =>
        attribute.name === 'id' || attribute.name.startsWith('data-'))));
}

export function capsuleSvgFrameMatches(observed, viewBox) {
  return capsuleFrameGeometryMatches(observed, viewBox) && observed.directPathsOnly === true;
}

export function capsuleAuthoredFrameMatches(observed, viewBox) {
  return capsuleFrameGeometryMatches(observed, viewBox) && observed.inertGroupsOnly === true;
}

export function capsuleViewportMatches(observed, viewBox, displaySize) {
  const same = (left, right) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.0001;
  return capsuleSvgFrameMatches(observed, viewBox) &&
    same(observed.width, displaySize) && same(observed.height, displaySize) &&
    same(observed.screen?.a, displaySize / viewBox[2]) && same(observed.screen?.d, displaySize / viewBox[3]) &&
    same(observed.screen?.b, 0) && same(observed.screen?.c, 0);
}

/** Вложенный SVG сравнивается в экранных координатах: CSS width может быть auto.
 * Допуск 0.001 CSS px относится к browser measurement, не к авторской геометрии. */
export function comparisonViewportMatches(observed, reference, viewBox) {
  const frame = item => item?.viewBox?.length === 4 && item.viewBox.every(Number.isFinite) &&
    item.viewBox[2] > 0 && item.viewBox[3] > 0 && item.screen?.length === 6 &&
    item.screen.every(Number.isFinite) && item.screen[0] * item.screen[3] - item.screen[1] * item.screen[2] !== 0;
  if (!frame(reference) || !Array.isArray(viewBox) || viewBox.length !== 4 ||
      !reference.viewBox.every((value, index) => value === viewBox[index]) ||
      !Array.isArray(observed) || observed.length < 2) return false;
  const [x, y, width, height] = reference.viewBox;
  const corners = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]];
  const project = ([a, b, c, d, e, f], [px, py]) => [a * px + c * py + e, b * px + d * py + f];
  return observed.every(item => frame(item) && item.viewBox.every((value, index) => value === reference.viewBox[index]) &&
    item.intrinsicWidth === width && item.intrinsicHeight === height && corners.every(point => {
      const expected = project(reference.screen, point), actual = project(item.screen, point);
      return actual.every((value, index) => Number.isFinite(value) && Number.isFinite(expected[index]) &&
        Math.abs(value - expected[index]) < 0.001);
    }));
}

/** Mask painting добавляет instance coordinates вне DOM getScreenCTM. */
export function comparisonMasksMatch(observed, viewBox) {
  return Array.isArray(observed) && observed.length === 2 && Array.isArray(viewBox) && viewBox.length === 4 &&
    viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0 && observed.every(mask =>
      mask.maskType === 'luminance' && mask.maskUnits === 'userSpaceOnUse' && mask.maskContentUnits === 'userSpaceOnUse' &&
      Array.isArray(mask.bounds) && mask.bounds.length === 4 && mask.bounds.every((value, index) =>
        Number.isFinite(value) && Math.abs(value - viewBox[index]) < 0.0001));
}

export function isFreshCapsuleDownload(downloads, previousCount, filename) {
  return downloads.length === previousCount + 1 && downloads.at(-1)?.filename === filename;
}

/** Геометрия должна быть залита в наблюдаемом CSS cascade, включая предков SVG. */
export function capsulePaintMatches(observed) {
  const visible = item => item.visibility === 'visible' && item.display !== 'none' && Number(item.opacity) === 1 &&
    item.filter === 'none' && item.maskImage === 'none' && item.clipPath === 'none';
  return /^rgb\(\d+, \d+, \d+\)$/.test(observed.expectedColor) && observed.paths.length > 0 &&
    observed.paths.every(item => visible(item) && item.fill === observed.expectedColor && item.color === observed.expectedColor &&
    item.fillRule === item.declaredFillRule && Number(item.fillOpacity) === 1 && item.stroke === 'none') &&
    observed.ancestors.length > 0 && observed.ancestors.every(visible);
}

/** Экспорт сохраняет все атрибуты реально показанных paths, включая semantic IDs. */
export function capsuleExportPathsMatch(observed, expected) {
  const attributes = paths => paths.map(path => Object.entries(path).sort(([left], [right]) => left.localeCompare(right)));
  return observed.length > 0 && JSON.stringify(attributes(observed)) === JSON.stringify(attributes(expected));
}

/** Compound наблюдается как одна заливка с полным упорядоченным набором contours. */
export function capsuleSemanticObservations(paths, anatomy) {
  const { kind, partIds, roles } = anatomy;
  if (!Array.isArray(partIds) || !partIds.length || new Set(partIds).size !== partIds.length ||
      !Array.isArray(roles) || roles.length !== partIds.length) throw new TypeError('Нужна полная анатомия capsule.');
  if (kind === 'layers') {
    if (paths.length !== partIds.length) throw new TypeError('Число слоёв не соответствует анатомии.');
    return paths.map((path, index) => {
      if (path.partIds !== null || path.roles !== null || path.partId !== null && path.partId !== partIds[index] ||
          path.role !== null && path.role !== roles[index]) throw new TypeError('Изменена адресация слоя.');
      return { id: partIds[index], role: roles[index], d: path.d, contours: path.contours, fillRule: path.fillRule };
    });
  }
  if (kind !== 'compound' || paths.length !== 1 || roles[0] !== 'container' || roles.slice(1).some(role => role !== 'counter')) {
    throw new TypeError('Нужна одна compound capsule с container/counter.');
  }
  const path = paths[0], split = value => value.trim().split(/\s+/);
  if (path.partId !== null || path.role !== null || path.fillRule !== 'evenodd' ||
      path.partIds !== null && JSON.stringify(split(path.partIds)) !== JSON.stringify(partIds) ||
      path.roles !== null && JSON.stringify(split(path.roles)) !== JSON.stringify(roles)) {
    throw new TypeError('Изменены порядок, роли или общая заливка compound capsule.');
  }
  const contours = rawCapsuleContours(path.d);
  if (contours.length !== partIds.length || path.contours.length !== contours.length) {
    throw new TypeError('Compound обязан покрывать каждый contour ровно один раз.');
  }
  return contours.map((contour, index) => ({ id: partIds[index], role: roles[index], fillRule: path.fillRule,
    d: contour.map(segment => segment.cmd + segment.values.join(' ')).join(''), contours: [path.contours[index]] }));
}

/** Browser getBBox округляет до float; допуск относится к измерению, не к оптике. */
export function capsuleWidthObservationChecks(before, after, width) {
  const same = (left, right) => Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) < 0.0001;
  const original = before.find(part => part.id === 'microphone-body');
  const modified = after.find(part => part.id === 'microphone-body');
  const identity = before.length >= 2 && before.length === after.length &&
    before.filter(part => part.id === 'microphone-body').length === 1 &&
    after.filter(part => part.id === 'microphone-body').length === 1 &&
    before.every((part, index) => part.id === after[index].id && part.role === after[index].role && part.fillRule === after[index].fillRule);
  const contours = Boolean(original && modified && original.contours.length > 0 &&
    original.contours.length <= 2 && original.contours.length === modified.contours.length);
  const sourceBox = original?.contours[0], box = modified?.contours[0];
  return {
    identity,
    unchangedOtherParts: identity && before.every((part, index) => part.id === 'microphone-body' || part.d === after[index].d),
    bodyChanged: Boolean(original && modified && original.d !== modified.d),
    bodyWidth: contours && same(box.width, sourceBox.width * width) && box.width > 0,
    bodyPosition: contours && original.contours.every((item, index) => {
      const changed = modified.contours[index];
      return same(item.x + item.width / 2, changed.x + changed.width / 2) && same(item.y, changed.y) &&
        same(item.height, changed.height) && changed.height > 0;
    }),
    counterWalls: contours && (original.contours.length === 1 || modified.contours[1].width > 0 &&
      same(sourceBox.width - original.contours[1].width, box.width - modified.contours[1].width)),
    contourCorrespondence: Boolean(original && modified && matchesAuthoredCapsulePath(original.d, modified.d, width)),
  };
}

/** Переключение жеста может заменить DOM; наблюдаем текущие части по их identity. */
export function readSemanticPartOpacities(root, partIds, style = globalThis.getComputedStyle) {
  if (!partIds.length) throw new Error('explorer journey: missing semantic opacity targets');
  return partIds.map(id => {
    const part = root.querySelector(`[data-part="${id}"]`);
    if (!part) throw new Error(`explorer journey: missing semantic opacity target ${id}`);
    const raw = style(part).opacity, opacity = Number(raw);
    if (typeof raw !== 'string' || !raw.trim() || !Number.isFinite(opacity) || opacity < 0 || opacity > 1) {
      throw new Error(`explorer journey: unobserved opacity ${id}`);
    }
    return opacity;
  });
}

/** Проверка настоящего consumer UI; в продукт и статический пакет не входит. */
export async function runExplorerJourney() {
  const checks = [];
  const authority = [];
  const controls = [];
  const fixtures = [];
  const observers = [];
  const restoreWrites = [];
  const q = id => document.querySelector(`#${id}`);
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const check = (id, passed, detail) => {
    const item = { id, pass: Boolean(passed), ...(detail !== undefined && { detail }) };
    checks.push(item);
    if (!item.pass) throw new Error(`explorer journey: ${id}`);
  };
  const wait = async (condition, label, timeout = 4000) => {
    const deadline = performance.now() + timeout;
    while (!condition()) {
      if (performance.now() >= deadline) throw new Error(`explorer journey: ${label}: timeout`);
      await frame();
    }
  };
  const settle = name => wait(() => q('symbol-inspector')?.getAttribute('aria-busy') === 'false' &&
    (!name || q('symbol-name').textContent === name), `selection ${name ?? 'initial'}`);
  const choose = async (name, variant = q('variant').value, { pending = false } = {}) => {
    if (q('variant').value !== variant) {
      q('variant').value = variant;
      q('variant').dispatchEvent(new Event('change', { bubbles: true }));
      await settle();
    }
    q('symbol-search').value = name;
    q('symbol-search').dispatchEvent(new Event('input', { bubbles: true }));
    const tile = [...q('symbol-grid').querySelectorAll('button')].find(button => button.dataset.symbol === name);
    if (!tile) throw new Error(`explorer journey: missing tile ${name}`);
    tile.focus();
    tile.click();
    if (!pending) await settle(name);
  };
  const setProgress = async value => {
    q('progress').value = String(value);
    q('progress').dispatchEvent(new Event('input', { bubbles: true }));
    await frame();
    await frame();
  };
  const setReduced = value => {
    if (q('reduce-motion').checked !== value) q('reduce-motion').click();
  };
  const paths = svg => [...svg.querySelectorAll('path')].map(path => ({
    d: path.getAttribute('d'), fillRule: path.getAttribute('fill-rule') ?? svg.getAttribute('fill-rule') ?? 'nonzero',
  }));
  const angle = element => {
    const matrix = new DOMMatrix(getComputedStyle(element).transform);
    return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI;
  };
  const angleDistance = (from, to) => Math.abs(((to - from + 540) % 360) - 180);
  const originalFetch = window.fetch;
  const originalCreateUrl = URL.createObjectURL;
  const originalAnchorClick = HTMLAnchorElement.prototype.click;
  const downloads = [];
  const blobs = new Map();
  let deferredReject;
  let failed = false;
  try {
    await settle();
    const response = await originalFetch('explorer.json');
    if (!response.ok) throw new Error(`explorer journey: manifest HTTP ${response.status}`);
    const data = await response.json();
    check('current-author-source', data.source?.kind === 'figma' && Boolean(data.source.version));
    check('complete-explorer-census', data.summary.variants === data.summary.glyphs * 2 && data.rows.length === data.summary.variants);

    URL.createObjectURL = function(blob) {
      const url = originalCreateUrl.call(this, blob);
      blobs.set(url, blob);
      return url;
    };
    HTMLAnchorElement.prototype.click = function() {
      if (blobs.has(this.href)) downloads.push({ filename: this.download, blob: blobs.get(this.href) });
      else originalAnchorClick.call(this);
    };

    for (const name of ['reload', 'refresh']) for (const variant of ['outline', 'filled']) {
      await choose(name, variant);
      const row = data.rows.find(item => item.name === name && item.variant === variant);
      const masterResponse = await originalFetch(row.views.master);
      if (!masterResponse.ok) throw new Error(`explorer journey: master HTTP ${masterResponse.status}`);
      const master = new DOMParser().parseFromString(await masterResponse.text(), 'image/svg+xml').documentElement;
      const stage = q('symbol-stage').querySelector('svg');
      check(`${name}/${variant}/author-paths`, JSON.stringify(paths(stage)) === JSON.stringify(paths(master)));
      check(`${name}/${variant}/semantic-part`, stage.querySelectorAll('[data-part="cycle-body"]').length === 1);
      check(`${name}/${variant}/keyboard-focus`, document.activeElement?.dataset.symbol === name);
      check(`${name}/${variant}/accessible-preview`, q('symbol-stage').getAttribute('role') === 'img' && q('symbol-stage').getAttribute('aria-label').includes(name));
      check(`${name}/${variant}/source-motion-controls`, !q('play').disabled && q('gesture').value === `${name}.cycle`);
      check(`${name}/${variant}/sliced-gesture-consumer`, q('consumer-import').textContent.includes(`/gestures/${name}`) &&
        data.rotationGestureIconIds.includes(name));
      check(`${name}/${variant}/no-unproved-axes`, q('axis-controls').children.length === 0);

      const beforeDisplay = JSON.stringify(paths(stage));
      q('display-size').value = '24';
      q('display-size').dispatchEvent(new Event('input', { bubbles: true }));
      q('display-color').value = '#7042a8';
      q('display-color').dispatchEvent(new Event('input', { bubbles: true }));
      check(`${name}/${variant}/display-preserves-paths`, JSON.stringify(paths(stage)) === beforeDisplay && stage.style.width === '24px' && getComputedStyle(stage).color === 'rgb(112, 66, 168)');
      check(`${name}/${variant}/small-size-samples`, [...q('size-samples').querySelectorAll('svg')].map(svg => svg.style.width).join(',') === '16px,24px,48px');

      const module = await import(`./package/symbols/${name}.js`);
      const { compileSymbolEffect } = await import('./package/motion/index.js');
      const glyph = module.glyph({ variant });
      const caps = module.glyphCapabilities(variant);
      const effect = compileSymbolEffect(glyph, caps, `${name}.cycle`, { duration: 900, from: 0.25, to: 0 });
      check(`${name}/${variant}/public-source-admission`, effect.ok && glyph.provenance.kind === 'source' && caps.modelState === null && glyph.provenance.anatomy.annotationSha256 === caps.anatomy.annotationSha256);
      check(`${name}/${variant}/declared-reverse`, effect.ok && effect.effect.targets[0].rotation.from === 90 && effect.effect.targets[0].rotation.to === 0);
      const unsupported = compileSymbolEffect(glyph, caps, 'time.advance', { duration: 10 });
      check(`${name}/${variant}/foreign-gesture-refusal`, !unsupported.ok && unsupported.reason.code === 'GESTURE_UNSUPPORTED');
      authority.push({ name, variant, author: glyph.provenance.author, anatomy: glyph.provenance.anatomy });

      q('export-format').value = 'svg';
      q('export').click();
      const svgDownload = downloads.at(-1);
      check(`${name}/${variant}/svg-export-basis`, svgDownload?.filename === `${name}-${variant}.svg` &&
        JSON.stringify(paths(new DOMParser().parseFromString(await svgDownload.blob.text(), 'image/svg+xml').documentElement)) === JSON.stringify(paths(master)));
      q('export-format').value = 'effect';
      q('export').click();
      const effectDownload = downloads.at(-1);
      const exportedEffect = JSON.parse(await effectDownload.blob.text());
      check(`${name}/${variant}/effect-export`, effectDownload.filename === `${name}-${variant}.effect.json` && exportedEffect.icon === name && exportedEffect.variant === variant && exportedEffect.targets[0].partId === 'cycle-body');
      const beforeLottie = downloads.length;
      q('export-format').value = 'lottie'; q('export').click();
      await wait(() => downloads.length > beforeLottie || q('export-status').textContent.startsWith('Lottie не подготовлен:'), 'Lottie export');
      const lottieDownload = downloads.at(-1);
      const animation = JSON.parse(await lottieDownload.blob.text());
      check(`${name}/${variant}/lottie-export`, lottieDownload.filename === `${name}-${variant}.lottie.json` &&
        animation.meta.labIcons.masterSha256 === glyph.provenance.author.masterSha256 && animation.layers[0].nm === 'cycle-body' &&
        animation.meta.labIcons.profile === 'lottie-web-svg-5.13');
      const beforeSf = downloads.length;
      q('export-format').value = 'sf-symbols'; q('export').click();
      check(`${name}/${variant}/sf-symbols-refusal`, downloads.length === beforeSf && q('export-status').textContent.includes('нет проверенного адаптера'));
    }

    const staticMotion = await import('./package/motion/index.js');
    for (const variant of ['outline', 'filled']) {
      await choose('timer', variant);
      const timerRow = data.rows.find(item => item.name === 'timer' && item.variant === variant);
      const timerResponse = await originalFetch(timerRow.views.original);
      if (!timerResponse.ok) throw new Error(`explorer journey: timer master HTTP ${timerResponse.status}`);
      const timerMaster = new DOMParser().parseFromString(await timerResponse.text(), 'image/svg+xml').documentElement;
      const timerSource = await import('./package/symbols/timer.js');
      const timerGlyph = timerSource.glyph({ variant }), timerCapabilities = timerSource.glyphCapabilities(variant);
      const timerRefusal = staticMotion.compileSymbolEffect(timerGlyph, timerCapabilities, 'timer.advance', { duration: 900 });
      check(`timer/${variant}/precise-motion-refusal`, !timerRefusal.ok &&
        timerRefusal.reason.code === 'SEMANTIC_MOTION_UNAVAILABLE' && timerCapabilities.motion.gestures.length === 0 &&
        !data.rotationGestureIconIds.includes('timer') && q('play').disabled && q('reverse').disabled &&
        q('progress').disabled && q('gesture').value === '' && q('consumer-import').textContent.includes('/symbols/timer'));
      check(`timer/${variant}/exact-author-paths`, JSON.stringify(paths(q('symbol-stage').querySelector('svg'))) === JSON.stringify(paths(timerMaster)));
      check(`timer/${variant}/small-samples-preserve-author`, [...q('size-samples').querySelectorAll('svg')]
        .every(svg => JSON.stringify(paths(svg)) === JSON.stringify(paths(timerMaster))));
      authority.push({ name: 'timer', variant, author: timerGlyph.provenance.author });
      const beforeTimerSvg = downloads.length;
      q('export-format').value = 'svg'; q('export').click();
      const timerSvg = downloads.at(-1);
      check(`timer/${variant}/static-svg-export`, downloads.length === beforeTimerSvg + 1 &&
        timerSvg.filename === `timer-${variant}.svg` && JSON.stringify(paths(new DOMParser()
          .parseFromString(await timerSvg.blob.text(), 'image/svg+xml').documentElement)) === JSON.stringify(paths(timerMaster)));
      const beforeTimerEffect = downloads.length;
      q('export-format').value = 'effect'; q('export').click();
      check(`timer/${variant}/motion-export-refusal`, downloads.length === beforeTimerEffect &&
        q('export-status').textContent === timerRefusal.reason.message && !q('export').disabled);
    }

    await choose('time', 'outline');
    const timeGenerated = document.querySelector('[data-view="generated"]');
    check('gesture-view/legacy-model-available', !timeGenerated.disabled);
    timeGenerated.click();
    await settle('time');
    check('gesture-view/legacy-uses-own-contract', q('symbol-stage').dataset.view === 'generated' &&
      q('consumer-import').textContent.includes('@labpics/icons/ir') && !q('consumer-import').textContent.includes('/gestures/') &&
      q('motion-status').textContent.includes('Жест относится к прежней модели.') &&
      q('gesture').value === 'time.advance' && !q('play').disabled);
    document.querySelector('[data-view="original"]').click();
    await settle('time');
    const timeSource = await import('./package/symbols/time.js');
    const timeRefusal = staticMotion.compileSymbolEffect(timeSource.glyph({ variant: 'outline' }),
      timeSource.glyphCapabilities('outline'), 'time.advance', { duration: 900 });
    const timeRow = data.rows.find(item => item.name === 'time' && item.variant === 'outline');
    const timeResponse = await originalFetch(timeRow.views.original);
    if (!timeResponse.ok) throw new Error(`explorer journey: time master HTTP ${timeResponse.status}`);
    const timeMaster = new DOMParser().parseFromString(await timeResponse.text(), 'image/svg+xml').documentElement;
    check('gesture-view/legacy-return-preserves-author-contract', q('symbol-stage').dataset.view === 'original' &&
      q('consumer-import').textContent.includes('/symbols/time') && q('gesture').value === '' && q('play').disabled &&
      q('reverse').disabled && q('progress').disabled && !timeRefusal.ok && timeRefusal.reason.code === 'SEMANTIC_MOTION_UNAVAILABLE');
    check('gesture-view/legacy-return-preserves-author-paths',
      JSON.stringify(paths(q('symbol-stage').querySelector('svg'))) === JSON.stringify(paths(timeMaster)));
    await choose('reload', 'outline');
    const reloadOverlay = document.querySelector('[data-view="overlay"]');
    check('gesture-view/comparison-available', !reloadOverlay.disabled);
    reloadOverlay.click();
    await settle('reload');
    check('gesture-view/comparison-keeps-motion-inactive', q('symbol-stage').dataset.view === 'overlay' && q('play').disabled &&
      !q('consumer-import').textContent.includes('/gestures/'));
    document.querySelector('[data-view="original"]').click();
    await settle('reload');
    check('gesture-view/comparison-return-restores-authored-contract', q('symbol-stage').dataset.view === 'original' &&
      q('consumer-import').textContent.includes('/gestures/reload') && q('gesture').value === 'reload.cycle' &&
      q('symbol-stage').querySelectorAll('[data-part="cycle-body"]').length === 1 && !q('play').disabled);
    q('display-size').value = '112';
    q('display-size').dispatchEvent(new Event('input', { bubbles: true }));
    setReduced(false);
    await setProgress(0);
    q('play').click();
    await wait(() => Number(q('progress').value) > 0.1 && Number(q('progress').value) < 0.7, 'in-flight progress');
    q('pause').click();
    const paused = Number(q('progress').value);
    const part = q('symbol-stage').querySelector('[data-part]');
    const pausedAngle = angle(part);
    for (let index = 0; index < 8; index++) await frame();
    check('pause-freezes-progress', Math.abs(Number(q('progress').value) - paused) < 0.000001);
    check('pause-freezes-visible-pose', angleDistance(pausedAngle, angle(part)) < 0.01);
    q('pause').click();
    await wait(() => Number(q('progress').value) > paused, 'resume progress');
    q('pause').click();
    const beforeReverse = angle(part);
    q('reverse').click();
    // Уже загруженный executor принимает successor в microtask, до следующего кадра.
    await Promise.resolve();
    await Promise.resolve();
    const afterReverse = angle(part);
    check('reverse-successor-admitted', q('pause').textContent === 'Пауза');
    // Фиксированный FPS не требуется: сравниваются позы на границе admission.
    check('reverse-retains-visible-pose', angleDistance(beforeReverse, afterReverse) < 0.1, { beforeReverse, afterReverse });
    setReduced(true);
    await wait(() => Number(q('progress').value) === 0, 'reduced reverse terminal');
    check('reduced-motion-terminal', angleDistance(0, angle(part)) < 0.01);
    setReduced(false);
    q('play').click();
    await wait(() => Number(q('progress').value) > 0.1, 'scrub control setup');
    q('pause').click();
    await setProgress(0.6);
    check('scrub-clears-paused-occurrence', q('pause').disabled && q('pause').textContent === 'Пауза');
    check('scrub-keeps-selected-phase', Math.abs(Number(q('progress').value) - 0.6) < 0.000001 && angleDistance(216, angle(part)) < 0.01);
    await setProgress(1);
    setReduced(false);
    q('play').click();
    await wait(() => Number(q('progress').value) > 0.01 && Number(q('progress').value) < 0.5, 'repeat occurrence');
    check('completed-cycle-repeats', angleDistance(0, angle(part)) > 1);
    setReduced(true);
    await wait(() => Number(q('progress').value) === 1, 'reduced forward terminal');

    window.fetch = (url, ...args) => String(url).includes('originals/refresh/outline.svg')
      ? Promise.reject(new Error('controlled selection failure')) : originalFetch(url, ...args);
    await choose('refresh', 'outline');
    check('failed-selection-clears-old-projection', q('consumer-import').textContent === '' &&
      q('size-samples').children.length === 0 && q('parts').children.length === 0 && q('export').disabled);
    check('failed-selection-visible-status', !q('load-status').hidden && q('load-status').textContent.includes('controlled selection failure'));
    window.fetch = originalFetch;
    await choose('reload', 'outline');
    window.fetch = (url, ...args) => String(url).includes('originals/refresh/outline.svg')
      ? new Promise((resolve, reject) => { deferredReject = reject; }) : originalFetch(url, ...args);
    await choose('refresh', 'outline', { pending: true });
    await wait(() => typeof deferredReject === 'function', 'controlled pending fetch');
    await choose('reload', 'outline');
    const status = q('source-status').textContent;
    deferredReject(new Error('controlled late selection failure'));
    deferredReject = null;
    for (let index = 0; index < 3; index++) await frame();
    check('late-failure-keeps-new-selection', q('symbol-name').textContent === 'reload' &&
      q('consumer-import').textContent.includes('/gestures/reload') && q('source-status').textContent === status && !q('play').disabled);
    check('late-failure-keeps-new-visible-status', q('load-status').hidden);
    window.fetch = originalFetch;

    const { glyph, glyphCapabilities } = await import('./package/symbols/reload.js');
    const { compileSymbolEffect } = await import('./package/motion/index.js');
    const { renderGlyphSvg } = await import('./package/ir/render.js');
    const { executeSymbolEffect } = await import('./motion-execution.js');
    const fixture = document.createElement('div');
    fixture.setAttribute('aria-hidden', 'true');
    fixture.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    fixture.innerHTML = renderGlyphSvg(glyph({ variant: 'filled' }), { instanceId: 'journey-left' }) +
      renderGlyphSvg(glyph({ variant: 'filled' }), { instanceId: 'journey-right' });
    fixtures.push(fixture);
    document.body.append(fixture);
    const [left, right] = fixture.querySelectorAll('svg');
    const rightBefore = right.outerHTML;
    const effect = compileSymbolEffect(glyph({ variant: 'filled' }), glyphCapabilities('filled'), 'reload.cycle', { duration: 900, to: 0.5 });
    check('filled-instance-effect-admitted', effect.ok);
    controls.push(...executeSymbolEffect(left, effect.effect, { initialize: true }));
    await wait(() => angleDistance(0, angle(left.querySelector('[data-part]'))) > 2, 'independent instance progress');
    check('filled-instances-independent', right.outerHTML === rightBefore && getComputedStyle(right.querySelector('[data-part]')).transform === 'none');
    check('rotation-envelope-visible', left.style.overflow === 'visible');
    controls.forEach(control => control.stop());
    fixture.remove();
    check('fixture-cleanup', !document.body.contains(fixture));

    for (const [name, variant] of [['ellipsis-horizontal', 'outline'], ['ellipsis-horizontal', 'filled'], ['chatbubble-ellipses', 'outline']]) {
      await choose(name, variant);
      const row = data.rows.find(item => item.name === name && item.variant === variant);
      const masterResponse = await originalFetch(row.views.master);
      const master = new DOMParser().parseFromString(await masterResponse.text(), 'image/svg+xml').documentElement;
      const stage = q('symbol-stage');
      check(`${name}/${variant}/triad-authored-paths`, JSON.stringify(paths(stage.querySelector('svg'))) === JSON.stringify(paths(master)));
      const parts = [...stage.querySelectorAll('[data-part]')];
      const dots = parts.filter(part => part.dataset.role === 'content');
      const dotIds = dots.map(part => part.dataset.part);
      const shell = parts.find(part => part.dataset.role === 'container');
      const shellBefore = shell?.outerHTML;
      check(`${name}/${variant}/triad-stable-ids`, dots.map(part => part.dataset.part).join(',') === 'dot-leading,dot-middle,dot-trailing');
      const symbol = await import(`./package/symbols/${name}.js`);
      const glyph = symbol.glyph({ variant });
      const caps = symbol.glyphCapabilities(variant);
      const activity = compileSymbolEffect(glyph, caps, `${name}.activity`, { duration: 900, from: 0.6, to: 0 });
      check(`${name}/${variant}/triad-public-effect`, activity.ok && activity.effect.version === 2 && activity.effect.stages.every(item => item.property === 'opacity' && item.at >= 0 && item.duration >= 0));
      setReduced(false);
      await setProgress(0);
      q('play').click();
      await wait(() => Number(q('progress').value) > 0.12 && Number(q('progress').value) < 0.7, 'triad active phase');
      q('pause').click();
      const opacity = () => readSemanticPartOpacities(stage, dotIds);
      const before = opacity();
      for (let count = 0; count < 8; count++) await frame();
      check(`${name}/${variant}/triad-pause`, before.every((value, index) => value === opacity()[index]));
      check(`${name}/${variant}/triad-semantic-emphasis`, before.some(value => value < 0.8) && new Set(before).size > 1);
      q('reverse').click();
      await Promise.resolve();
      await Promise.resolve();
      const after = opacity();
      check(`${name}/${variant}/triad-reverse-admission`, before.every((value, index) => Math.abs(value - after[index]) < 0.000001), { before, after });
      if (shell) check(`${name}/${variant}/unchanged-enclosure`, shell.outerHTML === shellBefore);
      q('gesture').value = `${name}.idle`;
      q('gesture').dispatchEvent(new Event('change', { bubbles: true }));
      q('play').click();
      setReduced(true);
      await wait(() => Number(q('progress').value) === 1 && opacity().every(value => value === 1), 'idle terminal');
      check(`${name}/${variant}/idle-restores-master`, opacity().every(value => value === 1) &&
        (!shell || stage.querySelector(`[data-part="${shell.dataset.part}"]`)?.outerHTML === shellBefore));
      check(`${name}/${variant}/triad-paths-unchanged-after-motion`, JSON.stringify(paths(stage.querySelector('svg'))) === JSON.stringify(paths(master)));
    }
    await choose('chatbubble-ellipses', 'filled');
    check('filled-typing-compound-refuses', q('play').disabled && q('gesture').value === '');
    await choose('ellipsis-vertical', 'outline');
    const verticalMenu = await import('./package/symbols/ellipsis-vertical.js');
    const verticalCaps = verticalMenu.glyphCapabilities('outline');
    check('vertical-menu-admits-orientation', !q('play').disabled && q('gesture').value === 'dots.orient' &&
      !q('state-group-controls').hidden && q('gesture-progress-control').hidden);
    for (const gesture of ['activity', 'idle']) {
      const refused = compileSymbolEffect(verticalMenu.glyph({ variant: 'outline' }), verticalCaps,
        `ellipsis-vertical.${gesture}`, { duration: 900 });
      check(`vertical-menu-does-not-inherit-${gesture}`, !refused.ok && refused.reason.code === 'SEMANTIC_MOTION_UNAVAILABLE' &&
        ![...q('gesture').options].some(option => option.value === `ellipsis-vertical.${gesture}`));
    }

    const viewButton = view => document.querySelector(`[data-view="${view}"]`);
    const chooseView = async view => {
      viewButton(view).click();
      await wait(() => q('symbol-inspector').getAttribute('aria-busy') === 'false' &&
        q('symbol-stage').dataset.view === view, `variation view ${view}`);
    };
    const variationInput = name => q('axis-controls').querySelector(`[data-variation="${name}"]`);
    const changeVariation = async (name, value, refusal) => {
      const input = variationInput(name);
      if (!input) throw new Error(`explorer journey: missing variation input ${name}`);
      input.value = String(value);
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => refusal ? variationInput(name)?.getAttribute('aria-invalid') === 'true' &&
        q('axis-status').textContent.includes(refusal) : q('symbol-inspector').getAttribute('aria-busy') === 'false' &&
        q('symbol-stage').dataset.view === 'generated' && variationInput(name)?.getAttribute('aria-invalid') !== 'true',
      `variation ${name}=${value}${refusal ? ` refusal ${refusal}` : ''}`);
      await frame();
      await frame();
    };
    const visibleDots = () => [...q('symbol-stage').querySelectorAll(':scope > svg [data-role="content"]')]
      .map(dot => Number(getComputedStyle(dot).opacity));
    for (const name of ['ellipsis-horizontal', 'ellipsis-vertical']) for (const variant of ['outline', 'filled']) {
      const id = `${name}/${variant}/variation`;
      await choose(name, variant);
      const sourceModule = await import(`./package/symbols/${name}.js`);
      const symbol = await import(`./package/variations/${name}.js`);
      const source = sourceModule.glyph({ variant });
      const caps = symbol.glyphCapabilities(variant);
      const row = data.rows.find(item => item.name === name && item.variant === variant);
      const masterResponse = await originalFetch(row.views.master);
      if (!masterResponse.ok) throw new Error(`explorer journey: variation master HTTP ${masterResponse.status}`);
      const master = new DOMParser().parseFromString(await masterResponse.text(), 'image/svg+xml').documentElement;
      const sourcePaths = JSON.stringify(paths(master));
      check(`${id}/actual-capability-controls`, data.variationIconIds.includes(name) &&
        !sourceModule.glyphCapabilities(variant).variation && caps.variation?.law === 'dots.affine' &&
        caps.variation.targets.svg === 'supported' &&
        [...q('axis-controls').querySelectorAll('[data-variation]')].map(input => input.dataset.variation).join(',') === 'dotScale,spacingScale' &&
        [...q('axis-controls').querySelectorAll('[data-variation]')].every(input => input.type === 'number' && input.value === '1') &&
        viewButton('generated').textContent === 'Вариация' && !viewButton('generated').disabled);
      check(`${id}/exact-default-master`, symbol.glyph({ variant, variation: caps.variation.defaults }) === source &&
        JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === sourcePaths);

      await chooseView('generated');
      check(`${id}/default-view-preserves-master`, q('consumer-import').textContent.includes(`/variations/${name}`) &&
        JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === sourcePaths);
      let retainedPhase = 0, retainedOpacity;
      if (name === 'ellipsis-horizontal') {
        setReduced(false);
        await setProgress(0.37);
        retainedPhase = Number(q('progress').value);
        retainedOpacity = visibleDots();
        check(`${id}/source-phase-witness`, retainedPhase === 0.37 && retainedOpacity.length === 3 &&
          retainedOpacity.some(value => value < 0.8) && new Set(retainedOpacity).size > 1);
      }
      await changeVariation('dotScale', 1.1);
      await changeVariation('spacingScale', 0.9);
      const parameters = { dotScale: 1.1, spacingScale: 0.9 };
      const modified = symbol.glyph({ variant, variation: parameters });
      const modifiedPaths = JSON.stringify(paths(new DOMParser().parseFromString(modified.svg, 'image/svg+xml').documentElement));
      check(`${id}/production-geometry`, modified.provenance.kind === 'authored-variation' && modifiedPaths !== sourcePaths &&
        JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === modifiedPaths &&
        JSON.stringify(source.parts.map(part => part.d)) === JSON.stringify(paths(master).map(part => part.d)));
      check(`${id}/production-size-samples`, [...q('size-samples').querySelectorAll('.size-sample > svg')]
        .map(svg => svg.style.width).join(',') === '16px,24px,48px' &&
        [...q('size-samples').querySelectorAll('.size-sample > svg')].every(svg => JSON.stringify(paths(svg)) === modifiedPaths));
      if (retainedOpacity) check(`${id}/geometry-edit-retains-visible-phase`, Number(q('progress').value) === retainedPhase &&
        q('pause').disabled && retainedOpacity.every((value, index) => Math.abs(value - visibleDots()[index]) < 0.000001),
      { phase: retainedPhase, before: retainedOpacity, after: visibleDots() });
      else check(`${id}/menu-variation-refuses-loading`, q('play').disabled && q('gesture').value === '');

      for (const view of ['overlay', 'difference']) {
        await chooseView(view);
        const comparison = q('symbol-stage').querySelector(':scope > svg');
        const originalLayer = comparison.querySelector(':scope > [data-comparison="source"]');
        const modifiedLayer = comparison.querySelector(':scope > [data-comparison="modified"]');
        const nested = [...comparison.querySelectorAll('svg')];
        check(`${id}/${view}/production-layers`, comparison.dataset.variationComparison === view &&
          JSON.stringify(paths(originalLayer)) === sourcePaths && JSON.stringify(paths(modifiedLayer)) === modifiedPaths);
        const viewport = svg => {
          const screen = svg.getScreenCTM();
          const box = svg.viewBox.baseVal;
          return { width: svg.getAttribute('width'), height: svg.getAttribute('height'),
            computedWidth: getComputedStyle(svg).width, computedHeight: getComputedStyle(svg).height,
            intrinsicWidth: svg.width.baseVal.value, intrinsicHeight: svg.height.baseVal.value,
            viewBox: [box.x, box.y, box.width, box.height],
            screen: screen && ['a', 'b', 'c', 'd', 'e', 'f'].map(key => screen[key]) };
        };
        const viewportReference = viewport(comparison), nestedViewports = nested.map(viewport);
        check(`${id}/${view}/authored-viewport-scaling`, comparisonViewportMatches(nestedViewports, viewportReference, modified.viewBox),
          { reference: viewportReference, nested: nestedViewports });
        check(`${id}/${view}/meaningful-colors`, getComputedStyle(originalLayer).color === 'rgb(185, 70, 60)' &&
          getComputedStyle(modifiedLayer).color === 'rgb(67, 132, 201)');
        if (view === 'difference') {
          const masks = [...comparison.querySelectorAll('mask')];
          const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
          const maskContexts = masks.map(mask => ({ maskType: getComputedStyle(mask).maskType,
            maskUnits: mask.getAttribute('maskUnits'), maskContentUnits: mask.getAttribute('maskContentUnits'),
            bounds: [mask.x.baseVal.value, mask.y.baseVal.value, mask.width.baseVal.value, mask.height.baseVal.value] }));
          check(`${id}/difference/directed-luminance-masks`, comparisonMasksMatch(maskContexts, modified.viewBox) &&
            new Set(ids).size === ids.length &&
            [originalLayer, modifiedLayer].every(layer => masks.some(mask => layer.getAttribute('mask') === `url(#${mask.id})`)),
            { masks: maskContexts });
        }
        check(`${id}/${view}/samples-remain-modified`, [...q('size-samples').querySelectorAll('.size-sample > svg')]
          .every(svg => JSON.stringify(paths(svg)) === modifiedPaths));
      }
      q('export-format').value = 'svg'; q('export').click();
      const svgDownload = downloads.at(-1);
      check(`${id}/svg-export-real-modified`, svgDownload?.filename === `${name}-${variant}-variation.svg` &&
        JSON.stringify(paths(new DOMParser().parseFromString(await svgDownload.blob.text(), 'image/svg+xml').documentElement)) === modifiedPaths);
      const beforeLottie = downloads.length;
      q('export-format').value = 'lottie'; q('export').click();
      await wait(() => q('export-status').textContent.includes('VARIATION_UNSUPPORTED'), `${id} Lottie refusal`);
      check(`${id}/nondefault-lottie-refusal`, downloads.length === beforeLottie);

      await chooseView('generated');
      const acceptedStage = q('symbol-stage').innerHTML;
      const acceptedSamples = q('size-samples').innerHTML;
      const acceptedSourceStatus = q('source-status').textContent;
      for (const [axis, value, refusal] of [['dotScale', 0, 'INVALID_VARIATION'], ['spacingScale', 3, 'VARIATION_OUTSIDE_DOMAIN']]) {
        await changeVariation(axis, value, refusal);
        check(`${id}/${refusal}/retains-accepted-projection`, q('symbol-stage').innerHTML === acceptedStage &&
          q('size-samples').innerHTML === acceptedSamples && q('source-status').textContent === acceptedSourceStatus && !q('export').disabled);
        q('export-format').value = 'svg'; q('export').click();
        const acceptedDownload = downloads.at(-1);
        check(`${id}/${refusal}/exports-accepted-geometry`, JSON.stringify(paths(new DOMParser()
          .parseFromString(await acceptedDownload.blob.text(), 'image/svg+xml').documentElement)) === modifiedPaths);
      }
      if (retainedOpacity) {
        q('play').click();
        await wait(() => Number(q('progress').value) > 0.45 && Number(q('progress').value) < 0.85, `${id} running refusal witness`);
        const runningPhase = Number(q('progress').value);
        await changeVariation('dotScale', 0, 'INVALID_VARIATION');
        check(`${id}/invalid-draft-retains-running-motion`, !q('pause').disabled && q('pause').textContent === 'Пауза' &&
          Number(q('progress').value) > runningPhase && JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === modifiedPaths);
        q('pause').click();
        await setProgress(retainedPhase);
        q('gesture').value = `${name}.idle`;
        q('gesture').dispatchEvent(new Event('change', { bubbles: true }));
        q('play').click(); setReduced(true);
        await wait(() => Number(q('progress').value) === 1 && visibleDots().every(value => value === 1), `${id} modified reduced terminal`);
        check(`${id}/modified-reduced-motion-terminal`, JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === modifiedPaths);
        setReduced(false);
        q('gesture').value = `${name}.activity`;
        q('gesture').dispatchEvent(new Event('change', { bubbles: true }));
        await setProgress(retainedPhase);
      }
      variationInput('dotScale').value = '1.15';
      variationInput('dotScale').dispatchEvent(new Event('input', { bubbles: true }));
      variationInput('spacingScale').value = '0.95';
      variationInput('spacingScale').dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => q('symbol-inspector').getAttribute('aria-busy') === 'false', `${id} overlapping accepted corrections`);
      await frame();
      const corrections = symbol.glyph({ variant, variation: { dotScale: 1.15, spacingScale: 0.95 } });
      check(`${id}/accepted-field-correction-survives-later-render`,
        [...q('axis-controls').querySelectorAll('[data-variation]')].every(input => input.getAttribute('aria-invalid') !== 'true') &&
        !q('axis-status').textContent.includes('INVALID_VARIATION') &&
        JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) ===
          JSON.stringify(paths(new DOMParser().parseFromString(corrections.svg, 'image/svg+xml').documentElement)));
      await changeVariation('spacingScale', 0.9);
      const rapidInput = variationInput('dotScale');
      rapidInput.value = '1.15';
      rapidInput.dispatchEvent(new Event('input', { bubbles: true }));
      rapidInput.value = '0';
      rapidInput.dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => q('symbol-inspector').getAttribute('aria-busy') === 'false', `${id} rapid draft completion`);
      await frame();
      const rapidAccepted = symbol.glyph({ variant, variation: { dotScale: 1.15, spacingScale: 0.9 } });
      const rapidPaths = JSON.stringify(paths(new DOMParser().parseFromString(rapidAccepted.svg, 'image/svg+xml').documentElement));
      check(`${id}/late-valid-completion-retains-new-invalid-draft`, variationInput('dotScale').value === '0' &&
        variationInput('dotScale').getAttribute('aria-invalid') === 'true' && q('axis-status').textContent.includes('INVALID_VARIATION') &&
        JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === rapidPaths);
      await changeVariation('spacingScale', 0.95);
      const otherFieldAccepted = symbol.glyph({ variant, variation: { dotScale: 1.15, spacingScale: 0.95 } });
      const otherFieldPaths = JSON.stringify(paths(new DOMParser().parseFromString(otherFieldAccepted.svg, 'image/svg+xml').documentElement));
      check(`${id}/other-field-edit-retains-invalid-draft`, variationInput('dotScale').value === '0' &&
        variationInput('dotScale').getAttribute('aria-invalid') === 'true' && q('axis-status').textContent.includes('INVALID_VARIATION') &&
        variationInput('spacingScale').value === '0.95' && JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === otherFieldPaths);
      q('axis-controls').querySelector('[data-variation-reset]').click();
      variationInput('dotScale').value = '0';
      variationInput('dotScale').dispatchEvent(new Event('input', { bubbles: true }));
      await wait(() => q('symbol-inspector').getAttribute('aria-busy') === 'false', `${id} reset newer invalid draft`);
      await frame();
      check(`${id}/reset-completion-retains-newer-invalid-draft`, q('symbol-stage').dataset.view === 'original' &&
        JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === sourcePaths &&
        variationInput('dotScale').value === '0' && variationInput('dotScale').getAttribute('aria-invalid') === 'true' &&
        variationInput('spacingScale').value === '1' && q('axis-status').textContent.includes('INVALID_VARIATION'));
      q('axis-controls').querySelector('[data-variation-reset]').click();
      await wait(() => q('symbol-inspector').getAttribute('aria-busy') === 'false' && q('symbol-stage').dataset.view === 'original', `${id} reset`);
      check(`${id}/reset-restores-author`, JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === sourcePaths &&
        [...q('axis-controls').querySelectorAll('[data-variation]')].every(input => input.value === '1' && input.getAttribute('aria-invalid') !== 'true'));
      if (retainedOpacity) {
        check(`${id}/reset-retains-phase`, Number(q('progress').value) === retainedPhase &&
          retainedOpacity.every((value, index) => Math.abs(value - visibleDots()[index]) < 0.000001));
        q('gesture').value = `${name}.idle`;
        q('gesture').dispatchEvent(new Event('change', { bubbles: true }));
        q('play').click(); setReduced(true);
        await wait(() => Number(q('progress').value) === 1 && visibleDots().every(value => value === 1), `${id} reduced terminal`);
        check(`${id}/reduced-motion-author-terminal`, JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === sourcePaths);
      }
      authority.push({ name, variant, author: source.provenance.author, anatomy: source.provenance.anatomy, variation: modified.provenance.variation });
    }
    for (const name of ['chatbubble-ellipses', 'ellipse']) {
      await choose(name, 'outline');
      const symbol = await import(`./package/symbols/${name}.js`);
      check(`${name}/no-invented-variation-controls`, !symbol.glyphCapabilities('outline').variation &&
        q('axis-controls').querySelectorAll('[data-variation]').length === 0 && viewButton('generated').textContent === 'Модель');
    }

    // Контрформу измеряет browser из фактически показанного d, независимо от compiler.
    const capsuleMeasure = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    capsuleMeasure.setAttribute('aria-hidden', 'true');
    capsuleMeasure.style.cssText = 'position:absolute;left:0;top:0;visibility:hidden;pointer-events:none';
    fixtures.push(capsuleMeasure); document.body.append(capsuleMeasure);
    const capsuleSnapshot = (svg, anatomy) => capsuleSemanticObservations([...svg.querySelectorAll('path')].map(path => {
      const d = path.getAttribute('d');
      const contours = rawCapsuleContours(d).map(contour => {
        const probe = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        probe.setAttribute('d', contour.map(segment => segment.cmd + segment.values.join(' ')).join('')); capsuleMeasure.append(probe);
        const { x, y, width, height } = probe.getBBox(); probe.remove();
        return { x, y, width, height };
      });
      return { partId: path.getAttribute('data-part'), partIds: path.getAttribute('data-parts'),
        role: path.getAttribute('data-role'), roles: path.getAttribute('data-roles'), d, contours,
        fillRule: path.getAttribute('fill-rule') ?? svg.getAttribute('fill-rule') ?? 'nonzero' };
    }), anatomy);
    const capsuleFrame = (svg, live = false) => {
      const elements = [svg, ...svg.querySelectorAll('*')];
      if (live) for (let parent = svg.parentElement; parent; parent = parent.parentElement) elements.push(parent);
      const box = svg.viewBox.baseVal;
      const untransformed = !svg.querySelector('svg,style,foreignObject,use') && elements.every(element => !element.hasAttribute('transform') &&
        ['transform', 'translate', 'rotate', 'scale'].every(property => {
          const value = live ? getComputedStyle(element)[property] : element.style?.getPropertyValue(property);
          return !value || value === 'none';
        }));
      return { viewBox: [box.x, box.y, box.width, box.height],
        // Canonical capsule output целиком состоит из адресованных непосредственных paths.
        directPathsOnly: capsuleContentShapeMatches(svg), inertGroupsOnly: capsuleContentShapeMatches(svg, true),
        intrinsicWidth: Number(svg.getAttribute('width')), intrinsicHeight: Number(svg.getAttribute('height')),
        preserveAspectRatio: (svg.getAttribute('preserveAspectRatio') ?? 'xMidYMid meet').trim().replace(/\s+/g, ' '), untransformed,
        ...(live ? { width: parseFloat(getComputedStyle(svg).width), height: parseFloat(getComputedStyle(svg).height),
          screen: ((matrix) => matrix && Object.fromEntries(['a', 'b', 'c', 'd', 'e', 'f'].map(key => [key, matrix[key]])))(svg.getScreenCTM()) } : {}) };
    };
    const capsulePaint = svg => {
      const properties = element => {
        const style = getComputedStyle(element);
        return Object.fromEntries(['fill', 'color', 'fillRule', 'fillOpacity', 'stroke', 'opacity',
          'visibility', 'display', 'filter', 'maskImage', 'clipPath'].map(property => [property, style[property]]));
      };
      const ancestors = new Set();
      for (const path of svg.querySelectorAll('path')) {
        for (let parent = path.parentElement; parent; parent = parent.parentElement) ancestors.add(parent);
      }
      const color = q('display-color').value;
      const expectedColor = /^#[0-9a-f]{6}$/i.test(color)
        ? `rgb(${color.slice(1).match(/../g).map(channel => parseInt(channel, 16)).join(', ')})` : '';
      return { paths: [...svg.querySelectorAll('path')].map(path => ({ ...properties(path),
        declaredFillRule: path.getAttribute('fill-rule') ?? svg.getAttribute('fill-rule') ?? 'nonzero' })),
        ancestors: [...ancestors].map(properties), expectedColor };
    };
    const capsuleExport = async (id, filename, expectedPaths, viewBox) => {
      const before = downloads.length;
      q('export-format').value = 'svg'; q('export').click();
      check(`${id}/fresh-download`, isFreshCapsuleDownload(downloads, before, filename));
      const exported = new DOMParser().parseFromString(await downloads.at(-1).blob.text(), 'image/svg+xml').documentElement;
      check(id, JSON.stringify(paths(exported)) === expectedPaths && capsuleSvgFrameMatches(capsuleFrame(exported), viewBox));
      const attributes = svg => [...svg.querySelectorAll('path')].map(path =>
        Object.fromEntries([...path.attributes].map(attribute => [attribute.name, attribute.value])));
      check(`${id}/semantic-and-paint-attributes`, capsuleExportPathsMatch(attributes(exported),
        attributes(q('symbol-stage').querySelector(':scope > svg'))));
      // Экспорт наблюдается в том же renderer: root/group opacity тоже влияет на заливку.
      const host = document.createElement('div');
      host.style.cssText = 'position:absolute;left:-10000px;top:0;pointer-events:none';
      host.style.color = q('display-color').value;
      document.body.append(host); host.append(exported);
      try { check(`${id}/visible-export-paint`, capsulePaintMatches(capsulePaint(exported))); }
      finally { host.remove(); }
    };
    for (const [name, variant] of [['mic', 'outline'], ['mic', 'filled'], ['mic-circle', 'outline'], ['mic-circle', 'filled']]) {
      const id = `${name}/${variant}/capsule-width`;
      await choose(name, variant);
      const sourceModule = await import(`./package/symbols/${name}.js`);
      const symbol = await import(`./package/variations/${name}.js`);
      const widthApi = await import(`./package/gestures/${name}.js`);
      const preparation = widthApi.prepareBodyWidth(variant);
      check(`${id}/public-preparation`, preparation.ok && preparation.prepared.law === 'capsule.width' &&
        data.preparedWidthIconIds.includes(name) && !data.rotationGestureIconIds.includes(name));
      if (!preparation.ok) throw new Error(`${id}: ${preparation.reason.code}`);
      q('gesture').value = 'capsule.width';
      q('gesture').dispatchEvent(new Event('change', { bubbles: true }));
      await wait(() => q('symbol-inspector').getAttribute('aria-busy') === 'false' && q('gesture').value === 'capsule.width', `${id} width mode`);
      setReduced(true);
      const source = sourceModule.glyph({ variant }), caps = symbol.glyphCapabilities(variant);
      const row = data.rows.find(item => item.name === name && item.variant === variant);
      const masterResponse = await originalFetch(row.views.master);
      if (!masterResponse.ok) throw new Error(`explorer journey: capsule master HTTP ${masterResponse.status}`);
      const master = new DOMParser().parseFromString(await masterResponse.text(), 'image/svg+xml').documentElement;
      const sourcePaths = JSON.stringify(paths(master));
      check(`${id}/admitted-width-controls`, data.variationIconIds.includes(name) && caps.variation?.law === 'capsule.width' &&
        caps.variation.targets.svg === 'supported' && caps.variation.domain.minimum === .8 && caps.variation.domain.maximum === 1 &&
        [...q('axis-controls').querySelectorAll('[data-variation]')].map(input => input.dataset.variation).join(',') === 'bodyWidth' &&
        variationInput('bodyWidth').type === 'number' && variationInput('bodyWidth').value === '1' &&
        viewButton('generated').textContent === 'Вариация' && !viewButton('generated').disabled);
      check(`${id}/exact-author-default`, symbol.glyph({ variant, variation: { bodyWidth: 1 } }) === source &&
        JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === sourcePaths);
      const masterFrame = capsuleFrame(master), sourceFrame = capsuleFrame(q('symbol-stage').querySelector(':scope > svg'), true);
      check(`${id}/source-viewport`, capsuleAuthoredFrameMatches(masterFrame, source.viewBox) &&
        capsuleViewportMatches(sourceFrame, source.viewBox, Number(q('display-size').value)),
        { master: masterFrame, source: sourceFrame, viewBox: source.viewBox, displaySize: Number(q('display-size').value) });
      check(`${id}/source-visible-paint`, capsulePaintMatches(capsulePaint(q('symbol-stage').querySelector(':scope > svg'))));
      const partIds = source.parts.map(part => part.id);
      const anatomy = { kind: source.composition.kind, partIds, roles: source.parts.map(part => part.role) };
      const original = capsuleSnapshot(q('symbol-stage').querySelector(':scope > svg'), anatomy);
      await chooseView('generated');
      check(`${id}/default-variation-view`, q('consumer-import').textContent.includes(`/gestures/${name}`) &&
        JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === sourcePaths &&
        capsuleViewportMatches(capsuleFrame(q('symbol-stage').querySelector(':scope > svg'), true), source.viewBox, Number(q('display-size').value)));
      let modified;
      for (const width of [.9, .8]) {
        await changeVariation('bodyWidth', width);
        await wait(() => q('pause').disabled && variationInput('bodyWidth').value === String(width), `${id} width endpoint ${width}`);
        const shown = q('symbol-stage').querySelector(':scope > svg');
        modified = symbol.glyph({ variant, variation: { bodyWidth: width } });
        const observed = capsuleSnapshot(shown, anatomy);
        const geometry = capsuleWidthObservationChecks(original, observed, width);
        for (const [property, passed] of Object.entries(geometry)) check(`${id}/${width}/${property}`, passed,
          property === 'bodyWidth' ? { before: original, after: observed, width } : undefined);
        const modifiedPaths = JSON.stringify(paths(new DOMParser().parseFromString(modified.svg, 'image/svg+xml').documentElement));
        check(`${id}/${width}/production-package-render`, modified.provenance.variation.parameters.bodyWidth === width &&
          JSON.stringify(paths(shown)) === modifiedPaths &&
          (anatomy.kind === 'compound' ? shown.querySelector('path')?.dataset.parts === partIds.join(' ') &&
            shown.querySelector('path')?.dataset.roles === anatomy.roles.join(' ')
            : [...shown.querySelectorAll('[data-part]')].map(part => part.dataset.part).join(',') === partIds.join(',') ) &&
          capsuleViewportMatches(capsuleFrame(shown, true), source.viewBox, Number(q('display-size').value)));
        check(`${id}/${width}/visible-paint`, capsulePaintMatches(capsulePaint(shown)));
        const samples = [...q('size-samples').querySelectorAll('.size-sample > svg')];
        check(`${id}/${width}/small-size-geometry`, samples.length === 3 && samples.every((svg, index) =>
          JSON.stringify(paths(svg)) === modifiedPaths && capsulePaintMatches(capsulePaint(svg)) &&
          capsuleViewportMatches(capsuleFrame(svg, true), source.viewBox, [16, 24, 48][index])));
        await capsuleExport(`${id}/${width}/exports-visible-width`, `${name}-${variant}-variation.svg`, modifiedPaths, source.viewBox);
      }
      const acceptedStage = q('symbol-stage').innerHTML, acceptedSamples = q('size-samples').innerHTML;
      for (const [width, refusal] of [[0, 'VARIATION_OUTSIDE_DOMAIN'], [.79, 'VARIATION_OUTSIDE_DOMAIN'], [1.01, 'VARIATION_OUTSIDE_DOMAIN']]) {
        await changeVariation('bodyWidth', width, refusal);
        check(`${id}/${width}/refusal-retains-accepted-width`, q('symbol-stage').innerHTML === acceptedStage &&
          q('size-samples').innerHTML === acceptedSamples && !q('export').disabled);
        await capsuleExport(`${id}/${width}/refusal-exports-accepted-width`, `${name}-${variant}-variation.svg`,
          JSON.stringify(paths(new DOMParser().parseFromString(modified.svg, 'image/svg+xml').documentElement)), source.viewBox);
      }
      check(`${id}/prepared-motion-is-distinct-from-format-export`, !q('play').disabled && q('gesture').value === 'capsule.width' &&
        caps.variation.targets.webEffect === 'not-exported');
      q('axis-controls').querySelector('[data-variation-reset]').click();
      await wait(() => q('symbol-inspector').getAttribute('aria-busy') === 'false' && q('symbol-stage').dataset.view === 'original', `${id} reset`);
      check(`${id}/reset-restores-exact-author`, variationInput('bodyWidth').value === '1' &&
        variationInput('bodyWidth').getAttribute('aria-invalid') !== 'true' &&
        JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === sourcePaths &&
        capsuleViewportMatches(capsuleFrame(q('symbol-stage').querySelector(':scope > svg'), true), source.viewBox, Number(q('display-size').value)));
      check(`${id}/reset-visible-paint`, capsulePaintMatches(capsulePaint(q('symbol-stage').querySelector(':scope > svg'))));
      await capsuleExport(`${id}/reset-export-restores-author`, `${name}-${variant}.svg`, sourcePaths, source.viewBox);
      setReduced(false);
      q('play').click();
      await wait(() => Number(q('progress').value) > .12 && Number(q('progress').value) < .8, `${id} width in flight`);
      q('pause').click();
      const pausedWidth = Number(variationInput('bodyWidth').value);
      const pausedPaths = JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg')));
      const pausedExpected = symbol.glyph({ variant, variation: { bodyWidth: pausedWidth } });
      const expectedPausedPaths = JSON.stringify(paths(new DOMParser().parseFromString(pausedExpected.svg, 'image/svg+xml').documentElement));
      check(`${id}/in-flight-physical-sample-matches-static`, pausedWidth > preparation.prepared.domain.minimum && pausedWidth < 1 &&
        pausedPaths === expectedPausedPaths && preparation.prepared.sample(pausedWidth).d ===
        q('symbol-stage').querySelector(preparation.prepared.renderTarget.selector).getAttribute('d'));
      const pausedGeometry = capsuleWidthObservationChecks(original,
        capsuleSnapshot(q('symbol-stage').querySelector(':scope > svg'), anatomy), pausedWidth);
      check(`${id}/in-flight-keeps-optical-laws`, Object.values(pausedGeometry).every(Boolean), pausedGeometry);
      for (let frameIndex = 0; frameIndex < 5; frameIndex++) await frame();
      check(`${id}/pause-retains-physical-width`, JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === pausedPaths &&
        Number(variationInput('bodyWidth').value) === pausedWidth);
      await capsuleExport(`${id}/pause-exports-visible-width`, `${name}-${variant}-variation.svg`, pausedPaths, source.viewBox);
      q('reverse').click();
      await Promise.resolve(); await Promise.resolve();
      check(`${id}/reverse-picks-up-last-written-width`, JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === pausedPaths);
      setReduced(true);
      await wait(() => Number(q('progress').value) === 0 && q('pause').disabled, `${id} reduced reverse terminal`);
      check(`${id}/reduced-reverse-restores-master`, JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === sourcePaths);
      setReduced(false);
      q('play').click();
      await wait(() => Number(q('progress').value) > .1 && Number(q('progress').value) < .8, `${id} latest width setup`);
      q('pause').click();
      const input = variationInput('bodyWidth');
      const beforeRetarget = JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg')));
      input.value = '.9'; input.dispatchEvent(new Event('input', { bubbles: true }));
      input.value = '.92'; input.dispatchEvent(new Event('input', { bubbles: true }));
      await Promise.resolve(); await Promise.resolve();
      check(`${id}/paused-retarget-keeps-visible-start`, JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === beforeRetarget);
      setReduced(true);
      await wait(() => Number(variationInput('bodyWidth').value) === .92 && q('pause').disabled, `${id} latest target terminal`);
      const latest = symbol.glyph({ variant, variation: { bodyWidth: .92 } });
      const latestPaths = JSON.stringify(paths(new DOMParser().parseFromString(latest.svg, 'image/svg+xml').documentElement));
      check(`${id}/latest-target-wins`, JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === latestPaths);
      await capsuleExport(`${id}/latest-export`, `${name}-${variant}-variation.svg`, latestPaths, source.viewBox);
      const settled = q('symbol-stage').innerHTML;
      for (let frameIndex = 0; frameIndex < 4; frameIndex++) await frame();
      check(`${id}/reduced-terminal-no-running-writer`, q('pause').disabled && q('symbol-stage').innerHTML === settled);
      for (const format of ['effect', 'lottie', 'sf-symbols']) {
        q('export-format').value = format;
        const before = downloads.length;
        q('export').click(); await Promise.resolve();
        check(`${id}/${format}/precise-refusal`, downloads.length === before && q('export-status').textContent.startsWith('FORMAT_UNSUPPORTED:'));
      }
      q('export-format').value = 'svg';
      authority.push({ name, variant, author: source.provenance.author, anatomy: source.provenance.anatomy, variation: modified.provenance.variation });
    }
    capsuleMeasure.remove();
    for (const [name, variant, halfway] of [
      ['volume-high', 'outline', [1, 0.5, 0]],
      ['volume-high', 'filled', [1, 0.5, 0]],
      ['volume-middle', 'filled', [1, 0]],
    ]) {
      setReduced(false);
      await choose(name, variant);
      const stage = q('symbol-stage');
      const row = data.rows.find(item => item.name === name && item.variant === variant);
      const master = new DOMParser().parseFromString(await (await originalFetch(row.views.master)).text(), 'image/svg+xml').documentElement;
      const symbol = await import(`./package/symbols/${name}.js`);
      const gesture = symbol.glyphCapabilities(variant).motion.gestures[0];
      const bands = gesture.partIds.map(id => stage.querySelector(`[data-part="${id}"]`));
      const opacity = () => bands.map(part => Number(getComputedStyle(part).opacity));
      const speaker = stage.querySelector('[data-part="speaker"]');
      const speakerBefore = speaker.outerHTML;
      check(`${name}/${variant}/level-rest-matches-master`, gesture.restProgress === 1 && Number(q('progress').value) === 1 && opacity().every(value => value === 1));
      check(`${name}/${variant}/level-authored-paths`, JSON.stringify(paths(stage.querySelector('svg'))) === JSON.stringify(paths(master)));
      await setProgress(0.5);
      check(`${name}/${variant}/level-halfway`, opacity().every((value, index) => Math.abs(value - halfway[index]) < 0.000001), opacity());
      q('reverse').click();
      await wait(() => Number(q('progress').value) < 0.4, 'volume reverse phase');
      q('pause').click();
      const before = opacity();
      q('play').click();
      await Promise.resolve();
      await Promise.resolve();
      check(`${name}/${variant}/level-interruption-pickup`, before.every((value, index) => Math.abs(value - opacity()[index]) < 0.000001), { before, after: opacity() });
      setReduced(true);
      await wait(() => Number(q('progress').value) === 1 && opacity().every(value => value === 1), 'volume latest terminal');
      check(`${name}/${variant}/level-reduced-latest-target`, opacity().every(value => value === 1));
      check(`${name}/${variant}/level-stationary-speaker`, speaker.outerHTML === speakerBefore);
      check(`${name}/${variant}/level-paths-unchanged`, JSON.stringify(paths(stage.querySelector('svg'))) === JSON.stringify(paths(master)));
    }
    await choose('volume-middle', 'outline');
    check('split-volume-band-refuses-object-opacity', q('play').disabled && q('gesture').value === '');

    const screenPosition = element => {
      const matrix = element.getScreenCTM();
      return [matrix.e, matrix.f];
    };
    const nudgeNames = ['chevron-back', 'chevron-forward', 'chevron-up', 'chevron-down',
      'arrow-back', 'arrow-forward', 'arrow-up', 'arrow-down'];
    for (const name of nudgeNames) for (const variant of ['outline', 'filled']) {
      await choose(name, variant);
      const row = data.rows.find(item => item.name === name && item.variant === variant);
      const master = new DOMParser().parseFromString(await (await originalFetch(row.views.master)).text(), 'image/svg+xml').documentElement;
      const svg = q('symbol-stage').querySelector('svg');
      const part = svg.querySelector('[data-part="direction-body"]');
      const symbol = await import(`./package/symbols/${name}.js`);
      const glyph = symbol.glyph({ variant }), caps = symbol.glyphCapabilities(variant);
      const fromOutbound = compileSymbolEffect(glyph, caps, `${name}.nudge`, { duration: 900, from: 0.25, to: 0 });
      const fromInbound = compileSymbolEffect(glyph, caps, `${name}.nudge`, { duration: 900, from: 0.75, to: 0 });
      check(`${name}/${variant}/nudge-author-paths`, JSON.stringify(paths(svg)) === JSON.stringify(paths(master)));
      check(`${name}/${variant}/nudge-declared-part`, Boolean(part) && caps.motion.gestures[0].kind === 'cycle' && q('gesture').value === `${name}.nudge`);
      check(`${name}/${variant}/nudge-source-admission`, fromOutbound.ok && fromInbound.ok && fromOutbound.effect.version === 3 &&
        glyph.provenance.kind === 'source' && glyph.provenance.anatomy.annotationSha256 === caps.anatomy.annotationSha256);
      check(`${name}/${variant}/nudge-phase-correspondence`, fromOutbound.effect.targets[0].from === fromInbound.effect.targets[0].from &&
        fromOutbound.effect.stages.length === 1 && fromInbound.effect.stages.length === 2 &&
        fromOutbound.effect.stages[0].to === 0 && Math.abs(fromInbound.effect.stages[0].to) > Math.abs(fromInbound.effect.targets[0].from));
      check(`${name}/${variant}/nudge-no-unproved-axes`, q('axis-controls').children.length === 0);
      const axis = name.endsWith('up') || name.endsWith('down') ? 1 : 0;
      const sign = name.endsWith('back') || name.endsWith('up') ? -1 : 1;
      setReduced(false);
      for (const size of [16, 24, 48]) {
        q('display-size').value = String(size);
        q('display-size').dispatchEvent(new Event('input', { bubbles: true }));
        await setProgress(0);
        const before = screenPosition(part);
        await setProgress(0.5);
        const after = screenPosition(part);
        const shift = after.map((value, index) => value - before[index]);
        // CTM наблюдает физическое перемещение; style transform не служит oracle.
        check(`${name}/${variant}/nudge-${size}px-viewbox-units`, Math.abs(shift[axis] - sign * size / 8) < 0.01 &&
          Math.abs(shift[1 - axis]) < 0.01, { size, shift });
        check(`${name}/${variant}/nudge-${size}px-preserves-master`, JSON.stringify(paths(svg)) === JSON.stringify(paths(master)));
      }
      authority.push({ name, variant, author: glyph.provenance.author, anatomy: glyph.provenance.anatomy });
      q('export-format').value = 'effect'; q('export').click();
      const downloaded = downloads.at(-1);
      const exported = JSON.parse(await downloaded.blob.text());
      check(`${name}/${variant}/nudge-effect-export`, downloaded.filename === `${name}-${variant}.effect.json` &&
        exported.version === 3 && exported.targets[0].property === (axis === 0 ? 'x' : 'y') && exported.targets[0].unit === 'viewBox');
      const beforeLottie = downloads.length;
      q('export-format').value = 'lottie'; q('export').click();
      await wait(() => downloads.length > beforeLottie || q('export-status').textContent.startsWith('Lottie:'), 'nudge Lottie export');
      const lottieDownload = downloads.at(-1);
      const animation = JSON.parse(await lottieDownload.blob.text());
      const position = animation.layers[0].ks.p;
      check(`${name}/${variant}/nudge-lottie-export`, lottieDownload.filename === `${name}-${variant}.lottie.json` &&
        animation.meta.labIcons.masterSha256 === glyph.provenance.author.masterSha256 && animation.layers[0].nm === 'direction-body' &&
        position.a === 1 && position.k.length === 3 && position.k[1].s[axis] - position.k[0].s[axis] === sign * 3 &&
        position.k[2].s[axis] === position.k[0].s[axis]);
    }

    await choose('arrow-forward', 'outline');
    q('display-size').value = '112';
    q('display-size').dispatchEvent(new Event('input', { bubbles: true }));
    const nudgePart = q('symbol-stage').querySelector('[data-part="direction-body"]');
    await setProgress(0);
    const nudgeOrigin = screenPosition(nudgePart)[0];
    const displacement = () => screenPosition(nudgePart)[0] - nudgeOrigin;
    const phasePoses = [];
    for (const phase of [0.25, 0.75]) {
      await setProgress(phase);
      const before = displacement();
      phasePoses.push(before);
      q('reverse').click();
      await Promise.resolve(); await Promise.resolve();
      check(`nudge-phase-${phase}/reverse-retains-pose`, Math.abs(displacement() - before) < 0.01);
      await wait(() => Number(q('progress').value) < phase - 0.01, 'nudge reverse phase');
      q('pause').click();
      const after = displacement();
      check(`nudge-phase-${phase}/distinct-reverse-continuation`, phase < 0.5 ? after < before : after > before, { before, after });
      for (let count = 0; count < 8; count++) await frame();
      check(`nudge-phase-${phase}/pause-freezes-visible-pose`, Math.abs(displacement() - after) < 0.01);
      q('play').click();
      await Promise.resolve(); await Promise.resolve();
      check(`nudge-phase-${phase}/new-target-pickup`, Math.abs(displacement() - after) < 0.01);
      setReduced(true);
      await wait(() => Number(q('progress').value) === 1 && Math.abs(displacement()) < 0.01, 'nudge latest reduced terminal');
      setReduced(false);
    }
    check('nudge-equal-pose-distinct-histories', Math.abs(phasePoses[0] - phasePoses[1]) < 0.01, phasePoses);
    q('play').click();
    await wait(() => Number(q('progress').value) > 0.04 && Number(q('progress').value) < 0.4 && displacement() > 0.1, 'nudge repeat');
    check('nudge-completed-cycle-repeats', !q('pause').disabled);
    setReduced(true);
    await wait(() => Number(q('progress').value) === 1 && Math.abs(displacement()) < 0.01, 'nudge repeat terminal');

    // Синтетический viewport проверяет единицы исполнителя независимо от Figma masters.
    const shiftedViewport = document.createElement('div');
    shiftedViewport.setAttribute('aria-hidden', 'true');
    shiftedViewport.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none';
    fixtures.push(shiftedViewport);
    document.body.append(shiftedViewport);
    for (const axis of ['x', 'y']) for (const size of [16, 24, 48]) {
      shiftedViewport.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="10 20 48 48" width="${size}" height="${size}"><path data-part="physics-part" d="M22 32h8v8h-8z"/></svg>`;
      const svg = shiftedViewport.querySelector('svg'), part = svg.querySelector('path');
      const before = screenPosition(part);
      const effect = { version: 3, viewport: { overflow: 'visible' },
        targets: [{ partId: 'physics-part', property: axis, unit: 'viewBox', from: 0, to: -6 }],
        stages: [{ partId: 'physics-part', property: axis, unit: 'viewBox', to: -6, at: 0, duration: 0 }],
        options: { duration: 0, easing: 'linear', fill: 'both' } };
      const running = executeSymbolEffect(svg, effect, { initialize: true });
      controls.push(...running);
      await Promise.all(running.map(control => control.finished));
      const after = screenPosition(part), index = axis === 'x' ? 0 : 1;
      const shift = after.map((value, position) => value - before[position]);
      check(`nudge-nonzero-viewbox/${axis}/${size}px`, Math.abs(shift[index] + size / 8) < 0.01 &&
        Math.abs(shift[1 - index]) < 0.01, { viewBox: [10, 20, 48, 48], size, shift });
    }
    shiftedViewport.remove();
    check('nudge-viewport-fixture-cleanup', !document.body.contains(shiftedViewport));
    for (const variant of ['outline', 'filled']) {
      await choose('arrow-forward-circle', variant);
      check(`circle/${variant}/nudge-not-inferred`, q('play').disabled && q('gesture').value === '');
    }

    for (const variant of ['outline', 'filled']) {
      const id = `contour/${variant}`;
      await choose('ellipsis-horizontal', variant);
      const contourModule = await import(`./package/states/ellipsis-orientation-${variant}.js`);
      const caps = contourModule.stateCapabilities();
      const masters = {};
      for (const member of caps.states) {
        const row = data.rows.find(row => row.name === member.icon && row.variant === variant);
        const response = await originalFetch(row.views.master);
        if (!response.ok) throw new Error(`explorer journey: ${id}/${member.id} master HTTP ${response.status}`);
        const raw = new DOMParser().parseFromString(await response.text(), 'image/svg+xml').documentElement;
        masters[member.id] = paths(raw);
        authority.push({ name: member.icon, variant, author: member.author, contour: caps.proof });
      }
      check(`${id}/preserves-activity-default`, q('gesture').value === 'ellipsis-horizontal.activity');
      q('gesture').value = 'dots.orient';
      q('gesture').dispatchEvent(new Event('change', { bubbles: true }));
      await settle('ellipsis-horizontal');
      const stage = q('symbol-stage');
      const nodes = caps.partIds.map(partId => stage.querySelector(`[data-part="${partId}"]`));
      const button = target => q('state-choices').querySelector(`[data-state-target="${target}"]`);
      const stable = () => nodes.every((node, index) => node === stage.querySelector(`[data-part="${caps.partIds[index]}"]`));
      const endpoint = target => JSON.stringify(paths(stage.querySelector(':scope > svg'))) === JSON.stringify(masters[target]);
      const middle = nodes[1], middleBefore = middle.outerHTML;
      const numbers = d => (d.match(/[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/g) ?? []).map(Number);
      const horizontal = masters.horizontal.map(part => numbers(part.d));
      const vertical = masters.vertical.map(part => numbers(part.d));
      const phase = () => (numbers(nodes[0].getAttribute('d'))[0] - horizontal[0][0]) / (vertical[0][0] - horizontal[0][0]);
      check(`${id}/real-public-controls`, caps.transition === 'contour-interpolation' && caps.morph === 'topology-proven' &&
        nodes.length === 3 && nodes.every(node => node?.tagName.toLowerCase() === 'path') &&
        !q('state-group-controls').hidden && q('gesture-progress-control').hidden && endpoint('horizontal') &&
        q('consumer-import').textContent.includes(`/states/${caps.group}`) &&
        [...q('parts').children].map(part => part.title).join(',') === caps.partIds.join(','));
      for (const member of caps.states) {
        const choice = button(member.id), rect = choice.getBoundingClientRect();
        check(`${id}/${member.id}/accessible-choice`, rect.width >= 44 && rect.height >= 44 &&
          Boolean(choice.getAttribute('aria-label')) && choice.querySelector('svg').getAttribute('aria-hidden') === 'true');
        for (const size of [16, 24, 48]) {
          q('display-size').value = String(size);
          q('display-size').dispatchEvent(new Event('input', { bubbles: true }));
          setReduced(true); choice.click();
          await wait(() => endpoint(member.id) && q('pause').disabled, `${id}/${member.id} reduced endpoint`);
          check(`${id}/${member.id}/${size}px-exact-master`, endpoint(member.id) && stable() && middle.outerHTML === middleBefore &&
            Math.abs(stage.querySelector(':scope > svg').getBoundingClientRect().width - size) < 0.01 &&
            [...q('size-samples').querySelectorAll('.size-sample > svg')].every(svg => JSON.stringify(paths(svg)) === JSON.stringify(masters[member.id])));
        }
      }
      setReduced(true); button('horizontal').click();
      await wait(() => endpoint('horizontal') && q('pause').disabled, `${id} horizontal start`);
      setReduced(false);
      const mutations = [];
      const observer = new MutationObserver(records => mutations.push(...records));
      observers.push(observer);
      observer.observe(stage, { childList: true, subtree: true, attributes: true });
      button('vertical').click();
      await wait(() => phase() > 0.08 && phase() < 0.8, `${id} intermediate contour`);
      q('pause').click();
      await wait(() => q('pause').textContent === 'Продолжить', `${id} paused`);
      const frozen = nodes.map(node => node.getAttribute('d')), frozenPhase = phase();
      await frame(); await frame();
      check(`${id}/paused-real-contours`, frozenPhase > 0 && frozenPhase < 1 &&
        nodes.every((node, index) => node.getAttribute('d') === frozen[index]) && stable() && middle.outerHTML === middleBefore);
      check(`${id}/interpolates-author-operands`, nodes.every((node, index) => {
        const actual = numbers(node.getAttribute('d'));
        return actual.length === horizontal[index].length && actual.every((value, coordinate) =>
          Math.abs(value - ((1 - frozenPhase) * horizontal[index][coordinate] + frozenPhase * vertical[index][coordinate])) < 1e-9);
      }));
      q('export-format').value = 'effect'; q('export').click();
      const exported = JSON.parse(await downloads.at(-1).blob.text());
      check(`${id}/effect-exports-visible-pickup`, exported.contract === 'labpics.symbol-state-effect/1' &&
        exported.kind === 'contour-interpolation' && exported.targetState === 'vertical' && exported.to === 1 &&
        Math.abs(exported.from - frozenPhase) < 1e-9 && exported.targets.length === 2 &&
        exported.unchangedPartIds.join(',') === caps.partIds[1] && exported.targets.every(target => {
          const index = caps.partIds.indexOf(target.partId);
          return target.property === 'd' && target.commands.join('') === 'MCCCCZ' &&
            target.endpoints[0] === masters.horizontal[index].d && target.endpoints[1] === masters.vertical[index].d;
        }));
      q('export-format').value = 'svg'; q('export').click();
      const canonical = downloads.at(-1);
      check(`${id}/svg-exports-selected-author-state`, canonical.filename === `${caps.group}-vertical-${variant}.svg` &&
        JSON.stringify(paths(new DOMParser().parseFromString(await canonical.blob.text(), 'image/svg+xml').documentElement)) === JSON.stringify(masters.vertical) &&
        q('export-status').textContent === 'SVG выбранного состояния подготовлен.');
      for (const format of ['lottie', 'sf-symbols']) {
        const before = downloads.length;
        q('export-format').value = format; q('export').click();
        check(`${id}/${format}/honest-refusal`, downloads.length === before && q('export-status').textContent.startsWith('FORMAT_UNSUPPORTED:'));
      }
      const moving = [0, 2], writes = [];
      const methods = moving.map(index => nodes[index].setAttribute);
      moving.forEach((index, position) => {
        nodes[index].setAttribute = function (property, value) {
          if (property === 'd') writes.push({ index, d: String(value), at: performance.now() });
          return methods[position].call(this, property, value);
        };
      });
      const restore = () => moving.forEach((index, position) => { nodes[index].setAttribute = methods[position]; });
      restoreWrites.push(restore);
      const operandRoundoff = Number(caps.proof.roundingUpper.numerator) / Number(caps.proof.roundingUpper.denominator);
      const phaseRoundoff = 4 * Number.EPSILON + 2 * operandRoundoff / Math.abs(vertical[0][0] - horizontal[0][0]);
      const pausedSuccessor = async (target, action, label) => {
        const before = nodes.map(node => node.getAttribute('d')), from = phase();
        writes.length = 0;
        action(); q('pause').click();
        await wait(() => button(target).getAttribute('aria-pressed') === 'true' && q('pause').textContent === 'Продолжить', `${id}/${label} paused target`);
        const admitted = moving.map(index => writes.find(write => write.index === index));
        check(`${id}/${label}/exact-admission-pickup`, admitted.every((write, position) => write && write.d === before[moving[position]]) && stable());
        const admissionAt = Math.min(...admitted.map(write => write.at)), lastSampleAt = writes.at(-1).at;
        const beforeDownload = downloads.length;
        q('export-format').value = 'effect'; q('export').click();
        const effect = JSON.parse(await downloads.at(-1).blob.text());
        const read = { progress: effect.from, paths: nodes.map(node => node.getAttribute('d')) };
        check(`${id}/${label}/reads-paused-materialized-progress`, downloads.length === beforeDownload + 1 &&
          effect.kind === 'contour-interpolation' && effect.targetState === target && Number.isFinite(read.progress));
        check(`${id}/${label}/pause-matches-author-interpolation`, nodes.every((node, index) => {
          const actual = numbers(read.paths[index]);
          return actual.length === horizontal[index].length && actual.every((value, coordinate) =>
            Math.abs(value - ((1 - read.progress) * horizontal[index][coordinate] + read.progress * vertical[index][coordinate])) <= operandRoundoff);
        }) && stable() && middle.outerHTML === middleBefore);
        // pause может применить время после admission; предел следует из 900 ms,
        // измеренного интервала записи и опубликованной ошибки геометрии.
        const travel = (read.progress - from) * Math.sign(effect.to - from);
        const upper = Math.abs(effect.to - from) * Math.min(1, Math.max(0, lastSampleAt - admissionAt) / effect.options.duration);
        check(`${id}/${label}/pause-has-bounded-continuous-travel`, travel >= -phaseRoundoff && travel <= upper + phaseRoundoff,
          { from, progress: read.progress, elapsedUpper: lastSampleAt - admissionAt, upper, phaseRoundoff });
        await frame(); await frame();
        check(`${id}/${label}/paused-pose-stays-fixed`, nodes.every((node, index) => node.getAttribute('d') === read.paths[index]));
        return read;
      };
      await pausedSuccessor('horizontal', () => q('reverse').click(), 'reverse');
      const resumed = await pausedSuccessor('vertical', () => button('vertical').click(), 'newer-target');
      restore(); restoreWrites.pop();
      q('pause').click();
      await wait(() => phase() > resumed.progress + 0.04, `${id} resumed progress`);
      setReduced(true);
      await wait(() => endpoint('vertical') && q('pause').disabled, `${id} latest reduced target`);
      check(`${id}/reduced-motion-settles-latest-target`, endpoint('vertical') && stable() && middle.outerHTML === middleBefore);
      q('reverse').click();
      await wait(() => endpoint('horizontal') && q('pause').disabled, `${id} reverse endpoint`);
      await frame();
      mutations.push(...observer.takeRecords()); observer.disconnect();
      check(`${id}/bounded-dom-work`, mutations.some(record => record.type === 'attributes' && nodes.includes(record.target)) &&
        mutations.every(record => record.type !== 'childList' && (!nodes.includes(record.target) ||
          record.target !== middle && record.attributeName === 'd')) && stable());
      for (const axis of ['dotScale', 'spacingScale']) {
        const refused = contourModule.compileStateEffect('vertical', { duration: 900, variant, variation: { [axis]: 1.1 } });
        check(`${id}/${axis}/precise-variation-refusal`, !refused.ok && refused.reason.code === 'VARIATION_UNSUPPORTED');
      }
      await choose('ellipsis-vertical', variant);
      check(`${id}/vertical-selects-its-author-endpoint`, q('gesture').value === 'dots.orient' &&
        JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === JSON.stringify(masters.vertical));
      await chooseView('generated');
      check(`${id}/variation-retains-no-loading-refusal`, q('gesture').value === '' && q('play').disabled &&
        q('state-group-controls').hidden && ![...q('gesture').options].some(option => option.value === 'dots.orient'));
      await chooseView('original');
      check(`${id}/return-restores-author-state`, q('gesture').value === 'dots.orient' && !q('state-group-controls').hidden &&
        JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === JSON.stringify(masters.vertical));
    }

    await choose('question-circle', 'outline');
    const stateModule = await import(new URL('./package/states/status-circle.js', location.href).href);
    const stateCaps = stateModule.stateCapabilities();
    const stateStage = q('symbol-stage');
    const enclosure = stateStage.querySelector(`[data-part="${stateCaps.enclosurePartId}"]`);
    const enclosureData = enclosure?.getAttribute('d');
    const groups = stateCaps.states.map(member => stateStage.querySelector(`[data-state="${member.id}"]`));
    const opacityValues = () => groups.map(group => Number(getComputedStyle(group).opacity));
    const stableNodes = () => groups.every((group, index) => group === stateStage.querySelector(`[data-state="${stateCaps.states[index].id}"]`)) &&
      enclosure === stateStage.querySelector(`[data-part="${stateCaps.enclosurePartId}"]`) && enclosure.getAttribute('d') === enclosureData;
    const targetButton = target => q('state-choices').querySelector(`[data-state-target="${target}"]`);
    const endpoint = target => opacityValues().every((value, index) => Math.abs(value - (stateCaps.states[index].id === target ? 1 : 0)) < 0.000001);
    check('replacement-six-groups-one-enclosure', groups.length === 6 && groups.every(group => group?.tagName.toLowerCase() === 'g') &&
      stateStage.querySelectorAll(`[data-part="${stateCaps.enclosurePartId}"]`).length === 1 && !q('state-group-controls').hidden);
    check('replacement-initial-author-state', endpoint('question') && q('gesture').value === 'enclosure.replace');
    for (const member of stateCaps.states) {
      const row = data.rows.find(row => row.name === member.icon && row.variant === 'outline');
      const original = await originalFetch(row.views.original).then(response => response.text());
      const template = document.createElement('template');
      template.innerHTML = original;
      const authorPaths = paths(template.content.querySelector('svg'));
      const group = groups[stateCaps.states.indexOf(member)];
      check(`replacement/${member.id}/exact-author-content`, JSON.stringify(paths(group)) === JSON.stringify(authorPaths.slice(0, -1)) &&
        JSON.stringify({ d: enclosureData, fillRule: enclosure.getAttribute('fill-rule') ?? 'nonzero' }) === JSON.stringify(authorPaths.at(-1)));
      const button = targetButton(member.id), rect = button.getBoundingClientRect();
      check(`replacement/${member.id}/accessible-choice`, rect.width >= 44 && rect.height >= 44 &&
        Boolean(button.getAttribute('aria-label')) && button.querySelector('svg').getAttribute('aria-hidden') === 'true');
      setReduced(true);
      button.click();
      await wait(() => endpoint(member.id) && q('symbol-name').textContent === member.icon, `replacement ${member.id}`);
      check(`replacement/${member.id}/terminal-and-nodes`, endpoint(member.id) && stableNodes() && button.getAttribute('aria-pressed') === 'true');
    }
    targetButton('question').click();
    await wait(() => endpoint('question'), 'replacement rest');
    setReduced(false);
    targetButton('confirmation').click();
    const confirmationIndex = stateCaps.states.findIndex(member => member.id === 'confirmation');
    await wait(() => opacityValues()[confirmationIndex] > 0.1 && opacityValues()[confirmationIndex] < 0.9, 'replacement visible mixed pose');
    q('pause').click();
    await frame();
    const frozen = opacityValues();
    await frame();
    check('replacement-pause-freezes-groups', frozen.every((value, index) => Math.abs(value - opacityValues()[index]) < 0.000001) && stableNodes());
    targetButton('attention').click();
    q('pause').click();
    await wait(() => targetButton('attention').getAttribute('aria-pressed') === 'true' && q('pause').textContent === 'Продолжить', 'replacement paused successor');
    check('replacement-newer-state-retains-visible-pose', frozen.every((value, index) => Math.abs(value - opacityValues()[index]) < 0.01) && stableNodes(), { before: frozen, after: opacityValues() });
    q('reverse').click();
    q('pause').click();
    await wait(() => targetButton('confirmation').getAttribute('aria-pressed') === 'true' && q('pause').textContent === 'Продолжить', 'replacement reverse pickup');
    check('replacement-reverse-retains-visible-pose', frozen.every((value, index) => Math.abs(value - opacityValues()[index]) < 0.01) && stableNodes());
    setReduced(true);
    await wait(() => endpoint('confirmation') && q('pause').disabled, 'replacement reduced endpoint');
    check('replacement-reduced-terminal', endpoint('confirmation') && stableNodes());
    q('export-format').value = 'svg';
    q('export').click();
    const stateSvg = downloads.at(-1);
    const stateSvgText = await stateSvg.blob.text();
    const canonicalState = stateModule.render('confirmation');
    check('replacement-current-canonical-svg-export', stateSvg.filename === 'status-circle-confirmation-outline.svg' &&
      canonicalState.ok && stateSvgText === canonicalState.svg);
    q('export-format').value = 'effect';
    q('export').click();
    const stateEffect = JSON.parse(await downloads.at(-1).blob.text());
    check('replacement-public-effect-export', stateEffect.contract === 'labpics.symbol-state-effect/1' &&
      stateEffect.targetState === 'confirmation' && stateEffect.stages.length === 6 &&
      stateEffect.unchangedPartIds.join(' ') === stateCaps.enclosurePartId);
    for (const format of ['lottie', 'sf-symbols']) {
      const before = downloads.length;
      q('export-format').value = format;
      q('export').click();
      check(`replacement/${format}/honest-refusal`, downloads.length === before && q('export-status').textContent.startsWith('FORMAT_UNSUPPORTED:'));
    }
    await choose('checkmark-circle', 'outline');
    const baseRow = data.rows.find(row => row.name === 'checkmark-circle' && row.variant === 'outline');
    const baseModule = await import('./package/symbols/checkmark-circle.js');
    const baseGlyph = baseModule.glyph({ variant: 'outline' });
    const baseOriginal = await originalFetch(baseRow.views.original).then(response => response.text());
    const basePaths = paths(new DOMParser().parseFromString(baseOriginal, 'image/svg+xml').documentElement);
    targetButton('question').click();
    await wait(() => q('symbol-name').textContent === 'question-circle' && targetButton('question').getAttribute('aria-pressed') === 'true', 'replacement different subject');
    const questionMember = stateCaps.states.find(member => member.id === 'question');
    const questionParts = [...questionMember.contentPartIds, stateCaps.enclosurePartId];
    for (const view of ['overlay', 'difference']) {
      const viewButton = document.querySelector(`[data-view="${view}"]`);
      check(`replacement-exit/${view}/available`, !viewButton.disabled);
      viewButton.click();
      await wait(() => q('symbol-stage').dataset.view === view && q('symbol-inspector').getAttribute('aria-busy') === 'false', `replacement exit ${view}`);
      const aria = q('symbol-stage').getAttribute('aria-label');
      check(`replacement-exit/${view}/subject-metadata`, q('symbol-name').textContent === 'checkmark-circle' &&
        aria.includes('checkmark-circle') && !aria.includes('question-circle') &&
        q('model-status').textContent !== 'Авторские состояния' && q('source-status').textContent.includes(baseRow.original.nodeId));
      check(`replacement-exit/${view}/mode-controls`, q('state-group-controls').hidden && !q('gesture-progress-control').hidden &&
        q('state-choice-label').textContent === '' &&
        [...document.querySelectorAll('button[data-view]')].every(button => button.getAttribute('aria-pressed') === String(button.dataset.view === view)));
      const projectedParts = [...q('parts').children];
      const stageSvg = q('symbol-stage').querySelector('svg');
      check(`replacement-exit/${view}/comparison-subject`,
        JSON.stringify(paths(stageSvg.querySelector('[data-comparison="source"]'))) === JSON.stringify(basePaths) &&
        JSON.stringify(paths(stageSvg.querySelector('[data-comparison="modified"]'))) === JSON.stringify(basePaths) &&
        q('consumer-import').textContent.includes('/variations/checkmark-circle') &&
        JSON.stringify(projectedParts.map(part => part.title)) === JSON.stringify(baseGlyph.parts.map(part => part.id)) &&
        q('source-status').textContent.includes('Красным') &&
        [...q('size-samples').querySelectorAll('svg')].every(svg => JSON.stringify(paths(svg)) === JSON.stringify(basePaths)) &&
        q('play').disabled && q('gesture').disabled);
      q('export-format').value = 'svg';
      q('export').click();
      const exported = downloads.at(-1);
      check(`replacement-exit/${view}/export-subject`, exported.filename === 'checkmark-circle-outline-variation.svg' &&
        JSON.stringify(paths(new DOMParser().parseFromString(await exported.blob.text(), 'image/svg+xml').documentElement)) === JSON.stringify(basePaths));
      document.querySelector('[data-view="original"]').click();
      await settle('question-circle');
      check(`replacement-return/${view}/state-metadata`, q('model-status').textContent === 'Авторские состояния' &&
        q('symbol-stage').getAttribute('aria-label').includes('question-circle') &&
        q('source-status').textContent.includes(questionMember.author.nodeId) &&
        q('consumer-import').textContent.includes('/states/status-circle') &&
        JSON.stringify([...q('parts').children].map(part => part.title)) === JSON.stringify(questionParts) &&
        !q('state-group-controls').hidden && q('gesture-progress-control').hidden && !q('gesture').disabled &&
        q('gesture').value === 'enclosure.replace' && targetButton('question').getAttribute('aria-pressed') === 'true' &&
        Number(getComputedStyle(q('symbol-stage').querySelector('[data-state="question"]')).opacity) === 1);
    }

    // Один настоящий UI связывает вариативность и переход; контролы не получают
    // геометрию от oracle и не могут восстановить смесь посредством remount.
    check('state-variation/published-group', data.stateVariationGroupIds.includes('status-circle'));
    const mounted = [...q('symbol-stage').querySelectorAll('*')];
    const stateParts = [...q('symbol-stage').querySelectorAll('g[data-state]')];
    const common = q('symbol-stage').querySelector(`[data-part="${stateCaps.enclosurePartId}"]`);
    const rawCommon = basePaths.at(-1).d;
    const contentBefore = stateParts.map(group => JSON.stringify(paths(group)));
    const sameMounted = () => {
      const current = q('symbol-stage').querySelectorAll('*');
      return current.length === mounted.length && mounted.every((node, index) => node === current[index]);
    };
    const stateOpacity = () => stateParts.map(group => Number(getComputedStyle(group).opacity));
    setReduced(false); targetButton('confirmation').click();
    await wait(() => stateOpacity()[confirmationIndex] > 0.1 && stateOpacity()[confirmationIndex] < 0.9, 'state variation mixed pose');
    q('pause').click(); await frame();
    const mixture = stateOpacity();
    await changeVariation('enclosureEmphasis', 1.2);
    const variedCommon = common.getAttribute('d');
    check('state-variation/one-event-preserves-mixture', sameMounted() && q('pause').textContent === 'Продолжить' &&
      mixture.every((value, index) => Math.abs(value - stateOpacity()[index]) < 0.000001) &&
      stateParts.every((group, index) => JSON.stringify(paths(group)) === contentBefore[index]) &&
      variedCommon !== rawCommon && variedCommon.startsWith(rawCommon.split(/(?=M)/)[0]) &&
      q('consumer-import').textContent.includes('/state-variations/status-circle') && !q('state-group-controls').hidden);
    q('export-format').value = 'svg'; q('export').click();
    const visibleExport = new DOMParser().parseFromString(await downloads.at(-1).blob.text(), 'image/svg+xml').documentElement;
    check('state-variation/exports-visible-mixture',
      visibleExport.querySelector(`[data-part="${stateCaps.enclosurePartId}"]`).getAttribute('d') === variedCommon &&
      [...visibleExport.querySelectorAll('g[data-state]')].every((group, index) =>
        Math.abs(Number(group.getAttribute('opacity')) - mixture[index]) < 0.000001) && sameMounted());
    await changeVariation('enclosureEmphasis', 2.6, 'VARIATION_OUTSIDE_DOMAIN');
    check('state-variation/refusal-before-mutation', common.getAttribute('d') === variedCommon && sameMounted() &&
      mixture.every((value, index) => Math.abs(value - stateOpacity()[index]) < 0.000001));
    targetButton('attention').click(); q('pause').click();
    await wait(() => targetButton('attention').getAttribute('aria-pressed') === 'true' && q('pause').textContent === 'Продолжить', 'state variation successor');
    check('state-variation/successor-pickup', sameMounted() && common.getAttribute('d') === variedCommon &&
      mixture.every((value, index) => Math.abs(value - stateOpacity()[index]) < 0.01));
    q('reverse').click(); q('pause').click();
    await wait(() => targetButton('confirmation').getAttribute('aria-pressed') === 'true' && q('pause').textContent === 'Продолжить', 'state variation reverse');
    check('state-variation/reverse-pickup', sameMounted() && common.getAttribute('d') === variedCommon &&
      mixture.every((value, index) => Math.abs(value - stateOpacity()[index]) < 0.01));
    q('axis-controls').querySelector('[data-variation-reset]').click();
    await wait(() => q('symbol-stage').dataset.view === 'original', 'state variation reset');
    check('state-variation/exact-reset-keeps-clock', common.getAttribute('d') === rawCommon && sameMounted() &&
      q('pause').textContent === 'Продолжить' &&
      mixture.every((value, index) => Math.abs(value - stateOpacity()[index]) < 0.01));
    setReduced(true);
    await wait(() => q('pause').disabled, 'state variation reduced terminal');
    check('state-variation/reduced-terminal', sameMounted() && common.getAttribute('d') === rawCommon &&
      stateOpacity().every((value, index) => value === (index === confirmationIndex ? 1 : 0)));
    await choose('question-circle', 'filled');
    check('replacement-filled-unavailable', q('state-group-controls').hidden &&
      ![...q('gesture').options].some(option => option.value === 'enclosure.replace'));

    await choose('time', 'outline');
    check('latest-clock-motion-refuses', q('play').disabled && q('gesture').value === '');
    await choose('reload', 'outline');
    setReduced(true);
    await setProgress(0);
    q('export-format').value = 'svg';
    q('display-color').value = '#19191e';
    q('display-color').dispatchEvent(new Event('input', { bubbles: true }));
    return { version: 1, scope: 'source Observatory consumer journey; bounded controls, no performance claim',
      source: data.source, counts: data.summary, executionIdentity: data.executionIdentity, authority, checks,
      userAgent: navigator.userAgent, downloadsChecked: downloads.length };
  } catch (error) {
    failed = true;
    error.journey = { version: 1, checks, authority, failure: error.message };
    throw error;
  } finally {
    window.fetch = originalFetch;
    URL.createObjectURL = originalCreateUrl;
    HTMLAnchorElement.prototype.click = originalAnchorClick;
    if (deferredReject) deferredReject(new Error('journey cleanup'));
    for (const control of controls) control.stop();
    for (const observer of observers) observer.disconnect();
    for (const restore of restoreWrites) restore();
    for (const fixture of fixtures) fixture.remove();
    if (failed && q('pause')?.textContent === 'Пауза' && !q('pause').disabled) q('pause').click();
  }
}

/** Реальная задержка module load; не подменяет content исполнителя. */
export async function verifyLazyPause({ page, origin }) {
  let release;
  let requested = false;
  const held = new Promise(resolve => { release = resolve; });
  await page.route('**/motion-execution.js', async route => {
    requested = true;
    await held;
    await route.continue();
  });
  try {
    await page.goto(origin, { waitUntil: 'load' });
    await page.locator('#symbol-inspector[aria-busy="false"]').waitFor();
    await page.locator('#symbol-search').fill('reload');
    await page.locator('[data-symbol="reload"]').click();
    await page.locator('#symbol-inspector[aria-busy="false"]').waitFor();
    await page.locator('#reduce-motion').uncheck();
    await page.locator('#play').click();
    await page.waitForFunction(() => !document.querySelector('#pause').disabled);
    await page.locator('#pause').click();
    release();
    await page.waitForFunction(() => document.querySelector('#symbol-stage [data-part]').style.transform !== '');
    const paused = await page.evaluate(async () => {
      for (let count = 0; count < 8; count++) await new Promise(resolve => requestAnimationFrame(resolve));
      const part = document.querySelector('#symbol-stage [data-part]');
      const matrix = new DOMMatrix(getComputedStyle(part).transform);
      return { progress: Number(document.querySelector('#progress').value),
        angle: Math.atan2(matrix.b, matrix.a) * 180 / Math.PI,
        label: document.querySelector('#pause').textContent };
    });
    if (!requested || paused.progress !== 0 || Math.abs(paused.angle) > 0.01 || paused.label !== 'Продолжить') {
      throw new Error(`lazy pause intent lost: ${JSON.stringify({ requested, ...paused })}`);
    }
    await page.locator('#pause').click();
    await page.waitForFunction(() => Number(document.querySelector('#progress').value) > 0.05);
    await page.locator('#pause').click();
    return { pass: true, requested, paused, resumed: true };
  } finally {
    release();
    await page.unroute('**/motion-execution.js');
  }
}

/** Старый state-module может завершиться после нового выбора; он не владеет inspector. */
export async function verifyLazyStateSelection({ page, origin }) {
  let release, signalRequested, timeout;
  const held = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { signalRequested = resolve; });
  await page.route('**/package/states/status-circle.js', async route => {
    signalRequested();
    await held;
    await route.continue();
  });
  try {
    await page.goto(origin, { waitUntil: 'load' });
    await page.locator('#symbol-inspector[aria-busy="false"]').waitFor();
    await page.locator('#symbol-search').fill('question-circle');
    await page.locator('[data-symbol="question-circle"]').click();
    await Promise.race([requested, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('state module was not requested')), 4000); })]);
    clearTimeout(timeout);
    await page.locator('#symbol-search').fill('reload');
    await page.locator('[data-symbol="reload"]').click();
    await page.locator('#symbol-inspector[aria-busy="false"]').waitFor();
    const before = await page.locator('#symbol-stage').innerHTML();
    release();
    await page.evaluate(async () => {
      await import('/package/states/status-circle.js');
      for (let index = 0; index < 2; index++) await new Promise(resolve => requestAnimationFrame(resolve));
    });
    const preserved = await page.locator('#symbol-name').textContent() === 'reload' &&
      await page.locator('#symbol-stage').innerHTML() === before &&
      await page.locator('#state-group-controls').isHidden();
    if (!preserved) throw new Error('late state module replaced the newer selection');
    return { pass: true, requested: true, preservedSelection: 'reload', preservedDom: true };
  } finally {
    clearTimeout(timeout);
    release();
    await page.unroute('**/package/states/status-circle.js');
  }
}

/** Поздний authored gesture import не заменяет новый выбор и его физический SVG. */
export async function verifyLazyGestureSelection({ page, origin }) {
  let release, signalRequested, timeout;
  const held = new Promise(resolve => { release = resolve; });
  const requested = new Promise(resolve => { signalRequested = resolve; });
  await page.route('**/package/gestures/refresh.js', async route => {
    signalRequested();
    await held;
    await route.continue();
  });
  try {
    await page.goto(origin, { waitUntil: 'load' });
    await page.locator('#symbol-inspector[aria-busy="false"]').waitFor();
    await page.locator('#symbol-search').fill('refresh');
    await page.locator('[data-symbol="refresh"]').click();
    await Promise.race([requested, new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('authored gesture module was not requested')), 4000);
    })]);
    clearTimeout(timeout);
    await page.locator('#symbol-search').fill('reload');
    await page.locator('[data-symbol="reload"]').click();
    await page.locator('#symbol-inspector[aria-busy="false"]').waitFor();
    const before = await page.locator('#symbol-stage').innerHTML();
    const sourceBefore = await page.locator('#source-status').textContent();
    release();
    await page.evaluate(async () => {
      await import('/package/gestures/refresh.js');
      for (let index = 0; index < 2; index++) await new Promise(resolve => requestAnimationFrame(resolve));
    });
    const preserved = await page.locator('#symbol-name').textContent() === 'reload' &&
      await page.locator('#symbol-stage').innerHTML() === before &&
      await page.locator('#source-status').textContent() === sourceBefore &&
      (await page.locator('#consumer-import').textContent()).includes('/gestures/reload') &&
      await page.locator('#load-status').isHidden();
    if (!preserved) throw new Error('late authored gesture module replaced the newer selection');
    return { pass: true, requested: true, preservedSelection: 'reload', preservedDom: true, preservedSource: true };
  } finally {
    clearTimeout(timeout);
    release();
    await page.unroute('**/package/gestures/refresh.js');
  }
}
