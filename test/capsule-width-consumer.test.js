import { build } from 'esbuild';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { authoredSymbolPayloads } from '../scripts/lib/authored-symbol-payload.js';
import { renderSymbolModules } from '../scripts/lib/symbol-modules.js';

const root = fileURLToPath(new URL('..',import.meta.url)), inputs = await authoredSymbolPayloads(['mic','mic-circle']);
async function consumer(icon, kind, statement) {
  const output = renderSymbolModules(inputs[icon]);
  const built = await build({stdin:{contents:`import * as symbol from '@labpics/icons/${kind}/${icon}';\n${statement}`,resolveDir:root},
    bundle:true,write:false,minify:true,platform:'browser',format:'esm',target:'es2022',metafile:true,logLevel:'silent',
    plugins:[{name:'capsule-public-consumer',setup(plugin){
      plugin.onResolve({filter:/^@labpics\/icons\/(symbols|variations)\//},args=>({path:args.path,namespace:'public',sideEffects:false}));
      plugin.onLoad({filter:/.*/,namespace:'public'},()=>({contents:kind==='variations'?output.variation:output.symbol,loader:'js',resolveDir:root}));
      plugin.onResolve({filter:/symbol-data\/[a-z0-9-]+\.js$/},()=>({path:'data',namespace:'data',sideEffects:false}));
      plugin.onLoad({filter:/.*/,namespace:'data'},()=>({contents:output.data,loader:'js',resolveDir:root}));
      plugin.onResolve({filter:/(?:capsule|symbol)-runtime\.js$/},args=>({path:fileURLToPath(new URL(`../src/ir/${args.path.endsWith('/capsule-runtime.js')?'author-capsule-runtime':'symbol-runtime'}.ts`,import.meta.url))}));
    }}]});
  const code = built.outputFiles[0].text;
  return {code,loaded:Object.keys(built.metafile.inputs),module:await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`)};
}
describe('body width uses the actual public generated consumer module',()=>{
  it.each(['mic','mic-circle'])('%s changes real geometry through the small opt-in and shares exact source defaults',async icon=>{
    const result = await consumer(icon,'variations',"export const source=symbol.glyph();export const varied=symbol.glyph({variation:{bodyWidth:.9}});export const lower=symbol.glyph({variation:{bodyWidth:.8}});export const refused=(()=>{try{symbol.glyph({variation:{bodyWidth:.79}});return null;}catch(error){return error.code;}})();export const caps=symbol.glyphCapabilities();export const publicKeys=Object.keys(symbol).sort();");
    const {source,varied,lower,refused,caps,publicKeys}=result.module;
    expect(publicKeys).toEqual(['filled','glyph','glyphCapabilities','outline']);
    expect(publicKeys).toEqual(JSON.parse(readFileSync(new URL('../release/export-surface.json',import.meta.url),'utf8'))[`./variations/${icon}`]);
    expect(varied.parts.find(part=>part.id==='microphone-body').d).not.toBe(source.parts.find(part=>part.id==='microphone-body').d);
    expect(varied.svg).not.toBe(source.svg);expect(caps.variation.law).toBe('capsule.width');
    expect(lower.provenance.variation.parameters.bodyWidth).toBe(.8);
    expect(caps.variation.domain.minimum).toBe(.8);expect(refused).toBe('VARIATION_OUTSIDE_DOMAIN');
    // request.ts переиспользует маленький AXIS_NAMES из type-проекции;
    // source module в metafile не означает сохранённый IR-каталог в output.
    expect(result.loaded.join('\n')).not.toMatch(/authoring|semantics\/catalog\.json|src\/ir\/index\.ts|author-capsule\.js|path-data\.js/);
    expect(result.code).not.toMatch(/accessibility|chevron-forward|ICON_IDS/);
  });
  it('ordinary glyph and literal SVG imports do not load the width program or runtime',async()=>{
    const glyph=await consumer('mic','symbols','export const glyph=symbol.glyph();');
    const svg=await consumer('mic','symbols','export const svg=symbol.outline;');
    for(const result of [glyph,svg]){
      expect(result.loaded.join('\n')).not.toMatch(/capsule-runtime|author-capsule-runtime|annulus-content-geometry/);
      expect(result.code).not.toMatch(/bodyWidth|capsule\.width|exact-tensor-bernstein/);
    }
    expect(svg.module.svg).toBe(inputs.mic.staticSvg.outline);
  });
  it('Filled negative anatomy reaches the generated module and keeps one compound path', async () => {
    const result = await consumer('mic-circle', 'variations', "export const source=symbol.glyph({variant:'filled'});export const defaultSame=source===symbol.glyph({variant:'filled',variation:{bodyWidth:1}});export const varied=symbol.glyph({variant:'filled',variation:{bodyWidth:.8}});export const caps=symbol.glyphCapabilities('filled');export const staticSvg=symbol.filled;");
    const { source, varied, defaultSame, caps, staticSvg } = result.module;
    expect(defaultSame).toBe(true); expect(source.composition).toEqual({ kind: 'compound', fillRule: 'evenodd' });
    expect(source.parts.map(part => part.role)).toEqual(['container', 'counter', 'counter']);
    expect(source.parts.map(part => part.fillRule)).toEqual([null, null, null]);
    expect(source.parts.map(part => part.d).join('')).toBe(source.d);
    expect(varied.parts[0]).toBe(source.parts[0]); expect(varied.parts[1]).toBe(source.parts[1]);
    expect(varied.parts[2].d).not.toBe(source.parts[2].d);
    expect(varied.svg.match(/<path\b/g)).toHaveLength(1); expect(varied.svg).toContain('data-parts="microphone-enclosure microphone-support microphone-body"');
    expect(varied.svg).toContain('data-roles="container counter counter"'); expect(varied.svg).toContain(`d="${varied.d}"`);
    expect(caps.variation.law).toBe('capsule.width'); expect(staticSvg).toBe(inputs['mic-circle'].staticSvg.filled);
    expect(source.parts[2]).not.toHaveProperty('contourIndices');
    expect(result.loaded.join('\n')).not.toMatch(/source-contours|author-curve-certificate|path-data/);
  });
});
