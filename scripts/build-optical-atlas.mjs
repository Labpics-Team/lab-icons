import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { compileOpticalCorpus } from './lib/optical-corpus.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const { axes, symbols } = compileOpticalCorpus(root, { preview: true });
const runtime = await build({ entryPoints: [join(root, 'src/render/index.ts')], bundle: true, write: false, format: 'esm' });
const { renderIcon } = await import(`data:text/javascript;base64,${Buffer.from(runtime.outputFiles[0].text).toString('base64')}`);
const compiled = Object.values(symbols).sort((a, b) => a.id.localeCompare(b.id));
const output = join(root, 'preview/optical-atlas'); mkdirSync(output, { recursive: true });
const pageSize = 10, pages = Math.ceil(compiled.length / pageSize);
const specs = Object.fromEntries(compiled.map(symbol => [symbol.id, JSON.parse(readFileSync(join(root, `symbols/optics/${symbol.id}.json`), 'utf8'))]));
const escape = text => String(text).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const riskCount = symbol => Object.values(specs[symbol.id].variants).reduce((sum, variant) => sum + (variant.diagnostics?.risks.length ?? 0), 0);
const cell = (svg, size, label = 'Aa', weight = 400, button = false) =>
  `<${button ? 'button type="button"' : 'span'} class="sample" ${button ? '' : 'role="img"'} aria-label="${label}" style="--size:${size}px;font-weight:${weight}">${svg}<span>${label}</span></${button ? 'button' : 'span'}>`;
const styles = `*{box-sizing:border-box}body{margin:0;color:#17171b;background:#fafafb;font:14px/1.4 Geist,Arial,sans-serif}header{padding:24px 32px;border-bottom:1px solid #dedee5}h1{margin:0;font-size:24px;font-weight:600}p{margin:6px 0 0;color:#71717b}a{color:inherit}nav{display:flex;gap:16px;flex-wrap:wrap;margin-top:16px}main{padding:20px 32px 28px}h3{font-size:16px;margin:0 0 12px}h4{font-size:12px;margin:0 0 8px;color:#767680;text-transform:uppercase}article{break-inside:avoid;border-bottom:1px solid #dedee5;padding-bottom:24px}article+article{margin-top:24px}.variants{display:grid;grid-template-columns:1fr 1fr;gap:32px}.row{display:grid;grid-template-columns:24px repeat(3,1fr) 1.15fr;align-items:center;min-height:68px;gap:10px}.labels{min-height:24px;font-size:11px;color:#767680}.sample{display:flex;align-items:center;gap:8px;white-space:nowrap}.sample svg{width:var(--size);height:var(--size);flex:none;display:block}.sample span{font-size:14px}.buttons{display:flex;align-items:center;gap:12px;margin-top:12px}button{font:inherit;color:inherit;background:#f0f0f4;border:1px solid #d4d4dc;border-radius:8px;padding:8px 12px}.selected{background:#17171b;color:#fff}.icon-only span{display:none}.icon-only{padding:8px}.dark{background:#17171b;color:#f5f5f8}.dark h4,.dark .labels,.dark p{color:#a2a2ab}.dark article,.dark header{border-color:#393940}.dark button{background:#2b2b32;border-color:#4c4c57}.dark .selected{background:#f5f5f8;color:#17171b}small{font-size:11px;color:#767680}.status{font-size:11px;font-weight:400;color:#b45309;margin-left:12px}.dark .status{color:#fbbf24}.index{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.index a{display:block;padding:16px;border:1px solid #dedee5;border-radius:8px;text-decoration:none}@media(max-width:1100px){.variants{grid-template-columns:1fr}.index{grid-template-columns:1fr}}`;
const shell = (title, content, theme = 'light') => `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Geist:wght@300..600&display=swap"><style>${styles}</style><body class="${theme}">${content}</body></html>`;
const manifest = [];
for (let page = 0; page < pages; page++) {
  const chunk = compiled.slice(page * pageSize, (page + 1) * pageSize);
  for (const theme of ['light', 'dark']) {
    const file = `${String(page + 1).padStart(2, '0')}-${theme}.html`;
    const nav = `<nav><a href="index.html">All pages</a>${page ? `<a href="${String(page).padStart(2, '0')}-${theme}.html">Previous</a>` : ''}${page + 1 < pages ? `<a href="${String(page + 2).padStart(2, '0')}-${theme}.html">Next</a>` : ''}<a href="${String(page + 1).padStart(2, '0')}-${theme === 'light' ? 'dark' : 'light'}.html">Switch theme</a></nav>`;
    const articles = chunk.map(symbol => `<article id="${symbol.id}" data-symbol="${symbol.id}"><h3>${symbol.id}<span class="status">${escape(specs[symbol.id].review)} · ${riskCount(symbol)} geometry findings</span></h3><div class="variants">${['outline', 'filled'].map(variant => `<div><h4>${variant}</h4>
      <div class="row labels"><span>size</span><span>300</span><span>400</span><span>600</span><span>Source 400/24</span></div>
      ${axes.opsz.map(size => `<div class="row"><small>${size}</small>${axes.weight.map(weight => cell(renderIcon(symbol, { variant, size, weight }), size, 'Aa', weight)).join('')}${cell(symbol[variant], size, 'Source')}</div>`).join('')}
      <div class="buttons">${axes.opsz.map(size => cell(renderIcon(symbol, { variant, size, weight: 400 }), size, 'Label', 400, true)
        .replace('class="sample"', `class="sample ${variant === 'filled' ? 'selected' : ''} ${size === 48 ? 'icon-only' : ''}"`)).join('')}</div></div>`).join('')}</div></article>`).join('');
    writeFileSync(join(output, file), shell(`Optical atlas ${page + 1}/${pages} · ${theme}`, `<header><h1>Optical atlas · ${page + 1}/${pages} · ${theme}</h1><p>${chunk[0].id} — ${chunk.at(-1).id}. Drafts require visual correction; diagnostics do not grant approval.</p>${nav}</header><main>${articles}</main>`, theme));
    manifest.push({ file, theme, symbols: chunk.map(symbol => symbol.id) });
  }
}
writeFileSync(join(output, 'manifest.json'), JSON.stringify({ families: compiled.length, variants: compiled.length * 2, axes, pages: manifest }, null, 2));
writeFileSync(join(output, 'index.html'), shell('Lab Icons · Full optical atlas', `<header><h1>Full optical atlas</h1><p>${compiled.length} families · ${compiled.length * 2} variants · nine supports · both themes. All drafts remain under review.</p></header><main class="index">${manifest.map(page => `<a href="${page.file}">${page.file}<br><small>${page.symbols[0]} — ${page.symbols.at(-1)}</small></a>`).join('')}</main>`));
writeFileSync(join(root, 'preview/optical-atlas.html'), shell('Lab Icons · Optical atlas', '<header><h1>Optical atlas</h1><p><a href="optical-atlas/index.html">Open all 660 variants</a></p></header>'));
console.log(`${join(output, 'index.html')} (${manifest.length} pages)`);
