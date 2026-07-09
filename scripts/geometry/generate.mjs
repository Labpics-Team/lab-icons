// Генератор производной геометрии lab-icons.
// Канон → производные (зеркала/повороты), кольца/диски — канонические строки.
// Запуск: node scripts/geometry/generate.mjs [--check]  (--check: не писать, только сверить)
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePath, serializePath, toAbsolute, applyAffine, extractPaths } from './path-ast.mjs';
import {
  RING, DISC, CIRCLE_ARROW_STEM, CIRCLE_ARROW_HEAD, CIRCLE_ARROW_WELDED,
  CHEVRON_OUTLINE, CHEVRON_FILLED, CIRCLE_CHEVRON, OPS, DERIVED,
} from './registry.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const CHECK = process.argv.includes('--check');
const svgPath = (dir, name) => join(ROOT, 'svg', dir, dir === 'Filled' ? `${name}_filled.svg` : `${name}.svg`);
const WRAP = (inner) =>
  `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">${inner}</svg>`;

let wrote = 0, drifted = [];
const emit = (p, content) => {
  const rel = p.split(/[\\/]/).slice(-2).join('/');
  if (existsSync(p) && readFileSync(p, 'utf8') === content) return;
  if (CHECK) { drifted.push(rel); return; }
  writeFileSync(p, content);
  wrote++;
  console.log(`✔ ${rel}`);
};

// ── классификация подпутей: кольцо/диск против глифа (по спану bbox концевых точек) ──
function splitSubpaths(d) {
  const abs = toAbsolute(parsePath(d));
  const subs = []; let cur = [];
  for (const c of abs) {
    if (c.cmd === 'M' && cur.length) { subs.push(cur); cur = []; }
    cur.push(c);
  }
  if (cur.length) subs.push(cur);
  return subs;
}
function span(sub) {
  const xs = [], ys = [];
  for (const { cmd, args } of sub) {
    if (cmd === 'A') { xs.push(args[5]); ys.push(args[6]); continue; }
    for (let k = 0; k < args.length - 1; k += 2) { xs.push(args[k]); ys.push(args[k + 1]); }
  }
  if (!xs.length) return 0;
  return Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
}
const isRingLike = (sub) => span(sub) > 17;

/** глиф-подпути файла (без кольца/диска), абсолютные AST */
function glyphSubs(file) {
  const svg = readFileSync(file, 'utf8');
  return extractPaths(svg)
    .flatMap(({ d }) => splitSubpaths(d))
    .filter((s) => !isRingLike(s));
}
const subsToD = (subs) => subs.map(serializePath).join('');
const transformSubs = (subs, op) => subs.map((s) => applyAffine(s, OPS[op]));

// Контракт слоёв (semantics/layers.json, хореографии): у Outline-enclosure
// глиф — ОТДЕЛЬНЫЙ path[0] (анимируется), кольцо — path[1] (стоит).
// Filled — один сваренный evenodd-path («бейдж целиком»).
const OUTLINE_ENCLOSURE = (glyphD) => `<path d="${glyphD}"/><path d="${RING}"/>`;

// ── каноны семейства «стрелка в круге» из примитивов ──
emit(svgPath('Outline', 'arrow-forward-circle'),
  WRAP(OUTLINE_ENCLOSURE(`${CIRCLE_ARROW_STEM}${CIRCLE_ARROW_HEAD}`)));
emit(svgPath('Filled', 'arrow-forward-circle'),
  WRAP(`<path fill-rule="evenodd" d="${DISC}${CIRCLE_ARROW_WELDED}" clip-rule="evenodd"/>`));

// ── каноны шеврона из примитивов (симметрия относительно y=12 by construction) ──
emit(svgPath('Outline', 'chevron-forward'), WRAP(`<path d="${CHEVRON_OUTLINE}"/>`));
emit(svgPath('Filled', 'chevron-forward'), WRAP(`<path d="${CHEVRON_FILLED}"/>`));
emit(svgPath('Outline', 'chevron-forward-circle'), WRAP(OUTLINE_ENCLOSURE(CIRCLE_CHEVRON)));
emit(svgPath('Filled', 'chevron-forward-circle'),
  WRAP(`<path fill-rule="evenodd" d="${DISC}${CIRCLE_CHEVRON}" clip-rule="evenodd"/>`));

// ── нормализация канонов circle-структуры (Outline: глиф path[0] + кольцо path[1]; Filled: один evenodd) ──
const CIRCLE_CANONS = ['play-forward-circle', 'play-skip-forward-circle', 'arrow-redo-circle'];
for (const name of CIRCLE_CANONS) {
  const o = glyphSubs(svgPath('Outline', name));
  emit(svgPath('Outline', name), WRAP(OUTLINE_ENCLOSURE(subsToD(o))));
  const f = glyphSubs(svgPath('Filled', name));
  emit(svgPath('Filled', name), WRAP(`<path fill-rule="evenodd" d="${DISC}${subsToD(f)}" clip-rule="evenodd"/>`));
}

// ── производные ──
for (const [name, { from, op }] of Object.entries(DERIVED)) {
  const isCircle = name.endsWith('-circle');
  for (const dir of ['Outline', 'Filled']) {
    const srcFile = svgPath(dir, from);
    if (!existsSync(srcFile)) throw new Error(`нет канона: ${srcFile}`);
    if (isCircle) {
      const g = transformSubs(glyphSubs(srcFile), op);
      const inner = dir === 'Outline'
        ? OUTLINE_ENCLOSURE(subsToD(g))
        : `<path fill-rule="evenodd" d="${DISC}${subsToD(g)}" clip-rule="evenodd"/>`;
      emit(svgPath(dir, name), WRAP(inner));
    } else {
      // прямые: трансформ всего d, атрибуты path сохраняем из источника
      const paths = extractPaths(readFileSync(srcFile, 'utf8'));
      const inner = paths.map(({ before, d, after }) =>
        `<path${before} d="${serializePath(applyAffine(toAbsolute(parsePath(d)), OPS[op]))}"${after}/>`).join('');
      emit(svgPath(dir, name), WRAP(inner));
    }
  }
}

if (CHECK) {
  if (drifted.length) {
    console.error(`ДРЕЙФ производной геометрии (${drifted.length}):\n` + drifted.map((x) => `  ${x}`).join('\n'));
    process.exit(1);
  }
  console.log('check: производная геометрия синхронна с реестром');
} else {
  console.log(`Генерация завершена, записано файлов: ${wrote}`);
}
