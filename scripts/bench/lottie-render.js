const NS = 'http://www.w3.org/2000/svg';
const assert = (condition, message) => { if (!condition) throw new Error(`Lottie render: ${message}`); };
/** Независимый oracle читает raw author commands; target parser сюда не импортируется. */
export function canonicalCubicPath(d) {
  const tokens = d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  let index = 0, command, cursor = [0, 0], start, output = '';
  const number = () => {
    const value = Number(tokens[index++]); assert(Number.isFinite(value), 'raw command содержит нечисловую координату'); return value;
  };
  const coordinates = point => point.map(Math.fround).join(' ');
  const curve = (a, b, end) => { output += `C${coordinates(a)} ${coordinates(b)} ${coordinates(end)}`; cursor = end; };
  while (index < tokens.length) {
    if (/^[a-zA-Z]$/.test(tokens[index])) command = tokens[index++];
    assert(command && !command.match(/[a-z]/), 'Independent raw oracle требует absolute author commands.');
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
  if (!declaration) return [];
  const law = declaration.gesture.law;
  if (law === 'cycle.clockwise') return [`${name}.cycle`];
  if (law === 'signal.levels') return [`${name}.level`];
  if (law === 'activity.triad') return [`${name}.activity`, `${name}.idle`];
  if (law === 'direction.nudge') return [`${name}.nudge`];
  if (law === 'confirmation.presence') return [`${name}.presence`];
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
  return { source, viewBox };
}
function referenceFrame(testCase) {
  const { source, viewBox } = rawSource(testCase);
  const time = referenceLottieTiming(testCase.request);
  let minX = viewBox[0], minY = viewBox[1], maxX = minX + viewBox[2], maxY = minY + viewBox[3];
  for (const [index, path] of [...source.querySelectorAll('path')].entries()) {
    const values = canonicalCubicPath(path.getAttribute('d')).match(/[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g).map(Number);
    const points = Array.from({ length: values.length / 2 }, (_, index) => values.slice(index * 2, index * 2 + 2));
    const part = testCase.annotation?.parts.find(item => item.pathIndex === index);
    if (testCase.request.gesture && testCase.annotation?.gesture.law === 'cycle.clockwise' && testCase.annotation.gesture.partId === part?.id) {
      const pivot = [viewBox[0] + part.anchor[0] * viewBox[2], viewBox[1] + part.anchor[1] * viewBox[3]];
      const radius = Math.max(...points.map(point => Math.hypot(point[0] - pivot[0], point[1] - pivot[1])));
      minX = Math.min(minX, pivot[0] - radius); minY = Math.min(minY, pivot[1] - radius);
      maxX = Math.max(maxX, pivot[0] + radius); maxY = Math.max(maxY, pivot[1] + radius);
    } else {
      const phases = time.terminalFrame ? [time.from, time.to, ...(Math.min(time.from, time.to) < 0.5 && Math.max(time.from, time.to) > 0.5 ? [0.5] : [])] : [time.to];
      const offsets = phases.map(progress => referenceNudgeTranslation(testCase.annotation, part?.id, testCase.request.gesture, progress, viewBox));
      for (const point of points) for (const translation of offsets) {
        minX = Math.min(minX, point[0] + translation[0]); minY = Math.min(minY, point[1] + translation[1]);
        maxX = Math.max(maxX, point[0] + translation[0]); maxY = Math.max(maxY, point[1] + translation[1]);
      }
    }
  }
  // Область наблюдения принадлежит raw master. Cropped target не обрезает oracle.
  return [Math.floor(minX), Math.floor(minY), Math.ceil(maxX) - Math.floor(minX), Math.ceil(maxY) - Math.floor(minY)];
}
function referenceSvg(testCase, frame, progress, canonical = false) {
  const { source, viewBox } = rawSource(testCase);
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
    if (testCase.annotation?.gesture.law === 'cycle.clockwise' && testCase.annotation.gesture.partId === part?.id && testCase.request.gesture) {
      path.setAttribute('transform', `rotate(${progress * 360} ${viewBox[0] + part.anchor[0] * viewBox[2]} ${viewBox[1] + part.anchor[1] * viewBox[3]})`);
    } else if (testCase.annotation?.gesture.law === 'direction.nudge' && testCase.annotation.gesture.partId === part?.id && testCase.request.gesture) {
      const translation = referenceNudgeTranslation(testCase.annotation, part.id, testCase.request.gesture, progress, viewBox);
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
export async function runLottieRenderCases(create, testCases, { controls = true, visible = true } = {}) {
  assert(window.lottie?.version === '5.13.0', 'Нужен pinned lottie-web 5.13.0 SVG player.');
  const rows = [];
  const gallery = document.createElement('div');
  if (visible) gallery.id = 'lottie-gallery';
  else gallery.style.cssText = 'position:absolute;left:-10000px;top:0';
  document.body.append(gallery);
  try {
  for (const testCase of testCases) {
    const exported = create(testCase.name, testCase.request);
    assert(exported.ok, `${testCase.name}: ${exported.reason?.code}`);
    const animation = exported.animation, before = JSON.stringify(animation), meta = animation.meta.labIcons;
    const expectedTime = referenceLottieTiming(testCase.request), frame = referenceFrame(testCase), rawViewBox = rawSource(testCase).viewBox;
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
      const phases = testCase.annotation?.gesture.law === 'direction.nudge' ? [0, 0.25, 0.5, 0.75, 1] : [0, 0.5, 1];
      if (testCase.annotation?.gesture.law === 'direction.nudge' && expectedTime.from !== expectedTime.to) {
        const peak = (0.5 - expectedTime.from) / (expectedTime.to - expectedTime.from);
        if (peak > 0 && peak < 1) phases.push(peak);
      }
      for (const t of [...new Set(phases.map(fraction => expectedTime.terminalFrame * fraction))].sort((a, b) => a - b)) {
        player.goToAndStop(t, true);
        const fraction = expectedTime.terminalFrame ? t / expectedTime.terminalFrame : 1;
        const progress = testCase.request.gesture ? expectedTime.from + (expectedTime.to - expectedTime.from) * fraction : 0;
        const reference = referenceSvg(testCase, frame, progress);
        const canonicalReference = referenceSvg(testCase, frame, progress, true);
        const rawPartIds = [...rawSource(testCase).source.querySelectorAll('path')].map((_, index) =>
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
      const authored = referenceSvg(testCase, [-meta.offset[0], -meta.offset[1], animation.w, animation.h], testCase.request.gesture ? expectedTime.to : 0);
      authored.style.width = `${animation.w * 2}px`; authored.style.height = `${animation.h * 2}px`;
      authored.setAttribute('aria-label', '48px author SVG'); container.append(authored);
    } finally { if (player.renderer) player.destroy(); }
  }
  // Negative controls не проходят даже при сдвиге небольшого fragment/hole.
  const expected = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]);
  assert(!compareLottiePixels(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]), expected).pass, 'Pixel oracle допускает другую форму.');
  assert(rows.every(row => row.pass), `raster mismatches: ${rows.filter(row => !row.pass).length}/${rows.length}; ${JSON.stringify(rows.filter(row => !row.pass).slice(0, 2))}`);
  const negativeControls = controls ? await runLottieNegativeControls(create, testCases) : [];
  return { player: window.lottie.version, rows, negativeControls, complete: true };
  } finally { if (!visible) gallery.remove(); }
}

async function runLottieNegativeControls(create, testCases) {
  const rotating = testCases.find(item => item.name === 'reload' && item.request.variant === 'outline' && item.request.gesture === 'reload.cycle');
  const countershape = testCases.find(item => item.name === 'chatbubble-ellipses' && item.request.variant === 'outline' && !item.request.gesture);
  const nudging = testCases.find(item => item.name === 'arrow-forward' && item.request.variant === 'outline' && item.request.gesture === 'arrow-forward.nudge');
  assert(rotating && countershape && nudging, 'Нужны реальные cycle, countershape и nudge controls.');
  const cycle = { ...rotating, request: { ...rotating.request, duration: 1000, frameRate: 60, from: 0.17, to: 0.73 } };
  const reverse = { ...cycle, request: { ...cycle.request, from: 0.73, to: 0.17 } };
  const reduced = { ...reverse, request: { ...reverse.request, reducedMotion: true } };
  const nudge = { ...nudging, request: { ...nudging.request, duration: 1000, frameRate: 60, from: 0.17, to: 0.73 } };
  const nudgeReverse = { ...nudge, request: { ...nudge.request, from: 0.73, to: 0.17 } };
  const nudgeReduced = { ...nudgeReverse, request: { ...nudgeReverse.request, to: 0.37, reducedMotion: true } };
  const nudgeNoop = { ...nudge, request: { ...nudge.request, from: 0.37, to: 0.37 } };
  await runLottieRenderCases(create, [cycle, countershape, reverse, reduced, nudge, nudgeReverse, nudgeReduced, nudgeNoop], { controls: false, visible: false });
  const mutants = [
    ['geometry', cycle, animation => { animation.layers[0].shapes.find(shape => shape.ty === 'sh').ks.k.v[0][0] += 1; }, /raster mismatches/],
    ['anchor', cycle, animation => { const layer = animation.layers.find(layer => layer.ks.r.a); layer.ks.a.k[0] += 1; layer.ks.p.k[0] += 1; }, /raster mismatches/],
    ['fill-countershape', countershape, animation => { const layer = animation.layers.find(layer => layer.shapes.filter(shape => shape.ty === 'sh').length > 1); layer.shapes.splice(layer.shapes.findLastIndex(shape => shape.ty === 'sh'), 1); }, /raster mismatches/],
    ['terminal-hold', cycle, animation => { animation.op -= 1; for (const layer of animation.layers) layer.op -= 1; }, /natural completion=59, terminal=60/],
    ['canvas-crop', cycle, animation => { animation.w = Math.floor(animation.w / 2); }, /raster mismatches/],
    ['nudge-axis', nudge, animation => { const position = animation.layers.find(layer => layer.ks.p.a).ks.p; for (const keyframe of position.k) [keyframe.s[0], keyframe.s[1]] = [keyframe.s[1], keyframe.s[0]]; }, /raster mismatches/],
    ['nudge-interior-peak', nudge, animation => { const position = animation.layers.find(layer => layer.ks.p.a).ks.p; position.k.splice(1, position.k.length - 2); }, /raster mismatches/],
    ['nudge-canvas-crop', nudge, animation => { animation.w = Math.floor(animation.w / 2); }, /raster mismatches/],
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
