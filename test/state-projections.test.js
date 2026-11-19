import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { renderStateGroupModule } from '../scripts/lib/author-state-groups.js';

const author = { kind: 'figma', fileKey: 'AUTHOR_RECEIPT_SENTINEL', version: '1' };
const payload = {
  schemaVersion: 2, group: 'state-control', variant: 'outline', defaultState: 'ready',
  frame: ['<svg viewBox="0 0 24 24">', '</svg>'], sharedSvg: '<path d="GEOMETRY_SHARED_SENTINEL"/>',
  sharedPartIds: ['fixed-enclosure'], enclosurePartId: 'fixed-enclosure',
  states: [
    { id: 'ready', partId: 'state-ready', icon: 'ready-icon', contentPartIds: ['ready-content'],
      author, contentSvg: '<path d="GEOMETRY_READY_SENTINEL"/>', staticSharedSvg: '<path d="GEOMETRY_STATIC_SENTINEL"/>' },
    { id: 'busy', partId: 'state-busy', icon: 'busy-icon', contentPartIds: ['busy-content'],
      author, contentSvg: '<path d="GEOMETRY_BUSY_SENTINEL"/>' },
  ],
  proof: { law: 'enclosure.replace', source: { fileKey: 'PROOF_SOURCE_SENTINEL', version: '1' },
    enclosureSha256: 'enclosure-hash', sharedPartsSha256: 'shared-hash', specSha256: 'spec-hash' },
};

async function consumeState(input, entry) {
  const contents = renderStateGroupModule(input);
  const result = await build({
    stdin: { contents: entry, loader: 'js' }, bundle: true, write: false, minify: true,
    format: 'esm', platform: 'browser', target: 'es2022', logLevel: 'silent',
    plugins: [{ name: 'state-projection-control', setup(plugin) {
      plugin.onResolve({ filter: /^test-state$/ }, () => ({ path: 'state', namespace: 'state', sideEffects: false }));
      plugin.onLoad({ filter: /.*/, namespace: 'state' }, () => ({ contents, loader: 'js' }));
      plugin.onResolve({ filter: /state-runtime\.js$/ }, () => ({ path: fileURLToPath(new URL('../src/states/runtime.ts', import.meta.url)) }));
    } }],
  });
  return result.outputFiles[0].text;
}

async function importState(input) {
  const bundled = await consumeState(input,
    'export { render, renderStateSvg, compileStateEffect, exportStateTransition, stateCapabilities } from "test-state";');
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

describe('две независимые state projections', () => {
  it('настоящий combined consumer entry не удерживает capabilities metadata', async () => {
    const actual = await consumeState(payload,
      'import { renderStateSvg, compileStateEffect } from "test-state"; console.log(renderStateSvg("ready"), compileStateEffect("busy", { duration: 180 }));');
    expect(actual).toContain('GEOMETRY_READY_SENTINEL');
    expect(actual).toContain('labpics.symbol-state-effect/1');
    for (const marker of ['AUTHOR_RECEIPT_SENTINEL', 'PROOF_SOURCE_SENTINEL', 'ready-icon', 'ready-content']) {
      expect(actual).not.toContain(marker);
    }
  });

  it('capabilities-only consumer не удерживает геометрию и исполнение перехода', async () => {
    const actual = await consumeState(payload, 'import { stateCapabilities } from "test-state"; console.log(stateCapabilities());');
    expect(actual).toContain('AUTHOR_RECEIPT_SENTINEL');
    expect(actual).toContain('PROOF_SOURCE_SENTINEL');
    expect(actual).not.toContain('GEOMETRY_');
    expect(actual).not.toContain('labpics.symbol-state-effect/1');
  });

  it('effect-only consumer использует общую runtime проекцию без авторских receipts', async () => {
    const actual = await consumeState(payload, 'import { compileStateEffect } from "test-state"; console.log(compileStateEffect("busy", { duration: 180 }));');
    expect(actual).toContain('labpics.symbol-state-effect/1');
    expect(actual).toContain('GEOMETRY_READY_SENTINEL');
    expect(actual).not.toContain('AUTHOR_RECEIPT_SENTINEL');
    expect(actual).not.toContain('PROOF_SOURCE_SENTINEL');
  });

  it('static render consumer использует общую runtime проекцию без capabilities', async () => {
    const actual = await consumeState(payload, 'import { render } from "test-state"; console.log(render("ready"));');
    expect(actual).toContain('GEOMETRY_STATIC_SENTINEL');
    expect(actual).not.toContain('AUTHOR_RECEIPT_SENTINEL');
    expect(actual).not.toContain('PROOF_SOURCE_SENTINEL');
    expect(actual).toContain('labpics.symbol-state-effect/1');
  });

  it('полный generated consumer сохраняет пять exports, public metadata и обе SVG-композиции', async () => {
    const before = structuredClone(payload);
    const api = await importState(payload);
    expect(Object.keys(api).sort()).toEqual(['compileStateEffect', 'exportStateTransition', 'render', 'renderStateSvg', 'stateCapabilities']);
    expect(api.render()).toEqual({ ok: true, svg: payload.frame[0] + payload.states[0].contentSvg + payload.states[0].staticSharedSvg + payload.frame[1] });
    expect(api.render('busy')).toEqual({ ok: true, svg: payload.frame[0] + payload.states[1].contentSvg + payload.sharedSvg + payload.frame[1] });
    expect(api.renderStateSvg('busy')).toEqual({ ok: true, svg: payload.frame[0] +
      '<g data-part="state-ready" data-role="state" data-state="ready" opacity="0">' + payload.states[0].contentSvg + '</g>' +
      '<g data-part="state-busy" data-role="state" data-state="busy" opacity="1">' + payload.states[1].contentSvg + '</g>' +
      payload.sharedSvg + payload.frame[1] });
    const caps = api.stateCapabilities();
    expect(caps).toEqual({ group: payload.group, variant: payload.variant, defaultState: payload.defaultState,
      transition: 'enclosure-replacement', morph: 'unavailable', enclosurePartId: payload.enclosurePartId,
      sharedPartIds: payload.sharedPartIds,
      states: payload.states.map(({ contentSvg, staticSharedSvg, ...state }) => state),
      formats: { static: ['svg'], transition: ['web-effect'] }, proof: payload.proof });
    expect(caps).toBe(api.stateCapabilities());
    expect(caps.sharedPartIds).toBe(api.compileStateEffect('busy', { duration: 1 }).effect.unchangedPartIds);
    expect(Object.isFrozen(caps.states[0].author)).toBe(true);
    expect(() => { caps.states[0].author.version = 'changed'; }).toThrow();
    expect(payload).toEqual(before);
    expect(Object.isFrozen(payload.states[0].author)).toBe(false);
  });

  it('слоты runtime tuple сохраняют независимые ID, partId, SVG и пустой optional override', async () => {
    const input = structuredClone(payload);
    input.states[0].staticSharedSvg = '';
    const api = await importState(input);
    expect(api.render('ready').svg).toBe(input.frame[0] + input.states[0].contentSvg + input.frame[1]);
    expect(api.render('busy').svg).toBe(input.frame[0] + input.states[1].contentSvg + input.sharedSvg + input.frame[1]);
    const mounted = api.renderStateSvg('busy').svg;
    expect(mounted).toContain('data-part="state-ready" data-role="state" data-state="ready" opacity="0"');
    expect(mounted).toContain('data-part="state-busy" data-role="state" data-state="busy" opacity="1"');
    expect(mounted).toContain(input.sharedSvg);
    expect(api.compileStateEffect('busy', { duration: 0 }).effect.stages.map(({ partId, to }) => [partId, to]))
      .toEqual([['state-ready', 0], ['state-busy', 1]]);
    expect(api.stateCapabilities().states.map(({ id, partId }) => [id, partId]))
      .toEqual([['ready', 'state-ready'], ['busy', 'state-busy']]);
    expect(api.stateCapabilities().states.every(state => !Object.hasOwn(state, 'staticSharedSvg'))).toBe(true);
  });

  it.each([
    ['group не строка', input => { input.group = { toString() { throw new Error('не вызывать'); } }; }],
    ['states не массив', input => { input.states = {}; }],
    ['states пустой', input => { input.states = []; }],
    ['record подменён tuple', input => { input.states[0] = ['ready', 'state-ready', '<path/>']; }],
    ['state null', input => { input.states[0] = null; }],
    ['ID не строка', input => { input.states[0].id = 1; }],
    ['partId не строка', input => { input.states[0].partId = 1; }],
    ['SVG отсутствует', input => { delete input.states[0].contentSvg; }],
    ['SVG не строка', input => { input.states[0].contentSvg = []; }],
    ['override null', input => { input.states[0].staticSharedSvg = null; }],
    ['defaultState неизвестен', input => { input.defaultState = 'unknown'; }],
  ])('%s: malformed compiled input получает build отказ перед tuple эмиссией', (_, mutate) => {
    const input = structuredClone(payload);
    mutate(input);
    expect(() => renderStateGroupModule(input)).toThrow(expect.objectContaining({ code: 'SPEC_INVALID' }));
  });

  it('SVG и named metadata сохраняют Unicode и собственный JSON __proto__', async () => {
    const input = structuredClone(payload);
    const text = 'Иконка 🧪 é e\u0301 " \' \\ \n \u2028 \u2029';
    input.frame = [`<svg data-label='${text}'>`, '</svg>'];
    input.sharedSvg = `<text>${text}</text>`;
    input.states[0].contentSvg = `<path data-label='${text}'/>`;
    input.states[0].staticSharedSvg = '';
    input.states[0].author = JSON.parse('{"kind":"figma","fileKey":"ключ 🧪","version":"1","__proto__":{"own":"receipt"}}');
    input.proof.source = JSON.parse('{"fileKey":"источник 🧪","version":"1","__proto__":{"own":"proof"}}');
    const api = await importState(input);
    expect(api.render('ready').svg).toBe(input.frame[0] + input.states[0].contentSvg + input.frame[1]);
    expect(api.render('busy').svg).toBe(input.frame[0] + input.states[1].contentSvg + input.sharedSvg + input.frame[1]);
    const caps = api.stateCapabilities();
    for (const [actual, original] of [[caps.states[0].author, input.states[0].author], [caps.proof.source, input.proof.source]]) {
      expect(actual).toEqual(original);
      expect(Object.hasOwn(actual, '__proto__')).toBe(true);
      expect(Object.getPrototypeOf(actual)).toBe(Object.prototype);
      expect(Object.isFrozen(actual.__proto__)).toBe(true);
    }
  });

  it('переходы и точные refusals сохраняются после разделения', async () => {
    const api = await importState(payload);
    const effect = api.compileStateEffect('busy', { duration: 180 });
    expect(effect).toEqual({ ok: true, effect: {
      contract: 'labpics.symbol-state-effect/1', version: 1, kind: 'enclosure-replacement',
      group: payload.group, variant: 'outline', targetState: 'busy',
      stages: [{ partId: 'state-ready', property: 'opacity', to: 0, at: 0, duration: 180 },
        { partId: 'state-busy', property: 'opacity', to: 1, at: 0, duration: 180 }],
      unchangedPartIds: ['fixed-enclosure'], options: { duration: 180, easing: 'linear', fill: 'both' },
    } });
    expect(api.exportStateTransition('busy', { format: 'web-effect', duration: 180 })).toEqual(effect);
    expect(api.compileStateEffect('busy', { duration: 180, reducedMotion: true }).effect.options.duration).toBe(0);
    for (const method of ['render', 'renderStateSvg', 'compileStateEffect', 'exportStateTransition']) {
      expect(api[method]('missing', null).reason.code).toBe('STATE_UNSUPPORTED');
      expect(api[method]('ready', null).reason.code).toBe('INVALID_REQUEST');
      expect(api[method]('ready', { variant: 'filled' }).reason.code).toBe('VARIANT_UNSUPPORTED');
      expect(api[method]('ready', { variant: 'fake' }).reason.code).toBe('INVALID_REQUEST');
    }
    expect(api.exportStateTransition('ready', { duration: 10 }).reason.code).toBe('INVALID_REQUEST');
    expect(api.exportStateTransition('ready', { format: 'lottie', duration: 10 }).reason.code).toBe('FORMAT_UNSUPPORTED');
    for (const duration of [NaN, Infinity, -1]) expect(api.compileStateEffect('ready', { duration }).reason.code).toBe('INVALID_REQUEST');
  });
});
