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
