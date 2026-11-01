/** Границы квантилей не предполагают нормальную latency и не выдумывают хвосты. */
function observations(values) {
  if (!Array.isArray(values) || values.length < 2 ||
      Array.from({ length: values.length }, (_, index) => values[index]).some(value => !Number.isFinite(value) || value < 0)) {
    throw new TypeError('benchmark: нужны плотные конечные неотрицательные наблюдения');
  }
  return [...values].sort((left, right) => left - right);
}

function probability(value, name) {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) throw new TypeError(`benchmark: неверная ${name}`);
}

function bitsOf(value) {
  const view = new DataView(new ArrayBuffer(8));
  view.setFloat64(0, value);
  return view.getBigUint64(0);
}

function adjacent(value, direction) {
  if (value === 0) return direction > 0 ? Number.MIN_VALUE : 0;
  const view = new DataView(new ArrayBuffer(8));
  view.setBigUint64(0, bitsOf(value) + BigInt(direction));
  return view.getFloat64(0);
}

function binary(value) {
  const bits = bitsOf(value), exponent = Number((bits >> 52n) & 2047n);
  return { significand: (bits & ((1n << 52n) - 1n)) + (exponent ? 1n << 52n : 0n), exponent: exponent ? exponent - 1075 : -1074 };
}

/** Сравнение с budget выполняется до округления ratio, без tolerance/epsilon. */
function ratioWithin(numerator, denominator, maximum) {
  if (numerator === null || denominator === null || denominator === 0) return null;
  const left = binary(numerator), divisor = binary(denominator), limit = binary(maximum);
  const shift = left.exponent - divisor.exponent - limit.exponent;
  return shift >= 0 ? (left.significand << BigInt(shift)) <= divisor.significand * limit.significand :
    left.significand <= (divisor.significand * limit.significand << BigInt(-shift));
}

/** Binomial(n,p): log-рекурсия сохраняет малые tail probabilities. */
function binomialMass(n, p) {
  const logs = [n * Math.log1p(-p)];
  for (let index = 1; index <= n; index++) {
    logs.push(logs[index - 1] + Math.log(n - index + 1) - Math.log(index) + Math.log(p) - Math.log1p(-p));
  }
  return logs.map(value => Math.exp(value));
}

export function quantileInterval(values, quantile, confidence = 0.95) {
  const sorted = observations(values);
  probability(quantile, 'quantile');
  probability(confidence, 'confidence');
  const mass = binomialMass(sorted.length, quantile);
  const tail = (1 - confidence) / 2;
  let below = 0, lowerRank = 0;
  for (let rank = 1; rank <= sorted.length; rank++) {
    below += mass[rank - 1];
    if (below <= tail) lowerRank = rank;
    else break;
  }
  let above = 0, upperRank = null;
  for (let rank = sorted.length; rank >= 1; rank--) {
    above += mass[rank];
    if (above <= tail) upperRank = rank;
    else break;
  }
  return {
    count: sorted.length, quantile, confidence,
    estimate: sorted[Math.ceil(sorted.length * quantile) - 1],
    lowerRank, upperRank,
    // Неотрицательный domain даёт 0; отсутствие верхней границы сохраняется явно.
    lower: lowerRank ? sorted[lowerRank - 1] : 0,
    upper: upperRank === null ? null : sorted[upperRank - 1],
  };
}

/** Union bound двух marginal intervals даёт совместную confidence границу ratio. */
export function quantileRatio(baseline, candidate, { quantile = 0.5, confidence = 0.95, resolution = 0 } = {}) {
  probability(confidence, 'confidence');
  if (!Number.isFinite(resolution) || resolution < 0) throw new TypeError('benchmark: неверное разрешение clock');
  const marginalConfidence = 1 - (1 - confidence) / 2;
  const base = quantileInterval(baseline, quantile, marginalConfidence);
  const head = quantileInterval(candidate, quantile, marginalConfidence);
  let arithmeticUnresolved = false;
  const divide = (numerator, denominator, direction = 0) => {
    if (numerator === null || denominator === null || denominator === 0) return null;
    const value = numerator / denominator;
    if (!Number.isFinite(value) || (numerator > 0 && value === 0)) {
      arithmeticUnresolved = true;
      return null;
    }
    const rounded = direction && value > 0 ? adjacent(value, direction) : value;
    if (!Number.isFinite(rounded)) { arithmeticUnresolved = true; return null; }
    return rounded;
  };
  const lower = divide(head.lower, base.upper, -1);
  const upper = divide(head.upper, base.lower, 1);
  const point = divide(head.estimate, base.estimate);
  const unresolvedClock = base.lower <= resolution || head.lower <= resolution;
  return {
    method: 'binomial-order-statistics/bonferroni-ratio-v1', confidence, quantile,
    baseline: base, candidate: head, point, lower, upper, resolution,
    arithmetic: 'outward binary64 bounds; exact binary64 input-ratio budget comparison',
    reason: arithmeticUnresolved ? 'ARITHMETIC_UNRESOLVED' : upper === null ? 'INSUFFICIENT_TAIL_OR_ZERO_BASELINE' : unresolvedClock ? 'BELOW_CLOCK_RESOLUTION' : null,
  };
}

export function assessQuantile(baseline, candidate, maximumRatio, options) {
  if (!Number.isFinite(maximumRatio) || maximumRatio <= 0) throw new TypeError('benchmark: неверный ratio budget');
  const interval = quantileRatio(baseline, candidate, options);
  const upperWithinBudget = ratioWithin(interval.candidate.upper, interval.baseline.lower, maximumRatio);
  const lowerWithinBudget = ratioWithin(interval.candidate.lower, interval.baseline.upper, maximumRatio);
  const verdict = ['BELOW_CLOCK_RESOLUTION', 'ARITHMETIC_UNRESOLVED'].includes(interval.reason) ? 'INCOMPLETE' :
    lowerWithinBudget === false ? 'FAIL' : interval.reason ? 'INCOMPLETE' : upperWithinBudget ? 'PASS' : 'INCOMPLETE';
  return { verdict, maximumRatio, upperWithinBudget, lowerWithinBudget, ...interval };
}

/** Calibration выполняется до candidate; шум не расширяет предел 5%. */
export function calibrateNoRegression(left, right, options = {}) {
  const confidence = options.confidence ?? 0.95;
  probability(confidence, 'confidence');
  const directionalConfidence = 1 - (1 - confidence) / 2;
  const forward = quantileRatio(left, right, { ...options, confidence: directionalConfidence });
  const reverse = quantileRatio(right, left, { ...options, confidence: directionalConfidence });
  if (forward.reason || reverse.reason) return { verdict: 'INCOMPLETE', tolerance: null, confidence, forward, reverse, reason: 'CALIBRATION_UNRESOLVED' };
  const maximumRatio = Math.max(1, forward.upper, reverse.upper);
  const accepted = ratioWithin(forward.candidate.upper, forward.baseline.lower, 1.05) && ratioWithin(reverse.candidate.upper, reverse.baseline.lower, 1.05);
  const tolerance = maximumRatio - 1;
  return { verdict: accepted ? 'PASS' : 'INCOMPLETE', tolerance: accepted ? Math.min(0.05, tolerance) : null,
    observedUpperTolerance: tolerance, confidence, forward, reverse, reason: accepted ? null : 'CALIBRATION_EXCEEDS_FIVE_PERCENT' };
}

/** Counts не получают статистического послабления, включая baseline=0. */
export function assessCount(baseline, candidate, maximumRatio = 1) {
  if (!Number.isSafeInteger(baseline) || baseline < 0 || !Number.isSafeInteger(candidate) || candidate < 0 ||
      !Number.isFinite(maximumRatio) || maximumRatio <= 0) throw new TypeError('benchmark: неверный count budget');
  const accepted = baseline === 0 ? candidate === 0 : ratioWithin(candidate, baseline, maximumRatio);
  return { verdict: accepted ? 'PASS' : 'FAIL', baseline, candidate, maximumRatio,
    ratio: baseline === 0 ? null : candidate / baseline };
}
