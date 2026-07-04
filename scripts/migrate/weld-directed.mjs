/**
 * weld-directed.mjs — направленная сшивка встык-швов (BL-020): узлы
 * path[A], лежащие на шве (ближе gap-порога к контурам других path),
 * сдвигаются по ЛОКАЛЬНОЙ нормали наружу на margin — край утапливается
 * под соседнее вещество (чёрное перекрывает чёрное), а края, граничащие
 * с белым, не трогаются (урок earth: радиальная инфляция меняла форму).
 * Контролы кривых двигаются вместе со своим узлом.
 *
 * Запуск: node weld-directed.mjs <файл.svg> <pathIndex> [margin=0.15] [--write]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { samplePolylines } from '../lib/curve-sampling.js';
import { parsePathData } from '../lib/path-data.js';
import { renderedPathData } from '../lib/icon-geometry.js';

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

export function weldDirected(content, pathIndex, margin = 0.15, gap = 0.06) {
  const ds = renderedPathData(content);
  const others = ds.filter((_, i) => i !== pathIndex).join('');
  const otherPolys = samplePolylines(others, 24).filter((p) => p.length > 2);
  // ближайшая точка на РЁБРАХ полилиний соседей (до точек — ловушка:
  // узел в 0.001 от ребра может быть в 0.3 от ближайшей выборки)
  const nearestOnOthers = (x, y) => {
    let min = 1e9, nx = 0, ny = 0;
    for (const p of otherPolys) {
      for (let i = 0; i < p.length; i++) {
        const a = p[i], b = p[(i + 1) % p.length];
        const abx = b[0] - a[0], aby = b[1] - a[1];
        const len2 = abx * abx + aby * aby || 1;
        let t = ((x - a[0]) * abx + (y - a[1]) * aby) / len2;
        t = Math.max(0, Math.min(1, t));
        const px = a[0] + abx * t, py = a[1] + aby * t;
        const d2 = Math.hypot(x - px, y - py);
        if (d2 < min) { min = d2; nx = px; ny = py; }
      }
    }
    return { dist: min, nx, ny };
  };
  // чернила соседей (even-odd по их полилиниям): сдвигаем ТОЛЬКО узлы,
  // за которыми чёрное вещество соседа — нахлёст невидим; узлы, глядящие
  // в белое, не трогаем (форма не меняется)
  const inOthersInk = (x, y) => {
    let cnt = 0;
    for (const p of otherPolys) {
      let inside = false;
      for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
        if ((p[i][1] > y) !== (p[j][1] > y) &&
            x < ((p[j][0] - p[i][0]) * (y - p[i][1])) / (p[j][1] - p[i][1]) + p[i][0])
          inside = !inside;
      }
      if (inside) cnt++;
    }
    return cnt % 2 === 1;
  };
  let idx = -1;
  let moved = 0;
  const newContent = content.replace(
    /(<path\b[^>]*?\bd=")([^"]+)(")/g,
    (whole, pre, dOrig, post) => {
      idx++;
      if (idx !== pathIndex) return whole;
      const segs = parsePathData(dOrig);
      let touched = false;
      const polys = samplePolylines(dOrig, 24);
      const subs = [];
      let cur = null;
      for (const s of segs) {
        if (s.cmd === 'M') {
          cur = [];
          subs.push(cur);
        }
        cur.push(s);
      }
      subs.forEach((sp, si) => {
        const poly = polys[si];
        if (!poly || poly.length < 3) return;
        let cx = 0, cy = 0;
        for (const [x, y] of poly) { cx += x; cy += y; }
        cx /= poly.length; cy /= poly.length;
        for (const s of sp) {
          if (!('x' in s) || s.cmd === 'Z') continue;
          const near = nearestOnOthers(s.x, s.y);
          if (near.dist < gap) {
            // направление сдвига = К соседу СКВОЗЬ его край (торцевые
            // стыки: «наружу от центроида» смотрит вбок, не в тело)
            let nx = near.nx - s.x, ny = near.ny - s.y;
            let len = Math.hypot(nx, ny);
            if (len < 1e-6) { // узел ровно на крае соседа: направление от центроида
              nx = s.x - cx; ny = s.y - cy; len = Math.hypot(nx, ny) || 1;
            }
            // направленность: за краем соседа должно быть его чёрное
            const probeX = s.x + (nx / len) * (near.dist + margin * 0.7);
            const probeY = s.y + (ny / len) * (near.dist + margin * 0.7);
            if (!inOthersInk(probeX, probeY)) continue;
            const dx = (nx / len) * (near.dist + margin), dy = (ny / len) * (near.dist + margin);
            for (const key of [['x','y'],['x1','y1'],['x2','y2']]) {
              if (key[0] in s) { s[key[0]] += dx; s[key[1]] += dy; }
            }
            moved++;
            touched = true;
          }
        }
      });
      // без сдвигов — исходный текст дословно (пересериализация зря
      // раздувает файл и теряет шортхенды)
      return touched ? pre + serialize(segs) + post : whole;
    },
  );
  return { content: newContent, moved };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const [file, pi, marginArg, writeFlag] = process.argv.slice(2);
  const content = readFileSync(file, 'utf8');
  const { content: out, moved } = weldDirected(content, Number(pi), Number(marginArg ?? 0.15));
  console.log(`сдвинуто шовных узлов: ${moved}`);
  if (writeFlag === '--write' && moved) {
    writeFileSync(file, out);
    console.log('записано');
  }
}
