/**
 * scripts/lib/path-data.js — парсер SVG path `d` + точный bbox (zero-dep).
 *
 * Зачем: метаданные слоёв иконок (якоря transform-origin, границы) считаются
 * на билд-тайме из геометрии `d` — без DOM/getBBox (SSR-чистота, детерминизм,
 * ресёрч REPORT.md вывод №4). Экстремумы кривых считаются ТОЧНО:
 * кубик/квадратик — корни производной; эллиптическая дуга — центральная
 * параметризация по W3C SVG 1.1 B.2.4 + осевые углы. Приближение bbox'ом
 * контрольных точек запрещено (даёт ложные поля до 25% высоты дуги).
 *
 * Экспорт:
 *   parsePathData(d)      → сегменты абсолютных команд M/L/C/Q/A/Z
 *                           (H/V/S/T/relative нормализованы на парсинге)
 *   pathBBox(d)           → { minX, minY, maxX, maxY } точный
 *   samplePath(d, steps)  → плотная полилиния [[x,y],…] НЕЗАВИСИМОЙ оценкой
 *                           (де Кастельжо / шаг по углу) — оракл для тестов
 */

// ─── Токенизатор чисел (грамматика SVG path: компактные формы svgo) ─────────

const NUM_RE = /[+-]?(?:\d*\.\d+|\d+\.?)(?:[eE][+-]?\d+)?/y;

function makeScanner(d) {
  let pos = 0;
  return {
    /** Пропустить разделители (пробелы/запятые). */
    skipSep() {
      while (pos < d.length) {
        const ch = d[pos];
        if (ch === ' ' || ch === ',' || ch === '\t' || ch === '\n' || ch === '\r') pos++;
        else break;
      }
    },
    /** Следующая буква команды или null. */
    peekCommand() {
      this.skipSep();
      if (pos >= d.length) return null;
      const ch = d[pos];
      return /[a-zA-Z]/.test(ch) ? ch : null;
    },
    takeCommand() {
      const c = this.peekCommand();
      if (c !== null) pos++;
      return c;
    },
    /** Есть ли впереди число (продолжение неявной команды). */
    hasNumber() {
      this.skipSep();
      NUM_RE.lastIndex = pos;
      return pos < d.length && NUM_RE.test(d);
    },
    number(what) {
      this.skipSep();
      NUM_RE.lastIndex = pos;
      const m = NUM_RE.exec(d);
      if (!m || m.index !== pos) {
        throw new Error(`path-data: ожидалось число (${what}) на позиции ${pos}: …${d.slice(pos, pos + 16)}`);
      }
      pos = NUM_RE.lastIndex;
      return Number(m[0]);
    },
    /** Арк-флаг: РОВНО один символ 0/1 (сжатая форма «011» = 0,1,1). */
    flag(what) {
      this.skipSep();
      const ch = d[pos];
      if (ch !== '0' && ch !== '1') {
        throw new Error(`path-data: ожидался флаг 0/1 (${what}) на позиции ${pos}: …${d.slice(pos, pos + 16)}`);
      }
      pos++;
      return ch === '1' ? 1 : 0;
    },
  };
}

// ─── Парсер команд → нормализованные абсолютные сегменты ────────────────────

/**
 * @typedef {(
 *   {cmd:'M'|'L', x:number, y:number} |
 *   {cmd:'C', x1:number, y1:number, x2:number, y2:number, x:number, y:number} |
 *   {cmd:'Q', x1:number, y1:number, x:number, y:number} |
 *   {cmd:'A', rx:number, ry:number, rotation:number, largeArc:0|1, sweep:0|1, x:number, y:number} |
 *   {cmd:'Z'}
 * )} Segment
 */

/** @returns {Segment[]} */
export function parsePathData(d) {
  const s = makeScanner(d);
  /** @type {Segment[]} */
  const out = [];
  let cx = 0, cy = 0;         // текущая точка
  let sx = 0, sy = 0;         // старт субпути (для Z)
  let prevC = null;           // последняя контрольная C/S (для S-отражения)
  let prevQ = null;           // последняя контрольная Q/T (для T-отражения)
  let cmd = null;

  for (;;) {
    const next = s.takeCommand();
    if (next !== null) {
      cmd = next;
    } else if (!s.hasNumber()) {
      break; // конец данных
    } else if (cmd === null) {
      throw new Error('path-data: данные до первой команды');
    } else if (cmd === 'M') {
      cmd = 'L'; // неявные координаты после M — это L (грамматика SVG)
    } else if (cmd === 'm') {
      cmd = 'l';
    } else if (cmd === 'Z' || cmd === 'z') {
      throw new Error('path-data: числа после Z без команды');
    }
    // иначе — повтор той же команды с новыми параметрами

    const isRel = cmd >= 'a' && cmd <= 'z';
    const C = cmd.toUpperCase();

    if (C === 'Z') {
      out.push({ cmd: 'Z' });
      cx = sx; cy = sy;
      prevC = prevQ = null;
      continue;
    }

    if (C === 'M') {
      const x = s.number('M.x') + (isRel ? cx : 0);
      const y = s.number('M.y') + (isRel ? cy : 0);
      out.push({ cmd: 'M', x, y });
      cx = x; cy = y; sx = x; sy = y;
      prevC = prevQ = null;
    } else if (C === 'L') {
      const x = s.number('L.x') + (isRel ? cx : 0);
      const y = s.number('L.y') + (isRel ? cy : 0);
      out.push({ cmd: 'L', x, y });
      cx = x; cy = y;
      prevC = prevQ = null;
    } else if (C === 'H') {
      const x = s.number('H.x') + (isRel ? cx : 0);
      out.push({ cmd: 'L', x, y: cy });
      cx = x;
      prevC = prevQ = null;
    } else if (C === 'V') {
      const y = s.number('V.y') + (isRel ? cy : 0);
      out.push({ cmd: 'L', x: cx, y });
      cy = y;
      prevC = prevQ = null;
    } else if (C === 'C') {
      const x1 = s.number('C.x1') + (isRel ? cx : 0);
      const y1 = s.number('C.y1') + (isRel ? cy : 0);
      const x2 = s.number('C.x2') + (isRel ? cx : 0);
      const y2 = s.number('C.y2') + (isRel ? cy : 0);
      const x = s.number('C.x') + (isRel ? cx : 0);
      const y = s.number('C.y') + (isRel ? cy : 0);
      out.push({ cmd: 'C', x1, y1, x2, y2, x, y });
      prevC = [x2, y2];
      prevQ = null;
      cx = x; cy = y;
    } else if (C === 'S') {
      // Отражение второй контрольной предыдущей C/S относительно текущей точки.
      const x1 = prevC ? 2 * cx - prevC[0] : cx;
      const y1 = prevC ? 2 * cy - prevC[1] : cy;
      const x2 = s.number('S.x2') + (isRel ? cx : 0);
      const y2 = s.number('S.y2') + (isRel ? cy : 0);
      const x = s.number('S.x') + (isRel ? cx : 0);
      const y = s.number('S.y') + (isRel ? cy : 0);
      out.push({ cmd: 'C', x1, y1, x2, y2, x, y });
      prevC = [x2, y2];
      prevQ = null;
      cx = x; cy = y;
    } else if (C === 'Q') {
      const x1 = s.number('Q.x1') + (isRel ? cx : 0);
      const y1 = s.number('Q.y1') + (isRel ? cy : 0);
      const x = s.number('Q.x') + (isRel ? cx : 0);
      const y = s.number('Q.y') + (isRel ? cy : 0);
      out.push({ cmd: 'Q', x1, y1, x, y });
      prevQ = [x1, y1];
      prevC = null;
      cx = x; cy = y;
    } else if (C === 'T') {
      const x1 = prevQ ? 2 * cx - prevQ[0] : cx;
      const y1 = prevQ ? 2 * cy - prevQ[1] : cy;
      const x = s.number('T.x') + (isRel ? cx : 0);
      const y = s.number('T.y') + (isRel ? cy : 0);
      out.push({ cmd: 'Q', x1, y1, x, y });
      prevQ = [x1, y1];
      prevC = null;
      cx = x; cy = y;
    } else if (C === 'A') {
      const rx = s.number('A.rx');
      const ry = s.number('A.ry');
      const rotation = s.number('A.rot');
      const largeArc = s.flag('A.largeArc');
      const sweep = s.flag('A.sweep');
      const x = s.number('A.x') + (isRel ? cx : 0);
      const y = s.number('A.y') + (isRel ? cy : 0);
      out.push({ cmd: 'A', rx, ry, rotation, largeArc, sweep, x, y });
      prevC = prevQ = null;
      cx = x; cy = y;
    } else {
      throw new Error(`path-data: неизвестная команда "${cmd}"`);
    }
  }
  return out;
}

// ─── Центральная параметризация дуги (W3C SVG 1.1 приложение B.2.4) ─────────

/**
 * @returns {null | {cx:number, cy:number, rx:number, ry:number, phi:number,
 *                   theta1:number, dTheta:number}} null = вырожденная (линия, F.6.6)
 */
function arcCenter(x1, y1, seg) {
  let { rx, ry } = seg;
  const { rotation, largeArc, sweep, x: x2, y: y2 } = seg;
  if (rx === 0 || ry === 0) return null; // спека F.6.6: как прямая
  rx = Math.abs(rx);
  ry = Math.abs(ry);
  const phi = (rotation * Math.PI) / 180;
  const cosPhi = Math.cos(phi);
  const sinPhi = Math.sin(phi);

  // (F.6.5.1) средняя точка в системе эллипса
  const dx2 = (x1 - x2) / 2;
  const dy2 = (y1 - y2) / 2;
  const x1p = cosPhi * dx2 + sinPhi * dy2;
  const y1p = -sinPhi * dx2 + cosPhi * dy2;

  // (F.6.6.2) коррекция недостаточных радиусов
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }

  // (F.6.5.2) центр в системе эллипса
  const rx2 = rx * rx;
  const ry2 = ry * ry;
  const num = rx2 * ry2 - rx2 * y1p * y1p - ry2 * x1p * x1p;
  const den = rx2 * y1p * y1p + ry2 * x1p * x1p;
  let coef = Math.sqrt(Math.max(0, num / den));
  if (largeArc === sweep) coef = -coef;
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;

  // (F.6.5.3) центр в исходной системе
  const cx = cosPhi * cxp - sinPhi * cyp + (x1 + x2) / 2;
  const cy = sinPhi * cxp + cosPhi * cyp + (y1 + y2) / 2;

  // (F.6.5.5/6) углы
  const angle = (ux, uy, vx, vy) => {
    const dot = ux * vx + uy * vy;
    const len = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    let a = Math.acos(Math.min(1, Math.max(-1, dot / len)));
    if (ux * vy - uy * vx < 0) a = -a;
    return a;
  };
  const theta1 = angle(1, 0, (x1p - cxp) / rx, (y1p - cyp) / ry);
  let dTheta = angle((x1p - cxp) / rx, (y1p - cyp) / ry, (-x1p - cxp) / rx, (-y1p - cyp) / ry);
  if (sweep === 0 && dTheta > 0) dTheta -= 2 * Math.PI;
  if (sweep === 1 && dTheta < 0) dTheta += 2 * Math.PI;

  return { cx, cy, rx, ry, phi, theta1, dTheta };
}

function arcPoint(c, theta) {
  const cosPhi = Math.cos(c.phi);
  const sinPhi = Math.sin(c.phi);
  const x = c.cx + c.rx * Math.cos(theta) * cosPhi - c.ry * Math.sin(theta) * sinPhi;
  const y = c.cy + c.rx * Math.cos(theta) * sinPhi + c.ry * Math.sin(theta) * cosPhi;
  return [x, y];
}

/**
 * Угол θ лежит внутри развёртки [theta1, theta1+dTheta]?
 * θ нормализуется В ОКНО периода со стороны theta1 по модулю 2π — сдвиг
 * только в одну сторону (while t<theta1 t+=2π) пропускал кандидатов,
 * стартовавших выше окна (класс-баг, пойман дифференциалом на accessibility).
 */
function thetaInSweep(theta, theta1, dTheta) {
  const TWO_PI = 2 * Math.PI;
  if (dTheta >= 0) {
    const t = theta1 + ((((theta - theta1) % TWO_PI) + TWO_PI) % TWO_PI);
    return t <= theta1 + dTheta + 1e-12;
  }
  const t = theta1 - ((((theta1 - theta) % TWO_PI) + TWO_PI) % TWO_PI);
  return t >= theta1 + dTheta - 1e-12;
}

// ─── Точный bbox ─────────────────────────────────────────────────────────────

function cubicAxisExtrema(p0, p1, p2, p3) {
  // d/dt кубика: 3(a t² + b t + c), a=-p0+3p1-3p2+p3, b=2(p0-2p1+p2), c=p1-p0
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  const ts = [];
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      const t = -c / b;
      if (t > 0 && t < 1) ts.push(t);
    }
  } else {
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      for (const t of [(-b + sq) / (2 * a), (-b - sq) / (2 * a)]) {
        if (t > 0 && t < 1) ts.push(t);
      }
    }
  }
  return ts;
}

function cubicAt(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return mt * mt * mt * p0 + 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t * p3;
}

function quadAt(p0, p1, p2, t) {
  const mt = 1 - t;
  return mt * mt * p0 + 2 * mt * t * p1 + t * t * p2;
}

/** @returns {{minX:number, minY:number, maxX:number, maxY:number}} */
export function pathBBox(d) {
  const segs = parsePathData(d);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x, y) => {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  };

  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const seg of segs) {
    if (seg.cmd === 'Z') {
      cx = sx; cy = sy;
      continue;
    }
    if (seg.cmd === 'M') {
      add(seg.x, seg.y);
      cx = seg.x; cy = seg.y; sx = seg.x; sy = seg.y;
      continue;
    }
    if (seg.cmd === 'L') {
      add(cx, cy);
      add(seg.x, seg.y);
    } else if (seg.cmd === 'C') {
      add(cx, cy);
      add(seg.x, seg.y);
      for (const t of cubicAxisExtrema(cx, seg.x1, seg.x2, seg.x)) {
        add(cubicAt(cx, seg.x1, seg.x2, seg.x, t), cubicAt(cy, seg.y1, seg.y2, seg.y, t));
      }
      for (const t of cubicAxisExtrema(cy, seg.y1, seg.y2, seg.y)) {
        add(cubicAt(cx, seg.x1, seg.x2, seg.x, t), cubicAt(cy, seg.y1, seg.y2, seg.y, t));
      }
    } else if (seg.cmd === 'Q') {
      add(cx, cy);
      add(seg.x, seg.y);
      // d/dt квадратика по оси: 2((p0-2p1+p2)t + (p1-p0)) → t=(p0-p1)/(p0-2p1+p2)
      for (const [p0, p1, p2] of [
        [cx, seg.x1, seg.x],
        [cy, seg.y1, seg.y],
      ]) {
        const den = p0 - 2 * p1 + p2;
        if (Math.abs(den) > 1e-12) {
          const t = (p0 - p1) / den;
          if (t > 0 && t < 1) {
            add(quadAt(cx, seg.x1, seg.x, t), quadAt(cy, seg.y1, seg.y, t));
          }
        }
      }
    } else if (seg.cmd === 'A') {
      add(cx, cy);
      add(seg.x, seg.y);
      const c = arcCenter(cx, cy, seg);
      if (c) {
        // Осевые экстремумы повёрнутого эллипса:
        // x'(θ)=0 → tanθ = −(ry/rx)·tanφ ; y'(θ)=0 → tanθ = (ry/rx)·cotφ
        const thetaX = Math.atan2(-c.ry * Math.sin(c.phi), c.rx * Math.cos(c.phi));
        const thetaY = Math.atan2(c.ry * Math.cos(c.phi), c.rx * Math.sin(c.phi));
        // Период решений tan — π: на полный оборот по два корня на ось.
        for (const base of [thetaX, thetaY]) {
          for (const th of [base, base + Math.PI]) {
            if (thetaInSweep(th, c.theta1, c.dTheta)) {
              const [px, py] = arcPoint(c, th);
              add(px, py);
            }
          }
        }
      }
    }
    cx = seg.x; cy = seg.y;
  }

  if (minX === Infinity) {
    throw new Error('path-data: пустой path — bbox не определён');
  }
  return { minX, minY, maxX, maxY };
}

// ─── Независимый плотный сэмплер (оракл дифференциальных тестов) ─────────────

/**
 * Полилиния пути НЕЗАВИСИМОЙ оценкой (де Кастельжо кубика/квадратика прямой
 * формулой, дуга — равномерный шаг по θ). Не использует pathBBox/экстремумы.
 * @returns {Array<[number, number]>}
 */
export function samplePath(d, stepsPerSeg = 256) {
  const segs = parsePathData(d);
  /** @type {Array<[number, number]>} */
  const pts = [];
  let cx = 0, cy = 0, sx = 0, sy = 0;
  for (const seg of segs) {
    if (seg.cmd === 'Z') {
      pts.push([sx, sy]);
      cx = sx; cy = sy;
      continue;
    }
    if (seg.cmd === 'M') {
      pts.push([seg.x, seg.y]);
      cx = seg.x; cy = seg.y; sx = seg.x; sy = seg.y;
      continue;
    }
    if (seg.cmd === 'L') {
      pts.push([seg.x, seg.y]);
    } else if (seg.cmd === 'C') {
      for (let i = 1; i <= stepsPerSeg; i++) {
        const t = i / stepsPerSeg;
        pts.push([cubicAt(cx, seg.x1, seg.x2, seg.x, t), cubicAt(cy, seg.y1, seg.y2, seg.y, t)]);
      }
    } else if (seg.cmd === 'Q') {
      for (let i = 1; i <= stepsPerSeg; i++) {
        const t = i / stepsPerSeg;
        pts.push([quadAt(cx, seg.x1, seg.x, t), quadAt(cy, seg.y1, seg.y, t)]);
      }
    } else if (seg.cmd === 'A') {
      const c = arcCenter(cx, cy, seg);
      if (!c) {
        pts.push([seg.x, seg.y]); // вырожденная → линия
      } else {
        for (let i = 1; i <= stepsPerSeg; i++) {
          const theta = c.theta1 + (c.dTheta * i) / stepsPerSeg;
          pts.push(arcPoint(c, theta));
        }
      }
    }
    cx = seg.x; cy = seg.y;
  }
  return pts;
}
