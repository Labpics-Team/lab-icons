import { canonicalCubicPath } from './lottie-render.js';

const NS = 'http://www.w3.org/2000/svg';
const assert = (value, message) => { if (!value) throw new Error(message); };
const scale = 4;

async function raster(svg, frame) {
  const width = Math.ceil(frame[2] * scale), height = Math.ceil(frame[3] * scale);
  svg.setAttribute('viewBox', frame.join(' ')); svg.setAttribute('width', width); svg.setAttribute('height', height);
  const bitmap = new Image(); bitmap.src = 'data:image/svg+xml,' + encodeURIComponent(new XMLSerializer().serializeToString(svg));
  await bitmap.decode(); const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const context = canvas.getContext('2d'); context.drawImage(bitmap, 0, 0, width, height);
  return context.getImageData(0, 0, width, height).data;
}

export function compareSymbolPixels(actual, expected) {
  assert(actual.length === expected.length, 'Pixel dimensions differ');
  let total = 0, maximum = 0, colorError = 0, colorMaximum = 0, alpha = 0, expectedAlpha = 0, ink = 0, expectedInk = 0;
  for (let i = 0; i < actual.length; i += 4) {
    const a = actual[i + 3], e = expected[i + 3], delta = Math.abs(a - e);
    total += delta; maximum = Math.max(maximum, delta); ink += a; expectedInk += e;
    alpha = Math.max(alpha, a); expectedAlpha = Math.max(expectedAlpha, e);
    for (let c = 0; c < 3; c++) {
      const difference = Math.abs(actual[i + c] * a - expected[i + c] * e) / 255;
      colorError += difference; colorMaximum = Math.max(colorMaximum, difference);
    }
  }
  // Normalize by a fixed logical icon area, never by the exporter's canvas.
  return { mean: total / (24 * scale) ** 2, maximum, colorMean: colorError / (3 * (24 * scale) ** 2),
    colorMaximum, alpha, expectedAlpha, ink, expectedInk };
}

export function acceptsSymbolPixels(row, tolerance) {
  return row.mean < tolerance && row.maximum <= 32 && row.colorMean < tolerance && row.colorMaximum <= 32 &&
    Math.abs(row.alpha - row.expectedAlpha) <= 1 && (row.expectedInk === 0 ? row.ink === 0 : row.ink > 0);
}

function observationFrame(svg) {
  const box = svg.getBBox();
  const x = Math.floor(Math.min(0, box.x) - 2), y = Math.floor(Math.min(0, box.y) - 2);
  return [x, y, Math.ceil(Math.max(24, box.x + box.width) + 2) - x, Math.ceil(Math.max(24, box.y + box.height) + 2) - y];
}

function observedPlayer(playerSvg, animation) {
  const svg = document.createElementNS(NS, 'svg'), nested = playerSvg.cloneNode(true);
  nested.removeAttribute('style'); nested.setAttribute('x', -animation.meta.labIcons.offset[0]); nested.setAttribute('y', -animation.meta.labIcons.offset[1]);
  nested.setAttribute('width', animation.w); nested.setAttribute('height', animation.h); nested.setAttribute('overflow', 'hidden');
  svg.append(nested); return svg;
}

function authoredSvg(raw, color) {
  const source = new DOMParser().parseFromString(raw, 'image/svg+xml');
  assert(!source.querySelector('parsererror'), 'Invalid author SVG');
  const svg = document.createElementNS(NS, 'svg');
  for (const original of source.querySelectorAll('path')) {
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', canonicalCubicPath(original.getAttribute('d')));
    path.setAttribute('fill-rule', original.getAttribute('fill-rule') ?? 'nonzero'); path.setAttribute('fill', color); svg.append(path);
  }
  assert(svg.childElementCount > 0, 'Author SVG is empty'); return svg;
}

function canonicalSvg(source) {
  const svg = source.cloneNode(true);
  // Lottie materializes binary32 cubic vertices. Compare the same line locus
  // in that representation: native SVG L versus degenerate C can rasterize
  // differently across Skia platforms even when the author comparison is exact.
  // A live stroke guide keeps its original length parametrization: converting
  // it changes the browser's dash-length approximation during draw.
  for (const path of svg.querySelectorAll('path')) if (path.hasAttribute('d') && (!path.hasAttribute('stroke') || path.getAttribute('stroke') === 'none')) {
    path.setAttribute('d', canonicalCubicPath(path.getAttribute('d')));
  }
  return svg;
}

function waitFor(player, event, action) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Lottie ' + event + ' timeout')), 3000);
    player.addEventListener(event, () => { clearTimeout(timer); resolve(); });
    player.addEventListener('data_failed', () => { clearTimeout(timer); reject(new Error('Lottie data_failed')); });
    action?.();
  });
}

export async function runSymbolLottieCases({ lottie, icons, exportLottie, cases, corpus, mutation, effectMembership = [] }) {
  assert(lottie.version === '5.13.0', 'Unexpected Lottie player version');
  assert(cases.length > 0, 'No selected Lottie cases');
  for (const { symbol, expected } of effectMembership) for (const variant of ['outline', 'filled']) {
    const actual = Object.keys(symbol.semantics?.variants?.[variant]?.effects ?? {}).sort();
    assert(JSON.stringify(actual) === JSON.stringify(expected[variant]), `${symbol.id}/${variant}: installed effect membership differs from source`);
  }
  const receipts = [];
  for (const item of cases) for (const variant of item.variant ? [item.variant] : ['outline', 'filled'])
    for (const weight of corpus || item.semantic ? [400] : [300, 400, 600]) for (const opsz of corpus || item.semantic ? [24] : [16, 24, 48]) {
    const request = { ...item.options, variant, weight, opsz, color: '#1234565e' };
    const result = exportLottie(item.symbol, request); assert(result.ok, item.name + ': ' + JSON.stringify(result));
    const animation = result.animation, before = JSON.stringify(animation), metadata = animation.meta.labIcons;
    const gesture = item.symbol.semantics?.variants?.[variant]?.effects?.[request.gesture];
    const duration = request.reducedMotion || request.gesture && (request.from ?? 0) === (request.to ?? 1) ? 0
      : request.duration ?? gesture?.duration ?? (request.transition ? 180 : 0);
    const terminalFrame = duration * (request.frameRate ?? 60) / 1000;
    assert(Math.abs(metadata.durationMs - duration) < 1e-9 && Math.abs(metadata.terminalFrame - terminalFrame) < 1e-9, item.name + ': request timing drift');
    assert(animation.op >= terminalFrame + 1, item.name + ': missing terminal hold');
    if (mutation === 'crop') animation.w = animation.h = 1;
    if (mutation === 'color') {
      for (const layer of [...animation.layers, ...animation.assets.flatMap(asset => asset.layers ?? [])])
        for (const shape of layer.shapes ?? []) if (shape.ty === 'fl' || shape.ty === 'st') shape.c = { a: 0, k: [1, 0, 0] };
    }
    if (mutation === 'terminal') { animation.op = Math.max(1, Math.floor(terminalFrame / 2)); for (const layer of animation.layers) layer.op = animation.op; }
    const container = document.createElement('div'); document.body.append(container);
    const player = lottie.loadAnimation({ container, renderer: 'svg', loop: false, autoplay: false, animationData: animation });
    const render = { variant, weight, opsz, ...Object.fromEntries(['date', 'timeZone', 'state'].filter(key => request[key] !== undefined).map(key => [key, request[key]])) };
    const icon = icons.mount(document.body, item.symbol, request.transition ? { ...render, ...request.transition.from } : render);
    icon.element.style.color = request.color;
    try {
      if (!player.isLoaded) await waitFor(player, 'DOMLoaded');
      let control;
      if (request.gesture) {
        icon.effect(request.gesture, { to: request.from ?? 0, reducedMotion: true });
        control = icon.effect(request.gesture, { to: request.to ?? 1, duration, reducedMotion: request.reducedMotion }); control.pause();
      } else if (request.transition) { control = icon.set({ ...render, ...request.transition.to }, { duration, reducedMotion: request.reducedMotion }); control.pause(); }
      const phases = new Set(duration ? [0, .125, .25, .437, .5, .75, 1] : [1]);
      if (duration && gesture?.parameter !== 'elapsed-hours') for (const track of gesture?.tracks ?? []) for (const [stop] of track.stops) {
        const progress = (stop - (request.from ?? 0)) / ((request.to ?? 1) - (request.from ?? 0));
        if (progress > 0 && progress < 1) phases.add(progress);
      }
      async function compare(progress, natural = false) {
        control?.seek(duration * progress);
        const frame = observationFrame(icon.element), svg = container.querySelector('svg'); assert(svg, item.name + ': player is empty');
        const actual = await raster(observedPlayer(svg, animation), frame), expected = await raster(canonicalSvg(icon.element), frame);
        const row = { name: item.name, variant, weight, opsz, progress, natural, ...compareSymbolPixels(actual, expected) };
        if (corpus) {
          const authored = await raster(authoredSvg(item.raw[variant], request.color), frame);
          row.authored = compareSymbolPixels(actual, authored);
          assert(row.authored.expectedInk > 0, item.name + ': author raster is empty');
          // A negative semantic part uses a mask; the author master is one
          // compound fill. Its antialias coverage differs at the shared edge.
          // Full-corpus measurement: .4077/255 mean, max30 for masked paint;
          // ordinary paint remains under .05 and the player/Motion bound .125.
          const masked = item.symbol.semantics?.variants?.[variant]?.parts.some(part => part.negative);
          row.authored.tolerance = masked ? .5 : .05;
          assert(acceptsSymbolPixels(row.authored, row.authored.tolerance), item.name + ': author parity ' + JSON.stringify(row));
        }
        receipts.push(row); assert(acceptsSymbolPixels(row, corpus ? .05 : .125), item.name + ': raster mismatch ' + JSON.stringify(row));
      }
      for (const progress of [...phases].sort((a, b) => a - b)) { player.goToAndStop(terminalFrame * progress, true); await compare(progress); }
      if (duration && item.complete) {
        await waitFor(player, 'complete', () => { player.goToAndStop(0, true); player.setSpeed(100); player.play(); });
        await compare(1, true);
      }
      assert(JSON.stringify(exportLottie(item.symbol, request).animation) === before, item.name + ': player contaminated the next export');
    } finally { icon.dispose(); player.destroy(); container.remove(); }
  }
  return receipts;
}
