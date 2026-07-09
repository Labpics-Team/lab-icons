/**
 * clean-hairlines.mjs — удаление волосяных суб-путей (класс дырок cog,
 * BL-руины): фрагменты экспорта со средней толщиной 2|S|/P < 0.15 —
 * мусор при любом fill-rule (nonzero рисует чёрный волос, evenodd —
 * белую дырку). Критерий ТОТ ЖЕ, что в гейте check-path-quality (5а).
 *
 * Механика удаления как в shift-subpaths: текст нетронутых кусков
 * дословно; кусок, идущий за удалённым, абсолютизируется absHead
 * (его относительный m опирался на конец удалённого суб-пути).
 *
 * Запуск: node clean-hairlines.mjs <файл.svg> [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { samplePolylines } from '../lib/curve-sampling.js';
import { parsePathData } from '../lib/path-data.js';

const fmt = (v) => {
  let s = (Math.round(v * 1000) / 1000).toFixed(3);
  s = s.replace(/0+$/, '').replace(/\.$/, '');
  s = s.replace(/^(-?)0\./, '$1.');
  return s === '' || s === '-' ? '0' : s;
};

const absHead = (chunk, sp) =>
  chunk.replace(
    /^([Mm])[\s,]*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)[\s,]*(-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)([\s,]*)(-?[\d.]|)/,
    (whole, cmd, x, y, sep, tailStart) =>
      `M${fmt(sp[0].x)} ${fmt(sp[0].y)}` +
      (tailStart ? `${cmd === 'm' ? 'l' : 'L'}${tailStart}` : sep + tailStart),
  );

export function removeHairlines(content) {
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
      const polys = samplePolylines(dOrig, 24);
      if (polys.length !== subpaths.length || chunks.length !== subpaths.length) {
        throw new Error(`рассинхрон суб-путей (${subpaths.length}/${chunks.length}/${polys.length})`);
      }
      if (subpaths.length < 2) return whole; // одиночный контур не трогаем (как в гейте)
      let prevRemoved = false;
      const outChunks = [];
      subpaths.forEach((sp, i) => {
        const p = polys[i];
        let a = 0, per = 0;
        for (let k = 0; k < p.length; k++) {
          const [x1, y1] = p[k];
          const [x2, y2] = p[(k + 1) % p.length];
          a += x1 * y2 - x2 * y1;
          per += Math.hypot(x2 - x1, y2 - y1);
        }
        a = Math.abs(a / 2);
        const hairline = per > 0.1 && (2 * a) / per < 0.15;
        if (hairline) {
          log.push(`удалён волосяной суб-путь ${i} (толщина ${((2 * a) / per).toFixed(3)}, периметр ${per.toFixed(2)})`);
          prevRemoved = true;
          return;
        }
        outChunks.push(prevRemoved ? absHead(chunks[i], sp) : chunks[i]);
        prevRemoved = false;
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
  const { content: out, log } = removeHairlines(content);
  console.log(file + ':');
  for (const l of log) console.log('  ' + l);
  if (!log.length) console.log('  волосяных не найдено');
  if (writeFlag === '--write' && log.length) {
    writeFileSync(file, out);
    console.log('  записано');
  }
}
