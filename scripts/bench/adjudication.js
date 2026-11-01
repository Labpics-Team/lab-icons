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
  const lower = base.upper === null || base.upper === 0 ? null : head.lower / base.upper;
  const upper = head.upper === null || base.lower === 0 ? null : head.upper / base.lower;
  const point = base.estimate === 0 ? null : head.estimate / base.estimate;
  const unresolvedClock = base.lower <= resolution || head.lower <= resolution;
  return {
    method: 'binomial-order-statistics/bonferroni-ratio-v1', confidence, quantile,
    baseline: base, candidate: head, point, lower, upper, resolution,
    reason: upper === null ? 'INSUFFICIENT_TAIL_OR_ZERO_BASELINE' : unresolvedClock ? 'BELOW_CLOCK_RESOLUTION' : null,
  };
}

export function assessQuantile(baseline, candidate, maximumRatio, options) {
  if (!Number.isFinite(maximumRatio) || maximumRatio <= 0) throw new TypeError('benchmark: неверный ratio budget');
  const interval = quantileRatio(baseline, candidate, options);
  const verdict = interval.reason ? 'INCOMPLETE' : interval.upper <= maximumRatio ? 'PASS' :
    interval.lower !== null && interval.lower > maximumRatio ? 'FAIL' : 'INCOMPLETE';
  return { verdict, maximumRatio, ...interval };
}

/** Calibration выполняется до candidate; шум не расширяет предел 5%. */
export function calibrateNoRegression(left, right, options = {}) {
  const confidence = options.confidence ?? 0.95;
  probability(confidence, 'confidence');
  const directionalConfidence = 1 - (1 - confidence) / 2;
  const forward = quantileRatio(left, right, { ...options, confidence: directionalConfidence });
  const reverse = quantileRatio(right, left, { ...options, confidence: directionalConfidence });
  if (forward.reason || reverse.reason) return { verdict: 'INCOMPLETE', tolerance: null, confidence, forward, reverse, reason: 'CALIBRATION_UNRESOLVED' };
  const tolerance = Math.max(0, forward.upper - 1, reverse.upper - 1);
  return { verdict: tolerance <= 0.05 ? 'PASS' : 'INCOMPLETE', tolerance: tolerance <= 0.05 ? tolerance : null,
    observedUpperTolerance: tolerance, confidence, forward, reverse, reason: tolerance <= 0.05 ? null : 'CALIBRATION_EXCEEDS_FIVE_PERCENT' };
}

/** Counts не получают статистического послабления, включая baseline=0. */
export function assessCount(baseline, candidate, maximumRatio = 1) {
  if (!Number.isSafeInteger(baseline) || baseline < 0 || !Number.isSafeInteger(candidate) || candidate < 0 ||
      !Number.isFinite(maximumRatio) || maximumRatio <= 0) throw new TypeError('benchmark: неверный count budget');
  return { verdict: candidate <= baseline * maximumRatio ? 'PASS' : 'FAIL', baseline, candidate, maximumRatio,
    ratio: baseline === 0 ? null : candidate / baseline };
}
