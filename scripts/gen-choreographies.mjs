/**
 * scripts/gen-choreographies.mjs — компилирует хореографии 13 семантических
 * классов в статические WAAPI-данные: src/animate/choreographies.generated.json.
 *
 * ИСТОЧНИК ДВИЖЕНИЙ: @labpics/motion/presets (lab-motion, ветка
 * feat/icon-effect-presets, PR #24). Пока пакет не опубликован/не смержен,
 * генератор читает ЛОКАЛЬНО собранный dist по пути из аргумента/env:
 *   node scripts/gen-choreographies.mjs [--motion-dist <path>]
 *   LAB_MOTION_DIST=<path> node scripts/gen-choreographies.mjs
 * После публикации @labpics/motion перевести на обычный devDependency-импорт.
 *
 * Почему генерат КОММИТИТСЯ: CI не имеет доступа к несмерженной ветке
 * lab-motion; хореографии — детерминированные чистые данные (пресеты без
 * Math.random/Date.now), валидируются гейтом check-choreographies. Провенанс
 * (SHA lab-motion) пишется в заголовок файла.
 *
 * Роли слоёв (резолвит рантайм по геометрии):
 *   whole    — вся иконка (single-path / wholeOnly)
 *   body     — слой наибольшей площади
 *   rest     — остальные слои по возрастанию расстояния от body (каскады)
 *   smallest — слой наименьшей площади (язычок, курсор)
 */

import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const argIdx = process.argv.indexOf('--motion-dist');
const motionDist =
  (argIdx > -1 && process.argv[argIdx + 1]) ||
  process.env.LAB_MOTION_DIST ||
  'C:/Users/Daniel/.agents/work/lab-motion-icons/dist';

const presetsUrl = pathToFileURL(join(motionDist, 'presets', 'index.js')).href;
const p = await import(presetsUrl);

let motionSha = 'unknown';
try {
  motionSha = execSync('git rev-parse HEAD', { cwd: join(motionDist, '..') }).toString().trim().slice(0, 12);
} catch {
  // dist вне git-клона — провенанс останется unknown, гейт это подсветит
}

/** Пресет → WAAPI-часть хореографии. extra позволяет переопределить repeat и пр. */
function part(role, origin, spec, opts = {}) {
  const { staggerGapMs, ...specPatch } = opts;
  const w = p.presetToWaapi({ ...spec, ...specPatch });
  const out = { role, origin, keyframes: w.keyframes, timing: w.timing };
  if (staggerGapMs !== undefined) out.staggerGapMs = staggerGapMs;
  if (w.progressTrack) out.progressTrack = w.progressTrack;
  return out;
}

/**
 * Хореографии классов. Вкусовой эталон владельца (REFS-LABPICS.md): мягкие
 * амплитуды, identity-края, каскадный стаггер ~100мс, читаемое движение.
 * Все — разовый акцент (repeat переопределён с Infinity где нужно);
 * луп-режим задаёт рантайм через iterations.
 */
/** Кастомные спеки двухфазных направлений (туда-обратно через центр). */
const seesawX = {
  duration: 0.7,
  tracks: [{ property: 'x', values: [0, -2.5, 0, 2.5, 0] }],
};
const seesawY = {
  duration: 0.7,
  tracks: [{ property: 'y', values: [0, -2.5, 0, 2.5, 0] }],
};

const choreographies = {
  direction: {
    // Сдвиг в семантическом направлении и возврат — данные на каждое из
    // 6 направлений (генерим все: чище, чем зеркалить transform-строки в рантайме).
    byDir: {
      right: [part('whole', '50% 50%', p.drift({ dx: 2.5, dy: 0, duration: 0.55 }), { repeat: 0 })],
      left: [part('whole', '50% 50%', p.drift({ dx: -2.5, dy: 0, duration: 0.55 }), { repeat: 0 })],
      up: [part('whole', '50% 50%', p.drift({ dx: 0, dy: -2.5, duration: 0.55 }), { repeat: 0 })],
      down: [part('whole', '50% 50%', p.drift({ dx: 0, dy: 2.5, duration: 0.55 }), { repeat: 0 })],
      'left-right': [part('whole', '50% 50%', seesawX)],
      'up-down': [part('whole', '50% 50%', seesawY)],
    },
  },
  spin: {
    parts: [part('whole', '50% 50%', p.spin({ turns: 1, duration: 0.9 }))],
  },
  bell: {
    parts: [
      // Корпус качается вокруг подвеса (верхняя точка), язычок — вдогонку.
      part('body', '50% 8%', p.wiggle({ degrees: 9, duration: 0.9 })),
      part('smallest', '50% 0%', p.wiggle({ degrees: 14, duration: 0.9, cycles: 3 }), {
        delay: 0.06,
      }),
    ],
  },
  wave: {
    parts: [
      part('body', '50% 50%', p.pulse({ amount: 0.04, duration: 0.9 })),
      // Волны гаснут/вспыхивают каскадом от источника (стаггер 100мс).
      part('rest', '50% 50%', p.blink({ min: 0.25, duration: 0.9 }), {
        repeat: 0,
        staggerGapMs: 100,
      }),
    ],
  },
  sparkle: {
    parts: [
      part('body', '50% 50%', p.pulse({ amount: 0.05, duration: 0.9 })),
      // Искры разлетаются scale-каскадом (эталон ref-4: 5 групп, ~100мс шаг).
      part('rest', '50% 50%', p.pulse({ amount: 0.45, duration: 0.7 }), { staggerGapMs: 100 }),
    ],
  },
  pulse: {
    parts: [part('whole', '50% 50%', p.pulse())],
  },
  draw: {
    // Инструмент «замахивается» (наклон), полотно рисуется clip-раскрытием.
    parts: [part('whole', '50% 85%', p.wiggle({ degrees: 5, cycles: 2, duration: 1.2 }))],
    clip: (() => {
      const w = p.presetToWaapi(p.drawOn({ duration: 1.2 }));
      return { progressTrack: w.progressTrack, timing: w.timing };
    })(),
  },
  pop: {
    parts: [part('whole', '50% 50%', p.pop({ duration: 0.45 }))],
  },
  blink: {
    parts: [part('smallest', '50% 50%', p.blink({ min: 0, duration: 0.9 }), { repeat: 1 })],
    wholeFallback: [part('whole', '50% 50%', p.blink({ min: 0.35, duration: 0.9 }), { repeat: 1 })],
  },
  drift: {
    parts: [part('whole', '50% 50%', p.drift({ dy: -1.2, duration: 2.2 }), { repeat: 0 })],
  },
  shake: {
    parts: [part('whole', '50% 50%', p.wiggle({ degrees: 6, cycles: 4, duration: 0.6 }))],
  },
  toggle: {
    // Мягкое «выключение»: провал масштаба к 0.92 и возврат.
    parts: [part('whole', '50% 50%', p.pulse({ amount: -0.08, duration: 0.6 }))],
  },
  generic: {
    parts: [part('whole', '50% 50%', p.pulse({ amount: 0.06, duration: 0.7 }))],
  },
};

const out = {
  comment: 'СГЕНЕРИРОВАНО scripts/gen-choreographies.mjs — НЕ править руками.',
  provenance: {
    source: '@labpics/motion/presets',
    motionSha,
    generatedFrom: 'feat/icon-effect-presets (lab-motion PR #24)',
  },
  choreographies,
};

mkdirSync(join(root, 'src', 'animate'), { recursive: true });
writeFileSync(
  join(root, 'src', 'animate', 'choreographies.generated.json'),
  JSON.stringify(out, null, 1) + '\n',
  'utf8',
);
console.log(
  `gen-choreographies: OK — ${Object.keys(choreographies).length} классов, lab-motion ${motionSha}`,
);
