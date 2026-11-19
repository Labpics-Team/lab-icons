/** Простые статистики сохраняют сырые повторы и область измерения. */
export function summarize(values) {
  if (!Array.isArray(values) || values.length < 2 || values.some((value) => !Number.isFinite(value) || value < 0)) {
    throw new TypeError('benchmark: нужны хотя бы два конечных неотрицательных наблюдения');
  }
  const sorted = [...values].sort((left, right) => left - right);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
  const deviation = Math.sqrt(variance);
  const middle = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return { count: values.length, mean, standardDeviation: deviation, meanStandardError: deviation / Math.sqrt(values.length), min: sorted[0], median, max: sorted.at(-1), raw: values };
}

/** Один clock и действительный paint endpoint; промежуточная работа не исчезает. */
export function coldRenderSpan(timing) {
  const phases = ['importStartedAt', 'importResolvedAt', 'firstCreateStartedAt', 'firstCreateEndedAt',
    'mountStartedAt', 'mountEndedAt', 'contentfulPaintAt'];
  if (!timing || phases.some(phase => !Number.isFinite(timing[phase]) || timing[phase] < 0)) {
    throw new TypeError('benchmark: cold render требует конечные milestones одного performance clock');
  }
  if (phases.some((phase, index) => index && timing[phase] < timing[phases[index - 1]])) {
    throw new TypeError('benchmark: cold render milestones нарушают import → create → mount → paint');
  }
  return { coldImportMs: timing.importResolvedAt - timing.importStartedAt,
    coldImportToUsefulRenderMs: timing.contentfulPaintAt - timing.importStartedAt };
}

/** Guard предотвращает случайный запуск нагрузки на рабочей станции. */
export function assertRemoteBenchmark(env = process.env) {
  if (env.GITHUB_ACTIONS !== 'true' || env.CI !== 'true' || !/^\d+$/.test(env.GITHUB_RUN_ID ?? '') ||
      !['self-hosted', 'github-hosted'].includes(env.BENCHMARK_RUNNER_ENVIRONMENT)) {
    throw new Error('benchmark: тяжёлая нагрузка разрешена только в штатном удалённом GitHub runner job');
  }
}
