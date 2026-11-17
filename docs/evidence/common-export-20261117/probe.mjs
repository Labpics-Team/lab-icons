import { build } from 'esbuild';
import { chromium } from 'playwright';
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import checkmark from '../../../dist/symbols/checkmark-circle.js';
import { opticalPathSource } from '../../../scripts/lib/optical-grid.js';
process.chdir(fileURLToPath(new URL('../../../', import.meta.url)));
const preparedGuides=Object.fromEntries(['outline','filled'].map(variant=>[variant,Object.fromEntries(checkmark.semantics.variants[variant].parts.filter(p=>p.draw).map(p=>[p.id,opticalPathSource({d:p.draw.path,strokeWidth:p.draw.width})]))]));
const source = `
import lottie from 'lottie-web';
import * as motion from '@labpics/motion';
import { createSymbolMotion } from '../src/motion/index.ts';
import calendar from '@labpics/icons/symbols/calendar-number';
import time from '@labpics/icons/symbols/time';
import checkmark from '@labpics/icons/symbols/checkmark-circle';
import { renderIcon } from '../src/render/index.ts';
import { resolveIconRequest } from '../src/render/request.ts';
import { opticalPathData, sampleOpticalPath, sampleOpticalScalar } from '../src/render/optical-grid.ts';
import { projectPathView, projectPoint } from '../src/motion/path-view.ts';
const fixed=k=>({a:0,k});
const animated=(from,to)=>({a:1,k:[{t:0,s:[from],o:{x:[0],y:[0]},i:{x:[1],y:[1]}},{t:60,s:[to]}]});
const guides=${JSON.stringify(preparedGuides)};
const transform={o:fixed(100),r:fixed(0),p:fixed([0,0,0]),a:fixed([0,0,0]),s:fixed([100,100,100])};
function contours(path, coordinates, included) {
 let cursor=0,index=-1,current,point;
 const result=[]; const finish=()=>{if(current && (!included || included.includes(index))) result.push(current); current=null;};
 const pair=()=>[coordinates[cursor++],coordinates[cursor++]];
 for (const op of path.commands) {
  if(op==='M'){finish();index++;point=pair();current={v:[point],i:[[0,0]],o:[[0,0]],c:false};}
  else if(op==='L'||op==='C') { const a=op==='C'?pair():point,b=op==='C'?pair():null,end=pair(); current.o[current.v.length-1]=a.map((v,i)=>v-point[i]);current.v.push(end);current.i.push(b?b.map((v,i)=>v-end[i]):[0,0]);current.o.push([0,0]);point=end; }
  else if(op==='Z'){ if(current.v.length>1 && point.every((v,i)=>v===current.v[0][i])) {current.i[0]=current.i.pop();current.v.pop();current.o.pop();}current.c=true; }
 }
 finish(); return result;
}
// Exploratory single coverage scope. A general exporter must group only by
// explicit part.layer; see the database-search counterexample in README.md.
function exportPose(symbol,options,drawProgress=1) {
 const r=resolveIconRequest(symbol,options), parts=r.selected.semantics.variants[r.variant].parts;
 const op=symbol===calendar?1:61;
 const layers=parts.flatMap((part,index)=>{
  const path=r.data.variants[r.variant].paths[part.pathIndex]; let c=sampleOpticalPath(path,r.position);
  const pivot=part.pivot?projectPoint(c,part.pivot):part.anchor;
  if(part.geometry)c=projectPathView(part.geometry,c);
  const pathView=part.geometry?{commands:part.geometry.commands}:path;
  const color=part.negative?[0,0,0]:[1,1,1];
  const paint=path.stroke?{ty:'st',c:fixed(color),o:fixed(100),w:fixed(sampleOpticalScalar(path.stroke.width,r.position)),lc:2,lj:2}: {ty:'fl',c:fixed(color),o:fixed(100),r:path.fillRule==='evenodd'?2:1};
  const shapes=contours(pathView,c,part.geometry?undefined:part.contourIndices).map(k=>({ty:'sh',ks:fixed(k)}));
  const dx=part.offsetX?sampleOpticalScalar(part.offsetX,r.position):0;
  const rotation=r.selected.semantics.variants[r.variant].effects.advance?.tracks.find(t=>t.partId===part.id && t.property==='rotate');
  const layer={ind:index*2+1,ty:4,nm:part.id,ip:0,op,st:0,sr:1,ks:rotation?{...transform,p:fixed([pivot[0]+dx,pivot[1],0]),a:fixed([...pivot,0]),r:animated(rotation.stops[0][1],rotation.stops.at(-1)[1]*2)}:{...transform,p:fixed([dx,0,0])},shapes:[...shapes,paint]};
  if(!part.draw || drawProgress===1)return [layer];
  const guide=guides[r.variant][part.id];
  return [{...layer,tt:1},{ind:index*2+2,ty:4,nm:'guide',td:1,ip:0,op,st:0,sr:1,ks:{...transform,o:fixed(drawProgress===0?0:100)},shapes:[...contours(guide,guide.coordinates).map(k=>({ty:'sh',ks:fixed(k)})),{ty:'st',c:fixed([1,1,1]),o:fixed(100),w:fixed(guide.strokeWidth),lc:2,lj:2},{ty:'tm',s:fixed(0),e:animated(0,100),o:fixed(0),m:1}]}];
 }).reverse();
 return {v:'5.13.0',fr:60,ip:0,op,w:24,h:24,ddd:0,assets:[{id:'coverage',layers,w:24,h:24}],layers:[
  {ind:1,ty:0,nm:'coverage',td:1,refId:'coverage',w:24,h:24,ip:0,op,st:0,sr:1,ks:transform},
  {ind:2,ty:4,nm:'ink',tt:3,ip:0,op,st:0,sr:1,ks:{...transform,o:fixed(37)},shapes:[{ty:'rc',p:fixed([12,12]),s:fixed([24,24]),r:fixed(0)},{ty:'fl',c:fixed([0,0,0]),o:fixed(100),r:1}]}
 ]};
}
async function raster(svg){const image=new Image();image.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svg)));await image.decode();const c=document.createElement('canvas');c.width=c.height=96;const ctx=c.getContext('2d');ctx.drawImage(image,0,0,96,96);return ctx.getImageData(0,0,96,96).data;}
async function run(){const receipts=[];for(const symbol of [calendar,time,checkmark])for(const variant of ['outline','filled'])for(const weight of [300,400,600])for(const opsz of [16,24,48])for(const drawProgress of symbol!==calendar?[0,.125,.25,.5,.75,1]:[1]){
 const options={variant,weight,opsz,size:96,...(symbol.id==='calendar-number'?{date:new Date('2026-01-28T12:00:00Z'),timeZone:'UTC'}:{})};
 const container=document.createElement('div');document.body.append(container);const animation=lottie.loadAnimation({container,renderer:'svg',loop:false,autoplay:false,animationData:exportPose(symbol,options,drawProgress)});await new Promise((resolve,reject)=>{animation.addEventListener('DOMLoaded',resolve);animation.addEventListener('data_failed',reject)});animation.goToAndStop(symbol===calendar?0:drawProgress*60,true);
 const svg=container.querySelector('svg');svg.setAttribute('width','96');svg.setAttribute('height','96');const a=await raster(new XMLSerializer().serializeToString(svg));
 const icon=createSymbolMotion(motion).mount(document.body,symbol,options);if(symbol===checkmark)icon.effect('draw',{to:drawProgress,reducedMotion:true});if(symbol===time)icon.effect('advance',{to:drawProgress*2,reducedMotion:true});const reference=icon.element;reference.style.color='rgba(0,0,0,.37)';const b=await raster(new XMLSerializer().serializeToString(reference));icon.dispose();
 let sum=0,max=0,alpha=0;for(let i=3;i<a.length;i+=4){const d=Math.abs(a[i]-b[i]);sum+=d;max=Math.max(max,d);alpha=Math.max(alpha,a[i]);}receipts.push({symbol:symbol.id,variant,weight,opsz,drawProgress,mean:sum/(a.length/4),max,alpha});animation.destroy();container.remove();}
 window.result=receipts;
}
run().catch(e=>window.failure=e.stack);
`;
const bundled=await build({stdin:{contents:source,resolveDir:process.cwd()+'/preview',sourcefile:'probe.js'},bundle:true,format:'esm',write:false,target:'es2022'});
const html='<!doctype html><html><body><script type="module">'+bundled.outputFiles[0].text.replaceAll('</script','<\\/script')+'</script></body></html>';
const browser=await chromium.launch({channel:'chrome',headless:true});try{const page=await browser.newPage();await page.setContent(html);await page.waitForFunction(()=>window.result||window.failure,undefined,{timeout:30000});const result=await page.evaluate(()=>window.result??{error:window.failure});writeFileSync('preview/lottie-common-probe.json',JSON.stringify(result,null,2));console.log(JSON.stringify(Array.isArray(result)?{count:result.length,worst:result.toSorted((a,b)=>b.mean-a.mean).slice(0,5)}:result));}finally{await browser.close();}
