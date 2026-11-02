/** Проверка настоящего consumer UI; в продукт и статический пакет не входит. */
export async function runExplorerJourney() {
  const checks = [];
  const authority = [];
  const controls = [];
  const fixtures = [];
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

    await choose('reload', 'outline');
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
      q('consumer-import').textContent.includes('/symbols/reload') && q('source-status').textContent === status && !q('play').disabled);
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
      const opacity = () => dots.map(dot => Number(getComputedStyle(dot).opacity));
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
      check(`${name}/${variant}/idle-restores-master`, opacity().every(value => value === 1) && (!shell || shell.outerHTML === shellBefore));
      check(`${name}/${variant}/triad-paths-unchanged-after-motion`, JSON.stringify(paths(stage.querySelector('svg'))) === JSON.stringify(paths(master)));
    }
    await choose('chatbubble-ellipses', 'filled');
    check('filled-typing-compound-refuses', q('play').disabled && q('gesture').value === '');
    await choose('ellipsis-vertical', 'outline');
    check('vertical-menu-does-not-inherit-loading', q('play').disabled && q('gesture').value === '');

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
      const symbol = await import(`./package/symbols/${name}.js`);
      const source = symbol.glyph({ variant });
      const caps = symbol.glyphCapabilities(variant);
      const row = data.rows.find(item => item.name === name && item.variant === variant);
      const masterResponse = await originalFetch(row.views.master);
      if (!masterResponse.ok) throw new Error(`explorer journey: variation master HTTP ${masterResponse.status}`);
      const master = new DOMParser().parseFromString(await masterResponse.text(), 'image/svg+xml').documentElement;
      const sourcePaths = JSON.stringify(paths(master));
      check(`${id}/actual-capability-controls`, caps.variation?.law === 'dots.affine' &&
        caps.variation.targets.svg === 'supported' &&
        [...q('axis-controls').querySelectorAll('[data-variation]')].map(input => input.dataset.variation).join(',') === 'dotScale,spacingScale' &&
        [...q('axis-controls').querySelectorAll('[data-variation]')].every(input => input.type === 'number' && input.value === '1') &&
        viewButton('generated').textContent === 'Вариация' && !viewButton('generated').disabled);
      check(`${id}/exact-default-master`, symbol.glyph({ variant, variation: caps.variation.defaults }) === source &&
        JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === sourcePaths);

      await chooseView('generated');
      check(`${id}/default-view-preserves-master`, JSON.stringify(paths(q('symbol-stage').querySelector(':scope > svg'))) === sourcePaths);
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
        check(`${id}/${view}/authored-viewport-scaling`, nested.length >= 2 && nested.every(svg =>
          Math.abs(parseFloat(getComputedStyle(svg).width) - modified.viewBox[2]) < 0.001 &&
          Math.abs(parseFloat(getComputedStyle(svg).height) - modified.viewBox[3]) < 0.001));
        check(`${id}/${view}/meaningful-colors`, getComputedStyle(originalLayer).color === 'rgb(185, 70, 60)' &&
          getComputedStyle(modifiedLayer).color === 'rgb(67, 132, 201)');
        if (view === 'difference') {
          const masks = [...comparison.querySelectorAll('mask')];
          const ids = [...document.querySelectorAll('[id]')].map(element => element.id);
          check(`${id}/difference/directed-luminance-masks`, masks.length === 2 && masks.every(mask =>
            getComputedStyle(mask).maskType === 'luminance' && mask.getAttribute('maskUnits') === 'userSpaceOnUse') &&
            new Set(ids).size === ids.length &&
            [originalLayer, modifiedLayer].every(layer => masks.some(mask => layer.getAttribute('mask') === `url(#${mask.id})`)));
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
    for (const view of ['overlay', 'difference', 'generated']) {
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
        [...document.querySelectorAll('[data-view]')].every(button => button.getAttribute('aria-pressed') === String(button.dataset.view === view)));
      const projectedParts = [...q('parts').children];
      let expectedExport = baseOriginal;
      if (view === 'generated') {
        const model = await import('./recorded-model.js');
        const modelGlyph = model.glyph({ icon: 'checkmark-circle', variant: 'outline' });
        expectedExport = modelGlyph.svg;
        check('replacement-exit/generated/model-metadata', q('model-status').textContent === 'Прежняя модель' && aria.includes('Прежняя модель') &&
          q('consumer-import').textContent.includes("from '@labpics/icons/ir'") &&
          q('source-status').textContent.includes('паритет с новой авторской основой не принят') &&
          JSON.stringify(projectedParts.map(part => part.title)) === JSON.stringify(modelGlyph.parts.map(part => part.id)) &&
          ![...q('gesture').options].some(option => option.value === 'enclosure.replace'));
      } else {
        const comparison = await originalFetch(baseRow.views[view]).then(response => response.text());
        const expected = new DOMParser().parseFromString(comparison, 'image/svg+xml').documentElement;
        check(`replacement-exit/${view}/comparison-subject`, JSON.stringify(paths(q('symbol-stage').querySelector('svg'))) === JSON.stringify(paths(expected)) &&
          q('model-status').textContent.includes('с прежней моделью') && aria.includes('с прежней моделью') &&
          q('consumer-import').textContent.includes('/symbols/checkmark-circle') && !q('consumer-import').textContent.includes('/states/') &&
          JSON.stringify(projectedParts.map(part => part.title)) === JSON.stringify(baseGlyph.parts.map(part => part.id)) &&
          q('source-status').textContent.includes('Части и образцы размеров относятся к текущему авторскому мастеру') &&
          [...q('size-samples').querySelectorAll('svg')].every(svg => JSON.stringify(paths(svg)) === JSON.stringify(basePaths)) &&
          q('play').disabled && q('gesture').disabled);
      }
      q('export-format').value = 'svg';
      q('export').click();
      const exported = downloads.at(-1);
      check(`replacement-exit/${view}/export-subject`, exported.filename === `checkmark-circle-outline${view === 'generated' ? '-recorded-model' : ''}.svg` &&
        await exported.blob.text() === expectedExport);
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
