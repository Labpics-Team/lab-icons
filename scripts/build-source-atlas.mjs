import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { loadAuthorBaseline } from './lib/author-baseline.js';
const root = fileURLToPath(new URL('..', import.meta.url));
const corpus = loadAuthorBaseline(root);
const svg = (text, size) => text.replace('<svg ', `<svg style="width:${size}px;height:${size}px" `);
const cells = Object.entries(corpus.icons).map(([id, variants]) => `<article><code>${id}</code>${['outline','filled'].map(variant=>
  `<div class="row"><small>${variant}</small>${[16,24,48].map(size=>`<span>${svg(variants[variant].artifactSvg,size)}</span>`).join('')}</div>`).join('')}</article>`).join('');
const controls = ['plus-circle','minus-circle','checkmark-circle','mic-circle'].map(id=>`<button>${svg(corpus.icons[id].outline.artifactSvg,24)}<span>${id.split('-')[0]}</span></button><button class="selected">${svg(corpus.icons[id].filled.artifactSvg,24)}</button>`).join('');
const html=`<!doctype html><html lang="ru"><meta charset="utf-8"><title>Lab Icons — авторский корпус</title><style>
*{box-sizing:border-box}body{margin:0;font:14px/1.5 Geist,Arial,sans-serif;color:#101012;background:#f6f6f8}header{padding:28px 36px;background:white;border-bottom:1px solid #ddd}h1{font-size:28px;margin:0}p{color:#676771;margin:6px 0 18px}.controls{display:flex;gap:12px;align-items:center;padding:16px;background:#fff}.dark{background:#17171b;color:#f5f5f8}button{display:flex;align-items:center;gap:9px;font:inherit;color:inherit;border:1px solid #9996;border-radius:9px;background:transparent;padding:10px 13px}.selected{color:#5a55e7}main{padding:28px 36px;display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:14px}article{background:#fff;border:1px solid #dedee5;padding:12px;border-radius:9px;break-inside:avoid}code{font:12px/1.5 Geist,Arial,sans-serif;display:block;color:#565660;margin-bottom:8px}.row{display:grid;grid-template-columns:48px repeat(3,1fr);align-items:center;min-height:58px}.row>span{display:flex;align-items:center;justify-content:center}small{font-size:10px;color:#888}svg{display:block;flex-shrink:0}</style>
<header><h1>Lab Icons</h1><p>${corpus.counts.families} семейств · Outline / Filled · исходные формы при 16 / 24 / 48 px · оптические оси ещё не применены</p><section class="controls">${controls}</section><section class="controls dark">${controls}</section></header><main>${cells}</main></html>`;
mkdirSync(join(root,'preview'),{recursive:true});writeFileSync(join(root,'preview/source-atlas.html'),html);
console.log('preview/source-atlas.html');
