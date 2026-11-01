const NUMBER = /[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/y;
const SPACE = /[\t\n\r ]/;

// Координаты остаются десятичными: цифры и степень десяти, без Number/округления.
function decimal(token) {
  const [mantissa, exponent = '0'] = token.toLowerCase().split('e');
  const negative = mantissa.startsWith('-');
  const unsigned = mantissa.replace(/^[+-]/, '');
  const fraction = unsigned.indexOf('.') < 0 ? 0 : unsigned.length - unsigned.indexOf('.') - 1;
  const significant = unsigned.replace('.', '').replace(/^0+/, '');
  const digits = significant.replace(/0+$/, '');
  if (!digits) return '0';
  const power = BigInt(exponent) - BigInt(fraction) + BigInt(significant.length - digits.length);
  return `${negative ? '-' : ''}${digits}e${power}`;
}

function closedContours(d) {
  if (typeof d !== 'string') return null;
  let cursor = 0;
  let previousNumber = false;
  let command;
  let start;
  let current;
  let edges;
  const contours = [];
  const pointEqual = (a, b) => a[0] === b[0] && a[1] === b[1];

  function number(separated = false) {
    while (SPACE.test(d[cursor] ?? '')) { cursor++; separated = true; }
    if (d[cursor] === ',') {
      if (!previousNumber) return null;
      cursor++;
      separated = true;
      while (SPACE.test(d[cursor] ?? '')) cursor++;
    }
    NUMBER.lastIndex = cursor;
    const match = NUMBER.exec(d);
    if (!match || (previousNumber && !separated && !/^[+.-]/.test(match[0]))) return null;
    cursor = NUMBER.lastIndex;
    previousNumber = true;
    return decimal(match[0]);
  }

  while (cursor < d.length) {
    const beforeSpace = cursor;
    while (SPACE.test(d[cursor] ?? '')) cursor++;
    if (cursor === d.length) break;
    const next = d[cursor];
    if (/[A-Za-z]/.test(next)) {
      cursor++;
      previousNumber = false;
      if (next === 'Z') {
        if (!start) return null;
        // Z создаёт прямое замыкание; нулевое замыкание не задаёт нового ребра.
        if (!pointEqual(current, start)) edges.push(['L', ...current, ...start]);
        contours.push({ start, edges });
        start = current = edges = command = undefined;
        continue;
      }
      if (!['M', 'L', 'H', 'V', 'C'].includes(next) || (next === 'M' ? start !== undefined : start === undefined)) return null;
      command = next;
    } else if (!command) return null;

    const values = [];
    const scalar = command === 'H' || command === 'V';
    for (let index = 0; index < (command === 'C' ? 6 : scalar ? 1 : 2); index++) {
      const value = number(index === 0 && cursor > beforeSpace);
      if (value === null) return null;
      values.push(value);
    }
    if (command === 'M') {
      start = current = values;
      edges = [];
      // Последующие пары абсолютного M — абсолютные L по SVG grammar.
      command = 'L';
    } else {
      // Absolute H/V сохраняют текущий y/x; арифметики нет.
      if (command === 'H') values.push(current[1]);
      if (command === 'V') values.unshift(current[0]);
      edges.push([scalar ? 'L' : command, ...current, ...values]);
      current = values.slice(-2);
    }
  }
  return start === undefined && contours.length ? contours : null;
}

// Два кандидата пропускают уже сравненную несовпадающую область: O(n) сравнений,
// одна итоговая rotation вместо материализации всех n вариантов.
function leastRotation(items) {
  const length = items.length;
  let left = 0, right = 1, offset = 0;
  while (left < length && right < length && offset < length) {
    const a = items[(left + offset) % length], b = items[(right + offset) % length];
    if (a === b) { offset++; continue; }
    if (a > b) {
      left += offset + 1;
      if (left <= right) left = right + 1;
    } else {
      right += offset + 1;
      if (right <= left) right = left + 1;
    }
    offset = 0;
  }
  const first = Math.min(left, right);
  return JSON.stringify(Array.from({ length }, (_, index) => items[(first + index) % length]));
}

function contourKeys({ start, edges }) {
  if (!edges.length) {
    const key = JSON.stringify(['point', ...start]);
    return [key, key];
  }
  const forward = edges.map(edge => JSON.stringify(edge));
  const reverse = [...edges].reverse().map(edge => JSON.stringify(edge[0] === 'L'
    ? ['L', ...edge.slice(-2), ...edge.slice(1, 3)]
    : ['C', ...edge.slice(-2), ...edge.slice(5, 7), ...edge.slice(3, 5), ...edge.slice(1, 3)]));
  return [leastRotation(forward), leastRotation(reverse)];
}

/**
 * Частный build-only достаточный признак: absolute M/L/H/V/C/Z, closed fill-only.
 * null означает «не доказано». Paint/rule/frame/IDs проверяет вызывающий владелец.
 * Контуры переставляются с сохранением количества и multiplicity всех рёбер.
 */
export function exactClosedFillPathKey(d, fillRule) {
  if (!['evenodd', 'nonzero'].includes(fillRule)) return null;
  const contours = closedContours(d);
  if (!contours) return null;
  const pairs = contours.map(contourKeys);
  if (fillRule === 'evenodd') return JSON.stringify(pairs.map(([a, b]) => a < b ? a : b).sort());
  // nonzero сохраняет взаимную ориентацию: только общий разворот меняет w на -w.
  const forward = JSON.stringify(pairs.map(([a]) => a).sort());
  const reverse = JSON.stringify(pairs.map(([, b]) => b).sort());
  return forward < reverse ? forward : reverse;
}
