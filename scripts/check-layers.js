/**
 * scripts/check-layers.js — гейт per-icon разметки (semantics/layers.json).
 *
 * Ловит два класса дрифта ДО рантайма (реврейм BL-004/BL-005):
 *   1. Разметка ↔ реальность SVG: path-индексы существуют в файле начертания,
 *      якоря лежат в границах viewBox (якорь = оптическая ось в px viewBox).
 *   2. Разметка ↔ генерат: icon-choreographies.generated.json собран ровно из
 *      текущего layers.json (наборы иконок/вариантов/частей, paths, anchor,
 *      clip-блоки), все числа конечны, provenance несёт SHA lab-motion.
 *
 * Ненулевой exit при любой ошибке — гейт в verify и CI.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { iconGeometry } from './lib/icon-geometry.js';
import { parsePathData, pathBBox } from './lib/path-data.js';

const VARIANTS = ['outline', 'filled'];
const PATH_D_RE = /<path\b[^>]*?\bd="([^"]+)"/g;

/**
 * @param {{
 *   layers: any, generated: any, assignments: any,
 *   readSvg: (name: string, variant: string) => string
 * }} input
 * @returns {string[]} список ошибок (пусто = валидно)
 */
export function validateLayers({ layers, generated, assignments, readSvg }) {
  const errors = [];
  const err = (m) => errors.push(m);

  if (!layers || layers.version !== 1 || typeof layers.icons !== 'object' || !layers.icons) {
    return ['layers.json: нет version=1 или icons'];
  }
  if (typeof generated?.provenance?.motionSha !== 'string' || !generated.provenance.motionSha) {
    err('генерат: provenance.motionSha отсутствует — неизвестно, из какого lab-motion собрано');
  }
  const genIcons = generated?.icons ?? {};

  // Дрифт наборов: генерат обязан содержать РОВНО иконки/варианты layers.json.
  for (const name of Object.keys(genIcons)) {
    if (!(name in layers.icons)) err(`генерат: лишняя иконка "${name}" — нет в layers.json`);
  }

  for (const [name, variants] of Object.entries(layers.icons)) {
    if (!(name in assignments)) {
      err(`layers.json: "${name}" нет в semantics/assignments.json`);
      continue;
    }
    if (!(name in genIcons)) {
      err(`генерат: иконка "${name}" из layers.json не сгенерирована — прогони gen-choreographies`);
    }
    for (const [variant, entry] of Object.entries(variants)) {
      const at = `${name}:${variant}`;
      if (!VARIANTS.includes(variant)) {
        err(`layers.json: ${at} — неизвестный вариант (ожидаю outline|filled)`);
        continue;
      }
      if (!Array.isArray(entry.parts) || entry.parts.length === 0) {
        err(`layers.json: ${at} — parts пуст`);
        continue;
      }

      // Реальность SVG: индексы и якоря против фактической геометрии файла.
      let geometry = null;
      let layerDs = [];
      try {
        const svgContent = readSvg(name, variant);
        geometry = iconGeometry(svgContent);
        layerDs = [...svgContent.matchAll(PATH_D_RE)].map((m) => m[1]);
      } catch (cause) {
        err(`layers.json: ${at} — SVG не читается (${cause.message})`);
      }

      const seenIndexes = new Set();
      for (const part of entry.parts) {
        if (!Array.isArray(part.paths) || part.paths.length === 0) {
          err(`layers.json: ${at} — у части "${part.part}" пустой paths`);
          continue;
        }
        for (const idx of part.paths) {
          if (!Number.isInteger(idx) || idx < 0) {
            err(`layers.json: ${at} — path-индекс "${idx}" не целое ≥ 0`);
          } else if (geometry && idx >= geometry.paths.length) {
            err(
              `layers.json: ${at} — path-индекс ${idx} за пределами SVG ` +
                `(в файле ${geometry.paths.length} слоёв)`,
            );
          }
          if (seenIndexes.has(idx)) {
            err(`layers.json: ${at} — path-индекс ${idx} дублируется между частями`);
          }
          seenIndexes.add(idx);
        }
        if (
          !Array.isArray(part.anchor) ||
          part.anchor.length !== 2 ||
          part.anchor.some((v) => !Number.isFinite(v))
        ) {
          err(`layers.json: ${at} — якорь части "${part.part}" не пара конечных чисел`);
        } else if (geometry) {
          const { x, y, width, height } = geometry.viewBox;
          const [ax, ay] = part.anchor;
          if (ax < x || ax > x + width || ay < y || ay > y + height) {
            err(`layers.json: ${at} — якорь (${ax},${ay}) вне viewBox ${x} ${y} ${width} ${height}`);
          }
        }
        if (typeof part.motion !== 'string' || !part.motion) {
          err(`layers.json: ${at} — часть "${part.part}" без motion`);
        }
        if (
          part.staggerGapMs !== undefined &&
          !(Number.isFinite(part.staggerGapMs) && part.staggerGapMs >= 0)
        ) {
          err(`layers.json: ${at} — staggerGapMs не конечное число ≥ 0`);
        }
      }

      // Дрифт с генератом: структура записи собрана из ЭТОГО layers.json.
      const gen = genIcons[name]?.[variant];
      if (!gen) {
        if (name in genIcons) err(`генерат: ${at} — вариант не сгенерирован`);
        continue;
      }
      if (!Array.isArray(gen.parts) || gen.parts.length !== entry.parts.length) {
        err(`генерат: ${at} — число частей не совпадает с layers.json`);
        continue;
      }
      for (let i = 0; i < entry.parts.length; i++) {
        const src = entry.parts[i];
        const dst = gen.parts[i];
        if (JSON.stringify(src.paths) !== JSON.stringify(dst.paths)) {
          err(`генерат: ${at} часть ${i} — paths разошлись с layers.json`);
        }
        if (JSON.stringify(src.anchor) !== JSON.stringify(dst.anchor)) {
          err(`генерат: ${at} часть ${i} — якорь разошёлся с layers.json`);
        }
        if ((src.staggerGapMs ?? null) !== (dst.staggerGapMs ?? null)) {
          err(`генерат: ${at} часть ${i} — staggerGapMs разошёлся с layers.json`);
        }
        if (!Array.isArray(dst.keyframes) || dst.keyframes.length < 2) {
          err(`генерат: ${at} часть ${i} — меньше 2 кейфреймов`);
        } else {
          validateOffsets(dst.keyframes, `${at} часть ${i}`, err);
        }
        if (!(dst.timing?.duration > 0)) {
          err(`генерат: ${at} часть ${i} — duration не > 0`);
        }
        validateFinite(dst, `${at} часть ${i}`, err);
      }
      if (Boolean(entry.clip) !== Boolean(gen.clip)) {
        err(`генерат: ${at} — clip-блок разошёлся с layers.json (есть/нет)`);
      } else if (gen.clip) {
        if ((entry.clip.path ?? null) !== (gen.clip.path ?? null)) {
          err(`генерат: ${at} clip — слой-цель (path) разошёлся с layers.json`);
        }
        if (!Array.isArray(gen.clip.keyframes) || gen.clip.keyframes.length < 2) {
          err(`генерат: ${at} clip — меньше 2 кейфреймов`);
        } else {
          validateOffsets(gen.clip.keyframes, `${at} clip`, err);
          for (const kf of gen.clip.keyframes) {
            if (typeof kf.clipPath !== 'string' || !kf.clipPath) {
              err(`генерат: ${at} clip — кейфрейм без clipPath`);
              break;
            }
          }
        }
        validateFinite(gen.clip, `${at} clip`, err);
      }

      // Морфы формы (BL-007): identity-края, единая структура команд,
      // валидные keyTimes, формы внутри канвы.
      if (Boolean(entry.morphs) !== Boolean(gen.morphs)) {
        err(`генерат: ${at} — морф-блок разошёлся с layers.json (есть/нет)`);
      } else if (gen.morphs) {
        if (!Array.isArray(gen.morphs) || gen.morphs.length !== entry.morphs.length) {
          err(`генерат: ${at} — число морфов не совпадает с layers.json`);
        } else {
          for (let i = 0; i < gen.morphs.length; i++) {
            validateMorph(entry.morphs[i], gen.morphs[i], layerDs, geometry, `${at} морф ${i}`, err);
          }
        }
      }
    }
  }
  return errors;
}

function validateMorph(src, dst, layerDs, geometry, at, err) {
  if (src.path !== dst.path) {
    err(`генерат: ${at} — слой-цель (path) разошёлся с layers.json`);
    return;
  }
  if (!Array.isArray(dst.values) || dst.values.length < 2) {
    err(`генерат: ${at} — меньше 2 форм`);
    return;
  }
  if (
    !Array.isArray(dst.keyTimes) ||
    dst.keyTimes.length !== dst.values.length ||
    dst.keyTimes[0] !== 0 ||
    dst.keyTimes[dst.keyTimes.length - 1] !== 1 ||
    dst.keyTimes.some((v, i) => !Number.isFinite(v) || (i > 0 && v < dst.keyTimes[i - 1]))
  ) {
    err(`генерат: ${at} — keyTimes не неубывающие 0..1 той же длины, что формы`);
  }
  if (!(dst.durationMs > 0)) err(`генерат: ${at} — durationMs не > 0`);

  const restD = layerDs[dst.path];
  if (restD !== undefined) {
    if (dst.values[0] !== restD || dst.values[dst.values.length - 1] !== restD) {
      err(`генерат: ${at} — морф без identity-краёв (края обязаны равняться d слоя)`);
    }
  }
  let signature = null;
  for (const value of dst.values) {
    let segs;
    try {
      segs = parsePathData(value);
    } catch (cause) {
      err(`генерат: ${at} — форма не парсится (${cause.message})`);
      return;
    }
    const sig = segs.map((s) => s.cmd).join('');
    if (signature === null) signature = sig;
    else if (sig !== signature) {
      err(`генерат: ${at} — структура команд форм разошлась (морф будет дискретным)`);
      return;
    }
    if (geometry) {
      const b = pathBBox(value);
      const { x, y, width, height } = geometry.viewBox;
      if (b.minX < x - 0.05 || b.maxX > x + width + 0.05 || b.minY < y - 0.05 || b.maxY > y + height + 0.05) {
        err(`генерат: ${at} — форма морфа выходит за viewBox (канву)`);
      }
    }
  }
}

function validateOffsets(keyframes, at, err) {
  let prev = -1;
  for (const kf of keyframes) {
    if (!Number.isFinite(kf.offset) || kf.offset < 0 || kf.offset > 1 || kf.offset < prev) {
      err(`генерат: ${at} — offset-ы не неубывающие в [0,1] (все конечные)`);
      return;
    }
    prev = kf.offset;
  }
  if (keyframes[0].offset !== 0 || keyframes[keyframes.length - 1].offset !== 1) {
    err(`генерат: ${at} — offset-ы не покрывают [0,1] от края до края`);
  }
}

/** Глубокий скан: каждое число в поддереве конечно (NaN/Infinity = дрифт-бомба). */
function validateFinite(node, at, err) {
  if (typeof node === 'number') {
    if (!Number.isFinite(node)) err(`генерат: ${at} — неконечное число в данных`);
    return;
  }
  if (Array.isArray(node)) {
    for (const v of node) validateFinite(v, at, err);
    return;
  }
  if (node && typeof node === 'object') {
    for (const v of Object.values(node)) validateFinite(v, at, err);
  }
}

// CLI-гейт: читает реальные файлы репо, ненулевой exit при ошибках.
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), '..');
  const readJson = (p) => JSON.parse(readFileSync(join(root, p), 'utf8'));
  const errors = validateLayers({
    layers: readJson('semantics/layers.json'),
    generated: readJson('src/animate/icon-choreographies.generated.json'),
    assignments: readJson('semantics/assignments.json'),
    readSvg: (name, variant) =>
      readFileSync(
        variant === 'filled'
          ? join(root, 'svg', 'Filled', `${name}_filled.svg`)
          : join(root, 'svg', 'Outline', `${name}.svg`),
        'utf8',
      ),
  });
  if (errors.length > 0) {
    console.error(`check-layers: FAIL — ${errors.length} ошибок:`);
    for (const e of errors) console.error('  - ' + e);
    process.exit(1);
  }
  const count = Object.keys(readJson('semantics/layers.json').icons).length;
  console.log(`check-layers: OK — per-icon разметка валидна (${count} иконок)`);
}
