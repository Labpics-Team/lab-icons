#!/usr/bin/env node
/**
 * Гард анатомии @labpics/icons (этап 1) — кусается, не украшает.
 *
 * Проверяет dist/anatomy.json против dist/svg и модели этапа 1:
 *   1. Полнота: скелет есть у ВСЕХ иконок (444), лишних имён нет.
 *   2. Конечность: каждая метрика — конечное число (NaN в геометрии =
 *      битый парс, тихо пропускать нельзя).
 *   3. Домен: bbox внутри viewBox 0..24 с допуском 0.5px (артефакты
 *      кадрирования clipPath-иконок); площадь > 0; контуров ≥ 1.
 *   4. Детерминизм: пересборка в памяти байт-в-байт равна артефакту
 *      (артефакт не правился руками и не устарел).
 *   5. Биндинги (anatomy/bindings.json): каждое имя существует в анатомии,
 *      pivot-режим известен модели, оси конечны.
 *
 * RED-proof: испортить любую метрику в anatomy.json → (4) падает;
 * удалить иконку из bindings-имён → (5) падает.
 */

import { execFileSync } from 'child_process';
import { readFileSync, readdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

let errors = 0;
const fail = (msg) => {
  console.error(`✗  ${msg}`);
  errors++;
};

const anatomy = JSON.parse(readFileSync(join(ROOT, 'dist', 'anatomy.json'), 'utf8'));
const icons = anatomy.icons ?? {};

// 1. Полнота против dist/svg
const expected = new Set();
for (const variant of ['Filled', 'Outline']) {
  for (const f of readdirSync(join(ROOT, 'dist', 'svg', variant)).filter((f) =>
    f.endsWith('.svg'),
  )) {
    const base = f.replace(/\.svg$/, '');
    const camel = base.replace(/[-_](.)/g, (_, c) => c.toUpperCase());
    expected.add(variant === 'Filled' ? camel : `${camel}Outline`);
  }
}
for (const name of expected) {
  if (!icons[name]) fail(`нет скелета: ${name}`);
}
for (const name of Object.keys(icons)) {
  if (!expected.has(name)) fail(`лишний скелет: ${name}`);
}
if (expected.size !== 444) fail(`ожидалось 444 иконки, в dist/svg ${expected.size}`);

// 2-3. Конечность и домен
const finite = (x) => typeof x === 'number' && Number.isFinite(x);
for (const [name, a] of Object.entries(icons)) {
  const nums = [
    ...a.bbox,
    a.area,
    ...a.centroid,
    a.symmetry.x,
    a.symmetry.y,
    ...a.subpaths.flatMap((s) => [...s.bbox, s.areaSigned, ...s.centroid, s.perimeter, s.points]),
  ];
  if (!nums.every(finite)) fail(`${name}: неконечная метрика`);
  if (a.subpaths.length < 1) fail(`${name}: ноль контуров`);
  if (!(a.area > 0)) fail(`${name}: неположительная площадь ${a.area}`);
  const [x0, y0, x1, y1] = a.bbox;
  if (x0 < -0.5 || y0 < -0.5 || x1 > 24.5 || y1 > 24.5) {
    fail(`${name}: bbox вне viewBox±0.5: ${a.bbox}`);
  }
  if (!(a.symmetry.x >= 0 && a.symmetry.x <= 1 && a.symmetry.y >= 0 && a.symmetry.y <= 1)) {
    fail(`${name}: symmetry вне [0,1]`);
  }
}

// 4. Детерминизм: пересборка байт-в-байт
execFileSync(process.execPath, [join(__dirname, 'build-anatomy.js')], { stdio: 'pipe' });
const rebuilt = readFileSync(join(ROOT, 'dist', 'anatomy.json'), 'utf8');
const doc = `${JSON.stringify(anatomy, null, 1)}\n`;
if (rebuilt !== doc) {
  // сравнение с нормализованной сериализацией исходного объекта: расхождение
  // означает либо ручную правку артефакта, либо недетерминизм сборки
  fail('anatomy.json не детерминистичен или правился руками (пересборка разошлась)');
}

// 5. Биндинги
const bindings = JSON.parse(readFileSync(join(ROOT, 'anatomy', 'bindings.json'), 'utf8'));
const PIVOTS = new Set(['centroid', 'bbox-center', 'point']);
for (const [name, b] of Object.entries(bindings.icons ?? {})) {
  if (!icons[name]) fail(`bindings: иконки ${name} нет в анатомии`);
  if (!PIVOTS.has(b.pivot?.mode)) fail(`bindings ${name}: неизвестный pivot.mode ${b.pivot?.mode}`);
  if (b.pivot?.mode === 'point' && !(finite(b.pivot.at?.[0]) && finite(b.pivot.at?.[1]))) {
    fail(`bindings ${name}: pivot point без координат`);
  }
  if (typeof b.animation !== 'string' || b.animation.length === 0) {
    fail(`bindings ${name}: пустая анимация`);
  }
}

if (errors > 0) {
  console.error(`\nAnatomy check FAILED — ${errors} ошибок`);
  process.exit(1);
}
console.info(
  `✓  Anatomy check PASSED — ${Object.keys(icons).length} скелетов, ${Object.keys(bindings.icons).length} биндингов`,
);
