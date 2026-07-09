/**
 * build-preview.mjs — ДЕТЕРМИНИРОВАННАЯ корпусная витрина «рука vs закон» (EC5).
 *
 * Для КАЖДОГО глифа semantics/anatomy.json (все задекларированные варианты),
 * сгруппировано по семьям, рендерит бок-о-бок:
 *   ОРИГИНАЛ (рука)  — если отгрузка status:hand — текущий svg; если отгрузка
 *                      уже generated — рука из git-истории: последняя ревизия
 *                      файла (git log --follow), в которой статус варианта в
 *                      semantics/anatomy.json ещё НЕ был generated (до
 *                      декларации = рука по построению). Источник подписан.
 *   ГЕНЕРАТ (закон)  — buildGlyph(decl) → path ЖИВЬЁМ (продакшен-генерат).
 *   ОТКЛОНЕНИЕ %     — (1 − inkIoU(рука, генерат)) · 100 (примитив гейтов).
 *   АРГУМЕНТ         — parked-причина / correctionReason / lawOverHand;
 *                      ОБЯЗАТЕЛЕН при отклонении >3%.
 *
 * Секция PARKED — витрина честности: причины пересняты ЖИВЫМ dry-run
 * scripts/migrate/promote-wave.mjs (та же формула, что вела последнюю волну).
 *
 * Секция AXIS-SWEEP — парадигма вариативного шрифта (Roboto Flex) для
 * клиентской кастомизации lab ui: промоутнутые глифы × веер осей
 * weight (0.8/1.0/1.2) × corner (0/0.6/1.0 — множитель ζ cornerSmoothing).
 *
 * Число = ПОЛ, не вердикт (N2): форму судит глаз на ОТГРУЖЕННОМ svg. Строки
 * с lawOverHand=true — «закон-поверх-руки»: генерат СОЗНАТЕЛЬНО расходится с
 * противоречивой рукой; отклонение тут ОЖИДАЕМО и обосновано, не дефект.
 *
 * Регенерация детерминирована из корпуса+истории: node scripts/build-preview.mjs
 * Вывод — preview/corpus.html (gitignored, регенерируемый артефакт).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGlyph } from './lib/anatomy-gen.js';
import { renderedPathData } from './lib/icon-geometry.js';
import { inkIoU } from './check-anatomy-drift.js';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..');

const grid = JSON.parse(readFileSync(join(REPO, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(REPO, 'semantics', 'anatomy.json'), 'utf8'));
const cw = grid.canvas.width;

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/** Инлайн-SVG из path-data (генерат): outline рендерим заливкой evenodd (силуэт). */
const genSvg = (d, size = 72) =>
  `<svg viewBox="0 0 ${cw} ${cw}" width="${size}" height="${size}"><path d="${esc(d)}" fill="currentColor" fill-rule="evenodd"/></svg>`;

// stderr — pipe (не наследуем): ожидаемые промахи git show (anatomy.json до
// своего рождения) ловятся catch-ем и не шумят fatal-строками в отчёт витрины
const git = (...args) =>
  execFileSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });

// ── PARKED: живой dry-run промоушен-формулы (та же, что вела волну) ─────────
function collectParked() {
  const out = execFileSync(process.execPath, [join(REPO, 'scripts', 'migrate', 'promote-wave.mjs')], {
    cwd: REPO,
    encoding: 'utf8',
  });
  const m = out.match(/\nPARKED \(\d+\):\n([\s\S]*?)(?:\n\n|\nWARN|\nadjacency)/);
  if (!m) throw new Error('build-preview: dry-run promote-wave не отдал секцию PARKED — формат отчёта изменился');
  const parked = [];
  for (const line of m[1].split('\n')) {
    const mm = line.match(/^ {2}([\w-]+)\/([\w+]+) = (.+)$/);
    if (mm) parked.push({ name: mm[1], variant: mm[2], reason: mm[3] });
  }
  if (parked.length === 0) throw new Error('build-preview: PARKED распарсился пустым — формат отчёта изменился');
  return parked;
}

// ── рука из git-истории (для отгрузок, уже заменённых генератом) ────────────
const anatomyAtCache = new Map();
function anatomyAt(sha) {
  if (!anatomyAtCache.has(sha)) {
    let parsed = null;
    try {
      parsed = JSON.parse(git('show', `${sha}:semantics/anatomy.json`));
    } catch {
      parsed = null; // anatomy.json ещё не существовал ⇒ весь корпус — рука
    }
    anatomyAtCache.set(sha, parsed);
  }
  return anatomyAtCache.get(sha);
}

/** Ревизии файла (новые→старые) с путём на момент ревизии (--follow, переименования). */
function fileHistory(relPath) {
  const raw = git('log', '--follow', '--format=@%H %cs', '--name-only', '--', relPath);
  const revs = [];
  let cur = null;
  for (const line of raw.split('\n')) {
    if (line.startsWith('@')) {
      const [sha, date] = line.slice(1).split(' ');
      cur = { sha, date, path: null };
      revs.push(cur);
    } else if (line.trim() && cur && !cur.path) {
      cur.path = line.trim();
    }
  }
  return revs.filter((r) => r.path);
}

/**
 * Последний hand-коммит файла: новейшая ревизия, в которой статус варианта
 * в anatomy.json того же коммита ещё НЕ был generated (глиф не задекларирован
 * = рука по построению — корпус рождался рукой).
 */
function handFromHistory(relPath, name, variant) {
  for (const rev of fileHistory(relPath)) {
    const an = anatomyAt(rev.sha);
    const status = an?.glyphs?.[name]?.status?.[variant];
    if (status === 'generated') continue;
    try {
      return { svg: git('show', `${rev.sha}:${rev.path}`), sha: rev.sha.slice(0, 7), date: rev.date };
    } catch {
      // ревизия — удаление/переименование без блоба: идём глубже
    }
  }
  return null;
}

// ── корпус: ряды по глифам/вариантам ────────────────────────────────────────
const FAMILY_MERGE = { checkmarks: 'checkmark' };
const familyOf = (name) => {
  const t = name.split('-')[0];
  return FAMILY_MERGE[t] ?? t;
};
const shippedPath = (name, v) => (v === 'outline' ? `svg/Outline/${name}.svg` : `svg/Filled/${name}_filled.svg`);

const parked = collectParked();
const parkedOf = (name, variant) =>
  parked.find((p) => p.name === name && p.variant.split('+').includes(variant)) ?? null;

const rows = [];
for (const [name, entry] of Object.entries(anatomy.glyphs)) {
  let built;
  try {
    built = buildGlyph(entry, grid, {}, anatomy.glyphs);
  } catch (err) {
    throw new Error(`build-preview: buildGlyph(${name}) упал: ${err.message}`);
  }
  for (const variant of ['outline', 'filled']) {
    const status = entry.status?.[variant];
    if (!status) continue;
    const gen = built[variant];
    if (!gen) throw new Error(`build-preview: ${name}/${variant} задекларирован (${status}), но генерат не строится`);

    const rel = shippedPath(name, variant);
    let handSvg = null;
    let handSource = '';
    if (status === 'hand') {
      if (!existsSync(join(REPO, rel))) throw new Error(`build-preview: ${rel} (status:hand) отсутствует на диске`);
      handSvg = readFileSync(join(REPO, rel), 'utf8');
      handSource = 'рука — текущая отгрузка';
    } else {
      const h = handFromHistory(rel, name, variant);
      if (h) {
        handSvg = h.svg;
        handSource = `рука@${h.sha} (${h.date}) — последний hand-коммит, git log --follow`;
      } else {
        handSource = 'руки в истории нет — глиф рождён законом';
      }
    }

    let devPct = null;
    if (handSvg) {
      const handD = renderedPathData(handSvg).join(' ');
      devPct = (1 - inkIoU(handD, gen, cw)) * 100;
    }

    // Аргумент: parked-причина (почему рука ещё не заменена) > correctionReason
    // (почему генерат расходится) > честный fallback (обязателен при >3%).
    const pk = parkedOf(name, variant);
    const lawOverHand = entry.lawOverHand === true;
    let argument = '';
    if (pk) argument = `PARKED: ${pk.reason}`;
    else if (entry.correctionReason) argument = entry.correctionReason;
    else if (devPct != null && devPct > 3) {
      argument =
        'аргумент не задекларирован: расхождение с исторической рукой сверх 3% — кандидат на correctionReason при следующей волне';
    }
    rows.push({
      name,
      variant,
      status,
      family: familyOf(name),
      prims: entry.archetype === 'composite' ? [...new Set(entry.parts.map((p) => p.primitive))] : [entry.archetype],
      handSvg,
      handSource,
      gen,
      devPct,
      lawOverHand,
      argument,
      fid: entry.fidelityToHand?.[variant],
    });
  }
}

// ── HTML: корпус по семьям ──────────────────────────────────────────────────
const families = [...new Set(rows.map((r) => r.family))].sort();
const corpusHtml = families
  .map((fam) => {
    const fr = rows.filter((r) => r.family === fam).sort((a, b) => a.name.localeCompare(b.name) || a.variant.localeCompare(b.variant));
    const nGen = fr.filter((r) => r.status === 'generated').length;
    const nHand = fr.length - nGen;
    const trs = fr
      .map((r) => {
        const dev = r.devPct == null ? '—' : `${r.devPct.toFixed(2)}%`;
        const devClass = r.devPct == null ? 'dev' : r.devPct > 3 ? (r.lawOverHand || r.status === 'hand' ? 'dev law' : 'dev warn') : 'dev ok';
        const stBadge =
          r.status === 'generated'
            ? '<span class="badge gen">generated</span>'
            : '<span class="badge hand">hand (parked)</span>';
        const lawBadge = r.lawOverHand ? ' <span class="badge law">закон-поверх-руки</span>' : '';
        const orig = r.handSvg
          ? `${r.handSvg}<div class="src">${esc(r.handSource)}</div>`
          : `<div class="src">${esc(r.handSource)}</div>`;
        const fidNote = r.fid != null ? `<div class="src">fid волны: ${r.fid}</div>` : '';
        return `<tr>
      <td class="name">${esc(r.name)} <span class="prims">/${r.variant}</span><br>${stBadge}${lawBadge}<br><span class="prims">${esc(r.prims.join(' · '))}</span></td>
      <td class="cell">${orig}</td>
      <td class="cell gen-cell">${genSvg(r.gen)}</td>
      <td class="${devClass}">${dev}${fidNote}</td>
      <td class="argcell">${r.argument ? esc(r.argument) : '<span class="muted">—</span>'}</td>
    </tr>`;
      })
      .join('\n');
    return `<h2>семья «${esc(fam)}» <span class="prims">(${fr.length} вариантов: ${nGen} generated, ${nHand} hand)</span></h2>
<table>
<thead><tr><th>глиф / вариант</th><th>оригинал (рука)</th><th>генерат (закон)</th><th>отклонение</th><th>аргумент</th></tr></thead>
<tbody>
${trs}
</tbody></table>`;
  })
  .join('\n');

// ── HTML: PARKED — витрина честности ────────────────────────────────────────
const parkedHtml = parked
  .map((p) => `<tr><td class="name">${esc(p.name)} <span class="prims">/${p.variant}</span></td><td class="argcell">${esc(p.reason)}</td></tr>`)
  .join('\n');

// ── HTML: axis-sweep (вариативность weight × corner) ───────────────────────
const SWEEP_GLYPHS = ['tablet-portrait', 'square', 'play-circle', 'minus-circle', 'chevron-down-circle'];
const WEIGHTS = [0.8, 1.0, 1.2];
const CORNERS = [0, 0.6, 1.0];
const sweepHtml = SWEEP_GLYPHS.map((name) => {
  const entry = anatomy.glyphs[name];
  if (!entry) throw new Error(`build-preview: axis-sweep глиф «${name}» не задекларирован`);
  const cells = WEIGHTS.map((w) => {
    const tds = CORNERS.map((c) => {
      const d = buildGlyph(entry, grid, { weight: w, corner: c }, anatomy.glyphs).outline;
      if (!d || /NaN|Infinity/.test(d)) throw new Error(`build-preview: sweep ${name} w=${w} c=${c} дал невалидный путь`);
      return `<td class="cell sweep-cell">${genSvg(d, 56)}<div class="src">w ${w} · ζ ${(c * (grid.ratios.cornerSmoothing ?? 0)).toFixed(2)}</div></td>`;
    }).join('');
    return `<tr><th class="axis">weight ${w}</th>${tds}</tr>`;
  }).join('\n');
  return `<h3>${esc(name)} <span class="prims">/outline</span></h3>
<table class="sweep">
<thead><tr><th></th>${CORNERS.map((c) => `<th>corner ${c}</th>`).join('')}</tr></thead>
<tbody>
${cells}
</tbody></table>`;
}).join('\n');

const html = `<!doctype html><html lang="ru"><head><meta charset="utf-8">
<title>lab-icons — корпусная витрина: рука vs закон</title>
<style>
:root{color-scheme:light dark}
body{font:14px/1.5 system-ui,sans-serif;margin:32px;color:#111;background:#fff}
@media(prefers-color-scheme:dark){body{color:#eee;background:#111}}
h1{font-size:20px}h2{font-size:16px;margin-top:32px}h3{font-size:14px;margin-top:20px}
.sub{opacity:.7;margin-bottom:24px;max-width:960px}
table{border-collapse:collapse;width:100%;max-width:1100px}
th,td{border:1px solid #8884;padding:10px;text-align:center;vertical-align:middle}
th{background:#8881;font-weight:600}
.name{text-align:left;font-weight:600;min-width:170px}
.cell svg{color:currentColor;width:72px;height:72px}.gen-cell{background:#0080ff10}
.sweep{width:auto}.sweep-cell svg{width:56px;height:56px}.axis{font-weight:600;white-space:nowrap}
.prims{font-weight:400;opacity:.6;font-size:12px}
.src{opacity:.55;font-size:11px;max-width:200px;margin:4px auto 0}
.dev{font-variant-numeric:tabular-nums;font-weight:700}
.dev.ok{color:#1a8}.dev.warn{color:#c60}.dev.law{color:#a5a}
.argcell{text-align:left;max-width:360px;font-size:13px}
.badge{display:inline-block;font-size:11px;padding:1px 6px;border-radius:4px;margin-top:4px}
.badge.law{background:#a5a3;color:#a5a}.badge.hand{background:#c603;color:#c60}.badge.gen{background:#1a83;color:#1a8}
.muted{opacity:.4}
</style></head><body>
<h1>lab-icons — корпусная витрина: рука vs закон</h1>
<div class="sub">Все глифы semantics/anatomy.json (${rows.length} вариантов / ${new Set(rows.map((r) => r.name)).size} глифов), по семьям.
Колонки: оригинал (рука; для generated-отгрузок — из git-истории, источник подписан) | генерат (закон, buildGlyph живьём) |
отклонение % = (1−inkIoU)·100 | аргумент (parked-причина / correctionReason; обязателен при &gt;3%).
Число — ПОЛ, не вердикт: форму судит глаз (N2). Детерминированно: <code>node scripts/build-preview.mjs</code>.</div>
${corpusHtml}
<h2>PARKED — витрина честности <span class="prims">(${parked.length} записей; живой dry-run promote-wave — та же формула, что вела волну)</span></h2>
<table>
<thead><tr><th>глиф / вариант</th><th>причина парковки</th></tr></thead>
<tbody>
${parkedHtml}
</tbody></table>
<h2>AXIS-SWEEP — оси вариативности <span class="prims">(парадигма Roboto Flex для кастомизации lab ui)</span></h2>
<div class="sub">Промоутнутые глифы × weight (множитель штриховых токенов) × corner (множитель ζ cornerSmoothing=${grid.ratios.cornerSmoothing}).
ζ-носители — задекларированные скругления rounded-rect / rounded-polygon; кольца и штрихи corner-инвариантны by construction
(minus-circle: тире-капсула ⇒ ζ_eff=0 бюджетом Figma; chevron-down-circle: stroke-v без ζ — колонки совпадают, это честно).</div>
${sweepHtml}
</body></html>`;

const OUT = join(REPO, 'preview', 'corpus.html');
mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, html, 'utf8');

console.log(`✓ corpus preview: ${rows.length} вариантов / ${new Set(rows.map((r) => r.name)).size} глифов, PARKED ${parked.length}, sweep ${SWEEP_GLYPHS.length}×${WEIGHTS.length}×${CORNERS.length} → ${OUT}`);
for (const r of rows.filter((q) => q.devPct != null && q.devPct > 3)) {
  console.log(`  >3%: ${r.name}/${r.variant} dev=${r.devPct.toFixed(2)}% статус=${r.status} аргумент=${r.argument ? 'есть' : 'НЕТ'}`);
}
