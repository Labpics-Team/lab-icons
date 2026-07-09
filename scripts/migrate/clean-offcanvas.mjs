/**
 * clean-offcanvas.mjs — удаление мёртвой геометрии за канвой (класс
 * headphone_filled: суб-пути с bbox ПОЛНОСТЬЮ вне [−0.5, 24.5],
 * прикрытые clip-path — невидимы, но живут в d и портят замеры).
 * Механика удаления = clean-hairlines (absHead за удалённым куском).
 *
 * Запуск: node clean-offcanvas.mjs <файл.svg> [--write]
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

export function removeOffcanvas(content, lo = -0.5, hi = 24.5) {
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
      let prevRemoved = false;
      const outChunks = [];
      subpaths.forEach((sp, i) => {
        const p = polys[i];
        let a = 1e9, b = 1e9, x = -1e9, y = -1e9;
        for (const [px, py] of p) {
          a = Math.min(a, px); b = Math.min(b, py);
          x = Math.max(x, px); y = Math.max(y, py);
        }
        const dead = a > hi || b > hi || x < lo || y < lo;
        if (dead) {
          log.push(`удалён мёртвый суб-путь ${i} за канвой: (${a.toFixed(1)},${b.toFixed(1)})–(${x.toFixed(1)},${y.toFixed(1)})`);
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
  const { content: out, log } = removeOffcanvas(content);
  console.log(file.split(/[\\/]/).slice(-2).join('/') + ':');
  for (const l of log) console.log('  ' + l);
  if (!log.length) console.log('  чисто');
  if (writeFlag === '--write' && log.length) {
    writeFileSync(file, out);
    console.log('  записано');
  }
}
