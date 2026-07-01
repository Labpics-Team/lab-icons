/**
 * scripts/check-choreographies.js — гейт закоммиченного генерата хореографий
 * (эпик ds-icons; закрывает findings арх-ревью PR #4: дрифт committed-generated
 * нечем ловить + полнота контракта только в одну сторону).
 *
 * Проверяет src/animate/choreographies.generated.json:
 *   1. Провенанс: motionSha задан и НЕ 'unknown' (генерат без источника запрещён).
 *   2. Полнота ОБЕИХ сторон: каждый класс semantics.json имеет хореографию
 *      И каждая хореография — класс из перечня (фантомы запрещены).
 *   3. Структура каждой части: role из перечня, origin — проценты,
 *      keyframes: offsets строго возрастают от 0 до 1, transform/opacity
 *      конечны; timing: duration>0, delay>=0, iterations >= 1 или Infinity
 *      (JSON-сериализация Infinity = null — учитывается).
 *   4. direction: byDir покрывает ВСЕ направления semantics.json.
 *   5. clip (draw): progressTrack монотонный 0→1.
 *
 * Любое нарушение → ненулевой exit. Запускается в pnpm verify и CI.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const semantics = JSON.parse(readFileSync(join(root, 'semantics', 'semantics.json'), 'utf8'));
const gen = JSON.parse(
  readFileSync(join(root, 'src', 'animate', 'choreographies.generated.json'), 'utf8'),
);

const ROLES = new Set(['whole', 'glyph', 'body', 'rest', 'smallest']);
const errors = [];

// 1. Провенанс
if (!gen.provenance || !gen.provenance.motionSha || gen.provenance.motionSha === 'unknown') {
  errors.push('провенанс: motionSha отсутствует или unknown — генерат без источника');
}

const choreographies = gen.choreographies ?? {};
const classes = new Set(semantics.classes);

// 2. Полнота в обе стороны
for (const cls of classes) {
  if (!(cls in choreographies)) errors.push(`класс "${cls}" без хореографии`);
}
for (const cls of Object.keys(choreographies)) {
  if (!classes.has(cls)) errors.push(`хореография-фантом "${cls}" вне перечня semantics.json`);
}

function checkTiming(where, t) {
  if (!t) return errors.push(`${where}: timing отсутствует`);
  if (!(Number.isFinite(t.duration) && t.duration > 0))
    errors.push(`${where}: timing.duration невалиден (${t.duration})`);
  if (!(Number.isFinite(t.delay) && t.delay >= 0))
    errors.push(`${where}: timing.delay невалиден (${t.delay})`);
  // Infinity сериализуется в null: null|>=1 допустимы.
  const it = t.iterations;
  if (!(it === null || (Number.isFinite(it) && it >= 1)))
    errors.push(`${where}: timing.iterations невалиден (${it})`);
}

function checkParts(where, parts) {
  if (!Array.isArray(parts) || parts.length === 0)
    return errors.push(`${where}: пустой список частей`);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    const w = `${where}[${i}]`;
    if (!ROLES.has(part.role)) errors.push(`${w}: role "${part.role}" вне перечня`);
    if (typeof part.origin !== 'string' || !/^[\d.]+% [\d.]+%$/.test(part.origin))
      errors.push(`${w}: origin "${part.origin}" не проценты`);
    const kfs = part.keyframes;
    if (!Array.isArray(kfs) || kfs.length < 2) {
      errors.push(`${w}: keyframes < 2`);
      continue;
    }
    let prev = -1;
    for (const kf of kfs) {
      if (!(Number.isFinite(kf.offset) && kf.offset > prev))
        errors.push(`${w}: offsets не строго возрастают (${kf.offset} после ${prev})`);
      prev = kf.offset;
      if (kf.opacity !== undefined && !Number.isFinite(kf.opacity))
        errors.push(`${w}: opacity не конечна`);
      if (kf.transform !== undefined && /NaN|Infinity/.test(kf.transform))
        errors.push(`${w}: transform содержит NaN/Infinity`);
    }
    if (kfs[0].offset !== 0) errors.push(`${w}: первый offset ≠ 0`);
    if (kfs[kfs.length - 1].offset !== 1) errors.push(`${w}: последний offset ≠ 1`);
    checkTiming(w, part.timing);
    if (part.staggerGapMs !== undefined && !(Number.isFinite(part.staggerGapMs) && part.staggerGapMs >= 0))
      errors.push(`${w}: staggerGapMs невалиден`);
  }
}

// 3-5. Структура
for (const [cls, ch] of Object.entries(choreographies)) {
  if (ch.byDir) {
    for (const dir of semantics.directions) {
      if (!ch.byDir[dir]) errors.push(`direction: нет данных для "${dir}"`);
    }
    for (const [dir, parts] of Object.entries(ch.byDir)) checkParts(`${cls}.byDir.${dir}`, parts);
  } else {
    checkParts(`${cls}.parts`, ch.parts);
  }
  if (ch.wholeFallback) checkParts(`${cls}.wholeFallback`, ch.wholeFallback);
  if (ch.clip) {
    const pt = ch.clip.progressTrack;
    if (!pt || pt.values.length < 2) {
      errors.push(`${cls}.clip: progressTrack отсутствует/короткий`);
    } else {
      for (let i = 1; i < pt.values.length; i++) {
        if (pt.values[i] < pt.values[i - 1] - 1e-9)
          errors.push(`${cls}.clip: progress не монотонен @${i}`);
      }
      if (Math.abs(pt.values[0]) > 1e-9 || Math.abs(pt.values[pt.values.length - 1] - 1) > 1e-9)
        errors.push(`${cls}.clip: progress не 0→1`);
    }
    checkTiming(`${cls}.clip`, ch.clip.timing);
  }
}

if (errors.length > 0) {
  console.error(`check-choreographies: FAIL — нарушений: ${errors.length}`);
  for (const e of errors) console.error('  - ' + e);
  process.exit(1);
}
console.log(
  `check-choreographies: OK — ${Object.keys(choreographies).length} классов, провенанс lab-motion ${gen.provenance.motionSha}`,
);
