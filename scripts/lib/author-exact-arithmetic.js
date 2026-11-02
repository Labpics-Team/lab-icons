/** Точная build-only арифметика. Ошибка и её предметный код принадлежат compiler. */
export function createAuthorExactArithmetic(onFailure) {
  const fail = kind => {
    onFailure(kind);
    throw new TypeError('author-exact-arithmetic: обработчик отказа обязан бросить ошибку.');
  };
  function fraction(n, d) {
    if (!d) fail('zero-denominator');
    if (d < 0n) { n = -n; d = -d; }
    let a = n < 0n ? -n : n, b = d;
    while (b) [a, b] = [b, a % b];
    return [n / a, d / a];
  }
  const add = (a, b) => fraction(a[0] * b[1] + b[0] * a[1], a[1] * b[1]);
  const sub = (a, b) => fraction(a[0] * b[1] - b[0] * a[1], a[1] * b[1]);
  const mul = (a, b) => fraction(a[0] * b[0], a[1] * b[1]);
  const div = (a, b) => fraction(a[0] * b[1], a[1] * b[0]);
  const cmp = (a, b) => a[0] * b[1] < b[0] * a[1] ? -1 : a[0] * b[1] > b[0] * a[1] ? 1 : 0;
  const square = a => mul(a, a);
  const min = values => values.reduce((a, b) => cmp(a, b) <= 0 ? a : b);
  const max = values => values.reduce((a, b) => cmp(a, b) >= 0 ? a : b);
  const receipt = value => ({ numerator: value[0].toString(), denominator: value[1].toString() });
  const bytes = new DataView(new ArrayBuffer(8));
  /** Дробь соответствует битам исходного Number, не десятичной записи. */
  function rational(value) {
    if (!Number.isFinite(value)) fail('nonfinite-operand');
    if (value === 0) return [0n, 1n];
    bytes.setFloat64(0, value);
    const bits = bytes.getBigUint64(0), exponent = Number((bits >> 52n) & 2047n);
    const mantissa = (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n);
    const shift = (exponent ? exponent - 1023 : -1022) - 52;
    const signed = bits >> 63n ? -mantissa : mantissa;
    return shift >= 0 ? [signed << BigInt(shift), 1n] : fraction(signed, 1n << BigInt(-shift));
  }
  const bitLength = value => value.toString(2).length;
  /** Точный exponent; предварительная разность bit lengths ошибается максимум на один. */
  function floorLog2(n, d) {
    let exponent = bitLength(n) - bitLength(d);
    if (exponent >= 0 ? n < (d << BigInt(exponent)) : (n << BigInt(-exponent)) < d) exponent--;
    return exponent;
  }
  function scaledRatio(n, d, exponent) {
    return exponent < 0 ? [n << BigInt(-exponent), d] : [n, d << BigInt(exponent)];
  }
  function materialize(significand, quantum, kind) {
    if (significand === 1n << 53n) { significand >>= 1n; quantum++; }
    const value = Number(significand) * 2 ** quantum;
    if (!Number.isFinite(value)) fail(kind);
    return value;
  }
  function integerRoot(value) {
    if (value < 2n) return value;
    let root = 1n << BigInt(Math.ceil(bitLength(value) / 2));
    let next = (root + value / root) >> 1n;
    while (next < root) { root = next; next = (root + value / root) >> 1n; }
    return root;
  }
  function directedNumber(value, direction) {
    const canonical = fraction(...value), sign = canonical[0] < 0n ? -1 : 1, n = canonical[0] * BigInt(sign), d = canonical[1];
    if (!n) return 0;
    const quantum = Math.max(floorLog2(n, d) - 52, -1074), [N, D] = scaledRatio(n, d, quantum);
    const floor = N / D, significand = floor + (direction * sign > 0 && N % D !== 0n ? 1n : 0n);
    const result = sign * materialize(significand, quantum, 'number-bound');
    if (direction * cmp(rational(result), canonical) < 0) fail('number-bound');
    return result;
  }
  function directedRoot(value, direction) {
    const canonical = fraction(...value), [n, d] = canonical;
    if (n < 0n) fail('root-bound');
    if (!n) return 0;
    const quantum = Math.max(Math.floor(floorLog2(n, d) / 2) - 52, -1074), [N, D] = scaledRatio(n, d, 2 * quantum);
    // После exact scaling quotient имеет максимум 106 бит независимо от размера n/d.
    const floor = integerRoot(N / D), significand = floor + (direction > 0 && floor * floor * D < N ? 1n : 0n);
    const result = materialize(significand, quantum, 'root-bound');
    if (direction * cmp(square(rational(result)), canonical) < 0) fail('root-bound');
    return result;
  }
  return Object.freeze({ fraction, add, sub, mul, div, cmp, square, min, max, receipt, rational,
    directedNumber, directedRoot, upperRoot: value => directedRoot(value, 1), lowerRoot: value => directedRoot(value, -1) });
}
