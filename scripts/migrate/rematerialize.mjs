/**
 * rematerialize.mjs — перематериализация отгрузки generated-варианта из декларации.
 *
 * КЛАСС дефекта: «stale-материализация» — декларация/генератор починены, а
 * svg/ остался со старой геометрией (пойман component/outline: генерат EO≡NZ
 * чист, файл — legacy-намотка 4114 точек EO≠NZ). Гейт check-eonz-strict мерит
 * ОТГРУЗКУ и такое ловит; этот инструмент — детерминированная починка.
 *
 * Дисциплина строже promote-wave: файл пишется БЕЗ fill-rule=evenodd —
 * генерат обязан быть fill-rule-НЕЗАВИСИМЫМ (инвариант check-eonz-strict,
 * EO≡NZ точно). Генерат с EO≠NZ — отказ, чинить генератор, не атрибут.
 *
 * Запуск: node scripts/migrate/rematerialize.mjs <глиф>/<вариант> [...]
 *   напр.: node scripts/migrate/rematerialize.mjs close/outline component/outline
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGlyph } from '../lib/anatomy-gen.js';
import { strictSeamReport } from '../check-eonz-strict.js';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const grid = JSON.parse(readFileSync(join(REPO, 'semantics', 'grid.json'), 'utf8'));
const anatomy = JSON.parse(readFileSync(join(REPO, 'semantics', 'anatomy.json'), 'utf8'));

const targets = process.argv.slice(2);
if (targets.length === 0) {
  console.error('rematerialize: укажи цели <глиф>/<вариант>, напр. close/outline');
  process.exit(2);
}

for (const target of targets) {
  const [name, variant] = target.split('/');
  const entry = anatomy.glyphs[name];
  if (!entry) throw new Error(`rematerialize: глифа «${name}» нет в anatomy.json`);
  if (entry.status?.[variant] !== 'generated') {
    throw new Error(`rematerialize: ${target} не generated — материализуется только промоутнутый генерат (промоушен — promote-wave)`);
  }
  const d = buildGlyph(entry, grid, {}, anatomy.glyphs)[variant];
  if (!d) throw new Error(`rematerialize: генерат не строит вариант ${target}`);
  const r = strictSeamReport(d, grid.canvas.width, grid);
  if (r.coarse > 0 || r.fine > 0) {
    throw new Error(
      `rematerialize: генерат ${target} fill-rule-ЗАВИСИМ (EO≠NZ ${r.coarse}+${r.fine} точек) — чинить генератор, не отгружать evenodd-атрибутом`,
    );
  }
  const file =
    variant === 'outline'
      ? join(REPO, 'svg', 'Outline', `${name}.svg`)
      : join(REPO, 'svg', 'Filled', `${name}_filled.svg`);
  writeFileSync(
    file,
    `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24"><path d="${d}"/></svg>`,
    'utf8',
  );
  console.log(`rematerialize: ${target} → ${file.slice(REPO.length + 1)} (EO≡NZ чист)`);
}
