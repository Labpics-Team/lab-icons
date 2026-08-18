#!/usr/bin/env node
/**
 * SEM-00/SIZE-01: generated census — семьи форм, примитивы, аттрибуция bundle.
 * Запись: semantics/census.json. SSOT — catalog/anatomy/dist; файл генерируем,
 * руками не правится (проверяется check-census-fresh в verify).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { pathBBox } from '../../src/core/path-data.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

const catalog = read('semantics/catalog.json');
const anatomy = read('semantics/anatomy.json');

// --- примитивы и роли по глифам анатомии ---
const primitives = {};
const roles = {};
const archetypes = {};
for (const g of Object.values(anatomy.glyphs)) {
  archetypes[g.archetype] = (archetypes[g.archetype] ?? 0) + 1;
  for (const p of g.parts ?? []) {
    primitives[p.primitive] = (primitives[p.primitive] ?? 0) + 1;
    if (p.role) roles[p.role] = (roles[p.role] ?? 0) + 1;
  }
}

// --- структурные семьи source-only ---
const sourceOnly = Object.entries(catalog.icons)
  .filter(([, ic]) => !ic.model)
  .map(([n]) => n)
  .sort();
const structural = { enclosure: [], directional: [], 'off-slash': [], badge: [], singleton: [] };
for (const n of sourceOnly) {
  if (/-circle$/.test(n)) structural.enclosure.push(n);
  else if (/-(up|down|back|forward|left|right|horizontal|vertical)/.test(n)) structural.directional.push(n);
  else if (/-off$/.test(n)) structural['off-slash'].push(n);
  else if (/(badge|notification|alert)/.test(n)) structural.badge.push(n);
  else structural.singleton.push(n);
}

// --- аттрибуция dist/ir/index.js по маркерам esbuild + consumer-бюджеты ---
// dist обязателен: census без bundle-секции недетерминирован относительно
// состояния рабочей копии (finding изолированного ревью PR #81).
const irSrc = readFileSync(join(ROOT, 'dist', 'ir', 'index.js'), 'utf8');
const markers = [...irSrc.matchAll(/^\/\/ ([^\n]+)$/gm)].map((m) => ({ path: m[1], idx: m.index }));
const mods = markers.map((m, i) => ({
  path: m.path,
  bytes: (i + 1 < markers.length ? markers[i + 1].idx : irSrc.length) - m.idx,
}));
mods.sort((a, b) => b.bytes - a.bytes);
const bundle = { totalBytes: irSrc.length, modules: mods };

const staticSrc = readFileSync(join(ROOT, 'dist', 'index.js'));
const consumerBudgets = {
  comment:
    'SIZE-01: цена потребителю по маршрутам импорта; one-icon цену доказывает check-treeshake (rollup), здесь замер полных артефактов',
  fullStaticCatalog: { raw: staticSrc.length, gzip: gzipSync(staticSrc).length },
  glyphRuntime: {
    raw: irSrc.length,
    gzip: gzipSync(Buffer.from(irSrc)).length,
    note: 'один glyph() тянет весь IR-бандл: JSON-данные доминируют — кандидат на split/lazy в REL-волне',
  },
};

// --- SEM-00: замер enclosure-семьи — масштаб контента внутри кольца ---
// Факт для SEM-01: закон "standalone → в кольце" не один; каждый вход несёт
// свой измеренный scale (перерисовка руки, не аффинное сжатие).
function contentBBox(file, dropRing) {
  const svg = readFileSync(join(ROOT, file), 'utf8');
  let boxes = [...svg.matchAll(/ d="([^"]+)"/g)].map((m) => ({ box: pathBBox(m[1]) }));
  if (dropRing) {
    boxes.sort((a, b) => (b.box.maxX - b.box.minX) - (a.box.maxX - a.box.minX));
    boxes = boxes.slice(1);
  }
  let minX = 99, minY = 99, maxX = -99, maxY = -99;
  for (const { box: b } of boxes) {
    minX = Math.min(minX, b.minX); minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX); maxY = Math.max(maxY, b.maxY);
  }
  return { w: maxX - minX, h: maxY - minY, cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}
const enclosureScale = {};
for (const enc of structural.enclosure) {
  const base = enc.replace(/-circle$/, '');
  try {
    const solo = contentBBox(`svg/Outline/${base}.svg`, false);
    const inner = contentBBox(`svg/Outline/${enc}.svg`, true);
    enclosureScale[enc] = {
      base,
      scaleW: Number((inner.w / solo.w).toFixed(3)),
      scaleH: Number((inner.h / solo.h).toFixed(3)),
      contentCenter: [Number(inner.cx.toFixed(2)), Number(inner.cy.toFixed(2))],
    };
  } catch {
    enclosureScale[enc] = { base, error: 'no standalone counterpart' };
  }
}

// --- SEM-00: замер off-slash семьи — общность капсулы слэша ---
// Слэш = первый субпуть (до Z) первого path. Кластеризация по нормализованной
// строке даёт reuse-кластеры для SEM-01 (INV-07: закон при ≥2 consumers).
const slashClusters = {};
for (const off of structural['off-slash']) {
  try {
    const svg = readFileSync(join(ROOT, `svg/Outline/${off}.svg`), 'utf8');
    const d = svg.match(/ d="([^"]+)"/)[1];
    const first = d.split(/[Zz]/)[0].replace(/\s+/g, ' ').trim();
    // ключ кластера: округляем числа до 1 знака — ловим бит-в-бит и почти-равные
    const key = first.replace(/-?\d+\.?\d*/g, (n) => Number(n).toFixed(1));
    (slashClusters[key] ??= []).push(off);
  } catch { /* нет файла — имя уйдёт в residual других гейтов */ }
}
const offSlashLaw = Object.values(slashClusters)
  .map((names) => ({ consumers: names.sort(), shared: names.length >= 2 }))
  .sort((a, b) => b.consumers.length - a.consumers.length);

const census = {
  generatedBy: 'scripts/census/build-census.mjs',
  sourceOnlyCount: sourceOnly.length,
  modeledCount: Object.keys(anatomy.glyphs).length,
  archetypes,
  primitives: Object.fromEntries(Object.entries(primitives).sort((a, b) => b[1] - a[1])),
  roles: Object.fromEntries(Object.entries(roles).sort((a, b) => b[1] - a[1])),
  structuralFamilies: Object.fromEntries(
    Object.entries(structural).map(([k, v]) => [k, { count: v.length, names: v }]),
  ),
  enclosureScale,
  offSlashLaw,
  bundle,
  consumerBudgets,
};

writeFileSync(join(ROOT, 'semantics', 'census.json'), JSON.stringify(census, null, 1) + '\n');
console.log(
  `census: ${census.modeledCount} modeled / ${census.sourceOnlyCount} source-only; ` +
    `families: enclosure ${structural.enclosure.length}, directional ${structural.directional.length}, ` +
    `off-slash ${structural['off-slash'].length}, badge ${structural.badge.length}, singleton ${structural.singleton.length}` +
    (bundle ? `; bundle ${bundle.totalBytes}B` : ''),
);
