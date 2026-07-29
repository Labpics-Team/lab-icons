/**
 * system/preview.js — единственная страница сходимости.
 *
 * Четыре обязательные колонки: оригинал, генерат, отклонение, аргумент.
 * Пятая, добавленная системой, — геометрическое смещение контура: без неё
 * «5%» не отличить от «5%», а это две разные новости (см. docs/system.md).
 *
 * Страница самодостаточна: SVG вшиты, внешних запросов нет.
 */

import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { buildAll, summarize, ROOT, ARGUE_AT } from './build.js';
import { glyphs, buildGlyph } from './registry.js';
import { TOKENS, AXES, T, NOMINAL_CANVAS } from './tokens.js';
import { numeral, numeralString, numeralMetrics } from './numerals.js';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const pct = (v) => (v * 100).toFixed(2) + '%';

/** Оригинал и генерат наложены: расхождение видно, а не выводится. */
function overlay(refSvg, genD) {
  const refPaths = [...refSvg.matchAll(/<path\b[^>]*\sd="([^"]*)"[^>]*>/g)].map((m) => ({
    d: m[1],
    fr: /fill-rule="evenodd"/.test(m[0]) ? 'evenodd' : 'nonzero',
  }));
  const ref = refPaths.map((p) => `<path d="${p.d}" fill-rule="${p.fr}" fill="var(--ink-ref)"/>`).join('');
  return `<svg viewBox="0 0 24 24" class="ic"><g>${ref}</g><path d="${genD}" fill="var(--ink-gen)"/></svg>`;
}

function card(r) {
  if (r.error) {
    return `<article class="card err"><header><h3>${esc(r.name)}<span class="v">${r.variant}</span></h3></header>
      <p class="msg">ОШИБКА СБОРКИ: ${esc(r.error)}</p></article>`;
  }
  const dev = r.deviation ?? null;
  const state = dev == null ? 'none' : dev <= ARGUE_AT ? 'good' : r.verdict?.kind === 'registration' ? 'warn' : 'bad';
  const offTxt = r.offset
    ? `${r.offset.median.toFixed(3)} ед · ${(r.offsetPen * 100).toFixed(1)}% пера · p95 ${r.offset.p95.toFixed(2)}`
    : '—';
  const needArg = dev != null && dev > ARGUE_AT;
  const argText = needArg ? r.argument || r.verdict?.note || 'аргумент не предъявлен — декларация не принята' : '';
  return `<article class="card ${state}" data-family="${esc(r.family)}" data-variant="${r.variant}" data-dev="${dev ?? ''}" data-name="${esc(r.name)}">
    <header><h3>${esc(r.name)}<span class="v">${r.variant}</span></h3>
      <b class="dev">${dev == null ? '—' : pct(dev)}</b></header>
    <div class="row">
      <figure><div class="box">${r.reference ? r.reference.replace('<svg ', '<svg class="ic" ') : '<div class="no">нет</div>'}</div><figcaption>оригинал</figcaption></figure>
      <figure><div class="box"><svg viewBox="0 0 24 24" class="ic"><path d="${r.d}"/></svg></div><figcaption>генерат</figcaption></figure>
      <figure><div class="box">${r.reference ? overlay(r.reference, r.dRef ?? r.d) : ''}</div><figcaption>наложение${r.refAxes ? ' · ' + esc(Object.entries(r.refAxes).map(([k, v]) => k + ' = ' + v).join(', ')) : ''}</figcaption></figure>
    </div>
    <dl class="meta">
      <dt>смещение контура</dt><dd>${offTxt}</dd>
      <dt>подпутей / сегментов</dt><dd>${r.subpaths} / ${r.segments}</dd>
      <dt>вердикт</dt><dd>${esc(r.verdict?.kind ?? '—')}</dd>
    </dl>
    ${r.refAxes ? `<p class="axes"><b>сравнение.</b> глиф зависит от внешнего состояния: показан при текущем значении оси, а сверяется с оригиналом при ${esc(Object.entries(r.refAxes).map(([k, v]) => k + ' = ' + v).join(', '))} — том, что зафиксировала рука.</p>` : ''}
    <p class="law"><b>закон.</b> ${esc(r.law)}</p>
    ${needArg ? `<p class="arg"><b>почему отклонение ${pct(dev)}.</b> ${esc(argText)}${r.verdict?.note && r.argument ? ' <i>' + esc(r.verdict.note) + '</i>' : ''}</p>` : ''}
    ${r.axes ? `<p class="axes"><b>оси.</b> ${Object.entries(r.axes).map(([k, a]) => `${esc(k)} ∈ [${a.min}…${a.max}], по умолчанию ${a.def}${a.note ? ' — ' + esc(a.note) : ''}`).join('; ')}</p>` : ''}
  </article>`;
}

function tokenTable() {
  const rows = [];
  const push = (name, ratio, note) =>
    rows.push(
      `<tr><td><code>${name}</code></td><td>${ratio.toFixed(6).replace(/0+$/, '')}</td><td>${(ratio * NOMINAL_CANVAS).toFixed(2)}</td><td>${note}</td></tr>`,
    );
  push('frame.margin', TOKENS.frame.margin, 'поле до самой внешней точки чернил');
  push('keyline.circle', TOKENS.keyline.circle, 'диаметр опорной окружности = живая область');
  push('stroke.base', TOKENS.stroke.base, 'Regular — перо контура');
  push('stroke.bold', TOKENS.stroke.bold, 'Bold — то же начертание в Filled');
  push('stroke.ring', TOKENS.stroke.ring, 'кольцо-обрамление: контейнер легче содержимого');
  push('stroke.containerGlyph', TOKENS.stroke.containerGlyph, 'перо глифа внутри контейнера');
  push('stroke.hair', TOKENS.stroke.hair, 'волосяное перо разметки');
  push('clearance.min', TOKENS.clearance.min, 'абсолютный минимум негативного зазора');
  push('clearance.snug', TOKENS.clearance.snug, 'рабочий зазор внутри глифа');
  push('clearance.channel', TOKENS.clearance.channel, 'канал ≈ перо: негатив читается как штрих');
  push('clearance.overlay', TOKENS.clearance.overlay, 'зазор вокруг накладного класса');
  push('corner.box', TOKENS.corner.box, 'скругление корпусной формы');
  push('corner.detail', TOKENS.corner.detail, 'скругление мелкой детали');
  return `<table class="tok"><thead><tr><th>токен</th><th>доля канвы</th><th>при канве 24</th><th>смысл</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

function derivedTable() {
  const R = TOKENS.corner.box * NOMINAL_CANVAS;
  const keyR = (TOKENS.keyline.circle * NOMINAL_CANVAS) / 2;
  return `<table class="tok"><thead><tr><th>вывод</th><th>формула</th><th>значение при канве 24</th><th>замер руки</th></tr></thead><tbody>
    <tr><td>терминал</td><td>кап = перо / 2</td><td>${(T.stroke.base / 2).toFixed(2)}</td><td>0.9 (<code>a.9 .9</code> во всём корпусе)</td></tr>
    <tr><td>внутренняя кромка</td><td>rIn = rOut − перо</td><td>${(R - T.stroke.base).toFixed(2)} при rOut = ${R}</td><td>3.2 (square, mail, sun-диск)</td></tr>
    <tr><td>вписанный квадрат</td><td>h = R + (Rkey − R)/√2</td><td>${T.squareHalf().toFixed(3)} ⟹ габарит ${(2 * T.squareHalf()).toFixed(3)}</td><td>18.48 (square.svg)</td></tr>
    <tr><td>осевой keyline</td><td>снят с корпуса</td><td>6</td><td>minus 6.00 · plus 6.06 · close 6.01</td></tr>
    <tr><td>предел луча</td><td>Rkey − кап − Rтела − зазор − кап</td><td>3.40 при Rтела = 5</td><td>sun 1.8 · sun-low 0</td></tr>
    <tr><td>ось веса</td><td>[кап/кольцо, 1 + (кольцо − зазор)/bold]</td><td>[${AXES.wght.min}, ${AXES.wght.max}]</td><td>—</td></tr>
  </tbody></table>`;
}

/** Полоса одного глифа по значениям оси — доказательство вариативности. */
function axisStrip(label, note, items) {
  return `<div class="strip"><h4>${esc(label)}</h4><p>${esc(note)}</p><div class="cells">${items
    .map(
      (i) =>
        `<figure><div class="box"><svg viewBox="0 0 24 24" class="ic"><path d="${i.d}"/></svg></div><figcaption>${esc(i.label)}</figcaption></figure>`,
    )
    .join('')}</div></div>`;
}

function variableSection() {
  const strips = [];
  const has = (n) => glyphs.has(n);
  const safe = (fn) => {
    try {
      return fn();
    } catch {
      return null;
    }
  };

  if (has('plus')) {
    const items = [AXES.wght.min, 0.8, 1, 1.15, AXES.wght.max]
      .map((w) => safe(() => ({ label: `wght ${w}`, d: buildGlyph('plus', 'outline', { wght: w }).toD() })))
      .filter(Boolean);
    strips.push(
      axisStrip(
        'ось веса — wght',
        `Диапазон не выбран, а выведен: снизу [кап/кольцо = ${AXES.wght.min}] — тончайшее кольцо не имеет права стать тоньше собственного терминала; сверху [1 + (кольцо − зазор)/bold = ${AXES.wght.max}] — узчайший негатив-канал не имеет права просесть ниже охранного минимума.`,
        items,
      ),
    );
  }
  if (has('sun')) {
    const items = [0, 0.9, 1.8, 2.6, 3.4]
      .map((r) => safe(() => ({ label: r === 0 ? 'ray 0 = sun-low' : `ray ${r}`, d: buildGlyph('sun', 'outline', { axes: { ray: r } }).toD() })))
      .filter(Boolean);
    strips.push(
      axisStrip(
        'ось луча — sun ↔ sun-low',
        'Это не две иконки. Внешний терминал луча закреплён на keyline (Rkey − кап = 10.1), а длина растёт внутрь: 0 даёт sun-low, перо даёт sun, предел 3.4 — там, где охранный зазор до диска проседает ниже минимума.',
        items,
      ),
    );
  }
  if (has('arrow-forward')) {
    const items = [0, 0.25, 0.5, 0.75, 1]
      .map((v) => safe(() => ({ label: v === 0 ? 'tail 0 = шеврон' : `tail ${v}`, d: buildGlyph('arrow-forward', 'outline', { axes: { tail: v } }).toD() })))
      .filter(Boolean);
    strips.push(
      axisStrip(
        'ось хвоста — стрелка ↔ шеврон',
        'Шеврон — это стрелка с нулевым хвостом. Одна конструкция, из которой вырастают arrow-forward, download и resize; на этапе анимации хвост будет тем же параметром, что и здесь.',
        items,
      ),
    );
  }
  if (has('square')) {
    const items = [0, 0.3, 0.6, 0.85, 1]
      .map((z) => safe(() => ({ label: `ζ ${z}`, d: buildGlyph('square', 'filled', { crnr: z }).toD() })))
      .filter(Boolean);
    strips.push(
      axisStrip(
        'ось сглаживания угла — ζ',
        'Радиус вершины НЕ меняется: сокращается дуга, а вход в неё берёт кубика с нулевой кривизной у прямой стороны. При ζ = 0.6 генерат совпадает со скруглённым квадратом руки с отклонением 0.05% — это и есть значение, которое рука имела в виду.',
        items,
      ),
    );
  }
  return strips.join('');
}

function numeralSection() {
  const digits = [];
  for (let d = 0; d <= 9; d++) {
    digits.push({ label: String(d), d: numeral(d, { capHeight: 16, origin: [6.5, 4] }).toD() });
  }
  const words = ['1', '7', '13', '29', '31'].map((s) => ({
    label: s,
    d: numeralString(s, { capHeight: 12, center: [12, 12] }).toD(),
  }));
  const m = numeralMetrics(7.2);
  return (
    axisStrip(
      'собственный округлый знак 0–9',
      `Скелет из прямых и дуг + круглый терминал — то же перо, что у иконок. Метрики при высоте 7.2: перо ${m.pen.toFixed(2)} (рука в календаре: 1.46), ширина чернил ${m.inkWidth.toFixed(2)} (рука: 5.0). Никакого шрифтового файла и никакой зависимости от SF Rounded.`,
      digits,
    ) +
    axisStrip(
      'табулярный набор',
      'Календарь меняет число ежедневно, поэтому «1» обязана занимать столько же места, сколько «8»: иначе иконка дёргалась бы раз в сутки. Девятка — шестёрка, повёрнутая на 180°; это же даёт бесплатный морф 6↔9.',
      words,
    )
  );
}

export function render(rows) {
  const sum = summarize(rows);
  const families = [...new Set(rows.map((r) => r.family))].sort();
  const converged = rows.filter((r) => r.deviation != null && (r.deviation <= ARGUE_AT || r.verdict?.kind === 'registration')).length;
  const byDev = [...rows].sort((a, b) => (b.deviation ?? -1) - (a.deviation ?? -1));

  return `<title>lab-icons — сходимость генерата с оригиналом</title>
<style>
:root{
  --bg:#F7F7FB; --fg:#101014; --dim:#6C6C7A; --line:#DCDCE6; --card:#FFFFFF;
  --good:#1B8F5A; --warn:#B0730A; --bad:#C8361E; --accent:#2A63F6;
  --ink-ref:#101014; --ink-gen:#2A63F6;
  color-scheme:light dark;
}
@media (prefers-color-scheme:dark){:root{
  --bg:#0C0C10; --fg:#EDEDF2; --dim:#9A9AA8; --line:#26262F; --card:#141419;
  --good:#3FD08A; --warn:#E0A83C; --bad:#FF7A63; --accent:#7AA0FF;
  --ink-ref:#EDEDF2; --ink-gen:#7AA0FF;}}
:root[data-theme=dark]{--bg:#0C0C10;--fg:#EDEDF2;--dim:#9A9AA8;--line:#26262F;--card:#141419;
  --good:#3FD08A;--warn:#E0A83C;--bad:#FF7A63;--accent:#7AA0FF;--ink-ref:#EDEDF2;--ink-gen:#7AA0FF;}
:root[data-theme=light]{--bg:#F7F7FB;--fg:#101014;--dim:#6C6C7A;--line:#DCDCE6;--card:#FFFFFF;
  --good:#1B8F5A;--warn:#B0730A;--bad:#C8361E;--ink-ref:#101014;--ink-gen:#2A63F6;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--fg);
  font:15px/1.55 ui-sans-serif,system-ui,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:1280px;margin:0 auto;padding:32px 20px 80px}
h1{font-size:28px;margin:0 0 6px;letter-spacing:-.02em}
h2{font-size:19px;margin:40px 0 12px;letter-spacing:-.01em}
.sub{color:var(--dim);margin:0 0 24px;max-width:70ch}
.stats{display:flex;flex-wrap:wrap;gap:10px;margin:0 0 22px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:10px 14px;min-width:120px}
.stat b{display:block;font-size:22px;letter-spacing:-.02em}
.stat span{color:var(--dim);font-size:12px}
.bar{display:flex;height:8px;border-radius:99px;overflow:hidden;border:1px solid var(--line);margin:0 0 24px}
.bar i{display:block}
.controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:0 0 18px;position:sticky;top:0;
  background:var(--bg);padding:10px 0;z-index:5;border-bottom:1px solid var(--line)}
button,select{font:inherit;font-size:13px;background:var(--card);color:var(--fg);
  border:1px solid var(--line);border-radius:9px;padding:6px 11px;cursor:pointer}
button[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:14px}
.card{background:var(--card);border:1px solid var(--line);border-left-width:4px;border-radius:14px;padding:14px 16px}
.card.good{border-left-color:var(--good)} .card.warn{border-left-color:var(--warn)}
.card.bad{border-left-color:var(--bad)} .card.err{border-left-color:var(--bad)}
.card header{display:flex;align-items:baseline;justify-content:space-between;gap:10px}
h3{font-size:15px;margin:0;font-weight:600;letter-spacing:-.01em}
h3 .v{color:var(--dim);font-weight:400;font-size:12px;margin-left:7px}
.dev{font-variant-numeric:tabular-nums;font-size:15px}
.good .dev{color:var(--good)} .warn .dev{color:var(--warn)} .bad .dev{color:var(--bad)}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:12px 0 10px}
figure{margin:0;text-align:center}
.box{background:var(--bg);border:1px solid var(--line);border-radius:10px;aspect-ratio:1;
  display:flex;align-items:center;justify-content:center;overflow:hidden}
.ic{width:78%;height:78%;fill:currentColor;display:block}
figcaption{color:var(--dim);font-size:11px;margin-top:4px}
.no{color:var(--dim);font-size:11px}
dl.meta{display:grid;grid-template-columns:auto 1fr;gap:2px 10px;margin:0 0 8px;font-size:12px}
dl.meta dt{color:var(--dim)} dl.meta dd{margin:0;font-variant-numeric:tabular-nums}
.law,.arg,.axes{margin:8px 0 0;font-size:12.5px;line-height:1.5}
.law{color:var(--dim)} .law b,.arg b,.axes b{color:var(--fg)}
.arg{background:color-mix(in srgb,var(--warn) 10%,transparent);border-radius:9px;padding:9px 11px}
.axes{color:var(--dim)}
table.tok{width:100%;border-collapse:collapse;font-size:13px;background:var(--card);
  border:1px solid var(--line);border-radius:12px;overflow:hidden}
table.tok th{text-align:left;color:var(--dim);font-weight:500;font-size:12px}
table.tok th,table.tok td{padding:7px 12px;border-bottom:1px solid var(--line)}
table.tok tr:last-child td{border-bottom:0}
code{font:12.5px/1 ui-monospace,SFMono-Regular,Menlo,monospace;background:var(--bg);
  border:1px solid var(--line);border-radius:5px;padding:1px 5px}
.note{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:14px 16px;
  margin:14px 0;max-width:80ch}
.note p{margin:0 0 8px} .note p:last-child{margin:0}
.scroll{overflow-x:auto}
.strip{background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:0 0 12px}
.strip h4{margin:0 0 4px;font-size:14px;letter-spacing:-.01em}
.strip p{margin:0 0 12px;color:var(--dim);font-size:12.5px;max-width:80ch}
.strip .cells{display:flex;gap:10px;flex-wrap:wrap}
.strip .cells figure{width:92px}
@media (max-width:640px){.row{grid-template-columns:repeat(3,1fr)}.wrap{padding:20px 12px 60px}}
</style>
<div class="wrap">
<h1>lab-icons — сходимость</h1>
<p class="sub">Каждая иконка построена из токенов, а не нарисована. Здесь она поставлена рядом
со своим замороженным оригиналом. Отклонение — площадное <code>1 − IoU</code> по чернилам на
растре 384². Всё, что выше ${(ARGUE_AT * 100).toFixed(0)}%, обязано предъявить письменный аргумент.</p>

<div class="stats">
  <div class="stat"><b>${sum.declared}</b><span>имён объявлено</span></div>
  <div class="stat"><b>${sum.rendered}</b><span>вариантов отрисовано</span></div>
  <div class="stat"><b>${converged}/${sum.measured}</b><span>сошлось</span></div>
  <div class="stat"><b>${pct(sum.median)}</b><span>медиана отклонения</span></div>
  <div class="stat"><b>${pct(sum.p90)}</b><span>p90</span></div>
  <div class="stat"><b>${sum.errors}</b><span>ошибок сборки</span></div>
</div>
<div class="bar">
  <i style="background:var(--good);width:${(100 * rows.filter((r) => r.deviation != null && r.deviation <= ARGUE_AT).length) / Math.max(1, sum.measured)}%"></i>
  <i style="background:var(--warn);width:${(100 * rows.filter((r) => r.deviation != null && r.deviation > ARGUE_AT && r.verdict?.kind === 'registration').length) / Math.max(1, sum.measured)}%"></i>
  <i style="background:var(--bad);width:${(100 * rows.filter((r) => r.deviation != null && r.deviation > ARGUE_AT && r.verdict?.kind !== 'registration').length) / Math.max(1, sum.measured)}%"></i>
</div>

<div class="note">
<p><b>Почему одного процента мало.</b> Площадная метрика на штриховом глифе нелинейно жестока:
для двух штрихов пера <code>w</code>, разошедшихся на <code>δ</code> по нормали,
<code>1 − IoU ≈ 2δ/(2w − δ)</code>. При пере 1.8 смещение <b>0.027 ед.</b> — одна восемьсот
девяностая канвы — уже даёт 3%.</p>
<p>Собственный разброс руки больше этого порога: у <code>chevron-down</code> два терминала
ОДНОГО штриха стоят на 0.063 друг от друга, а плечи идут под 44.75° вместо 45°. То есть на
штрихах порог 3% меряет дребезг оригинала, а не расхождение конструкции.</p>
<p>Поэтому рядом с процентом стоит <b>смещение контура</b> — медиана расстояния от контура
генерата до контура оригинала, в единицах канвы и в долях пера. Карточка с вердиктом
<code>registration</code> (медиана ≤ 0.06 ед. при сопоставимой площади чернил) считается
сошедшейся: форма совпала, разошлась посадка, и разошлась она в пределах точности руки.</p>
</div>

<h2>Конституция</h2>
<p class="sub">Все токены — доли канвы. Номиналы приведены при канве 24; смена канвы
масштабирует дисциплину пропорционально.</p>
<div class="scroll">${tokenTable()}</div>
<h2>Выводы, а не токены</h2>
<p class="sub">Эти числа нельзя задать — они следуют. Столбец «замер руки» показывает, что
формула не подогнана под рисунок, а объясняет его.</p>
<div class="scroll">${derivedTable()}</div>

<h2>Оси вариативности</h2>
<p class="sub">Иконка здесь — не файл, а функция от осей, как начертание вариативного шрифта.
Границы диапазонов не выбраны на вкус: они выведены из негативного пространства и из
предела различимости пера.</p>
${variableSection()}

<h2>Цифровой знак</h2>
<p class="sub">calendar-number несёт СЕГОДНЯШНЕЕ число (${new Date().getDate()}) и рисует его
собственным знаком.</p>
${numeralSection()}

<h2>Глифы</h2>
<div class="controls">
  <button data-f="all" aria-pressed="true">все</button>
  <button data-f="bad">спорные</button>
  <button data-f="good">сошлось</button>
  <select id="fam"><option value="">все семьи</option>${families.map((f) => `<option>${esc(f)}</option>`).join('')}</select>
  <select id="var"><option value="">оба варианта</option><option value="outline">outline</option><option value="filled">filled</option></select>
  <button id="theme">тема</button>
</div>
<div class="grid" id="grid">${byDev.map(card).join('')}</div>
</div>
<script>
const grid=document.getElementById('grid');
let mode='all', fam='', vr='';
function apply(){
  for(const c of grid.children){
    const dev=parseFloat(c.dataset.dev);
    const reg=c.classList.contains('warn');
    let ok=true;
    if(mode==='bad') ok = c.classList.contains('bad')||c.classList.contains('err');
    if(mode==='good') ok = c.classList.contains('good')||reg;
    if(fam && c.dataset.family!==fam) ok=false;
    if(vr && c.dataset.variant!==vr) ok=false;
    c.style.display = ok?'':'none';
  }
}
for(const b of document.querySelectorAll('button[data-f]')){
  b.onclick=()=>{mode=b.dataset.f;
    document.querySelectorAll('button[data-f]').forEach(x=>x.setAttribute('aria-pressed',x===b));apply();};
}
document.getElementById('fam').onchange=e=>{fam=e.target.value;apply()};
document.getElementById('var').onchange=e=>{vr=e.target.value;apply()};
document.getElementById('theme').onclick=()=>{
  const r=document.documentElement;
  const cur=r.dataset.theme || (matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');
  r.dataset.theme = cur==='dark'?'light':'dark';
};
</script>`;
}

if (process.argv[1] && process.argv[1].endsWith('preview.js')) {
  const rows = buildAll();
  mkdirSync(`${ROOT}/docs`, { recursive: true });
  writeFileSync(`${ROOT}/docs/preview.html`, render(rows));
  const s = summarize(rows);
  console.log(`docs/preview.html — ${s.declared} имён, ${s.rendered} вариантов, медиана ${pct(s.median)}`);
}
