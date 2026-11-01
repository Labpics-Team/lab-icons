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
function expectedOpacity(declaration, id, gesture, progress) {
  if (!declaration || !gesture) return 1;
  const law = declaration.gesture;
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
function referenceSvg(testCase, animation, progress, canonical = false) {
  const meta = animation.meta.labIcons;
  const source = new DOMParser().parseFromString(testCase.rawSvg, 'image/svg+xml');
  assert(!source.querySelector('parsererror'), `${testCase.name}: raw SVG не прочитан`);
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${animation.w} ${animation.h}`);
  const root = document.createElementNS(NS, 'g');
  root.setAttribute('transform', `translate(${meta.offset.join(' ')})`);
  svg.append(root);
  for (const [index, sourcePath] of [...source.querySelectorAll('path')].entries()) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', canonical ? canonicalCubicPath(sourcePath.getAttribute('d')) : sourcePath.getAttribute('d'));
    path.setAttribute('fill-rule', sourcePath.getAttribute('fill-rule') ?? 'nonzero');
    path.setAttribute('fill', testCase.request.color ?? '#000000');
    const part = testCase.annotation?.parts.find(item => item.pathIndex === index);
    path.setAttribute('opacity', String(expectedOpacity(testCase.annotation, part?.id, testCase.request.gesture, progress)));
    if (testCase.annotation?.gesture.law === 'cycle.clockwise' && testCase.annotation.gesture.partId === part?.id && testCase.request.gesture) {
      const viewBox = meta.logicalViewBox;
      path.setAttribute('transform', `rotate(${progress * 360} ${viewBox[0] + part.anchor[0] * viewBox[2]} ${viewBox[1] + part.anchor[1] * viewBox[3]})`);
    }
    root.append(path);
  }
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
export function compareLottiePixels(actual, expected) {
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
    pass: referenceInk > 0 && relativeInkError <= 0.001 && maxAlphaError <= 4 && relativeColorError <= 0.001 && maxColorError <= 4 };
}
export async function runLottieRenderCases(create, testCases) {
  assert(window.lottie?.version === '5.13.0', 'Нужен pinned lottie-web 5.13.0 SVG player.');
  const rows = [];
  const gallery = document.createElement('div'); gallery.id = 'lottie-gallery'; document.body.append(gallery);
  for (const testCase of testCases) {
    const exported = create(testCase.name, testCase.request);
    assert(exported.ok, `${testCase.name}: ${exported.reason?.code}`);
    const animation = exported.animation, before = JSON.stringify(animation), meta = animation.meta.labIcons;
    assert(meta.masterSha256 === testCase.masterSha256, `${testCase.name}: master identity drift`);
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
      for (const t of [...new Set([0, meta.terminalFrame / 2, meta.terminalFrame])]) {
        player.goToAndStop(t, true);
        const fraction = meta.terminalFrame ? t / meta.terminalFrame : 1;
        const progress = testCase.request.gesture ? meta.from + (meta.to - meta.from) * fraction : 0;
        const reference = referenceSvg(testCase, animation, progress);
        const canonicalReference = referenceSvg(testCase, animation, progress, true);
        const rendered = container.querySelector('svg'); assert(rendered, 'SVG player ничего не нарисовал');
        for (const size of [16, 24, 48]) {
          const width = Math.ceil(animation.w * size / meta.logicalViewBox[2]), height = Math.ceil(animation.h * size / meta.logicalViewBox[3]);
          const renderedPixels = await pixels(rendered, width, height);
          const nativeRaster = compareLottiePixels(renderedPixels, await pixels(reference, width, height));
          const observation = compareLottiePixels(renderedPixels, await pixels(canonicalReference, width, height));
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
      if (meta.terminalFrame) {
        await new Promise((resolve, reject) => {
          const timer = setTimeout(() => reject(new Error('Lottie completion timeout')), 3000);
          player.addEventListener('complete', () => { clearTimeout(timer); resolve(); });
          player.goToAndStop(0, true); player.setSpeed(100); player.play();
        });
        assert(player.currentFrame === meta.terminalFrame, `natural completion=${player.currentFrame}, terminal=${meta.terminalFrame}`);
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
      const authored = referenceSvg(testCase, animation, testCase.request.gesture ? meta.to : 0);
      authored.style.width = `${animation.w * 2}px`; authored.style.height = `${animation.h * 2}px`;
      authored.setAttribute('aria-label', '48px author SVG'); container.append(authored);
    } finally { if (player.renderer) player.destroy(); }
  }
  // Negative controls не проходят даже при сдвиге небольшого fragment/hole.
  const expected = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 0]);
  assert(!compareLottiePixels(new Uint8ClampedArray([0, 0, 0, 0, 0, 0, 0, 255]), expected).pass, 'Pixel oracle допускает другую форму.');
  assert(rows.every(row => row.pass), `raster mismatches: ${rows.filter(row => !row.pass).length}/${rows.length}; ${JSON.stringify(rows.filter(row => !row.pass).slice(0, 2))}`);
  return { player: window.lottie.version, rows, complete: true };
}
