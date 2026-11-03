const NS = 'http://www.w3.org/2000/svg';
const assert = (condition, message) => { if (!condition) throw new Error(`Lottie render: ${message}`); };
/** Независимый oracle читает raw author commands; target parser сюда не импортируется. */
export function canonicalCubicPath(d) {
  assert(typeof d === 'string', 'raw path обязан быть строкой');
  const tokens = []; let consumed = 0;
  for (const match of d.matchAll(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g)) {
    const gap = d.slice(consumed, match.index), token = match[0];
    assert(/^[ \t\r\n\f]*(?:,[ \t\r\n\f]*)?$/.test(gap), 'raw path содержит неизвестный token или separator');
    if (gap.includes(',')) {
      assert(tokens.length && !/^[a-zA-Z]$/.test(tokens.at(-1)) && !/^[a-zA-Z]$/.test(token),
        'raw path допускает comma только между координатами');
    }
    tokens.push(token); consumed = match.index + token.length;
  }
  assert(/^[ \t\r\n\f]*$/.test(d.slice(consumed)), 'raw path содержит неполный trailing token или separator');
  let index = 0, command, cursor = [0, 0], start, output = '';
  const number = () => {
    const value = Number(tokens[index++]); assert(Number.isFinite(value), 'raw command содержит нечисловую координату'); return value;
  };
  const coordinates = point => {
    const materialized = point.map(Math.fround);
    assert(materialized.every(Number.isFinite), 'raw координаты невыразимы в конечном binary32');
    return materialized.join(' ');
  };
  const curve = (a, b, end) => { output += `C${coordinates(a)} ${coordinates(b)} ${coordinates(end)}`; cursor = end; };
  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++];
    assert(command && !command.match(/[a-z]/), 'Independent raw oracle требует absolute author commands.');
    assert(start || command === 'M', 'raw path обязан начинаться с M');
    if (command === 'M') { cursor = [number(), number()]; start = cursor; output += `M${coordinates(cursor)}`; command = 'L'; }
    else if (command === 'L') { const end = [number(), number()]; curve(cursor, end, end); }
    else if (command === 'H') { const end = [number(), cursor[1]]; curve(cursor, end, end); }
    else if (command === 'V') { const end = [cursor[0], number()]; curve(cursor, end, end); }
    else if (command === 'C') { const a = [number(), number()], b = [number(), number()], end = [number(), number()]; curve(a, b, end); }
    else if (command === 'Z') {
      assert(start, 'Z без M');
      if (cursor[0] !== start[0] || cursor[1] !== start[1]) curve(cursor, start, start);
      output += 'Z'; command = undefined;
    } else throw new Error(`Independent raw oracle: неподдержанная команда ${command}`);
  }
  return output;
}
/** Только диагностическая интервенция: исходные C и числовые tokens сохраняются.
 * Это не compiler и не новая форма публичной геометрии. */
export function diagnosticPath(d, { lines = 'native', numbers = 'author' } = {}) {
  assert(['native', 'zero-tangent', 'parameter-linear'].includes(lines), 'Неизвестная line intervention');
  assert(['author', 'binary32'].includes(numbers), 'Неизвестная number intervention');
  canonicalCubicPath(d); // Существующий независимый parser проверяет весь вход.
  const numberPattern = /[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g;
  const materialize = value => value.replace(numberPattern, token => ` ${Math.fround(Number(token))} `);
  if (lines === 'native') return numbers === 'binary32' ? materialize(d) : d;
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g);
  let index = 0, command, cursor, start, output = '';
  const point = () => [tokens[index++], tokens[index++]];
  const coordinates = value => value.join(' ');
  const line = end => {
    const control = fraction => cursor.map((value, axis) => {
      const interpolated = Number(value) + (Number(end[axis]) - Number(value)) * fraction;
      return String(interpolated);
    });
    const a = lines === 'zero-tangent' ? cursor : control(1 / 3);
    const b = lines === 'zero-tangent' ? end : control(2 / 3);
    output += `C${coordinates(a)} ${coordinates(b)} ${coordinates(end)}`; cursor = end;
  };
  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++];
    if (command === 'M') { cursor = point(); start = cursor; output += `M${coordinates(cursor)}`; command = 'L'; }
    else if (command === 'L') line(point());
    else if (command === 'H') line([tokens[index++], cursor[1]]);
    else if (command === 'V') line([cursor[0], tokens[index++]]);
    else if (command === 'C') {
      const a = point(), b = point(), end = point();
      output += `C${coordinates(a)} ${coordinates(b)} ${coordinates(end)}`; cursor = end;
    } else if (command === 'Z') {
      if (cursor.some((value, axis) => Number(value) !== Number(start[axis]))) line(start);
      output += 'Z'; command = undefined;
    }
  }
  // Проекция применяется после line intervention; одновременно endpoints не меняются.
  return numbers === 'binary32' ? output.replace(numberPattern, token => String(Math.fround(Number(token)))) : output;
}
export function referenceLottieOpacity(declaration, id, gesture, progress) {
  if (!declaration || !gesture) return 1;
  const law = declaration.gesture;
  if (law.law === 'confirmation.presence') return id === law.partId ? progress : 1;
  const index = law.partIds?.indexOf(id) ?? -1;
  if (index < 0 || gesture.endsWith('.idle')) return 1;
  if (law.law === 'signal.levels') return Math.max(0, Math.min(1, law.partIds.length * progress - index));
  if (law.law !== 'activity.triad') return 1;
  // Независимая шкала документированного triad law; producer sampler не импортируется.
  const points = [[0, 1], [1 / 12, 0.35], ...index ? [[(1 + 3 * index) / 12, 0.35]] : [],
    [(2 + 3 * index) / 12, 1], [(4 + 3 * index) / 12, 0.35], ...index < 2 ? [[10 / 12, 0.35]] : [], [1, 1]];
  const next = points.findIndex(([t]) => t >= progress);
  if (next === 0) return points[0][1];
  const a = points[next - 1], b = points[next];
  return a[1] + (b[1] - a[1]) * (progress - a[0]) / (b[0] - a[0]);
}
export function referenceLottieGestures(name, declaration) {
  if (!declaration || declaration.gesture === null) return [];
  const law = declaration.gesture?.law;
  if (law === 'cycle.clockwise') return [`${name}.cycle`];
  if (law === 'signal.levels') return [`${name}.level`];
  if (law === 'activity.triad') return [`${name}.activity`, `${name}.idle`];
  if (law === 'direction.nudge') return [`${name}.nudge`];
  if (law === 'confirmation.presence') return [`${name}.presence`];
  if (law === 'notification.ring') return [`${name}.ring`];
  throw new Error(`${name}: raw law не имеет независимого oracle`);
}
export function referenceLottieEmptyPose(declaration, rawPartIds, gesture, progress) {
  return rawPartIds.length > 0 && rawPartIds.every(id => referenceLottieOpacity(declaration, id, gesture, progress) === 0);
}
/** Независимый physical direction law по raw viewport; producer stops не читаются. */
export function referenceNudgeTranslation(declaration, id, gesture, progress, viewBox) {
  const law = declaration?.gesture;
  if (!gesture || law?.law !== 'direction.nudge' || law.partId !== id) return [0, 0];
  assert(['left', 'right', 'up', 'down'].includes(law.direction), 'raw direction.nudge имеет неизвестное направление');
  const pulse = 1 - Math.abs(2 * progress - 1);
  if (pulse === 0) return [0, 0];
  const horizontal = law.direction === 'left' || law.direction === 'right';
  const amount = (horizontal ? viewBox[2] : viewBox[3]) / 8 * pulse;
  return horizontal ? [law.direction === 'left' ? -amount : amount, 0] : [0, law.direction === 'up' ? -amount : amount];
}
/** SVG2 bbox измеряется на connected raw surface; Chromium 140 не создаёт
 * LayoutObject для detached XML. Один вызов на testcase, без producer bounds. */
export function measureRawNotificationWidth(declaration, source, documentOwner = document) {
  const law = declaration?.gesture;
  assert(law?.law === 'notification.ring', 'raw measurement требует notification.ring');
  const part = declaration.parts.find(item => item.id === law.partId);
  assert(part && Number.isInteger(part.pathIndex) && part.pathIndex >= 0, 'raw clapper не объявлен');
  const surface = documentOwner.importNode(source.documentElement, true);
  surface.setAttribute('aria-hidden', 'true');
  surface.style.cssText = 'position:absolute;left:-10000px;top:0;visibility:hidden;pointer-events:none';
  try {
    documentOwner.body.append(surface);
    const rawPath = surface.querySelectorAll('path')[part.pathIndex];
    assert(rawPath, 'raw clapper отсутствует в master');
    const width = rawPath.getBBox().width;
    assert(Number.isFinite(width) && width > 0, 'raw clapper имеет невалидную ширину');
    return width;
  } finally { surface.remove(); }
}
/** Motion stops и control-point hull не участвуют в независимой калибровке. */
export function referenceNotificationTranslation(declaration, id, gesture, progress, width) {
  const law = declaration?.gesture;
  if (!gesture || law?.law !== 'notification.ring' || law.partId !== id) return [0, 0];
  assert(law.purpose === 'incoming-notification', 'raw notification.ring имеет неизвестный смысл');
  assert(Number.isFinite(width) && width > 0, 'raw clapper имеет невалидную ширину');
  assert(Number.isFinite(progress) && progress >= 0 && progress <= 1, 'raw ring progress выходит за [0,1]');
  const values = [0, 1, -1, 0.5, -0.5, 0];
  if (progress === 1) return [0, 0];
  const interval = progress * 5, index = Math.floor(interval), fraction = interval - index;
  const displacement = width / 4 * (values[index] + (values[index + 1] - values[index]) * fraction);
  return [displacement, 0];
}
function translationStops(declaration) {
  const law = declaration?.gesture?.law;
  return law === 'notification.ring' ? [0.2, 0.4, 0.6, 0.8] : law === 'direction.nudge' ? [0.5] : [];
}
function referenceTranslation(declaration, id, gesture, progress, viewBox, notificationWidth) {
  return declaration?.gesture?.law === 'notification.ring'
    ? referenceNotificationTranslation(declaration, id, gesture, progress, notificationWidth)
    : referenceNudgeTranslation(declaration, id, gesture, progress, viewBox);
}
export function referenceLottieTiming(request) {
  const from = request.gesture ? request.from ?? 0 : 0, to = request.gesture ? request.to ?? 1 : 0;
  const duration = request.gesture && !request.reducedMotion && from !== to ? request.duration ?? 1000 : 0;
  // Oracle считает кадры по длительности одного кадра из request.
  // Producer metadata и его промежуточные вычисления сюда не переносятся.
  return { terminalFrame: Math.round(duration / (1000 / (request.frameRate ?? 60))), from, to };
}
function rawSource(testCase) {
  const source = new DOMParser().parseFromString(testCase.rawSvg, 'image/svg+xml');
  assert(!source.querySelector('parsererror'), `${testCase.name}: raw SVG не прочитан`);
  const viewBox = source.documentElement.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  assert(viewBox.length === 4 && viewBox.every(Number.isFinite) && viewBox[2] > 0 && viewBox[3] > 0, 'raw viewBox невалиден');
  const notificationWidth = testCase.request.gesture && testCase.annotation?.gesture?.law === 'notification.ring'
    ? measureRawNotificationWidth(testCase.annotation, source) : undefined;
  return { source, viewBox, notificationWidth };
}
function referenceFrame(testCase, raw) {
  const { source, viewBox, notificationWidth } = raw;
  const time = referenceLottieTiming(testCase.request);
  let minX = viewBox[0], minY = viewBox[1], maxX = minX + viewBox[2], maxY = minY + viewBox[3];
  for (const [index, path] of [...source.querySelectorAll('path')].entries()) {
    const values = canonicalCubicPath(path.getAttribute('d')).match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g).map(Number);
    const points = Array.from({ length: values.length / 2 }, (_, index) => values.slice(index * 2, index * 2 + 2));
    const part = testCase.annotation?.parts.find(item => item.pathIndex === index);
    if (testCase.request.gesture && testCase.annotation?.gesture?.law === 'cycle.clockwise' && testCase.annotation.gesture.partId === part?.id) {
      const pivot = [viewBox[0] + part.anchor[0] * viewBox[2], viewBox[1] + part.anchor[1] * viewBox[3]];
      const radius = Math.max(...points.map(point => Math.hypot(point[0] - pivot[0], point[1] - pivot[1])));
      minX = Math.min(minX, pivot[0] - radius); minY = Math.min(minY, pivot[1] - radius);
      maxX = Math.max(maxX, pivot[0] + radius); maxY = Math.max(maxY, pivot[1] + radius);
    } else {
      const phases = time.terminalFrame ? [time.from, time.to, ...translationStops(testCase.annotation).filter(progress =>
        progress > Math.min(time.from, time.to) && progress < Math.max(time.from, time.to))] : [time.to];
      const offsets = phases.map(progress => referenceTranslation(testCase.annotation, part?.id, testCase.request.gesture, progress, viewBox, notificationWidth));
      for (const point of points) for (const translation of offsets) {
        minX = Math.min(minX, point[0] + translation[0]); minY = Math.min(minY, point[1] + translation[1]);
        maxX = Math.max(maxX, point[0] + translation[0]); maxY = Math.max(maxY, point[1] + translation[1]);
      }
    }
  }
  // Область наблюдения принадлежит raw master. Cropped target не обрезает oracle.
  return [Math.floor(minX), Math.floor(minY), Math.ceil(maxX) - Math.floor(minX), Math.ceil(maxY) - Math.floor(minY)];
}
function referenceSvg(testCase, raw, frame, progress, canonical = false) {
  const { source, viewBox, notificationWidth } = raw;
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', frame.join(' '));
  const root = document.createElementNS(NS, 'g');
  svg.append(root);
  for (const [index, sourcePath] of [...source.querySelectorAll('path')].entries()) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', canonical ? canonicalCubicPath(sourcePath.getAttribute('d')) : sourcePath.getAttribute('d'));
    path.setAttribute('fill-rule', sourcePath.getAttribute('fill-rule') ?? 'nonzero');
    path.setAttribute('fill', testCase.request.color ?? '#000000');
    const part = testCase.annotation?.parts.find(item => item.pathIndex === index);
    path.setAttribute('opacity', String(referenceLottieOpacity(testCase.annotation, part?.id, testCase.request.gesture, progress)));
    if (testCase.annotation?.gesture?.law === 'cycle.clockwise' && testCase.annotation.gesture.partId === part?.id && testCase.request.gesture) {
      path.setAttribute('transform', `rotate(${progress * 360} ${viewBox[0] + part.anchor[0] * viewBox[2]} ${viewBox[1] + part.anchor[1] * viewBox[3]})`);
    } else if (translationStops(testCase.annotation).length && testCase.annotation.gesture.partId === part?.id && testCase.request.gesture) {
      const translation = referenceTranslation(testCase.annotation, part.id, testCase.request.gesture, progress, viewBox, notificationWidth);
      path.setAttribute('transform', `translate(${translation[0]} ${translation[1]})`);
    }
    root.append(path);
  }
  return svg;
}
function observedSvg(rendered, animation, frame) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', frame.join(' '));
  const target = rendered.cloneNode(true);
  target.removeAttribute('style');
  target.setAttribute('x', -animation.meta.labIcons.offset[0]); target.setAttribute('y', -animation.meta.labIcons.offset[1]);
  target.setAttribute('width', animation.w); target.setAttribute('height', animation.h);
  target.setAttribute('overflow', 'hidden');
  svg.append(target);
  return svg;
}
async function pixels(svg, width, height) {
  const copy = svg.cloneNode(true);
  copy.setAttribute('width', width); copy.setAttribute('height', height);
  copy.removeAttribute('style');
  const image = new Image(), url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(copy)], { type: 'image/svg+xml' }));
  try {
    image.src = url; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    context.drawImage(image, 0, 0, width, height);
    return context.getImageData(0, 0, width, height).data;
  } finally { URL.revokeObjectURL(url); }
}
export function compareLottiePixels(actual, expected, { expectedEmpty = false } = {}) {
  if (actual.length !== expected.length || expected.length === 0 || expected.length % 4 !== 0) return { pass: false };
  let referenceInk = 0, alphaError = 0, maxAlphaError = 0, colorError = 0, maxColorError = 0;
  for (let index = 3; index < expected.length; index += 4) {
    referenceInk += expected[index];
    const error = Math.abs(actual[index] - expected[index]);
    alphaError += error; maxAlphaError = Math.max(maxAlphaError, error);
    for (let channel = index - 3; channel < index; channel++) {
      const error = Math.abs(actual[channel] * actual[index] - expected[channel] * expected[index]) / 255;
      colorError += error; maxColorError = Math.max(maxColorError, error);
    }
  }
  // Эти пределы относятся только к одинаковому cubic-представлению.
  // Native L и эквивалентный C имеют разные scan conversion routes в Skia.
  const relativeInkError = alphaError / Math.max(1, referenceInk);
  const relativeColorError = colorError / Math.max(1, referenceInk * 3);
  return { referenceInk, alphaError, maxAlphaError, relativeInkError, colorError, maxColorError, relativeColorError,
    pass: expectedEmpty ? referenceInk === 0 && alphaError === 0 :
      referenceInk > 0 && relativeInkError <= 0.001 && maxAlphaError <= 4 && relativeColorError <= 0.001 && maxColorError <= 4 };
}
export function diagnosticAlpha(actual, expected) {
  const comparison = compareLottiePixels(actual, expected);
  assert(Number.isFinite(comparison.referenceInk), 'Diagnostic pixels имеют неверную длину');
  const alpha = [], alphaDifference = [];
  let actualInk = 0;
  for (let index = 3; index < actual.length; index += 4) {
    alpha.push(actual[index]); alphaDifference.push(actual[index] - expected[index]); actualInk += actual[index];
  }
  return { ...comparison, actualInk, signedInkBias: (actualInk - comparison.referenceInk) / Math.max(1, comparison.referenceInk), alpha, alphaDifference };
}
const nativeDiagnosticCells = [
  ['native-author', { lines: 'native', numbers: 'author' }],
  ['native-binary32', { lines: 'native', numbers: 'binary32' }],
  ['zero-author', { lines: 'zero-tangent', numbers: 'author' }],
  ['zero-binary32', { lines: 'zero-tangent', numbers: 'binary32' }],
  ['linear-author', { lines: 'parameter-linear', numbers: 'author' }],
  ['linear-binary32', { lines: 'parameter-linear', numbers: 'binary32' }],
];
async function diagnoseNativeRaster(testCase, raw, frame, rendered, animation) {
  assert(!testCase.request.gesture, 'Native diagnostic ограничена static pose');
  const rawPaths = [...raw.source.querySelectorAll('path')];
  assert(rawPaths.length === 1, 'Bounded native diagnostic требует один author paint path');
  const reference = referenceSvg(testCase, raw, frame, 0), surfaces = [];
  for (const [id, intervention] of nativeDiagnosticCells) {
    const svg = reference.cloneNode(true);
    svg.querySelector('path').setAttribute('d', diagnosticPath(rawPaths[0].getAttribute('d'), intervention));
    surfaces.push({ id, intervention, svg });
  }
  const clonedMaster = raw.source.documentElement.cloneNode(true);
  clonedMaster.setAttribute('viewBox', frame.join(' '));
  for (const path of clonedMaster.querySelectorAll('path')) path.style.fill = testCase.request.color ?? '#000000';
  surfaces.push({ id: 'cloned-master', svg: clonedMaster });
  if (rendered) {
    surfaces.push({ id: 'player', svg: observedSvg(rendered, animation, frame) });
    const envelope = observedSvg(rendered, animation, frame);
    const painted = [...envelope.querySelectorAll('path')].filter(path => !path.closest('defs') && path.getAttribute('fill') !== 'none');
    assert(painted.length === 1, 'Native envelope diagnostic требует один physical player paint path');
    painted[0].setAttribute('d', rawPaths[0].getAttribute('d'));
    surfaces.push({ id: 'native-player-envelope', svg: envelope });
  }
  const observations = [];
  for (const size of [16, 24, 48]) {
    const width = Math.ceil(frame[2] * size / raw.viewBox[2]), height = Math.ceil(frame[3] * size / raw.viewBox[3]);
    const expected = await pixels(reference, width, height);
    for (const { id, svg } of surfaces) observations.push({ id, size, width, height, ...diagnosticAlpha(await pixels(svg, width, height), expected) });
  }
  return { name: testCase.name, variant: testCase.request.variant ?? 'outline', masterSha256: testCase.masterSha256 ?? null,
    scope: 'static-native-raster-intervention; observations are not optical admission', frame,
    surfaces: surfaces.map(({ id, intervention, svg }) => ({ id, intervention: intervention ?? null,
      physicalPathCount: [...svg.querySelectorAll('path')].filter(path => !path.closest('defs')).length,
      serializedSvg: new XMLSerializer().serializeToString(svg) })), observations };
}
async function syntheticNativeDiagnostic() {
  // Целые endpoints и line vectors кратны 3: linear controls также целые.
  const testCase = { name: 'synthetic-integer-mixed-contour', request: { color: '#123456' },
    rawSvg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M3 15C3 14 3 13 6 12L12 6L18 12C19 13 20 14 18 15L12 9L6 15C3 18 1 17 3 15Z"/></svg>' };
  const raw = rawSource(testCase);
  return diagnoseNativeRaster(testCase, raw, raw.viewBox);
}
/** Evidence-only candidate для штатного SVG image asset; public exporter не меняется. */
export function nativeSvgAssetCandidate(sourceAnimation, svgText) {
  const animation = structuredClone(sourceAnimation), meta = animation.meta.labIcons;
  assert(animation.layers.length === 1 && animation.layers[0].ty === 4, 'SVG asset diagnostic требует один whole paint layer');
  assert(meta.logicalViewBox[0] === 0 && meta.logicalViewBox[1] === 0, 'Bounded SVG asset diagnostic требует zero-origin master');
  assert(typeof svgText === 'string' && svgText.length > 0, 'SVG asset diagnostic требует явный payload');
  const id = 'native-master-svg';
  animation.assets = [{ id, w: meta.logicalViewBox[2], h: meta.logicalViewBox[3], e: 1, u: '',
    p: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`, pr: 'xMidYMid meet' }];
  const layer = animation.layers[0];
  layer.ty = 2; layer.refId = id; delete layer.shapes;
  animation.meta.labIcons = { ...meta, profile: 'lab-icons.lottie-web.svg-asset.diagnostic.v1', sourceProfile: meta.profile };
  return animation;
}
async function observeNativeSvgAsset(testCase, sourceAnimation, { mutation } = {}) {
  const raw = rawSource(testCase), frame = referenceFrame(testCase, raw), expectedTime = referenceLottieTiming(testCase.request);
  const source = raw.source.documentElement.cloneNode(true);
  for (const path of source.querySelectorAll('path')) path.style.fill = testCase.request.color ?? '#000000';
  if (mutation === 'remove-hole') {
    const path = source.querySelector('path'), contours = path.getAttribute('d').split(/(?=M)/).filter(Boolean);
    assert(contours.length === 3, 'Mic negative control требует outer и два counter contours');
    path.setAttribute('d', contours.slice(0, -1).join(''));
  }
  const svgText = mutation === 'missing-image-ink'
    ? `<svg xmlns="${NS}" viewBox="${raw.viewBox.join(' ')}"></svg>` : new XMLSerializer().serializeToString(source);
  const animation = nativeSvgAssetCandidate(sourceAnimation, svgText);
  if (mutation === 'wrong-position') {
    assert(animation.layers[0].ks.p.a === 0, 'Wrong-position control требует static layer');
    animation.layers[0].ks.p.k[0] += 1;
  }
  const dataBeforePlayer = JSON.stringify(animation), container = document.createElement('div');
  container.style.cssText = 'position:absolute;left:-10000px;top:0'; document.body.append(container);
  let player;
  const report = { name: testCase.name, variant: testCase.request.variant, gesture: testCase.request.gesture ?? null,
    mutation: mutation ?? null, profile: animation.meta.labIcons.profile, sourceProfile: animation.meta.labIcons.sourceProfile,
    scope: 'stock lottie-web 5.13.0 SVG image asset experiment; not bezier editability or native/dotLottie admission',
    masterSha256: testCase.masterSha256, animation: JSON.parse(dataBeforePlayer), frame, observations: [], complete: false };
  try {
    player = window.lottie.loadAnimation({ container, animationData: animation, renderer: 'svg', loop: false, autoplay: false,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet', imagePreserveAspectRatio: 'xMidYMid meet' } });
    await new Promise((resolve, reject) => {
      let domLoaded = player.isLoaded === true, imagesLoaded = false;
      const finish = error => {
        clearTimeout(timer); player.removeEventListener('DOMLoaded', onDom); player.removeEventListener('loaded_images', onImages);
        player.removeEventListener('data_failed', onFailure); error ? reject(error) : resolve();
      };
      const check = () => { if (domLoaded && imagesLoaded) finish(); };
      const onDom = () => { domLoaded = true; check(); }, onImages = () => { imagesLoaded = true; check(); };
      const onFailure = () => finish(new Error('SVG asset diagnostic: data_failed'));
      const timer = setTimeout(() => finish(new Error(`SVG asset load timeout: DOMLoaded=${domLoaded}, loaded_images=${imagesLoaded}`)), 3000);
      player.addEventListener('DOMLoaded', onDom); player.addEventListener('loaded_images', onImages); player.addEventListener('data_failed', onFailure);
    });
    const rendered = container.querySelector('svg'), imageNodes = [...rendered.querySelectorAll('image')].filter(node => !node.closest('defs'));
    assert(imageNodes.length === 1, 'SVG asset diagnostic требует один physical image');
    const href = imageNodes[0].getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? imageNodes[0].getAttribute('href');
    assert(href === animation.assets[0].p, 'Player image href обязан сохранить payload');
    const decoded = new Image(); decoded.src = href; await decoded.decode();
    assert(decoded.naturalWidth > 0 && decoded.naturalHeight > 0, 'SVG asset href не декодирован');
    report.loaded = { domLoaded: true, loadedImages: true, hrefDecoded: true, naturalWidth: decoded.naturalWidth, naturalHeight: decoded.naturalHeight };
    const phases = expectedTime.terminalFrame ? [0, 0.25, 0.5, 0.75, 1] : [0];
    for (const fraction of phases) {
      const t = expectedTime.terminalFrame * fraction, progress = testCase.request.gesture
        ? expectedTime.from + (expectedTime.to - expectedTime.from) * fraction : 0;
      player.goToAndStop(t, true);
      const actual = observedSvg(container.querySelector('svg'), animation, frame), reference = referenceSvg(testCase, raw, frame, progress);
      for (const size of [16, 24, 48]) {
        const width = Math.ceil(frame[2] * size / raw.viewBox[2]), height = Math.ceil(frame[3] * size / raw.viewBox[3]);
        const observation = diagnosticAlpha(await pixels(actual, width, height), await pixels(reference, width, height));
        report.observations.push({ t, fraction, progress, size, width, height, ...observation });
      }
      (report.surfaces ??= []).push({ t, progress, physicalImageCount: 1, physicalPathCount: [...actual.querySelectorAll('path')].filter(node => !node.closest('defs')).length,
        serializedSvg: new XMLSerializer().serializeToString(actual), referenceSvg: new XMLSerializer().serializeToString(reference) });
    }
    if (expectedTime.terminalFrame) {
      await new Promise((resolve, reject) => {
        const onComplete = () => { clearTimeout(timer); player.removeEventListener('complete', onComplete); resolve(); };
        const timer = setTimeout(() => { player.removeEventListener('complete', onComplete); reject(new Error('SVG asset completion timeout')); }, 3000);
        player.addEventListener('complete', onComplete); player.goToAndStop(0, true); player.setSpeed(100); player.play();
      });
      assert(player.currentFrame === expectedTime.terminalFrame, 'SVG asset natural completion теряет terminal hold');
      report.naturalCompletion = { frame: player.currentFrame, expectedTerminalFrame: expectedTime.terminalFrame };
    }
    report.nonempty = report.observations.every(row => row.actualInk > 0);
    report.pass = report.nonempty && report.observations.every(row => row.pass);
    report.complete = true;
  } catch (error) { report.error = error.message; report.pass = false; }
  finally { if (player?.renderer) player.destroy(); container.remove(); }
  return report;
}
async function runNativeSvgAssetDiagnostics(create, testCases) {
  const select = (name, variant, gesture) => testCases.find(item => item.name === name && item.request.variant === variant &&
    (item.request.gesture ?? null) === gesture);
  const chevron = select('chevron-up', 'outline', null), mic = select('mic-circle', 'filled', null), nudge = select('chevron-up', 'outline', 'chevron-up.nudge');
  assert(chevron && mic && nudge, 'SVG asset experiment требует две статики и полный direction.nudge interval');
  const exportSource = testCase => {
    const result = create(testCase.name, testCase.request); assert(result.ok, 'SVG asset experiment: source export refused'); return result.animation;
  };
  const cases = [];
  for (const testCase of [chevron, mic, nudge]) cases.push(await observeNativeSvgAsset(testCase, exportSource(testCase)));
  const negativeControls = [];
  if (cases.every(testCase => testCase.complete && testCase.nonempty)) {
    for (const [mutation, testCase] of [['missing-image-ink', chevron], ['wrong-position', chevron], ['remove-hole', mic]]) {
      const observed = await observeNativeSvgAsset(testCase, exportSource(testCase), { mutation });
      negativeControls.push({ mutation, detected: observed.complete && !observed.pass, ...observed });
    }
  }
  return { player: window.lottie.version, cases, negativeControls, complete: cases.every(testCase => testCase.complete),
    pass: cases.every(testCase => testCase.pass) && negativeControls.length === 3 && negativeControls.every(control => control.detected) };
}
export async function runLottieRenderCases(create, testCases, { controls = true, visible = true } = {}) {
  assert(window.lottie?.version === '5.13.0', 'Нужен pinned lottie-web 5.13.0 SVG player.');
  const rows = [], nativeDiagnostics = [];
  const gallery = document.createElement('div');
  if (visible) gallery.id = 'lottie-gallery';
  else gallery.style.cssText = 'position:absolute;left:-10000px;top:0';
  document.body.append(gallery);
  try {
  for (const testCase of testCases) {
    const exported = create(testCase.name, testCase.request);
    assert(exported.ok, `${testCase.name}: ${exported.reason?.code}`);
    const animation = exported.animation, before = JSON.stringify(animation), meta = animation.meta.labIcons;
    const expectedTime = referenceLottieTiming(testCase.request), raw = rawSource(testCase), frame = referenceFrame(testCase, raw), rawViewBox = raw.viewBox;
    assert(meta.masterSha256 === testCase.masterSha256, `${testCase.name}: master identity drift`);
    assert(JSON.stringify(meta.logicalViewBox) === JSON.stringify(rawViewBox), `${testCase.name}: raw viewBox drift`);
    assert(meta.terminalFrame === expectedTime.terminalFrame && meta.from === expectedTime.from && meta.to === expectedTime.to, `${testCase.name}: request timing drift`);
    const card = document.createElement('section'); card.style.cssText = 'display:inline-grid;gap:8px;vertical-align:top;margin:12px';
    const label = document.createElement('div'); label.textContent = `${testCase.name}/${testCase.request.variant ?? 'outline'} · ${testCase.request.gesture ?? 'static'}`;
    const container = document.createElement('div'); container.style.cssText = `width:${animation.w * 2}px;height:${animation.h * 2}px`;
    card.append(label, container); gallery.append(card);
    const player = window.lottie.loadAnimation({ container, animationData: animation, renderer: 'svg', loop: false, autoplay: false,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' } });
    try {
      await new Promise((resolve, reject) => {
        if (player.isLoaded) { resolve(); return; }
        const timer = setTimeout(() => reject(new Error('Lottie DOMLoaded timeout')), 3000);
        player.addEventListener('DOMLoaded', () => { clearTimeout(timer); resolve(); });
        player.addEventListener('data_failed', () => { clearTimeout(timer); reject(new Error('Lottie data_failed')); });
      });
      const phases = testCase.annotation?.gesture?.law === 'direction.nudge' ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];
      for (const stop of translationStops(testCase.annotation)) {
        const peak = (stop - expectedTime.from) / (expectedTime.to - expectedTime.from);
        if (peak > 0 && peak < 1) phases.push(peak);
      }
      for (const t of [...new Set(phases.map(fraction => expectedTime.terminalFrame * fraction))].sort((a, b) => a - b)) {
        player.goToAndStop(t, true);
        const fraction = expectedTime.terminalFrame ? t / expectedTime.terminalFrame : 1;
        const progress = testCase.request.gesture ? expectedTime.from + (expectedTime.to - expectedTime.from) * fraction : 0;
        const reference = referenceSvg(testCase, raw, frame, progress);
        const canonicalReference = referenceSvg(testCase, raw, frame, progress, true);
        const rawPartIds = [...raw.source.querySelectorAll('path')].map((_, index) =>
          testCase.annotation?.parts.find(part => part.pathIndex === index)?.id);
        const expectedEmpty = referenceLottieEmptyPose(testCase.annotation, rawPartIds, testCase.request.gesture, progress);
        const rendered = container.querySelector('svg'); assert(rendered, 'SVG player ничего не нарисовал');
        for (const size of [16, 24, 48]) {
          const width = Math.ceil(frame[2] * size / rawViewBox[2]), height = Math.ceil(frame[3] * size / rawViewBox[3]);
          const renderedPixels = await pixels(observedSvg(rendered, animation, frame), width, height);
          const nativeRaster = compareLottiePixels(renderedPixels, await pixels(reference, width, height), { expectedEmpty });
          const observation = compareLottiePixels(renderedPixels, await pixels(canonicalReference, width, height), { expectedEmpty });
          rows.push({ name: testCase.name, variant: testCase.request.variant ?? 'outline', gesture: testCase.request.gesture ?? null, t, size, ...observation, nativeRaster });
          if (!observation.pass) {
            window.__lottieFailure = { rows, rendered: rendered.outerHTML, reference: reference.outerHTML, animation };
            if (!card.dataset.reference) {
              reference.style.width = `${animation.w * 2}px`; reference.style.height = `${animation.h * 2}px`;
              card.append(reference); card.dataset.reference = 'true';
            }
          }
        }
      }
      if (controls && !testCase.request.gesture &&
          (testCase.name === 'chevron-up' && testCase.request.variant === 'outline' || testCase.name === 'mic-circle' && testCase.request.variant === 'filled')) {
        nativeDiagnostics.push(await diagnoseNativeRaster(testCase, raw, frame, container.querySelector('svg'), animation));
      }
      if (expectedTime.terminalFrame) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Lottie completion timeout')), 3000);
          player.addEventListener('complete', () => { clearTimeout(timer); resolve(); });
          player.goToAndStop(0, true); player.setSpeed(100); player.play();
        });
        assert(player.currentFrame === expectedTime.terminalFrame, `natural completion=${player.currentFrame}, terminal=${expectedTime.terminalFrame}`);
      }
      assert(JSON.stringify(create(testCase.name, testCase.request).animation) === before, 'Player изменил следующий export.');
      // Сохраняется независимый SVG snapshot для ручного просмотра; player освобождается.
      const snapshot = container.querySelector('svg').cloneNode(true);
      player.destroy();
      container.style.cssText = 'display:flex;align-items:end;gap:12px;width:auto;height:auto';
      for (const size of [16, 24, 48]) {
        const sample = snapshot.cloneNode(true);
        sample.style.width = `${animation.w * size / meta.logicalViewBox[2]}px`;
        sample.style.height = `${animation.h * size / meta.logicalViewBox[3]}px`;
        sample.setAttribute('aria-label', `${size}px Lottie`); container.append(sample);
      }
      const authored = referenceSvg(testCase, raw, [-meta.offset[0], -meta.offset[1], animation.w, animation.h], testCase.request.gesture ? expectedTime.to : 0);
      authored.style.width = `${animation.w * 2}px`; authored.style.height = `${animation.h * 2}px`;
      authored.setAttribute('aria-label', '48px author SVG'); container.append(authored);
    } finally { if (player.renderer) player.destroy(); }
  }
  // Negative controls не проходят даже при сдвиге небольшого fragment/hole.
  const expected = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]);
  assert(!compareLottiePixels(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]), expected).pass, 'Pixel oracle допускает другую форму.');
  assert(rows.every(row => row.pass), `raster mismatches: ${rows.filter(row => !row.pass).length}/${rows.length}; ${JSON.stringify(rows.filter(row => !row.pass).slice(0, 2))}`);
  const negativeControls = controls ? await runLottieNegativeControls(create, testCases) : [];
  if (controls) {
    assert(nativeDiagnostics.length === 2, 'Нужны оба объявленных real native diagnostic cases');
    nativeDiagnostics.push(await syntheticNativeDiagnostic());
  }
  const nativeSvgAssetDiagnostics = controls ? await runNativeSvgAssetDiagnostics(create, testCases) : null;
  return { player: window.lottie.version, rows, negativeControls, nativeDiagnostics, nativeSvgAssetDiagnostics, complete: true };
  } finally { if (!visible) gallery.remove(); }
}

async function runLottieNegativeControls(create, testCases) {
  const rotating = testCases.find(item => item.name === 'reload' && item.request.variant === 'outline' && item.request.gesture === 'reload.cycle');
  const countershape = testCases.find(item => item.name === 'chatbubble-ellipses' && item.request.variant === 'outline' && !item.request.gesture);
  const nudging = testCases.find(item => item.name === 'arrow-forward' && item.request.variant === 'outline' && item.request.gesture === 'arrow-forward.nudge');
  const ringing = testCases.find(item => item.name === 'notifications' && item.request.variant === 'outline' && item.request.gesture === 'notifications.ring');
  const compound = testCases.find(item => item.name === 'mic-circle' && item.request.variant === 'filled' && !item.request.gesture);
  assert(rotating && countershape && nudging && ringing && compound, 'Нужны реальные cycle, countershape, nudge, ring и compound controls.');
  const counterId = compound.annotation.parts.find(part => part.role === 'counter')?.id;
  assert(counterId, 'Compound control требует объявленного авторского counter.');
  const cycle = { ...rotating, request: { ...rotating.request, duration: 1000, frameRate: 60, from: 0.17, to: 0.73 } };
  const reverse = { ...cycle, request: { ...cycle.request, from: 0.73, to: 0.17 } };
  const reduced = { ...reverse, request: { ...reverse.request, reducedMotion: true } };
  const nudge = { ...nudging, request: { ...nudging.request, duration: 1000, frameRate: 60, from: 0.17, to: 0.73 } };
  const nudgeReverse = { ...nudge, request: { ...nudge.request, from: 0.73, to: 0.17 } };
  const nudgeReduced = { ...nudgeReverse, request: { ...nudgeReverse.request, to: 0.37, reducedMotion: true } };
  const nudgeNoop = { ...nudge, request: { ...nudge.request, from: 0.37, to: 0.37 } };
  await runLottieRenderCases(create, [cycle, countershape, compound, reverse, reduced, nudge, nudgeReverse, nudgeReduced, nudgeNoop], { controls: false, visible: false });
  const mutants = [
    ['geometry', cycle, animation => { animation.layers[0].shapes.find(shape => shape.ty === 'sh').ks.k.v[0][0] += 1; }, /raster mismatches/],
    ['anchor', cycle, animation => { const layer = animation.layers.find(layer => layer.ks.r.a); layer.ks.a.k[0] += 1; layer.ks.p.k[0] += 1; }, /raster mismatches/],
    ['fill-countershape', countershape, animation => { const layer = animation.layers.find(layer => layer.shapes.filter(shape => shape.ty === 'sh').length > 1); layer.shapes.splice(layer.shapes.findLastIndex(shape => shape.ty === 'sh'), 1); }, /raster mismatches/],
    ['compound-hole', compound, animation => {
      for (const layer of animation.layers) layer.shapes = layer.shapes.filter(shape => shape.ty !== 'sh' || shape.nm !== counterId);
    }, /raster mismatches/],
    ['compound-fill-scopes', compound, animation => {
      // Сохраняет все контуры и цвет, но намеренно нарушает единого paint owner.
      animation.layers = animation.layers.flatMap(layer => {
        const fill = layer.shapes.find(shape => shape.ty === 'fl');
        return layer.shapes.filter(shape => shape.ty === 'sh').map(shape => ({
          ...layer, nm: shape.nm, shapes: [shape, structuredClone(fill)],
        }));
      }).map((layer, index) => ({ ...layer, ind: index + 1 }));
    }, /raster mismatches/],
    ['terminal-hold', cycle, animation => { animation.op -= 1; for (const layer of animation.layers) layer.op -= 1; }, /natural completion=59, terminal=60/],
    ['canvas-crop', cycle, animation => { animation.w = Math.floor(animation.w / 2); }, /raster mismatches/],
    ['nudge-axis', nudge, animation => { const position = animation.layers.find(layer => layer.ks.p.a).ks.p; for (const keyframe of position.k) [keyframe.s[0], keyframe.s[1]] = [keyframe.s[1], keyframe.s[0]]; }, /raster mismatches/],
    ['nudge-interior-peak', nudge, animation => { const position = animation.layers.find(layer => layer.ks.p.a).ks.p; position.k.splice(1, position.k.length - 2); }, /raster mismatches/],
    ['nudge-canvas-crop', nudge, animation => { animation.w = Math.floor(animation.w / 2); }, /raster mismatches/],
    ['ring-idle-clapper', ringing, animation => {
      const layer = animation.layers.find(layer => layer.ks.p.a);
      layer.ks.p = { a: 0, k: layer.ks.p.k[0].s.slice() };
    }, /raster mismatches/],
    ['ring-wrong-part', ringing, animation => {
      const moving = animation.layers.find(layer => layer.ks.p.a), enclosure = animation.layers.find(layer => !layer.ks.p.a);
      enclosure.ks.p = moving.ks.p;
      moving.ks.p = { a: 0, k: moving.ks.p.k[0].s.slice() };
    }, /raster mismatches/],
    ['ring-interior-extrema', ringing, animation => {
      const position = animation.layers.find(layer => layer.ks.p.a).ks.p;
      position.k.splice(1, position.k.length - 2);
    }, /raster mismatches/],
  ];
  const receipt = [];
  for (const [id, testCase, mutate, expectedFailure] of mutants) {
    let failure;
    try {
      await runLottieRenderCases((name, request) => {
        const result = create(name, request);
        assert(result.ok, `control ${id}: producer refusal`);
        mutate(result.animation); return result;
      }, [testCase], { controls: false, visible: false });
    } catch (error) { failure = error.message; }
    assert(failure && expectedFailure.test(failure), `control ${id} не обнаружил предметный дефект: ${failure ?? 'PASS'}`);
    receipt.push({ id, detected: true, failure: failure.split(';')[0] });
  }
  delete window.__lottieFailure;
  return receipt;
}
