import { describe, expect, it } from 'vitest';
import { authoredSymbolPayloads } from '../scripts/lib/authored-symbol-payload.js';
import { authorContentVariationCapability } from '../scripts/lib/author-annulus.js';
import { createCompiledContentGlyph } from '../src/ir/author-content-runtime.js';
import { compileSymbolEffect } from '../src/motion/index.js';

const icon = 'checkmark-circle';
const payload = (await authoredSymbolPayloads([icon]))[icon];
const compiled = payload.contentVariation.outline;
const glyph = createCompiledContentGlyph(icon, payload.source, compiled);
const capabilities = { ...payload.capabilities.outline, variation: authorContentVariationCapability(compiled) };
const gesture = `${icon}.presence`;
const compile = (model, caps = capabilities, request = { duration: 600, from: .37, to: .8 }) =>
  compileSymbolEffect(model, caps, gesture, request);

describe('content/annulus variation preserves the authored confirmation gesture', () => {
  it.each([{contentScale:.9}, {enclosureEmphasis:1.1}, {contentScale:.9,enclosureEmphasis:1.1}])(
    'uses the existing opacity protocol for %j', variation => {
      const model = glyph({variation});
      expect(compile(glyph()).ok).toBe(true);
      const result = compile(model);
      expect(result).toMatchObject({ok:true,effect:{version:2,icon,variant:'outline',gesture,
        from:.37,to:.8,targets:[{partId:'confirmation-mark',property:'opacity',from:.37,to:.8}],
        unchangedPartIds:['confirmation-enclosure'],options:{duration:600,easing:'linear',fill:'both'}}});
      expect(result.effect.stages).toEqual([{partId:'confirmation-mark',property:'opacity',at:0,duration:600,to:.8}]);
    });

  it('reverses, holds and reduces motion without replacing geometry', () => {
    const model = glyph({variation:{contentScale:.9,enclosureEmphasis:1.1}});
    for (const request of [{duration:600,from:.8,to:.2}, {duration:600,from:.4,to:.4},
      {duration:600,from:.8,to:.2,reducedMotion:true}]) {
      const result = compile(model,capabilities,request);
      expect(result.ok).toBe(true);
      expect(result.effect.targets[0]).toEqual({partId:'confirmation-mark',property:'opacity',from:request.from,to:request.to});
      expect(result.effect.options.duration).toBe(request.reducedMotion || request.from === request.to ? 0 : 600);
      expect(result.effect).not.toHaveProperty('geometry');
    }
  });

  it.each([
    ['capability law', value => {value.caps.variation.law='dots.affine';}],
    ['capability target', value => {value.caps.variation.targets.webEffect='not-exported';}],
    ['capability geometry', value => {value.caps.variation.geometrySha256='0'.repeat(64);}],
    ['part law', value => {value.model.parts[0].provenance.variation={...value.model.parts[0].provenance.variation,law:'dots.affine'};}],
    ['part version', value => {value.model.parts[0].provenance.variation={...value.model.parts[0].provenance.variation,version:2};}],
    ['part geometry', value => {value.model.parts[0].provenance.variation={...value.model.parts[0].provenance.variation,geometrySha256:'0'.repeat(64)};}],
    ['author', value => {value.caps.author.masterSha256='0'.repeat(64);}],
    ['anatomy', value => {value.caps.anatomy.annotationSha256='0'.repeat(64);}],
    ['non-opacity', value => {value.caps.motion.gestures[0].tracks=[{partId:'confirmation-mark',kind:'rotate',anchor:[.5,.5],from:0,to:360,unit:'degrees',interpolation:'linear'}];}],
  ])('refuses detached %s while the unmodified control works', (_label, mutate) => {
    const value = { model:structuredClone(glyph({variation:{contentScale:.9,enclosureEmphasis:1.1}})), caps:structuredClone(capabilities) };
    expect(compile(value.model,value.caps).ok).toBe(true);
    mutate(value);
    expect(compile(value.model,value.caps)).toMatchObject({ok:false,reason:{code:'SEMANTIC_MOTION_UNAVAILABLE'}});
  });
});
