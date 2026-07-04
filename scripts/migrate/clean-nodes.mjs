/**
 * clean-nodes.mjs — детерминированная чистка узлового мусора экспорта
 * (классы гейта check-path-quality, формы НЕ меняющие):
 *   1) лишний узел на прямой: L-узел между двумя L-сегментами,
 *      отклонение от хорды соседей < 0.02 — узел удаляется;
 *   2) микросегмент-«узелок» < 0.05: СКЛЕИВАЕТСЯ с соседним узлом
 *      только если оба конца — L-сегменты (кривые не трогаем — там
 *      узелок может нести касательную).
 * Правки per-subpath по механике shift-subpaths: нетронутые куски
 * дословно, правленые пересериализуются, следующий за правленым
 * абсолютизируется absHead.
 *
 * Запуск: node clean-nodes.mjs <файл.svg> [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { samplePolylines } from '../lib/curve-sampling.js';
import { parsePathData } from '../lib/path-data.js';

const REDUNDANT = 0.02;
const MICRO = 0.05;

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

const absHead = (chunk, sp) =>
  chunk.replace(
    /^([Mm])[\s,]*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[\s,]*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([\s,]*)(-?[\d.]|)/,
    (whole, cmd, x, y, sep, tailStart) =>
      `M${fmt(sp[0].x)} ${fmt(sp[0].y)}` +
      (tailStart ? `${cmd === 'm' ? 'l' : 'L'}${tailStart}` : sep + tailStart),
  );

/** Чистка одного суб-пути (массив сегментов, [0] = M). Возвращает
 *  {segs, removed} — removed = число убранных узлов. */
function cleanSubpath(sp) {
  const segs = sp.map((s) => ({ ...s }));
  let removed = 0;
  let changed = true;
  while (changed) {
    changed = false;
    for (let i = 1; i < segs.length - 1; i++) {
      const cur = segs[i];
      const next = segs[i + 1];
      if (cur.cmd !== 'L' || next.cmd !== 'L') continue;
      const prev = segs[i - 1];
      const from = [prev.x, prev.y];
      const mid = [cur.x, cur.y];
      const to = [next.x, next.y];
      const dx = to[0] - from[0];
      const dy = to[1] - from[1];
      const len = Math.hypot(dx, dy) || 1;
      const dist = Math.abs((mid[0] - from[0]) * dy - (mid[1] - from[1]) * dx) / len;
      const segLen = Math.hypot(mid[0] - from[0], mid[1] - from[1]);
      const nextLen = Math.hypot(to[0] - mid[0], to[1] - mid[1]);
      // лишний узел на прямой ИЛИ L-микросегмент, растворяемый в соседний L
      if (dist < REDUNDANT || segLen < MICRO || nextLen < MICRO) {
        segs.splice(i, 1);
        removed++;
        changed = true;
        break;
      }
    }
  }
  return { segs, removed };
}

export function cleanNodes(content) {
  const log = [];
  const newContent = content.replace(
    /(<path\b[^>]*?\bd=")([^"]+)(")/g,
    (whole, pre, dOrig, post) => {
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
      if (chunks.length !== subpaths.length) throw new Error('рассинхрон кусков');
      let prevEdited = false;
      const outChunks = subpaths.map((sp, i) => {
        const { segs: cleaned, removed } = cleanSubpath(sp);
        if (!removed) {
          const chunk = prevEdited ? absHead(chunks[i], sp) : chunks[i];
          prevEdited = false;
          return chunk;
        }
        log.push(`суб-путь ${i}: убрано узлов ${removed}`);
        prevEdited = true;
        return serialize(cleaned);
      });
      return pre + outChunks.join('') + post;
    },
  );
  return { content: newContent, log };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const [file, writeFlag] = process.argv.slice(2);
  const content = readFileSync(file, 'utf8');
  const { content: out, log } = cleanNodes(content);
  console.log(file.split(/[\\/]/).slice(-2).join('/') + ':');
  for (const l of log) console.log('  ' + l);
  if (!log.length) console.log('  чисто');
  if (writeFlag === '--write' && log.length) {
    writeFileSync(file, out);
    console.log('  записано');
  }
}
