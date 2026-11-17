import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { compileOpticalCorpus } from './lib/optical-corpus.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const { axes, symbols } = compileOpticalCorpus(root, { preview: true });
const runtime = await build({ entryPoints: [join(root, 'src/render/index.ts')], bundle: true, write: false, format: 'esm' });
const { renderIcon } = await import(`data:text/javascript;base64,${Buffer.from(runtime.outputFiles[0].text).toString('base64')}`);
const compiled = Object.values(symbols);
const cell = (svg, size, label = 'Aa', weight = 400) => `<span class="sample" role="img" aria-label="${label}" style="--size:${size}px;font-weight:${weight}">${svg}<span>${label}</span></span>`;
const sections = ['light', 'dark'].map(theme => `<section class="${theme}"><h2>${theme === 'light' ? 'Light' : 'Dark'}</h2>${compiled.map(symbol =>
  `<article><h3>${symbol.id}</h3><div class="variants">${['outline', 'filled'].map(variant => `<div><h4>${variant}</h4>
    <div class="row labels"><span>size</span><span>300</span><span>400</span><span>600</span><span>Source 400/24</span></div>
    ${axes.opsz.map(size => `<div class="row"><small>${size}</small>${axes.weight.map(weight => cell(renderIcon(symbol, { variant, size, weight }), size, 'Aa', weight)).join('')}${cell(symbol[variant], size, 'Source')}</div>`).join('')}
    </div>`).join('')}</div></article>`).join('')}</section>`).join('');
const html = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Lab Icons — optical masters</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..600&display=swap">
<style>*{box-sizing:border-box}body{margin:0;color:#101012;background:#fafafb;font:14px/1.4 Geist,Arial,sans-serif}header{padding:24px 32px;border-bottom:1px solid #dedee5}h1{margin:0;font-size:24px;font-weight:600}p{margin:6px 0 0;color:#676771}section{padding:20px 32px 28px}h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;font-weight:600;margin:0 0 16px}h3{font-size:16px;margin:0 0 16px}h4{font-size:12px;margin:0 0 12px;color:#767680;text-transform:uppercase}article+article{margin-top:24px}.variants{display:grid;grid-template-columns:1fr 1fr;gap:32px}.row{display:grid;grid-template-columns:24px repeat(3,1fr) 1.15fr;align-items:center;min-height:74px;gap:10px}.labels{min-height:24px;font-size:11px;color:#767680}.sample{display:flex;align-items:center;gap:8px;white-space:nowrap}.sample svg{width:var(--size);height:var(--size);flex:none;display:block}.sample span{font-size:14px}.dark{background:#17171b;color:#f5f5f8}.dark h4,.dark .labels{color:#a2a2ab}small{font-size:11px;color:#767680}</style>
<header><h1>Optical masters</h1><p>Original Lab UI drawing beside the authored weight/size grid. Source support stays exact; masters are under visual review.</p></header>${sections}</html>`;
const output = join(root, 'preview'); mkdirSync(output, { recursive: true });
writeFileSync(join(output, 'optical-atlas.html'), html);
console.log(join(output, 'optical-atlas.html'));
