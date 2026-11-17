import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { chromium } from 'playwright';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = join(root, 'preview/clock-optical'); mkdirSync(output, { recursive: true });
const source = `
import * as motion from '@labpics/motion';
import { createSymbolMotion } from '@labpics/icons/motion';
import { renderIcon } from '@labpics/icons/render';
import time from '@labpics/icons/symbols/time';
import history from '@labpics/icons/symbols/history';
const assert=(value,message)=>{if(!value)throw new Error(message)};
const near=(value,target)=>assert(Math.abs(value-target)<1e-5,value+' != '+target);
let live=0;
const icons=createSymbolMotion({...motion,value(initial){live++;const v=motion.value(initial),dispose=v.dispose.bind(v);let released=false;
  v.dispose=()=>{if(!released){live--;released=true}dispose()};return v;}});
const serialize=svg=>new XMLSerializer().serializeToString(svg);
const pixels=async(svg,background)=>{const c=document.createElement('canvas');c.width=96;c.height=96;const ctx=c.getContext('2d');
  if(background){ctx.fillStyle=background;ctx.fillRect(0,0,96,96)}const image=new Image();image.src='data:image/svg+xml,'+encodeURIComponent(svg);
  await image.decode();ctx.drawImage(image,0,0,96,96);return ctx.getImageData(0,0,96,96).data;};
const angle=(icon,part)=>Number(icon.element.querySelector('[data-part="clock-'+part+'"]').getAttribute('transform').match(/rotate\\(([^ ]+)/)[1]);
let comparisons=0,maximumMeanChannelDifference=0,coverageComparisons=0,maximumClockAlpha=0;
for(const symbol of[time,history])for(const variant of['outline','filled']){
  const icon=icons.mount(document.body,symbol,{variant,size:96});icon.element.style.color='rgba(48,104,161,.45)';
  for(const weight of[300,400,600])for(const opsz of[16,24,48]){
    icon.set({variant,size:96,weight,opsz},{reducedMotion:true});
    const template=document.createElement('template');template.innerHTML=renderIcon(symbol,{variant,size:96,weight,opsz});
    template.content.firstChild.style.color=icon.element.style.color;
    for(const hours of[0,12])for(const background of[null,'#eee','#18181c']){
      icon.effect('advance',{to:hours,reducedMotion:true});
      const actual=await pixels(serialize(icon.element),background),expected=await pixels(serialize(template.content.firstChild),background);
      const difference=actual.reduce((sum,value,i)=>sum+Math.abs(i%4===3?value-expected[i]:value*actual[i-i%4+3]/255-expected[i]*expected[i-i%4+3]/255),0)/actual.length;
      maximumMeanChannelDifference=Math.max(maximumMeanChannelDifference,difference);comparisons++;
      assert(difference<1,'rest silhouette changed: '+symbol.id+'/'+variant+'/'+weight+'/'+opsz+': '+difference);
      for(let y=1;y<95;y++)for(let x=1;x<95;x++){
        const index=(y*96+x)*4;if(![0,1,2,3].some(ch=>Math.abs(actual[index+ch]-expected[index+ch])>1))continue;
        const boundary=[0,1,2,3].some(ch=>{let low=255,high=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
          const v=expected[((y+dy)*96+x+dx)*4+ch];low=Math.min(low,v);high=Math.max(high,v)}return high-low>1});
        assert(boundary,'clock changed a source interior pixel');
      }
    }
  }
  icon.element.style.color='rgba(0,0,0,.37)';
  for(const weight of[300,400,600])for(const opsz of[16,24,48]){
    icon.set({variant,size:96,weight,opsz},{reducedMotion:true});
    for(let step=0;step<=24;step++){
      icon.effect('advance',{to:step/2,reducedMotion:true});
      const actual=await pixels(serialize(icon.element),null);let maximum=0;
      for(let i=3;i<actual.length;i+=4)maximum=Math.max(maximum,actual[i]);
      maximumClockAlpha=Math.max(maximumClockAlpha,maximum);coverageComparisons++;
      assert(maximum<=95,'translucent clock overpainted: '+symbol.id+'/'+variant+'/'+weight+'/'+opsz+'/'+step/2+': '+maximum);
      if(symbol===history&&variant==='outline'&&weight===600&&opsz===16&&step===1)near(actual[(81*96+47)*4+3],94);
    }
  }
  icon.set({variant,size:96,weight:400,opsz:24},{reducedMotion:true});
  const first=icon.effect('advance',{to:2,duration:1000});first.pause();first.seek(250);
  near(angle(icon,'minute'),180);near(angle(icon,'hour'),15);
  const reverse=icon.effect('advance',{to:-1,duration:1000});
  near(angle(icon,'minute'),180);assert((await first.finished).status==='stopped','retarget retained old control');
  reverse.pause();reverse.seek(500);near(angle(icon,'minute'),-90);near(angle(icon,'hour'),-7.5);
  reverse.finish();await reverse.finished;
  icon.effect('advance',{reducedMotion:true});near(angle(icon,'minute'),0);near(angle(icon,'hour'),0);
  icon.effect('advance',{reducedMotion:true});near(angle(icon,'minute'),360);near(angle(icon,'hour'),30);
  const next=icon.effect('advance',{duration:1000});next.pause();next.seek(500);near(angle(icon,'minute'),540);near(angle(icon,'hour'),45);
  const restore=icon.set({variant,size:96,weight:400,opsz:24},{duration:1000});restore.pause();restore.seek(500);near(angle(icon,'minute'),270);
  restore.finish();await restore.finished;near(angle(icon,'minute'),0);near(angle(icon,'hour'),0);
  icon.effect('advance',{to:2,reducedMotion:true});
  const reset=icon.set({variant,size:96},{duration:1000});reset.pause();reset.seek(500);
  near(angle(icon,'minute'),360);near(angle(icon,'hour'),30);
  const resumed=icon.effect('advance',{duration:1000});resumed.pause();resumed.seek(0);
  near(angle(icon,'minute'),360);near(angle(icon,'hour'),30);
  resumed.seek(500);near(angle(icon,'minute'),540);near(angle(icon,'hour'),45);
  reset.finish();await reset.finished;near(angle(icon,'minute'),540);near(angle(icon,'hour'),45);
  resumed.finish();await resumed.finished;near(angle(icon,'minute'),720);near(angle(icon,'hour'),60);
  const removed=icon.effect('advance');icon.dispose();assert((await removed.finished).status==='stopped','dispose retained advance');
}
await Promise.resolve();assert(live===0,'clocks retained after completion/disposal');
for(const dark of[false,true]){
  const section=document.createElement('section');if(dark)section.className='dark';document.body.append(section);
  section.innerHTML='<h1>'+(dark?'Тёмный фон':'Светлый фон')+'</h1><div class="row header"><span></span><small>Static</small><small>0 h</small><small>¼ h</small><small>½ h</small><small>1 h</small></div>';
  for(const symbol of[time,history])for(const variant of['outline','filled']){
    const title=document.createElement('h2');title.textContent=symbol.id+' · '+variant;section.append(title);
    const supports=[[300,16],[400,24],[600,48],...(symbol===history&&variant==='outline'?[[600,16]]:[])];
    for(const[weight,opsz]of supports){
      const row=document.createElement('div');row.className='row';row.innerHTML='<span>'+weight+' / '+opsz+'</span>'+renderIcon(symbol,{variant,size:48,weight,opsz});section.append(row);
      for(const hours of[0,.25,.5,1]){const icon=icons.mount(row,symbol,{variant,size:48,weight,opsz});icon.effect('advance',{to:hours,reducedMotion:true});}
    }
  }
}
window.result={ok:true,comparisons,maximumMeanChannelDifference,coverageComparisons,maximumClockAlpha,live,groups:['time/outline','time/filled','history/outline','history/filled'],
  cases:['9 optical supports','rest and 12 hours','transparent/translucent color','900 translucent poses including hand/enclosure overlap','common-pivot limb union','elapsed-hour units','reverse and interruption','next-hour continuation including interrupted reset','selection returns source pose','dispose']};
`;
const bundle = await build({ stdin: { contents: source, resolveDir: root, sourcefile: 'clock-consumer.mjs' }, bundle: true, format: 'esm', write: false, target: 'es2022' });
const html = `<!doctype html><html><head><meta charset="utf-8"><style>body{margin:0;display:flex;gap:20px;padding:20px;background:#e4e4e8;font:14px system-ui}section{padding:24px;background:#fafafa;color:#235d9b;border-radius:14px}.dark{background:#19191e;color:#a9cdf3}h1{font-size:20px;margin:0 0 16px}h2{font-size:15px;margin:20px 0 8px}.row{display:flex;align-items:center;gap:22px;height:58px}.row>span{width:95px}.row>small{width:48px}.header{height:24px;color:#80808b}</style></head><body><script type="module">${bundle.outputFiles[0].text.replaceAll('</script', '<\\/script')}</script></body></html>`;
writeFileSync(join(output, 'index.html'), html);
let browser;
try {
  browser = await chromium.launch({ channel: 'chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1160, height: 1040 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', error => errors.push(error.message));
  await page.setContent(html);
  await page.waitForFunction(() => window.result, undefined, { timeout: 15000 }).catch(async error => {
    await page.screenshot({ path: join(output, 'failure.png') }); throw new Error(`${error.message}: ${errors.join('; ')}`);
  });
  const result = await page.evaluate(() => window.result); assert.equal(result.ok, true); assert.deepEqual(errors, []);
  await page.screenshot({ path: join(output, 'clock-motion.png'), fullPage: true });
  writeFileSync(join(output, 'receipt.json'), `${JSON.stringify(result, null, 2)}\n`); console.log(JSON.stringify(result));
} finally { await browser?.close(); }
