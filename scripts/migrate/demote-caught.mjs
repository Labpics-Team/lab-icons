/**
 * demote-caught.mjs — демоушен пойманных владельцем вариантов волны (per-variant).
 *
 * Зеркало promote-wave.mjs: промоушен был заменой руки генератом по декларации,
 * демоушен — откат ровно этой замены ПО ЗАКОНУ (правкой декларации), не руками:
 *   а) status варианта generated→hand (отгружается снова рука);
 *   б) svg восстанавливается из BASELINE — коммита непосредственно ДО замены
 *      волной (родитель 9e5a2e6): это тот же артефакт руки, что был отгружен,
 *      байт-в-байт из истории, никакой ручной геометрии;
 *   в) fidelityToHand НЕ стирается — исторический рекорд замера (прецедент:
 *      22 hand-варианта корпуса хранят fid, включая swap-horizontal);
 *   г) demotionReason фиксирует ПРИЧИНУ и заземление (зум владельца
 *      2026-07-08, STOP-комментарий PR #34 + леджер): промоушен был слеп —
 *      блоб-порог fill-rule пропускал малые артефакты, инвариант «компоненты
 *      чернил генерат==рука» (North) не был реализован.
 *
 * adjacency-promoted.json НЕ трогаем: корпусный check-adjacency (HARD) бежит
 * по МАТЕРИАЛИЗОВАННОМУ ГЕНЕРАТУ из деклараций — фикс смежности в декларации
 * приземлён и остаётся забетонированным независимо от статуса отгрузки
 * (прецедент: swap-horizontal — status:hand, в allowlist). Убрать = ослабить
 * инвариант; демоут ослабления не требует.
 *
 * Пере-промоушен пойманных — ТОЛЬКО через строгие детекторы (eonz-strict #38,
 * ink-topology #39, ink-weight #37) после их доводки.
 *
 * Запуск: node scripts/migrate/demote-caught.mjs           # dry-run, отчёт
 *         node scripts/migrate/demote-caught.mjs --apply   # запись
 */
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const APPLY = process.argv.includes('--apply');

/** Родитель волны 9e5a2e6 — последнее состояние руки до замены генератом. */
const BASELINE = '94e23e3e07a1c6ad828944fda96a7d69e784ab9b';

/** Пойманные владельцем (зум 2026-07-08): глиф/вариант → заземлённая причина. */
const DEMOTE = new Map([
  ['close/outline',
   'демоут 2026-07-09 (зум владельца 2026-07-08, STOP PR #34): вторая палочка ' +
   'креста разрезана на 2 куска с щелями, ромбик-evenodd в центре — блоб-порог ' +
   'check-fill-rule слеп к малым артефактам; вернуть только через eonz-strict/ink-topology'],
  ['play-forward-circle/outline',
   'демоут 2026-07-09 (зум владельца 2026-07-08, STOP PR #34): клинья слиты в ' +
   'одну массу с вертикальными щелями — метафора перемотки убита; компонент-каунт ' +
   'чернил (North) не гейтился; вернуть только через ink-topology'],
  ['arrow-back-circle/outline',
   'демоут 2026-07-09 (зум владельца 2026-07-08, STOP PR #34): грязь/залип под ' +
   'наконечником + полумесяц в стыке — вернуть только через eonz-strict (сварка ' +
   'X-пересечений) + ink-topology'],
]);

const anatomyPath = join(REPO, 'semantics', 'anatomy.json');
const anatomy = JSON.parse(readFileSync(anatomyPath, 'utf8'));

const svgPath = (name, variant) => variant === 'filled'
  ? join('svg', 'Filled', `${name}_filled.svg`)
  : join('svg', 'Outline', `${name}.svg`);

const report = [];
for (const [key, reason] of DEMOTE) {
  const [name, variant] = key.split('/');
  const entry = anatomy.glyphs[name];
  if (!entry) throw new Error(`демоут: нет декларации «${name}»`);
  if (entry.status?.[variant] !== 'generated')
    throw new Error(`демоут: ${key} не generated (status=${entry.status?.[variant]}) — нечего демоутить`);

  const rel = svgPath(name, variant).replace(/\\/g, '/');
  const hand = execSync(`git show ${BASELINE}:${rel}`, { cwd: REPO, encoding: 'utf8' });
  if (!hand.includes('<svg')) throw new Error(`демоут: ${rel}@${BASELINE} не похож на svg`);

  if (APPLY) {
    writeFileSync(join(REPO, rel), hand);
    entry.status[variant] = 'hand';
    entry.demotionReason = entry.demotionReason
      ? entry.demotionReason + ' || ' + reason
      : reason;
  }
  report.push({ key, fid: entry.fidelityToHand?.[variant], bytes: hand.length });
}

if (APPLY) writeFileSync(anatomyPath, JSON.stringify(anatomy, null, 1) + '\n');

console.log(`demote-caught ${APPLY ? 'APPLY' : 'DRY-RUN'} — baseline ${BASELINE.slice(0, 7)}`);
for (const r of report)
  console.log(`  ${r.key}: рука восстановлена (${r.bytes} байт), исторический fid=${r.fid} сохранён`);
console.log(`итого демоутов: ${report.length}; adjacency-promoted.json не тронут (HARD-бетон деклараций)`);
