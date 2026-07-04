/**
 * shift-subpaths.mjs — сдвиг суб-путей внутри SVG-иконки (BL-016).
 *
 * Родовая ошибка корпуса: глиф внутри контейнера на 0.30 ниже центра.
 * В Outline проявлялась как «кольцо выше глифа» (закрыто фиксом +0.3 колец),
 * в Filled — как глиф ниже центра диска. Модуль двигает выбранные суб-пути
 * на вектор, сохраняя текст нетронутых суб-путей дословно (пересериализация
 * всего d раздувает файл ~40%: теряются шортхенды и относительные команды).
 *
 * Экспорт: shiftSubpaths(content, movesBySubIndex) — суб-пути нумеруются
 * СКВОЗНО по рендерящимся <path> (пропуская <defs>), в порядке файла.
 *
 * CLI (легаси-режим «все не-контейнеры на dy»):
 *   node shift-subpaths.mjs <файл.svg> <dy> [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { samplePolylines } from '../lib/curve-sampling.js';
import { parsePathData } from '../lib/path-data.js';

/**
 * Число в стиле корпуса: 3 знака (округление до 2 знаков создавало
 * пороговые «почти-гладкие изломы» ~2° на стыках — гейт качества ловил
 * +1 шум на bookmark), без хвостовых нулей и ведущего 0.
 */
const fmt = (v) => {
  let s = (Math.round(v * 1000) / 1000).toFixed(3);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  s = s.replace(/^(-?)0\./, '$1.');
  return s === '' || s === '-' ? '0' : s;
};

function serialize(segs) {
  let d = '';
  for (const s of segs) {
    if (s.cmd === 'M') d += `M${fmt(s.x)} ${fmt(s.y)}`;
    else if (s.cmd === 'L') d += `L${fmt(s.x)} ${fmt(s.y)}`;
    else if (s.cmd === 'C')
      d += `C${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x2)} ${fmt(s.y2)} ${fmt(s.x)} ${fmt(s.y)}`;
    else if (s.cmd === 'Q') d += `Q${fmt(s.x1)} ${fmt(s.y1)} ${fmt(s.x)} ${fmt(s.y)}`;
    else if (s.cmd === 'A')
      d += `A${fmt(s.rx)} ${fmt(s.ry)} ${fmt(s.rotation)} ${s.largeArc} ${s.sweep} ${fmt(s.x)} ${fmt(s.y)}`;
    else if (s.cmd === 'Z') d += 'Z';
  }
  return d;
}

/**
 * Заголовок куска → абсолютный M. Применяется ТОЛЬКО к куску, идущему
 * сразу за сдвинутым (его относительный m опирался на конечную точку
 * сдвинутого суб-пути). ЛОВУШКА неявных lineto: `m x y -2 3…` несёт
 * неявные ОТНОСИТЕЛЬНЫЕ lineto — при смене регистра на M они стали бы
 * абсолютными, поэтому перед неявным хвостом вставляется явная `l`.
 */
const absHead = (chunk, sp) =>
  chunk.replace(
    /^([Mm])[\s,]*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[\s,]*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([\s,]*)(-?[\d.]|)/,
    (whole, cmd, x, y, sep, tailStart) =>
      `M${fmt(sp[0].x)} ${fmt(sp[0].y)}` +
      (tailStart ? `${cmd === 'm' ? 'l' : 'L'}${tailStart}` : sep + tailStart),
  );

/** Диапазоны <defs>…</defs> в контенте (их path — служебные, не трогаем). */
function defsRanges(content) {
  const ranges = [];
  for (const m of content.matchAll(/<defs\b[\s\S]*?<\/defs>/g)) {
    ranges.push([m.index, m.index + m[0].length]);
  }
  return ranges;
}

/**
 * Сдвиг суб-путей файла: moves — Map<subIndex, [dx,dy]> со СКВОЗНОЙ
 * нумерацией суб-путей по рендерящимся path. Возвращает { content, log,
 * subpaths } — subpaths несёт bbox-центры для маппинга контуров.
 */
export function shiftSubpaths(content, moves = new Map()) {
  const ranges = defsRanges(content);
  const inDefs = (idx) => ranges.some(([a, b]) => idx >= a && idx < b);
  const log = [];
  const subpathsInfo = [];
  let subIdx = 0;
  const newContent = content.replace(
    /(<path\b[^>]*?\bd=")([^"]+)(")/g,
    (whole, pre, dOrig, post, offset) => {
      if (inDefs(offset)) return whole;
      const segs = parsePathData(dOrig);
      const subpaths = [];
      let current = null;
      for (const s of segs) {
        if (s.cmd === 'M') {
          current = [];
          subpaths.push(current);
        }
        current.push(s);
      }
      const chunks = dOrig.split(/(?=[Mm])/).filter((c) => c.length);
      const polys = samplePolylines(dOrig, 24);
      if (polys.length !== subpaths.length || chunks.length !== subpaths.length) {
        throw new Error(`рассинхрон суб-путей/кусков/полилиний в d (${subpaths.length}/${chunks.length}/${polys.length})`);
      }
      let prevShifted = false;
      const outChunks = subpaths.map((sp, i) => {
        const poly = polys[i];
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of poly) {
          minX = Math.min(minX, x); minY = Math.min(minY, y);
          maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
        }
        subpathsInfo.push({
          subIndex: subIdx,
          cx: (minX + maxX) / 2,
          cy: (minY + maxY) / 2,
          w: maxX - minX,
          h: maxY - minY,
        });
        const move = moves.get(subIdx);
        subIdx++;
        if (!move) {
          // текст дословно; abs-заголовок нужен ТОЛЬКО следом за сдвинутым
          // (его относительный m опирался на конец сдвинутого суб-пути)
          const chunk = prevShifted ? absHead(chunks[i], sp) : chunks[i];
          prevShifted = false;
          return chunk;
        }
        const [dx, dy] = move;
        log.push(`суб-путь ${subIdx - 1}: сдвиг (${fmt(dx)}, ${fmt(dy)})`);
        for (const s of sp) {
          if (s.cmd !== 'Z') {
            if ('x' in s) s.x += dx;
            if ('y' in s) s.y += dy;
          }
          if ('x1' in s) s.x1 += dx;
          if ('y1' in s) s.y1 += dy;
          if ('x2' in s) s.x2 += dx;
          if ('y2' in s) s.y2 += dy;
        }
        prevShifted = true;
        return serialize(sp);
      });
      return pre + outChunks.join('') + post;
    },
  );
  return { content: newContent, log, subpaths: subpathsInfo };
}

// ── CLI: легаси-режим — все суб-пути, кроме круглого контейнера, на dy ──
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const [file, dyArg, writeFlag] = process.argv.slice(2);
  const dy = Number(dyArg);
  if (!file || !Number.isFinite(dy)) {
    console.error('использование: node shift-subpaths.mjs <файл.svg> <dy> [--write]');
    process.exit(1);
  }
  const content = readFileSync(file, 'utf8');
  // контейнер = почти-круг r>канва/4 (детект по полилинии суб-пути)
  const probe = shiftSubpaths(content, new Map());
  const dOrig = /d="([^"]+)"/.exec(content)[1];
  const polys = samplePolylines(dOrig, 24);
  const moves = new Map();
  probe.subpaths.forEach((sp, i) => {
    const poly = polys[i];
    if (!poly) return;
    let a = 0, cx = 0, cy = 0;
    for (let j = 0; j < poly.length; j++) {
      const [x1, y1] = poly[j];
      const [x2, y2] = poly[(j + 1) % poly.length];
      const w = x1 * y2 - x2 * y1;
      a += w; cx += (x1 + x2) * w; cy += (y1 + y2) * w;
    }
    a /= 2;
    if (Math.abs(a) < 3) { moves.set(i, [0, dy]); return; }
    cx /= 6 * a; cy /= 6 * a;
    let sum = 0, min = Infinity, max = -Infinity;
    for (const [x, y] of poly) {
      const r = Math.hypot(x - cx, y - cy);
      sum += r; min = Math.min(min, r); max = Math.max(max, r);
    }
    const isContainer = max - min < 0.35 && sum / poly.length > 6;
    console.log(`суб-путь ${i}: ${isContainer ? 'контейнер (не трогаю)' : `глиф → dy ${dy}`}`);
    if (!isContainer) moves.set(i, [0, dy]);
  });
  const { content: out, log } = shiftSubpaths(content, moves);
  if (writeFlag === '--write') {
    writeFileSync(file, out);
    console.log(`записано: ${log.length} суб-путей сдвинуто`);
  } else {
    console.log('\n(сухой прогон, --write для записи)\n' + /d="([^"]+)"/.exec(out)[1]);
  }
}
