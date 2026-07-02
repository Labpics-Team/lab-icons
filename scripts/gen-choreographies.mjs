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
 * Math.random/Date.now). Дрифт и структуру ловит scripts/check-choreographies.js
 * (в verify и CI): провенанс, конечность чисел, покрытие ВСЕХ классов
 * semantics.json. Провенанс (SHA lab-motion) пишется в файл.
 *
 * Роли слоёв (резолвит рантайм по геометрии):
 *   whole    — вся иконка (single-path / wholeOnly)
 *   body     — слой наибольшей площади
 *   rest     — остальные слои по возрастанию расстояния от body (каскады)
 *   smallest — слой наименьшей площади (язычок, курсор)
 */

import { execSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { samplePolylines } from './lib/motion-geometry.js';
import { parsePathData, pathBBox } from './lib/path-data.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const PATH_D_RE = /<path\b[^>]*?\bd="([^"]+)"/g;

function readIconPathD(name, variant, index) {
  const file =
    variant === 'filled'
      ? join(root, 'svg', 'Filled', `${name}_filled.svg`)
      : join(root, 'svg', 'Outline', `${name}.svg`);
  const ds = [...readFileSync(file, 'utf8').matchAll(PATH_D_RE)].map((m) => m[1]);
  if (index >= ds.length) {
    throw new Error(`gen-choreographies: ${name}:${variant} — clip.path ${index} за пределами SVG`);
  }
  return ds[index];
}

const argIdx = process.argv.indexOf('--motion-dist');
const motionDist =
  (argIdx > -1 && process.argv[argIdx + 1]) ||
  process.env.LAB_MOTION_DIST ||
  'C:/Users/Daniel/.agents/work/lab-motion-icons/dist';

const presetsUrl = pathToFileURL(join(motionDist, 'presets', 'index.js')).href;
const p = await import(presetsUrl);
const e = await import(pathToFileURL(join(motionDist, 'easing', 'index.js')).href);

let motionSha = 'unknown';
try {
  motionSha = execSync('git rev-parse HEAD', { cwd: join(motionDist, '..') }).toString().trim().slice(0, 12);
} catch {
  // dist вне git-клона — провенанс останется unknown, гейт это подсветит
}

/**
 * Пресет → WAAPI-часть хореографии. extra позволяет переопределить repeat и пр.
 * progressTrack на уровне части НЕ эмитится (рантайм читает его только из
 * clip-блока хореографии — finding арх-ревью: мёртвое поле = дрифт формы).
 */
function part(role, origin, spec, opts = {}) {
  const { staggerGapMs, ...specPatch } = opts;
  const w = p.presetToWaapi({ ...spec, ...specPatch });
  const out = { role, origin, keyframes: w.keyframes, timing: w.timing };
  if (staggerGapMs !== undefined) out.staggerGapMs = staggerGapMs;
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

/**
 * Сквош-поп: акцент «нажали» ОТ единицы (фидбек владельца 2026-07-02:
 * scale-с-нуля на hover читался как исчезновение — появление-с-нуля уместно
 * только на mount-триггере, он придёт отдельной опцией).
 * Овершут 1.08: полноширинные глифы (bbox ~1..23) при 1.1 выводит контур
 * за канву (гейт bounds).
 */
const squashPop = {
  duration: 0.5,
  tracks: [{ property: 'scale', values: [1, 0.86, 1.08, 1], times: [0, 0.3, 0.65, 1] }],
};

/**
 * Живой generic: мягкий подскок со сквошем при приземлении — SF-подобный
 * default вместо еле заметного пульса (фидбек владельца: «generic мёртвый»).
 */
const liveBounce = {
  duration: 0.55,
  tracks: [
    { property: 'y', values: [0, -1.7, 0, -0.35, 0], times: [0, 0.32, 0.62, 0.82, 1] },
    { property: 'scaleY', values: [1, 1.06, 0.92, 1.02, 1], times: [0, 0.32, 0.62, 0.82, 1] },
  ],
};

const choreographies = {
  direction: {
    // Сдвиг в семантическом направлении и возврат — данные на каждое из
    // 6 направлений (генерим все: чище, чем зеркалить transform-строки в рантайме).
    // Роль glyph: у enclosure-иконок (стрелка В круге) двигается ГЛИФ, круг
    // стоит (фидбек владельца: ехал весь бейдж — дёшево); без вложенного
    // глифа роль честно деградирует в whole.
    byDir: {
      right: [part('glyph', '50% 50%', p.drift({ dx: 2.5, dy: 0, duration: 0.55 }), { repeat: 0 })],
      left: [part('glyph', '50% 50%', p.drift({ dx: -2.5, dy: 0, duration: 0.55 }), { repeat: 0 })],
      up: [part('glyph', '50% 50%', p.drift({ dx: 0, dy: -2.5, duration: 0.55 }), { repeat: 0 })],
      down: [part('glyph', '50% 50%', p.drift({ dx: 0, dy: 2.5, duration: 0.55 }), { repeat: 0 })],
      'left-right': [part('glyph', '50% 50%', seesawX)],
      'up-down': [part('glyph', '50% 50%', seesawY)],
    },
  },
  spin: {
    // Вращается внутренний глиф (игла компаса, стрелка таймера), корпус стоит.
    parts: [part('glyph', '50% 50%', p.spin({ turns: 1, duration: 0.9 }))],
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
    parts: [part('whole', '50% 50%', squashPop)],
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
    parts: [part('whole', '50% 100%', liveBounce)],
  },
};

// ─── Per-icon хореографии (semantics/layers.json → скомпилированные WAAPI) ───
//
// Словарь движений от СМЫСЛА конкретных иконок (реврейм BL-004/BL-005):
// разметка (какой path, какой якорь, какое движение) живёт в layers.json,
// здесь — только сами движения. Все движения identity-краевые НА КОНЦЕ
// (cancel после завершения бесшовен); rotate 360 = полный оборот к identity.
/**
 * Треки куч песка hourglass: синхронный флип (rotate+dip как flip-hold) +
 * дыхание уровня scaleY(k) с ТОЧНОЙ фикс-точкой y0 (горловина верхней кучи /
 * основание нижней) в локальной системе слоя. Компенсация — плотные x/y-треки
 * из dv(t) = R(θ(t))·(0, (y0−ay)·(1−k(t))), т.к. translate в WAAPI-строке
 * глобальный (внешний относительно rotate/scale).
 */
function sandLayerMotions() {
  const AY = 12;
  const N = 48;
  const phase = (t) => (t <= 0.32 ? [180 * e.easeInOut(t / 0.32)]
    : t <= 0.62 ? [180]
    : [180 + 180 * e.easeInOut((t - 0.62) / 0.38)]);
  const kAt = (t, kPeak) => {
    if (t <= 0.32) return 1 + (kPeak - 1) * e.easeInOut(t / 0.32);
    if (t <= 0.62) return kPeak + (1 - kPeak) * e.easeInOut((t - 0.32) / 0.3);
    return 1;
  };
  const build = (y0, kPeak, kxPeak = 1) => {
    const times = [];
    const xs = [];
    const ys = [];
    const ks = [];
    const kxs = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const [theta] = phase(t);
      const k = kAt(t, kPeak);
      const c = (y0 - AY) * (1 - k);
      const rad = (theta * Math.PI) / 180;
      times.push(t);
      xs.push(-c * Math.sin(rad));
      ys.push(c * Math.cos(rad)); // dv = R(θ)·(0, c): фикс-точка y0 в локальной системе
      ks.push(k);
      kxs.push(1 + (kxPeak - 1) * ((1 - k) / (1 - kPeak) || 0));
    }
    // в покое и в конце (k=1 → c=0): dv=0 ✓ identity-края
    return {
      duration: 1.5,
      tracks: [
        {
          property: 'rotate',
          values: [0, 180, 180, 360],
          times: [0, 0.32, 0.62, 1],
          easing: [e.easeInOut, e.linear, e.easeInOut],
        },
        {
          property: 'scale',
          values: [1, 0.97, 1, 1, 0.97, 1],
          times: [0, 0.16, 0.32, 0.62, 0.81, 1],
          easing: e.easeInOut,
        },
        { property: 'scaleY', values: ks, times },
        ...(kxPeak !== 1 ? [{ property: 'scaleX', values: kxs, times }] : []),
        { property: 'x', values: xs, times },
        { property: 'y', values: ys, times },
      ],
    };
  };
  return {
    'flip-hold-top': build(10.61, 0.15, 0.35),
    'flip-hold-bottom': build(18.98, 1.28),
  };
}

const iconMotions = {
  // Песок слоями (BL-008: слойная статика вместо SMIL-морфа): верхняя куча
  // тает к горловине НА ФЛИПЕ (песок «остаётся в колбе»), нижняя растёт;
  // на паузе — обратно (экранно, вверх ногами: песок стекает вниз).
  // Кучи — заливки-массы, scale разрешён. Фикс-точка (горловина/основание)
  // держится ТОЧНО: компенсация глобального translate зависит от угла флипа
  // (порядок функций presetToWaapi: translate → rotate → scale), поэтому
  // треки печатаются плотно из формулы dv(t) = R(θ(t))·(I−S(t))·(p0−a).
  ...sandLayerMotions(),
  // Физика песочных часов: переворот, пауза «песок сыплется», доворот (BL-005 D).
  // Подныривание масштаба в фазах вращения: угол глифа отстоит от центра на
  // ~12.5 units > 12 — без 0.9 углы срезаются краем viewBox (overflow: hidden).
  'flip-hold': {
    duration: 1.5,
    tracks: [
      {
        property: 'rotate',
        values: [0, 180, 180, 360],
        times: [0, 0.32, 0.62, 1],
        easing: [e.easeInOut, e.linear, e.easeInOut],
      },
      {
        property: 'scale',
        values: [1, 0.97, 1, 1, 0.97, 1],
        times: [0, 0.16, 0.32, 0.62, 0.81, 1],
        easing: e.easeInOut,
      },
    ],
  },
  // История = время назад: спринг-отмотка стрелок с перелётом и возвратом.
  // Полный оборот невозможен честно: стрелка проходит сквозь загнутый внутрь
  // наконечник кольца (гейт collision), а поджатие толщин отвергнуто (BL-008).
  'rewind-spring': {
    duration: 1,
    tracks: [
      {
        property: 'rotate',
        values: [0, -30, 9, -3.5, 0],
        times: [0, 0.3, 0.62, 0.84, 1],
        easing: e.easeInOut,
      },
    ],
  },
  // Циферблат «вздрагивает» в противоход отмотке (живость, BL-008).
  'dial-flinch': {
    duration: 1,
    tracks: [
      { property: 'rotate', values: [0, -4, 1.5, 0], times: [0, 0.35, 0.7, 1], easing: e.easeInOut },
    ],
  },
  // Переключение камеры = аккуратный подворот стрелок цикла со спринг-возвратом
  // (владелец 2026-07-02: флип «не туда», нужно вращение). 45° — максимум,
  // при котором стрелки не задевают корпус (потолок по гейту collision ≈ 50°).
  'twist-spring': {
    duration: 0.8,
    tracks: [
      {
        property: 'rotate',
        values: [0, 45, -12.6, 0],
        times: [0, 0.4, 0.74, 1],
        easing: e.easeInOut,
      },
    ],
  },
  // Полуоборот с поджатием — для C2-симметричных пар стрелок в тесном окне
  // (camera-reverse): 180° при симметрии читается полным циклом, поджатие
  // 0.62 проводит широкие дуги (полуширина 6.7) через окно корпуса (полувысота
  // ~4.4) без наслоения (гейт collision).
  'half-spin-tuck': {
    duration: 0.8,
    tracks: [
      { property: 'rotate', values: [0, 180], easing: e.easeInOut },
      { property: 'scale', values: [1, 0.62, 1], times: [0, 0.5, 1], easing: e.easeInOut },
    ],
  },
  // Полный оборот с поджатием — для круг-стрелок, чей наконечник дальше от оси,
  // чем край канвы (reload: r≈14.4 от оси (11.7,12) → слева нужен s ≤ 11.75/14.4
  // ≈ 0.81, иначе угол наконечника вылетает — гейт bounds).
  'spin-cycle-tucked': {
    duration: 0.9,
    tracks: [
      { property: 'rotate', values: [0, 360], easing: e.easeInOut },
      {
        property: 'scale',
        values: [1, 0.8, 0.8, 1],
        times: [0, 0.22, 0.78, 1],
        easing: e.easeInOut,
      },
    ],
  },
  // Полный оборот по часовой (круг-стрелки, стрелки цикла) вокруг ОСИ ОКРУЖНОСТИ.
  'spin-cycle': {
    duration: 0.9,
    tracks: [{ property: 'rotate', values: [0, 360], easing: e.easeInOut }],
  },
  // Компас ищет север: затухающие колебания иглы вокруг втулки.
  'seek-north': {
    duration: 1.1,
    tracks: [
      {
        property: 'rotate',
        values: [0, -26, 14, -6, 0],
        times: [0, 0.35, 0.62, 0.84, 1],
        easing: e.easeInOut,
      },
    ],
  },
  // Маятник корпуса колокола вокруг подвеса (затухает). Амплитуды корпуса и
  // язычка подобраны так, чтобы противофаза не сводила обод с язычком
  // (гейт collision: разлёт фаз ≤ ~15°).
  'bell-swing': {
    duration: 0.95,
    tracks: [
      {
        property: 'rotate',
        values: [0, 8, -6, 3.5, -1.2, 0],
        times: [0, 0.22, 0.46, 0.68, 0.86, 1],
        easing: e.easeInOut,
      },
    ],
  },
  // Язычок — маятник на ТОМ ЖЕ подвесе, в противофазе и вдогонку (90мс).
  'clapper-swing': {
    duration: 0.95,
    delay: 0.09,
    tracks: [
      {
        property: 'rotate',
        values: [0, -8, 7, -4, 1.5, 0],
        times: [0, 0.22, 0.46, 0.68, 0.86, 1],
        easing: e.easeInOut,
      },
    ],
  },
  // Рупор дышит громкостью.
  'speaker-pulse': {
    duration: 0.7,
    tracks: [{ property: 'scale', values: [1, 1.05, 1], easing: e.easeInOut }],
  },
  // Волна «загорается» от рупора наружу (каскад по стаггеру). Только opacity:
  // геометрический рост со стаггером сводил кольца волн друг на друга
  // (разные фазы гомотетии — гейт collision), излучение читается каскадом.
  'wave-emit': {
    duration: 0.7,
    tracks: [{ property: 'opacity', values: [0.25, 1, 1], times: [0, 0.55, 1], easing: e.easeOut }],
  },
  // Мерцание искр (слитый слой): двойной блик + лёгкое дыхание масштаба.
  twinkle: {
    duration: 0.9,
    tracks: [
      {
        property: 'opacity',
        values: [1, 0.45, 1, 0.8, 1],
        times: [0, 0.25, 0.55, 0.75, 1],
        easing: e.easeInOut,
      },
      {
        property: 'scale',
        values: [1, 1.08, 1, 1.04, 1],
        times: [0, 0.25, 0.55, 0.75, 1],
        easing: e.easeInOut,
      },
    ],
  },
  // Луна мягко покачивается (ночной ambient-характер).
  'moon-rock': {
    duration: 1.1,
    tracks: [
      { property: 'rotate', values: [0, -6, 3, 0], times: [0, 0.4, 0.75, 1], easing: e.easeInOut },
    ],
  },
  // Сердцебиение «тук-тук»: два удара разной силы. Пик 1.08: bbox сердца почти
  // во весь viewBox, больший масштаб выводит контур за канву (гейт bounds).
  'heart-beat': {
    duration: 0.9,
    tracks: [
      {
        property: 'scale',
        values: [1, 1.08, 1, 1.05, 1],
        times: [0, 0.2, 0.5, 0.7, 1],
        easing: e.easeOut,
      },
    ],
  },
  // Нудж в семантическом направлении с пружинным овершутом (BL-008: живость).
  'nudge-left': {
    duration: 0.6,
    tracks: [
      { property: 'x', values: [0, -2.3, 0.6, 0], times: [0, 0.4, 0.72, 1], easing: e.easeInOut },
    ],
  },
  // Мягкий нудж целого (деградация слитого бейджа). −0.9: бейдж во весь
  // viewBox, больший сдвиг выводит край за канву (гейт bounds).
  'nudge-left-soft': {
    duration: 0.55,
    tracks: [{ property: 'x', values: [0, -0.9, 0], easing: e.easeInOut }],
  },
  // Сквош-акцент «нажали» (деградация слитых иконок вместо бессмысленного вращения).
  'settle-pop': squashPop,
  // Галочку «поставили»: подскок с наклоном вокруг нижней вершины и
  // пружинная посадка (клип заморожен BL-009; scale на штрихе запрещён BL-008).
  'check-spring': {
    duration: 0.65,
    tracks: [
      { property: 'y', values: [0, -1.6, 0.35, 0], times: [0, 0.3, 0.68, 1], easing: e.easeInOut },
      { property: 'rotate', values: [0, -10, 4, 0], times: [0, 0.3, 0.68, 1], easing: e.easeInOut },
    ],
  },
  // Кисть РИСУЕТ движением: замах вверх вдоль оси мазка, мазок к холсту,
  // протяжка, возврат + наклон вокруг кончика ворса. Амплитуды — максимум,
  // который пропускает гейт bounds (запас канвы у кисти ~1.1 по диагонали).
  'brush-stroke': {
    duration: 1,
    tracks: [
      {
        property: 'x',
        values: [0, 0.42, -0.92, -0.35, 0],
        times: [0, 0.28, 0.55, 0.78, 1],
        easing: e.easeInOut,
      },
      {
        property: 'y',
        values: [0, -0.42, 0.92, 0.35, 0],
        times: [0, 0.28, 0.55, 0.78, 1],
        easing: e.easeInOut,
      },
      {
        property: 'rotate',
        values: [0, -3, 5, -2, 0],
        times: [0, 0.28, 0.55, 0.78, 1],
        easing: e.easeInOut,
      },
    ],
  },
};

// ─── Clip-раскрытия (draw-on, BL-002/BL-007) ────────────────────────────────
//
// «Рисуется вдоль мазка» (SF-style): лента полуширины halfWidth идёт вдоль
// направляющей (полилиния в координатах viewBox) с КРУГЛОЙ головкой —
// раскрытие следует изгибу штриха, а не плоской шторкой. Полигон каждого
// кадра имеет ФИКСИРОВАННОЕ число точек (боковины пересэмплируются по доле
// пройденной длины) — браузер интерполирует path() плавно (совпадение
// структуры команд, MDN basic-shape). Координаты — относительно bbox слоя:
// clip-path на SVG-слое читает path() в юнитах fill-box.
function alongClipBuilder({ guide, halfWidth, backMargin = 1.2, sideSamples = 8, capSamples = 8 }) {
  const segs = [];
  let total = 0;
  for (let i = 0; i + 1 < guide.length; i++) {
    const [x1, y1] = guide[i];
    const [x2, y2] = guide[i + 1];
    const len = Math.hypot(x2 - x1, y2 - y1);
    segs.push({ x1, y1, len, start: total, ux: (x2 - x1) / len, uy: (y2 - y1) / len });
    total += len;
  }
  const at = (s) => {
    const clamped = Math.min(Math.max(s, 0), total);
    let seg = segs[segs.length - 1];
    for (const candidate of segs) {
      if (clamped <= candidate.start + candidate.len + 1e-9) {
        seg = candidate;
        break;
      }
    }
    const along = clamped - seg.start + (s - clamped); // за краями — экстраполяция
    return { x: seg.x1 + seg.ux * along, y: seg.y1 + seg.uy * along, ux: seg.ux, uy: seg.uy };
  };
  const sMin = -halfWidth - backMargin;
  const sTail = sMin - 2;
  return {
    /** Полигон ленты в координатах viewBox при данном прогрессе. */
    bandPoints(progress) {
      const sHead = sMin + progress * (total + halfWidth - sMin);
      const pts = [];
      for (let i = 0; i <= sideSamples; i++) {
        const g = at(sTail + (sHead - sTail) * (i / sideSamples));
        pts.push([g.x - g.uy * halfWidth, g.y + g.ux * halfWidth]);
      }
      const head = at(sHead);
      for (let i = 1; i <= capSamples; i++) {
        const phi = Math.PI / 2 - (Math.PI * i) / (capSamples + 1);
        const vx = head.ux * Math.cos(phi) - head.uy * Math.sin(phi);
        const vy = head.uy * Math.cos(phi) + head.ux * Math.sin(phi);
        pts.push([head.x + vx * halfWidth, head.y + vy * halfWidth]);
      }
      for (let i = sideSamples; i >= 0; i--) {
        const g = at(sTail + (sHead - sTail) * (i / sideSamples));
        pts.push([g.x + g.uy * halfWidth, g.y - g.ux * halfWidth]);
      }
      return pts;
    },
    clipPath(progress, origin) {
      const [ox, oy] = origin;
      const d = this.bandPoints(progress)
        .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${(x - ox).toFixed(2)} ${(y - oy).toFixed(2)}`)
        .join('');
      return `path('${d}Z')`;
    },
  };
}

/** Точка внутри полигона (самопроверка покрытия ленты). */
function insidePolygon([px, py], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ─── Морфы формы (BL-007: «песок переливается») ─────────────────────────────
//
// Ключевая форма строится ТОЧЕЧНЫМ ОТРАЖЕНИЕМ исходного контура вокруг центра
// слоя: структура команд совпадает с оригиналом автоматически → SMIL
// интерполирует плавно (морф d требует одинаковой последовательности команд).
// Рантайм играет морф через SMIL <animate attributeName="d"> — единственный
// нативный механизм морфа d, работающий во всех движках включая Safari
// (CSS-свойство d в WebKit отсутствует; ресёрч 2026-07-02).
const round2 = (v) => {
  const r = Math.round(v * 100) / 100;
  return Object.is(r, -0) ? 0 : r;
};

/** d после точечного отражения вокруг (cx,cy): p′ = (2c − p), дуги сохраняют флаги. */
function pointReflectPathD(d, cx, cy) {
  const out = [];
  for (const seg of parsePathData(d)) {
    if (seg.cmd === 'Z') {
      out.push('Z');
    } else if (seg.cmd === 'M' || seg.cmd === 'L') {
      out.push(`${seg.cmd}${round2(2 * cx - seg.x)} ${round2(2 * cy - seg.y)}`);
    } else if (seg.cmd === 'C') {
      out.push(
        `C${round2(2 * cx - seg.x1)} ${round2(2 * cy - seg.y1)} ` +
          `${round2(2 * cx - seg.x2)} ${round2(2 * cy - seg.y2)} ` +
          `${round2(2 * cx - seg.x)} ${round2(2 * cy - seg.y)}`,
      );
    } else if (seg.cmd === 'Q') {
      out.push(
        `Q${round2(2 * cx - seg.x1)} ${round2(2 * cy - seg.y1)} ` +
          `${round2(2 * cx - seg.x)} ${round2(2 * cy - seg.y)}`,
      );
    } else if (seg.cmd === 'A') {
      // точечное отражение сохраняет ориентацию → rx/ry/rotation/флаги как были
      out.push(
        `A${seg.rx} ${seg.ry} ${seg.rotation} ${seg.largeArc} ${seg.sweep} ` +
          `${round2(2 * cx - seg.x)} ${round2(2 * cy - seg.y)}`,
      );
    }
  }
  return out.join('');
}

// Хронология синхронна flip-hold (1.5с): флип 0→0.32 — песок «удерживается
// в колбе» (A→B); пауза 0.32→0.62 — песок стекает вниз (B→A на перевёрнутой
// иконке); доворот 0.62→1 — форма покоя (A). Края = A = identity.
// Морфы формы: механизм (SMIL d) сохранён для модификаторов BL-010
// (слэш прочерчивается морфом); песок hourglass переведён на слойную статику.
const iconMorphs = {};

const iconClips = {
  // Кисть: направляющая = ось мазка от кончика ворса к рукояти (контур кисти
  // лежит в t∈[−2.9..20.5] вдоль оси, перпендикуляр ≤ 7.93 → полуширина 8.5).
  'reveal-brush-along': {
    kind: 'along',
    spec: { duration: 0.9, tracks: [{ property: 'progress', values: [0, 1], easing: e.easeOut }] },
    guide: [
      [2.03, 21.97],
      [19.35, 4.65],
    ],
    halfWidth: 8.5,
  },
  // Галочка: направляющая повторяет штрих (вход слева → впадина → верх-право).
  // Точки/полуширина подобраны по контуру (самопроверка покрытия при генерации).
  'reveal-check-along': {
    kind: 'along',
    spec: {
      duration: 0.5,
      tracks: [{ property: 'progress', values: [0, 1], easing: e.easeOut }],
    },
    guide: [
      [5.9, 11.6],
      [10.9, 16.3],
      [17.8, 5.9],
    ],
    halfWidth: 3.6,
  },
};

const layersJson = JSON.parse(readFileSync(join(root, 'semantics', 'layers.json'), 'utf8'));
const iconsOut = {};
for (const [name, variants] of Object.entries(layersJson.icons)) {
  iconsOut[name] = {};
  for (const [variant, entry] of Object.entries(variants)) {
    const parts = entry.parts.map((pt) => {
      const spec = iconMotions[pt.motion];
      if (!spec) {
        throw new Error(`gen-choreographies: неизвестный motion "${pt.motion}" (${name}:${variant})`);
      }
      const w = p.presetToWaapi(spec);
      const compiledPart = {
        paths: pt.paths,
        anchor: pt.anchor,
        keyframes: w.keyframes,
        timing: w.timing,
      };
      if (pt.staggerGapMs !== undefined) compiledPart.staggerGapMs = pt.staggerGapMs;
      return compiledPart;
    });
    const compiled = { parts };
    if (entry.clip) {
      const clip = iconClips[entry.clip.motion];
      if (!clip) {
        throw new Error(
          `gen-choreographies: неизвестный clip-motion "${entry.clip.motion}" (${name}:${variant})`,
        );
      }
      if (clip.kind !== 'along' || entry.clip.path === undefined) {
        throw new Error(
          `gen-choreographies: clip ${name}:${variant} — ожидаю kind=along и clip.path (слой-цель)`,
        );
      }
      const layerD = readIconPathD(name, variant, entry.clip.path);
      const bbox = pathBBox(layerD);
      const origin = [bbox.minX, bbox.minY];
      const band = alongClipBuilder(clip);

      // Самопроверка данных: при p=1 лента покрывает ВЕСЬ контур слоя,
      // при p=0 — ни одной точки (иначе направляющая/полуширина неверны).
      const contour = samplePolylines(layerD, 8).flat();
      const bandFull = band.bandPoints(1);
      const bandNone = band.bandPoints(0);
      const uncovered = contour.filter((pt) => !insidePolygon(pt, bandFull)).length;
      const leaked = contour.filter((pt) => insidePolygon(pt, bandNone)).length;
      if (uncovered > 0 || leaked > 0) {
        throw new Error(
          `gen-choreographies: clip ${name}:${variant} — лента не покрывает контур ` +
            `(не покрыто при p=1: ${uncovered}, видно при p=0: ${leaked})`,
        );
      }

      const w = p.presetToWaapi(clip.spec);
      compiled.clip = {
        path: entry.clip.path,
        keyframes: w.progressTrack.offsets.map((offset, i) => ({
          offset,
          clipPath: band.clipPath(w.progressTrack.values[i], origin),
        })),
        timing: w.timing,
      };
    }
    if (entry.morphs) {
      compiled.morphs = entry.morphs.map((m) => {
        const morph = iconMorphs[m.motion];
        if (!morph) {
          throw new Error(
            `gen-choreographies: неизвестный morph-motion "${m.motion}" (${name}:${variant})`,
          );
        }
        const dRest = readIconPathD(name, variant, m.path);
        const values = morph.shapes(dRest);
        // Гарантия плавности: структура команд всех форм идентична
        const signature = (d) => parsePathData(d).map((s) => s.cmd).join('');
        const restSig = signature(dRest);
        for (const value of values) {
          if (signature(value) !== restSig) {
            throw new Error(
              `gen-choreographies: morph ${name}:${variant} — структура команд формы разошлась`,
            );
          }
        }
        return {
          path: m.path,
          values,
          keyTimes: morph.keyTimes,
          keySplines: morph.keySplines,
          durationMs: morph.durationMs,
        };
      });
    }
    iconsOut[name][variant] = compiled;
  }
}

const provenance = {
  source: '@labpics/motion/presets',
  motionSha,
  generatedFrom: 'feat/icon-effect-presets (lab-motion PR #24)',
};

const out = {
  comment: 'СГЕНЕРИРОВАНО scripts/gen-choreographies.mjs — НЕ править руками.',
  provenance,
  choreographies,
};

mkdirSync(join(root, 'src', 'animate'), { recursive: true });
writeFileSync(
  join(root, 'src', 'animate', 'choreographies.generated.json'),
  JSON.stringify(out, null, 1) + '\n',
  'utf8',
);
writeFileSync(
  join(root, 'src', 'animate', 'icon-choreographies.generated.json'),
  JSON.stringify(
    {
      comment:
        'СГЕНЕРИРОВАНО scripts/gen-choreographies.mjs из semantics/layers.json — НЕ править руками.',
      provenance,
      icons: iconsOut,
    },
    null,
    1,
  ) + '\n',
  'utf8',
);
console.log(
  `gen-choreographies: OK — ${Object.keys(choreographies).length} классов, ` +
    `${Object.keys(iconsOut).length} per-icon иконок, lab-motion ${motionSha}`,
);
