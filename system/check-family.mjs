/**
 * system/check-family.mjs — проверка ОДНОГО модуля семьи в изоляции.
 *
 * Нужен, чтобы автор семьи мерил себя, не завися от того, в каком состоянии
 * сейчас чужие модули: общая сборка импортирует всё сразу и краснеет от
 * соседа. Здесь импортируется ровно один файл.
 *
 *   node system/check-family.mjs system/glyphs/arrows.js [--d имя]
 */

import { readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { glyphs, buildGlyph } from './registry.js';
import { maskFromSvg, maskFromPath, compare, diffClusters, classify, contourOffset } from './metrics.js';
import { pathsFromSvg, polylinesFromD } from './core/parse.js';
import { T } from './tokens.js';
import { toSvg } from './render.js';

const file = process.argv[2];
if (!file) {
  console.error('укажи модуль: node system/check-family.mjs system/glyphs/<семья>.js');
  process.exit(2);
}
await import(pathToFileURL(file).href);

const showD = process.argv.includes('--d') ? process.argv[process.argv.indexOf('--d') + 1] : null;
const ref = (v, n) => `reference/${v === 'filled' ? 'Filled' : 'Outline'}/${n}${v === 'filled' ? '_filled' : ''}.svg`;

let n = 0;
let ok = 0;
const rows = [];
for (const [name, def] of glyphs) {
  for (const variant of ['outline', 'filled']) {
    if (variant === 'filled' && def.deriveFilled === 'none' && !def.filled) continue;
    let path;
    try {
      path = buildGlyph(name, variant);
    } catch (e) {
      rows.push({ name, variant, err: String(e.message || e) });
      continue;
    }
    const f = ref(variant, name);
    if (!existsSync(f)) {
      rows.push({ name, variant, err: 'нет оригинала' });
      continue;
    }
    const svg = readFileSync(f, 'utf8');
    const a = maskFromSvg(svg);
    const b = maskFromPath(path);
    const cmp = compare(a, b);
    const cl = diffClusters(a, b);
    const off = contourOffset(
      pathsFromSvg(svg).flatMap((p) => polylinesFromD(p.d, 0.01)),
      path.flatten(0.01),
    );
    const pen = variant === 'filled' ? T.stroke.bold : T.stroke.base;
    const v = classify(cmp, cl, off, pen);
    n++;
    if (cmp.deviation <= 0.03 || v.kind === 'registration') ok++;
    rows.push({ name, variant, dev: cmp.deviation, off: off.median, p95: off.p95, kind: v.kind, note: v.note, segs: path.subs.reduce((s, x) => s + x.segs.length, 0) });
    if (showD === name && variant === 'outline') console.log(`d(${name}) = ${path.toD()}\n`);
  }
}

rows.sort((x, y) => (y.dev ?? 9) - (x.dev ?? 9));
for (const r of rows) {
  if (r.err) {
    console.log(`${(r.name + '/' + r.variant).padEnd(32)} ОШИБКА: ${r.err}`);
    continue;
  }
  console.log(
    `${(r.name + '/' + r.variant).padEnd(32)} ${((r.dev * 100).toFixed(2) + '%').padStart(8)}  ` +
      `смещ ${r.off.toFixed(3)} (p95 ${r.p95.toFixed(2)})  ${r.kind}${r.dev > 0.03 && r.note ? ' — ' + r.note.slice(0, 110) : ''}`,
  );
}
console.log(`\nсошлось ${ok}/${n} (≤3% площади ИЛИ вердикт registration)`);
