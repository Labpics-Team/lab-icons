import { readFileSync } from 'node:fs';
import { samplePolylines } from '../scripts/lib/curve-sampling.js';
const [,, file] = process.argv;
const svg = readFileSync(file, 'utf8');
const d = svg.match(/ d="([^"]+)"/)[1];
const polys = samplePolylines(d, 48).filter(p => p.length > 4);
const CW = 24;
for (const [i, p] of polys.entries()) {
  let A=0, cx=0, cy=0;
  for (let k=0;k<p.length;k++){ const [x0,y0]=p[k],[x1,y1]=p[(k+1)%p.length];
    const cr=x0*y1-x1*y0; A+=cr; cx+=(x0+x1)*cr; cy+=(y0+y1)*cr; }
  A/=2; cx/=6*A; cy/=6*A;
  let mxx=0,mxy=0,myy=0;
  for (let k=0;k<p.length;k++){ const [x0,y0]=p[k],[x1,y1]=p[(k+1)%p.length];
    const cr=x0*y1-x1*y0;
    mxx+=(x0*x0+x0*x1+x1*x1)*cr; mxy+=(x0*y1+2*x0*y0+2*x1*y1+x1*y0)*cr; myy+=(y0*y0+y0*y1+y1*y1)*cr; }
  mxx=mxx/12-A*cx*cx; mxy=mxy/24-A*cx*cy; myy=myy/12-A*cy*cy;
  const c20=mxx/A, c11=mxy/A, c02=myy/A;
  const th=0.5*Math.atan2(2*c11, c20-c02)*180/Math.PI;
  const t1=(c20+c02)/2, t2=Math.sqrt(((c20-c02)/2)**2+c11**2);
  const a=2*Math.sqrt(Math.abs(t1+t2)), b=2*Math.sqrt(Math.abs(t1-t2));
  const xs=p.map(q=>q[0]), ys=p.map(q=>q[1]);
  console.log(`#${i} A=${(A).toFixed(2)} c=(${(cx/CW).toFixed(4)},${(cy/CW).toFixed(4)}) a=${(a/CW).toFixed(4)} b=${(b/CW).toFixed(4)} θ=${th.toFixed(1)}° bbox x[${Math.min(...xs).toFixed(1)},${Math.max(...xs).toFixed(1)}] y[${Math.min(...ys).toFixed(1)},${Math.max(...ys).toFixed(1)}]`);
}
