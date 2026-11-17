import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'preview/negative-draw'); mkdirSync(output, { recursive: true });
const source = `
import * as motion from '@labpics/motion';
import { createSymbolMotion } from '@labpics/icons/motion';
import { renderIcon } from '@labpics/icons/render';
import check from '@labpics/icons/symbols/checkmark-circle';
const assert = (value, message) => { if (!value) throw new Error(message); };
const runtime = createSymbolMotion(motion);
const serialize = element => new XMLSerializer().serializeToString(element);
const pixels = async (svg, background) => {
  const canvas = document.createElement('canvas'); canvas.width=96; canvas.height=96;
  const context = canvas.getContext('2d');
  if(background) { context.fillStyle=background; context.fillRect(0,0,96,96); }
  const image = new Image(); image.src='data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  await image.decode(); context.drawImage(image,0,0,96,96);
  return context.getImageData(0,0,96,96).data;
};
const fixture = runtime.mount(document.body,check,{variant:'filled',size:96});
fixture.element.style.color='rgba(69,129,196,.55)';
const comparisons=[];
for(const weight of [300,400,600]) for(const opsz of [16,24,48]) {
  fixture.set({variant:'filled',size:96,weight,opsz},{reducedMotion:true});
  const template=document.createElement('template');
  template.innerHTML=renderIcon(check,{variant:'filled',size:96,weight,opsz});
  const staticSvg=template.content.firstChild; staticSvg.style.color=fixture.element.style.color;
  for(const phase of [.99999,1]) for(const background of [null,'#fff','#252530']) {
    fixture.effect('draw',{to:phase,reducedMotion:true});
    const expected=await pixels(serialize(staticSvg),background);
    const actual=await pixels(serialize(fixture.element),background);
    // Compare premultiplied channels: invisible RGB is immaterial at antialiased edges.
    const difference=actual.reduce((sum,value,index)=>sum+Math.abs(index%4===3 ? value-expected[index]
      : value*actual[index-index%4+3]/255-expected[index]*expected[index-index%4+3]/255),0)/actual.length;
    comparisons.push({weight,opsz,phase,background,difference});
    // Chrome uses different antialiasing for convex paths and compound fills. Only a
    // one-pixel boundary may differ; a missing/shifted interior must still fail.
    let interiorMismatches=0;
    for(let y=1;y<95;y++) for(let x=1;x<95;x++) {
      const index=(y*96+x)*4;
      if(![0,1,2,3].some(channel=>Math.abs(actual[index+channel]-expected[index+channel])>1)) continue;
      const boundary=[0,1,2,3].some(channel=>{
        let low=255,high=0;
        for(let dy=-1;dy<=1;dy++) for(let dx=-1;dx<=1;dx++) {
          const value=expected[((y+dy)*96+x+dx)*4+channel]; low=Math.min(low,value); high=Math.max(high,value);
        }
        return high-low>1;
      });
      if(!boundary) interiorMismatches++;
    }
    assert(difference<1 && interiorMismatches===0,'static/motion silhouette changed at '+weight+'/'+opsz+': '+difference+', interior '+interiorMismatches);
  }
}
fixture.set({variant:'filled',size:96,weight:400,opsz:24},{reducedMotion:true});
fixture.element.style.color='black';
const totals=[];
for(const phase of [0,.5,1]) {
  fixture.effect('draw',{to:phase,reducedMotion:true});
  const actual=await pixels(serialize(fixture.element));
  totals.push(actual.reduce((sum,value,index)=>sum+(index%4===3?value:0),0));
  const opaque=await pixels(serialize(fixture.element),'#cc3355');
  assert(opaque.every((value,index)=>index%4!==3||value===255),'negative draw erased consumer background');
}
assert(totals[0]>totals[1]&&totals[1]>totals[2],'draw did not gradually cut the authored hole');
const replay=fixture.effect('draw',{duration:1000}); replay.pause(); replay.seek(500);
const counter=fixture.element.querySelector('[data-part="confirmation-mark"]');
const guide=fixture.element.querySelector('[id^="lab-icon-draw"] path');
assert(guide.getAttribute('stroke-dashoffset')==='0.5','negative draw replay lost phase');
const reverse=fixture.effect('draw',{to:0,duration:1000}); reverse.pause(); reverse.seek(500);
assert(guide.getAttribute('stroke-dashoffset')==='0.75','negative draw reverse jumped');
const switchVariant=fixture.set({size:96,state:'unselected'},{duration:1000}); switchVariant.pause(); switchVariant.seek(500);
assert(counter.getAttribute('opacity')==='1','state fade changed counter opacity');
const restore=fixture.setState('selected',{duration:1000}); restore.pause(); restore.seek(500); restore.finish(); await restore.finished;
fixture.set({state:'selected',size:96,weight:400,opsz:24},{reducedMotion:true});
const completePose=await pixels(serialize(fixture.element));
const interrupted=fixture.effect('draw',{duration:1000}); interrupted.pause(); interrupted.seek(250);
assert(guide.getAttribute('stroke-dashoffset')==='0.75','round-trip fixture has wrong starting pose');
const away=fixture.setState('unselected',{duration:1000});
assert(guide.getAttribute('stroke-dashoffset')==='0.75','leaving selected jumped');
away.pause(); away.seek(500);
const returnToSelected=fixture.setState('selected',{duration:1000});
assert(guide.getAttribute('stroke-dashoffset')==='0.75','returning selected jumped');
returnToSelected.pause(); returnToSelected.seek(500);
assert(guide.getAttribute('stroke-dashoffset')==='0.375','selected did not restore the draw pose continuously');
returnToSelected.finish(); await returnToSelected.finished;
assert(guide.getAttribute('stroke-dashoffset')==='0' && counter.getAttribute('mask')==='','selected retained a partial draw');
const returnedPose=await pixels(serialize(fixture.element));
assert(returnedPose.every((value,index)=>value===completePose[index]),'selected endpoint did not restore the complete picture');
fixture.dispose();
for(const dark of [false,true]) {
  const section=document.createElement('section'); section.className=dark?'dark':'';
  section.innerHTML='<h2>'+(dark?'На тёмном фоне':'На светлом фоне')+'</h2>'; document.body.append(section);
  for(const [weight,opsz] of [[300,16],[400,24],[600,48]]) {
    const row=document.createElement('div'); row.className='row'; section.append(row);
    const label=document.createElement('span'); label.textContent=weight+' / '+opsz; row.append(label);
    for(const phase of [0,.25,.5,.75,1]) {
      const cell=document.createElement('div'); cell.className='cell'; row.append(cell);
      const icon=runtime.mount(cell,check,{variant:'filled',size:48,weight,opsz});
      icon.effect('draw',{to:phase,reducedMotion:true});
      const value=document.createElement('small'); value.textContent=phase; cell.append(value);
    }
  }
}
window.result={ok:true,comparisons:comparisons.length,maximumMeanChannelDifference:Math.max(...comparisons.map(item=>item.difference)),alphaTotals:totals,
  cases:['9 optical supports','transparent and opaque backgrounds','partial tint alpha','draw 0/.5/1','replay and reversal','interrupted selection','selected round-trip exact endpoint and no jump','dispose']};
`;
const bundle = await build({ stdin: { contents: source, resolveDir: root, sourcefile: 'negative-consumer.mjs' }, bundle: true, format: 'esm', write: false, target: 'es2022' });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;background:#e6e6eb;font:14px system-ui;display:flex;gap:16px;padding:24px}section{padding:24px;color:#17171b;background:#fafafb;border-radius:16px}.dark{color:#f4f4f6;background:#17171b}h2{margin:0 0 24px;font-size:18px}.row{display:flex;align-items:center;gap:24px;margin:24px 0}.row>span{width:64px}.cell{display:flex;align-items:center;flex-direction:column;gap:12px}</style></head><body><script type="module">${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
writeFileSync(join(output, 'index.html'), html);
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1080, height: 440 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(html);
  await page.waitForFunction(() => window.result, undefined, { timeout: 10000 }).catch(async error => {
    await page.screenshot({ path: join(output, 'failure.png') });
    throw new Error(`${error.message}: ${errors.join('; ')}`);
  });
  const result = await page.evaluate(() => window.result); assert.equal(result.ok, true); assert.deepEqual(errors, []);
  await page.screenshot({ path: join(output, 'negative-draw.png') });
  writeFileSync(join(output, 'receipt.json'), `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify(result));
} finally { await browser?.close(); }
