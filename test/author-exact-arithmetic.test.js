import { describe, expect, it } from 'vitest';
import { createAuthorExactArithmetic } from '../scripts/lib/author-exact-arithmetic.js';

const arithmetic = createAuthorExactArithmetic(kind => { throw Object.assign(new Error(kind), { code: kind }); });
const { rational, fraction, add, sub, mul, div, cmp, square, directedNumber, lowerRoot, upperRoot, receipt } = arithmetic;
const compare = (a, b) => a[0] * b[1] - b[0] * a[1];
const adjacent = (value, direction) => {
  const bytes = new DataView(new ArrayBuffer(8)); bytes.setFloat64(0, value);
  bytes.setBigUint64(0, bytes.getBigUint64(0) + BigInt(direction)); return bytes.getFloat64(0);
};
describe('shared author exact arithmetic: binary input and directed materialized bounds', () => {
  it('represents known binary64 values exactly, including sign and subnormal', () => {
    expect(rational(0.1)).toEqual([3602879701896397n, 36028797018963968n]);
    expect(rational(-0.1)).toEqual([-3602879701896397n, 36028797018963968n]);
    expect(rational(Number.MIN_VALUE)).toEqual([1n, 1n << 1074n]);
    expect(rational(2 ** -1022)).toEqual([1n, 1n << 1022n]);
    expect(rational(2 ** 100)).toEqual([1n << 100n, 1n]);
    expect(rational(-0)).toEqual([0n, 1n]);
    expect(receipt(rational(0.1))).toEqual({ numerator: '3602879701896397', denominator: '36028797018963968' });
  });
  it('reduces arithmetic without converting through Number', () => {
    expect(fraction(-6n, -8n)).toEqual([3n, 4n]);
    expect(add([1n, 3n], [1n, 6n])).toEqual([1n, 2n]);
    expect(sub([1n, 3n], [1n, 2n])).toEqual([-1n, 6n]);
    expect(mul([3n, 7n], [14n, 9n])).toEqual([2n, 3n]);
    expect(div([3n, 7n], [9n, 14n])).toEqual([2n, 3n]);
    expect(cmp([1n, 3n], [3333333333333333n, 10000000000000000n])).toBe(1);
  });
  it.each([[1n, 10n], [-1n, 10n], [1n, 3n], [-1n, 3n], [9007199254740993n, 9007199254740992n]])('directed Number encloses %s/%s on both sides', (n, d) => {
    const value = [n, d], lower = directedNumber(value, -1), upper = directedNumber(value, 1);
    expect(compare(rational(lower), value)).toBeLessThanOrEqual(0n);
    expect(compare(rational(upper), value)).toBeGreaterThanOrEqual(0n);
    expect(lower).toBeLessThanOrEqual(upper);
  });
  it.each([[2n, 1n], [1n, 10n], [27398335617n, 250000000n], [18996717409n, 250000000n]])('directed roots enclose sqrt(%s/%s) after binary64 serialization', (n, d) => {
    const value = [n, d], lower = lowerRoot(value), upper = upperRoot(value);
    const decoded = JSON.parse(JSON.stringify({ lower, upper }));
    expect(compare(square(rational(decoded.lower)), value)).toBeLessThanOrEqual(0n);
    expect(compare(square(rational(decoded.upper)), value)).toBeGreaterThanOrEqual(0n);
    expect(decoded.lower).toBeLessThanOrEqual(decoded.upper);
  });
  it('normal round-to-nearest sqrt2 is not a valid lower bound', () => {
    const root = Math.sqrt(2), squared = square(rational(root));
    expect(compare(squared, [2n, 1n])).toBeGreaterThan(0n);
    expect(lowerRoot([2n, 1n])).toBe(adjacent(root, -1));
    expect(upperRoot([2n, 1n])).toBe(root);
    expect(lowerRoot([4n, 1n])).toBe(2); expect(upperRoot([4n, 1n])).toBe(2);
  });
  it('returns the consumer failure code for nonfinite and unrepresentable bounds', () => {
    for (const value of [NaN, Infinity, -Infinity]) expect(() => rational(value)).toThrow(expect.objectContaining({ code: 'nonfinite-operand' }));
    expect(() => fraction(1n, 0n)).toThrow(expect.objectContaining({ code: 'zero-denominator' }));
    expect(() => directedNumber([1n << 2000n, 1n], 1)).toThrow(expect.objectContaining({ code: 'number-bound' }));
    expect(() => upperRoot([1n << 3000n, 1n])).toThrow(expect.objectContaining({ code: 'root-bound' }));
    expect(() => lowerRoot([-1n, 1n])).toThrow(expect.objectContaining({ code: 'root-bound' }));
  });
  it('huge separately unrepresentable integers still yield finite exact ratio and root', () => {
    const d = 1n << 2000n, n = d * 3n / 2n;
    expect(Number(n)).toBe(Infinity); expect(Number(d)).toBe(Infinity);
    expect(directedNumber([n, d], -1)).toBe(1.5); expect(directedNumber([n, d], 1)).toBe(1.5);
    const lo = lowerRoot([n, d]), hi = upperRoot([n, d]);
    expect(compare(square(rational(lo)), [n, d])).toBeLessThanOrEqual(0n);
    expect(compare(square(rational(hi)), [n, d])).toBeGreaterThanOrEqual(0n);
    expect(upperRoot([1n, 1n << 2000n])).toBe(2 ** -1000);
  });
  it('keeps directed subnormal bounds, quantum carries and exact extremes', () => {
    expect(directedNumber([1n, 1n << 2000n], -1)).toBe(0);
    expect(directedNumber([1n, 1n << 2000n], 1)).toBe(Number.MIN_VALUE);
    expect(directedNumber([-1n, 1n << 2000n], -1)).toBe(-Number.MIN_VALUE);
    expect(Object.is(directedNumber([-1n, 1n << 2000n], 1), -0)).toBe(true);
    expect(lowerRoot([1n, 1n << 2149n])).toBe(0);
    expect(upperRoot([1n, 1n << 2149n])).toBe(Number.MIN_VALUE);
    for (const value of [Number.MIN_VALUE, 2 ** -1022, 1, 2, Number.MAX_VALUE]) {
      expect(directedNumber(rational(value), -1)).toBe(value); expect(directedNumber(rational(value), 1)).toBe(value);
    }
    const beforeTwo = [(1n << 54n) - 1n, 1n << 53n];
    expect(directedNumber(beforeTwo, 1)).toBe(2);
    expect(directedNumber(beforeTwo, -1)).toBe(adjacent(2, -1));
  });
});
