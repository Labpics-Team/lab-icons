// path-ast: лоссless парсер/сериализатор SVG path d + аффинные операции реестра.
// Ядро геометрической системы lab-icons: зеркала/сдвиги/масштаб без потери кривых.
// Инвариант: flatten(serialize(parse(d))) совпадает с flatten(d) (см. test/geometry-roundtrip).

const NUM = /-?\d*\.?\d+(?:e[-+]?\d+)?/y;
const ARGC = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** d → [{cmd, args:number[]}] (повторные наборы аргументов разворачиваются в отдельные команды) */
export function parsePath(d) {
  const cmds = [];
  let i = 0;
  const ws = () => { while (i < d.length && /[\s,]/.test(d[i])) i++; };
  const num = () => {
    ws(); NUM.lastIndex = i;
    const m = NUM.exec(d);
    if (!m) throw new Error(`число не распарсилось @${i}: …${d.slice(i, i + 20)}`);
    i = NUM.lastIndex;
    return parseFloat(m[0]);
  };
  // флаги арок могут слипаться ("1119" = 1 1 19) — читаем по одному символу
  const flag = () => {
    ws();
    const c = d[i];
    if (c !== '0' && c !== '1') throw new Error(`флаг арки не 0/1 @${i}: ${c}`);
    i++;
    return c === '1' ? 1 : 0;
  };
  let cur = '';
  while (i < d.length) {
    ws();
    if (i >= d.length) break;
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(d[i])) cur = d[i++];
    if (!cur) throw new Error(`нет команды @${i}`);
    const up = cur.toUpperCase();
    if (up === 'Z') { cmds.push({ cmd: cur, args: [] }); cur = ''; continue; }
    const args = [];
    if (up === 'A') {
      args.push(num(), num(), num(), flag(), flag(), num(), num());
    } else {
      for (let k = 0; k < ARGC[up]; k++) args.push(num());
    }
    cmds.push({ cmd: cur, args });
    // повторные наборы: M→L / m→l по спеке
    if (up === 'M') cur = cur === 'M' ? 'L' : 'l';
  }
  return cmds;
}

const fmt = (n) => {
  const r = Math.round(n * 1000) / 1000;
  let s = String(r);
  if (s.startsWith('0.')) s = s.slice(1);
  else if (s.startsWith('-0.')) s = '-' + s.slice(2);
  return s;
};

/** AST → d (компактно: команды слитно, аргументы через пробел) */
export function serializePath(cmds) {
  let out = '';
  for (const { cmd, args } of cmds) {
    out += cmd;
    if (args.length) out += args.map(fmt).join(' ');
  }
  return out;
}

/** Абсолютизация: все команды → верхний регистр с абсолютными координатами */
export function toAbsolute(cmds) {
  const out = [];
  let x = 0, y = 0, sx = 0, sy = 0;
  for (const { cmd, args } of cmds) {
    const rel = cmd === cmd.toLowerCase();
    const up = cmd.toUpperCase();
    let a = args.slice();
    switch (up) {
      case 'M': case 'L': case 'T':
        if (rel) { a[0] += x; a[1] += y; }
        x = a[0]; y = a[1];
        if (up === 'M') { sx = x; sy = y; }
        break;
      case 'H': if (rel) a[0] += x; x = a[0]; a = [x, y]; out.push({ cmd: 'L', args: a }); continue;
      case 'V': if (rel) a[0] += y; y = a[0]; a = [x, y]; out.push({ cmd: 'L', args: a }); continue;
      case 'C':
        if (rel) { a[0]+=x; a[1]+=y; a[2]+=x; a[3]+=y; a[4]+=x; a[5]+=y; }
        x = a[4]; y = a[5]; break;
      case 'S': case 'Q':
        if (rel) { a[0]+=x; a[1]+=y; a[2]+=x; a[3]+=y; }
        x = a[2]; y = a[3]; break;
      case 'A':
        if (rel) { a[5] += x; a[6] += y; }
        x = a[5]; y = a[6]; break;
      case 'Z': x = sx; y = sy; break;
    }
    out.push({ cmd: up, args: a });
  }
  return out;
}

/** Аффин по абсолютному AST. m = {a,b,c,d,e,f}: x'=a·x+c·y+e, y'=b·x+d·y+f.
 *  Ограничение: для A поддержаны только зеркала/масштаб без skew (b=c=0) либо чистые повороты на 90°. */
export function applyAffine(absCmds, m) {
  const px = (X, Y) => m.a * X + m.c * Y + m.e;
  const py = (X, Y) => m.b * X + m.d * Y + m.f;
  const det = m.a * m.d - m.b * m.c;
  const flip = det < 0;
  const scale = Math.sqrt(Math.abs(det));
  return absCmds.map(({ cmd, args }) => {
    const a = args.slice();
    switch (cmd) {
      case 'M': case 'L': case 'T': {
        const X = px(a[0], a[1]), Y = py(a[0], a[1]);
        return { cmd, args: [X, Y] };
      }
      case 'C': {
        const r = [];
        for (let k = 0; k < 6; k += 2) { r.push(px(a[k], a[k+1]), py(a[k], a[k+1])); }
        return { cmd, args: r };
      }
      case 'S': case 'Q': {
        const r = [];
        for (let k = 0; k < 4; k += 2) { r.push(px(a[k], a[k+1]), py(a[k], a[k+1])); }
        return { cmd, args: r };
      }
      case 'A': {
        const [rx, ry, rot, laf, sf, X0, Y0] = a;
        // без skew: новые радиусы = масштаб; поворот эллипса при зеркале — отражается
        const nrx = rx * (Math.hypot(m.a, m.b));
        const nry = ry * (Math.hypot(m.c, m.d));
        const nrot = flip ? -rot : rot;
        const nsf = flip ? (sf ? 0 : 1) : sf;
        return { cmd: 'A', args: [nrx, nry, nrot, laf, nsf, px(X0, Y0), py(X0, Y0)] };
      }
      case 'Z': return { cmd, args: [] };
      default: throw new Error(`applyAffine: неожиданная команда ${cmd}`);
    }
  });
}

export const MIRROR_X = { a: -1, b: 0, c: 0, d: 1, e: 24, f: 0 };  // зеркало по вертикальной оси (x→24−x)
export const MIRROR_Y = { a: 1, b: 0, c: 0, d: -1, e: 0, f: 24 };  // зеркало по горизонтальной оси

/** Хелпер: d → зеркальный d */
export function mirrorPath(d, axis = 'H') {
  return serializePath(applyAffine(toAbsolute(parsePath(d)), axis === 'H' ? MIRROR_X : MIRROR_Y));
}

/** Разбор svg-файла: [{attrs, d}] по каждому <path> */
export function extractPaths(svg) {
  return [...svg.matchAll(/<path\b([^>]*?)\sd="([^"]+)"([^>]*?)\/?>/g)].map(m => ({
    before: m[1], d: m[2], after: m[3],
  }));
}
