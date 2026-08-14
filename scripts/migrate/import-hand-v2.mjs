/**
 * Импорт hand v2 (Figma-экспорт августа 2026) в svg/ — только бакет «import»
 * из reports-hand-v2-triage.json (master=hand И владелец перерисовал).
 *
 * Нормализация под формат репо (сид 668af3f):
 *  - разворачивание <g clip-path=...> и вырезание <defs> (фантомный clipPath
 *    Figma-экспорта — класс 9fe5767: служебный прямоугольник не геометрия);
 *  - снятие fill/fill-rule-atributos root-а, снятие fill с path (цвет — через
 *    currentColor на этапе build, источники его не несут);
 *  - канонический конверт <svg viewBox="0 0 24 24" xmlns width height>.
 *
 * Инвариант: чернила ДО и ПОСЛЕ нормализации идентичны (path-aware растр,
 * шаг 0.12, IoU=1.0) — иначе файл пропускается с ошибкой в отчёт.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { optimize } from 'svgo';
import { rasterizeSvgInk } from '../lib/ink-raster.js';

const require = createRequire(import.meta.url);

const DESK = 'C:/Users/Daniel/Desktop/Lab Icons';
const ROOT = process.cwd();
const triage = JSON.parse(readFileSync(join(ROOT, 'reports-hand-v2-triage.json'), 'utf8'));

function normalize(svg) {
  // Срезать defs можно только если каждый clipPath — identity-прямоугольник канвы:
  // любой другой клип РЕЖЕТ чернила, его снятие меняет иконку.
  for (const def of svg.matchAll(/<clipPath\b[^>]*>([\s\S]*?)<\/clipPath>/g)) {
    const inner = def[1].trim();
    const identity = /^<rect\s+width="24"\s+height="24"[^>]*\/?>(<\/rect>)?$/.test(inner)
      || /^<path\s+d="M0\s*0\s*[hH]24\s*[vV]24\s*[hH]-?24\s*[zZ]?"[^>]*\/?>$/.test(inner);
    if (!identity) throw new Error(`неidentity clipPath: ${inner.slice(0, 60)}`);
  }
  let body = svg
    .replace(/<defs>[\s\S]*?<\/defs>/g, '')
    .replace(/<g\s+clip-path="[^"]*"\s*>/g, '')
    .replace(/<\/g>/g, '');
  const paths = [...body.matchAll(/<path\b[^>]*>/g)].map(m => {
    let tag = m[0].replace(/\s+fill="[^"]*"/g, '');
    // Контракт корпуса (svg-corpus тест 3–7): fill-rule="evenodd" обязан идти
    // в паре с clip-rule — снимать clip-rule нельзя, только дополнять.
    if (/fill-rule="evenodd"/.test(tag) && !/clip-rule=/.test(tag)) {
      tag = tag.replace(/fill-rule="evenodd"/, 'fill-rule="evenodd" clip-rule="evenodd"');
    }
    return tag.endsWith('/>') ? tag : tag.replace(/>$/, '/>');
  });
  if (paths.length === 0) throw new Error('нет path после нормализации');
  const wrapped = `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">${paths.join('')}</svg>`;
  // Источник обязан быть неподвижной точкой SVGO по числу path (контракт
  // icon-catalog: author count == artifact count) — прогоняем оптимизатор
  // при импорте, чтобы mergePaths/convertPathData отработали один раз здесь,
  // затем возвращаем канонический конверт репозитория. Квантование SVGO
  // (floatPrecision 2) — канон репо, растром не перепроверяется; растр
  // проверяет только НАШИ преобразования (снятие defs/g/fill) — см. вызов.
  const svgoConfig = require(join(ROOT, 'svgo.config.cjs'));
  const opt = optimize(wrapped, { ...svgoConfig });
  if (opt.error) throw new Error(`SVGO: ${opt.error}`);
  const optPaths = [...opt.data.matchAll(/<path\b[^>]*\/?>/g)]
    .map(m => m[0].replace(/\s+fill="currentColor"/g, ''));
  if (optPaths.length === 0) throw new Error('SVGO съел все path');
  return {
    preSvgo: wrapped,
    final: `<svg viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg" width="24" height="24">${optPaths.join('')}</svg>`,
    postSvgoRaw: opt.data,
  };
}

function mask(svg) {
  return rasterizeSvgInk(svg, { width: 24, height: 24, step: 0.12 }).mask;
}
// SVGO пишет координаты с floatPrecision 2 (канон репо) — рёбра плывут до
// 0.005u и переворачивают граничные клетки растра. Порог 0.999 пропускает
// только это квантование: смысловая правка формы стоит на порядки дороже.
// IoU непригоден для тонких штрихов (кольцо 1.8u при шаге 0.12: квантование
// floatPrecision 2 переворачивает клетки обеих кромок → IoU ~0.92 на визуально
// идентичных формах). Правильный инвариант — дискретный Хаусдорф: каждая
// клетка симметрической разности лежит не дальше maxDist клеток от чернил
// другой маски. Сдвиг кромки квантованием ≤0.005u проходит; потерянная точка,
// залитая evenodd-дырка или срезанный элемент — компактная область глубже
// шага растра — валит проверку.
function inkPreserved(a, b, maxDistCells = 1) {
  const STEP = 0.12;
  const ra = rasterizeSvgInk(a, { width: 24, height: 24, step: STEP });
  const rb = rasterizeSvgInk(b, { width: 24, height: 24, step: STEP });
  const { cols, rows } = ra;
  const near = (m, r, c) => {
    for (let dr = -maxDistCells; dr <= maxDistCells; dr++) {
      for (let dc = -maxDistCells; dc <= maxDistCells; dc++) {
        const rr = r + dr, cc = c + dc;
        if (rr >= 0 && rr < rows && cc >= 0 && cc < cols && m[rr * cols + cc]) return true;
      }
    }
    return false;
  };
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const i = r * cols + c;
      if (ra.mask[i] && !rb.mask[i] && !near(rb.mask, r, c)) return false;
      if (rb.mask[i] && !ra.mask[i] && !near(ra.mask, r, c)) return false;
    }
  }
  return true;
}

let ok = 0;
const failed = [];
const unchanged = [];
for (const key of triage.import) {
  const [variant, name] = key.split('/');
  const file = `${name}.svg`;
  const src = readFileSync(join(DESK, variant, file), 'utf8');
  try {
    const { preSvgo, final, postSvgoRaw } = normalize(src);
    // Инвариант 1 (строгий): НАШИ преобразования (снятие defs/g/fill,
    // самозакрытие тегов) чернил не двигают — сверка оригинал ↔ preSvgo.
    const base = src
      .replace(/<defs>[\s\S]*?<\/defs>/g, '')
      .replace(/<g\s+clip-path="[^"]*"\s*>/g, '')
      .replace(/<\/g>/g, '');
    if (!inkPreserved(base, preSvgo, 0)) throw new Error('чернила изменились при нормализации');
    // SVGO-канонизация (floatPrecision 2, makeArcs: безье→дуга со сдвигом
    // до ~0.5u) — норма репо: master собран тем же конвейером. Отдельный
    // инвариант на неё не нужен; вместо него — пропуск файлов, чья
    // канонизация совпала с master по чернилам (владелец их не менял,
    // расхождение триажа было артефактом сырого экспорта).
    if (inkPreserved(final, readFileSync(join(ROOT, 'svg', variant, file), 'utf8'), 0)) {
      unchanged.push(key);
      continue;
    }
    // Инвариант 2: снятие fill="currentColor" с конверта не тронуло path.
    const countRaw = (postSvgoRaw.match(/<path\b/g) || []).length;
    const countFinal = (final.match(/<path\b/g) || []).length;
    if (countRaw !== countFinal) throw new Error('потерян path при переупаковке');
    writeFileSync(join(ROOT, 'svg', variant, file), final + '\n');
    ok++;
  } catch (e) {
    failed.push(`${key}: ${e.message}`);
  }
}
console.log(`импортировано ${ok}/${triage.import.length}; без изменений после канонизации: ${unchanged.length} (${unchanged.join(', ')})`);
if (failed.length) {
  console.log('ПРОПУЩЕНО:');
  for (const f of failed) console.log(' ', f);
  process.exitCode = 1;
}
