/**
 * system/loupe.mjs — ЛУПА С ГРЕБЁНКОЙ КРИВИЗНЫ.
 *
 * Проценты и таблицы углов доказывают несовпадение, но не показывают его. А
 * спор идёт именно про то, что видно глазом: «скругление могло бы быть
 * угловатым — сходимость была бы, а вид отвратительный».
 *
 * Гребёнка кривизны — стандартный прибор шрифтовика и промдизайнера. Из каждой
 * точки контура наружу откладывается отрезок длиной пропорционально кривизне.
 * Огибающая этих отрезков читается мгновенно:
 *
 *   ровная полка       — дуга постоянного радиуса
 *   плавный подъём     — скругление с мягким входом
 *   ступенька          — разрыв кривизны: дуга воткнута в прямую встык
 *   зубец или провал   — защип, тот самый «неорганичный» узел
 *   всплеск в ноль     — излом, голый угол
 *
 * Рядом — та же гребёнка оригинала. Спор про органичность превращается в
 * сравнение двух огибающих, а не в обмен впечатлениями.
 *
 *   node system/loupe.mjs play-circle
 *   node system/loupe.mjs square --filled
 *   node system/loupe.mjs plus,minus,close --png
 */

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { edgesOfD, edgesOfPath } from './contour.js';
import { sampleSub, spectrum } from './corners.js';
import { pathsFromSvg } from './core/parse.js';
import { v2 } from './core/num.js';
import { ROOT } from './build.js';
import './glyphs/index.js';
import { glyphs, buildGlyph } from './registry.js';

const CHROME = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const OUT = `${ROOT}/system/out`;
const PAD_U = 0.08; // поля панели в долях окна
const COMB = 3.2; // длина зуба гребёнки при кривизне 1

const argv = process.argv.slice(2);
const names = (argv.find((a) => !a.startsWith('--')) ?? 'play-circle').split(',');
const variant = argv.includes('--filled') ? 'filled' : 'outline';
const wantPng = argv.includes('--png');
// --ink — только чернила, без гребёнки: шов виден сам, приборы его загораживают
const inkOnly = argv.includes('--ink');
// --crop x,y,w — вырезать окно канвы: один узел под увеличением честнее целой
// иконки, на которой дефект размером в десятую долю единицы не видно вовсе
const crop = argv.includes('--crop') ? argv[argv.indexOf('--crop') + 1].split(',').map(Number) : null;
const VW = crop ? crop[2] : 24;
const VX = crop ? crop[0] : 0;
const VY = crop ? crop[1] : 0;

/** Гребёнка одного контура: путь зубцов и огибающая. */
function comb(subs) {
  const teeth = [];
  const hull = [];
  for (const sub of subs) {
    const pts = sampleSub(sub);
    if (!pts.length) continue;
    const step = Math.max(1, Math.round(pts.length / 260));
    let run = null;
    for (let i = 0; i < pts.length; i += step) {
      const q = pts[i];
      const n = [-q.t[1], q.t[0]];
      const l = Math.min(2.6, Math.abs(q.k) * COMB);
      const tip = v2.mad(q.p, n, l * Math.sign(q.sk || 1));
      teeth.push(`M${f(q.p)}L${f(tip)}`);
      if (!run) hull.push((run = [`M${f(tip)}`]));
      else run.push(`L${f(tip)}`);
      // излом рвёт огибающую: она не должна перескакивать через узел
      if (q.imp > 8) run = null;
    }
  }
  return { teeth: teeth.join(''), hull: hull.map((r) => r.join('')).join('') };
}

const f = (p) => `${p[0].toFixed(3)} ${p[1].toFixed(3)}`;

function panel(title, d, subs, x0, sc, PAD) {
  const c = comb(subs);
  const sp = spectrum(subs).filter((k) => k.kind !== 'кольцо' && k.kind !== 'колпачок');
  const marks = sp
    .map(
      (k) =>
        `<circle cx="${k.at[0]}" cy="${k.at[1]}" r="${(0.2 * VW) / 24}" class="v"/>` +
        `<text x="${k.at[0]}" y="${k.at[1] - (0.55 * VW) / 24}" class="lb" font-size="${(0.62 * VW) / 24}">${k.turn}° R${k.r} ε${k.ease}</text>`,
    )
    .join('');
  return `<g transform="translate(${x0} ${PAD}) scale(${sc}) translate(${-VX} ${-VY})">
    <clipPath id="cp${x0}"><rect x="${VX}" y="${VY}" width="${VW}" height="${VW}"/></clipPath>
    <g clip-path="url(#cp${x0})">
      <path d="${d}" class="ink"/>
      ${inkOnly ? '' : `<path d="${c.teeth}" class="teeth" stroke-width="${1.1 / sc}"/>
      <path d="${c.hull}" class="hull" stroke-width="${2.2 / sc}"/>
      ${marks}`}
    </g>
    <rect x="${VX}" y="${VY}" width="${VW}" height="${VW}" class="fr" stroke-width="${1.4 / sc}"/>
  </g>`;
}

mkdirSync(OUT, { recursive: true });

for (const name of names) {
  const file = `${ROOT}/reference/${variant === 'filled' ? 'Filled' : 'Outline'}/${name}${variant === 'filled' ? '_filled' : ''}.svg`;
  if (!existsSync(file)) {
    console.error(`нет оригинала: ${file}`);
    continue;
  }
  const def = glyphs.get(name);
  if (!def) {
    console.error(`глиф не объявлен: ${name}`);
    continue;
  }
  const refD = pathsFromSvg(readFileSync(file, 'utf8')).map((p) => p.d).join(' ');
  const path = buildGlyph(name, variant, def.refAxes ? { axes: def.refAxes } : {});
  const genD = path.toD();

  const SIDE = 560; // пикселей на панель
  const PAD = SIDE * PAD_U;
  const sc = SIDE / VW;
  const W = SIDE * 2 + PAD * 3;
  const H = SIDE + PAD * 2.4;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
<style>
  rect.bg{fill:#0B0B0F}
  .fr{fill:none;stroke:#2A2A34;stroke-width:.06}
  .ink{fill:#8FA8CC}
  .teeth{fill:none;stroke:#5AA9FF;stroke-width:.035;opacity:.55}
  .hull{fill:none;stroke:#FF9F5A;stroke-width:.075}
  .v{fill:#FF5A7A}
  .ti{fill:#B9B9C6;font:17px ui-sans-serif,system-ui;text-anchor:middle}
  .lb{fill:#8C8C9C;text-anchor:middle;font-family:ui-sans-serif,system-ui}
</style>
<rect class="bg" x="0" y="0" width="${W}" height="${H}"/>
<text x="${PAD + SIDE / 2}" y="${PAD * 0.72}" class="ti">рука — ${name}/${variant}</text>
<text x="${PAD * 2 + SIDE * 1.5}" y="${PAD * 0.72}" class="ti">система</text>
${panel('рука', refD, edgesOfD(refD), PAD, sc, PAD)}
${panel('система', genD, edgesOfPath(path), PAD * 2 + SIDE, sc, PAD)}
</svg>`;

  const svgPath = `${OUT}/loupe-${name}-${variant}.svg`;
  writeFileSync(svgPath, svg);
  if (wantPng) {
    const html = `${OUT}/loupe-${name}-${variant}.html`;
    writeFileSync(html, `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#0B0B0F}</style>${svg}`);
    execFileSync(
      CHROME,
      ['--headless', '--disable-gpu', '--no-sandbox', '--hide-scrollbars', `--window-size=${Math.round(W)},${Math.round(H)}`, `--screenshot=${OUT}/loupe-${name}-${variant}.png`, `file://${html}`],
      { stdio: 'pipe' },
    );
  }
  console.log(`${svgPath}`);
}
